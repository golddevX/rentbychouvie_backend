import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, BookingStatus, RentalStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditDisputesService } from '../audit-disputes/audit-disputes.service';

@Injectable()
export class PickupService {
  constructor(
    private prisma: PrismaService,
    private auditDisputesService: AuditDisputesService,
  ) {}

  private async findBooking(bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId, archivedAt: null },
      include: {
        customer: true,
        items: {
          include: {
            product: true,
            variant: true,
            inventoryItem: true,
          },
        },
        rental: {
          include: {
            inventoryItems: true,
          },
        },
      },
    });

    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }

  async scan(bookingId: string, qrCode: string) {
    const booking = await this.findBooking(bookingId);
    const item = await this.prisma.inventoryItem.findUnique({
      where: { qrCode },
      include: { product: true, variant: true },
    });

    if (!item) {
      throw new NotFoundException('Scanned QR code does not belong to an active inventory item');
    }

    const expectedItemIds = new Set(booking.items.map((bookingItem) => bookingItem.inventoryItemId));
    const matched = expectedItemIds.has(item.id);

    return {
      bookingId: booking.id,
      bookingStatus: booking.status,
      matched,
      message: matched
        ? 'QR matches an expected pickup item'
        : 'QR does not match this booking',
      scannedItem: {
        id: item.id,
        qrCode: item.qrCode,
        status: item.status,
        productName: item.product.name,
        variantName: item.variant?.name ?? null,
      },
      expectedItems: booking.items.map((bookingItem) => ({
        itemId: bookingItem.inventoryItemId,
        qrCode: bookingItem.inventoryItem.qrCode,
        productName: bookingItem.product.name,
        variantName: bookingItem.variant?.name ?? null,
      })),
    };
  }

  async confirm(bookingId: string, qrCodes: string[], pickedUpById?: string, conditionNotes?: string) {
    const booking = await this.findBooking(bookingId);
    const pickupReadyStatuses: BookingStatus[] = [
      BookingStatus.CONFIRMED,
      BookingStatus.SCHEDULED_PICKUP,
    ];
    if (!pickupReadyStatuses.includes(booking.status)) {
      throw new BadRequestException('Booking must be confirmed before pickup');
    }

    const scannedItems = await this.prisma.inventoryItem.findMany({
      where: { qrCode: { in: qrCodes } },
    });
    if (scannedItems.length !== qrCodes.length) {
      throw new BadRequestException('One or more scanned QR codes were not found');
    }

    const expectedItemIds = new Set(booking.items.map((item) => item.inventoryItemId));
    const scannedItemIds = new Set(scannedItems.map((item) => item.id));
    if (
      expectedItemIds.size !== scannedItemIds.size ||
      [...expectedItemIds].some((id) => !scannedItemIds.has(id))
    ) {
      throw new BadRequestException('Pickup confirmation requires every expected item and no extra items');
    }

    return this.prisma.$transaction(async (tx) => {
      const rental =
        booking.rental ??
        (await tx.rental.create({
          data: {
            bookingId: booking.id,
            status: RentalStatus.PICKED_UP,
            scheduledPickupDate: booking.pickupDate ?? booking.startDate,
            scheduledReturnDate: booking.returnDate ?? booking.endDate,
            inventoryItems: {
              connect: booking.items.map((item) => ({ id: item.inventoryItemId })),
            },
          },
        }));

      const updatedRental = await tx.rental.update({
        where: { id: rental.id },
        data: {
          status: RentalStatus.PICKED_UP,
          actualPickupDate: new Date(),
          pickedUpById,
          pickupConditionNotes: conditionNotes,
        },
        include: {
          booking: { include: { customer: true, items: true } },
          inventoryItems: true,
        },
      });

      await tx.booking.update({
        where: { id: booking.id },
        data: { status: BookingStatus.PICKED_UP },
      });
      await tx.inventoryItem.updateMany({
        where: { id: { in: [...expectedItemIds] } },
        data: { status: 'RENTED' },
      });

      await this.auditDisputesService.log({
        action: AuditAction.PICKUP_CONFIRMED,
        entity: 'Rental',
        entityId: updatedRental.id,
        bookingId: booking.id,
        rentalId: updatedRental.id,
        actorId: pickedUpById,
        summary: `Confirmed pickup for booking ${booking.id}`,
        before: booking,
        after: updatedRental,
        metadata: {
          qrCodes,
          inventoryItemIds: [...expectedItemIds],
          conditionNotes,
        },
      }, tx);

      return updatedRental;
    });
  }
}
