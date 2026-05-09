import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, BookingStatus, InventoryItemStatus, ProductStatus, RentalStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditDisputesService } from '../audit-disputes/audit-disputes.service';
import { PaymentsService } from '../payments/payments.service';

@Injectable()
export class PickupService {
  constructor(
    private prisma: PrismaService,
    private auditDisputesService: AuditDisputesService,
    private paymentsService: PaymentsService,
  ) {}

  private async findBooking(bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId, archivedAt: null },
      include: {
        customer: true,
        lead: {
          include: {
            product: true,
            inventoryItem: {
              include: {
                product: true,
                variant: true,
              },
            },
            items: {
              include: {
                product: true,
                inventoryItem: {
                  include: {
                    product: true,
                    variant: true,
                  },
                },
              },
            },
          },
        },
        items: {
          include: {
            product: true,
            variant: true,
            inventoryItem: {
              include: {
                product: true,
                variant: true,
              },
            },
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

  private bookingProducts(booking: Awaited<ReturnType<PickupService['findBooking']>>) {
    if (booking.items.length > 0) {
      return booking.items
        .map((item) => ({
          id: item.inventoryItemId ?? item.productId,
          productId: item.productId,
          qrCode: item.inventoryItem?.qrCode ?? (item.product as any)?.qrCode ?? item.productId,
          name: item.product?.name ?? item.inventoryItem?.product?.name ?? '-',
          status: item.inventoryItem?.status ?? 'AVAILABLE',
        }));
    }
    const leadItems = (booking.lead?.items ?? []).filter((item) => String(item.status ?? '').toUpperCase() !== 'REMOVED');
    if (leadItems.length > 0) {
      return leadItems.map((item) => ({
        id: item.inventoryItemId ?? item.productId,
        productId: item.productId,
        qrCode: item.inventoryItem?.qrCode ?? (item.product as any)?.qrCode ?? item.productId,
        name: item.product?.name ?? item.inventoryItem?.product?.name ?? '-',
        status: item.inventoryItem?.status ?? 'AVAILABLE',
      }));
    }
    return booking.lead?.inventoryItem
      ? [{
          id: booking.lead.inventoryItem.id,
          productId: booking.lead.productId ?? booking.lead.inventoryItem.productId,
          qrCode: booking.lead.inventoryItem.qrCode,
          name: booking.lead.product?.name ?? booking.lead.inventoryItem.product.name,
          status: booking.lead.inventoryItem.status,
        }]
      : [];
  }

  private expectedProducts(booking: Awaited<ReturnType<PickupService['findBooking']>>) {
    return this.bookingProducts(booking).map((product) => ({
      id: product.id,
      productId: product.productId,
      qrCode: product.qrCode || product.id,
      name: product.name,
      status: String(product.status ?? 'available').toUpperCase(),
    }));
  }

  async scan(bookingId: string, qrCode: string) {
    const booking = await this.findBooking(bookingId);
    const expectedProducts = this.expectedProducts(booking);
    if (!expectedProducts.length) {
      throw new BadRequestException('Booking does not have products ready for pickup');
    }

    const matchedProduct = expectedProducts.find((product) => product.qrCode === qrCode);
    const matched = Boolean(matchedProduct);
    let message = matched ? 'QR matches the expected product' : 'QR does not match this booking';

    if (!matched) {
      message = 'QR does not match this booking';
    } else if (matchedProduct!.status === InventoryItemStatus.RENTED) {
      message = 'Product is already rented and cannot be handed over again';
    } else if (matchedProduct!.status === InventoryItemStatus.MAINTENANCE || matchedProduct!.status === InventoryItemStatus.DAMAGED) {
      message = 'Product is under maintenance and blocked for pickup';
    } else if (matchedProduct!.status !== InventoryItemStatus.AVAILABLE && matchedProduct!.status !== InventoryItemStatus.RESERVED) {
      message = 'Product is missing from pickup-ready stock';
    }

    return {
      bookingId: booking.id,
      bookingStatus: booking.status,
      matched,
      message,
      scannedItem: {
        id: matchedProduct?.id ?? qrCode,
        qrCode,
        status: String(matchedProduct?.status ?? 'available').toLowerCase(),
        productName: matchedProduct?.name ?? qrCode,
        variantName: null,
      },
      expectedItems: expectedProducts.map((product) => ({
        itemId: product.id,
        qrCode: product.qrCode,
        productName: product.name,
        variantName: null,
      })),
    };
  }

  async confirm(bookingId: string, images: string[], pickedUpById?: string, conditionNotes?: string) {
    const booking = await this.findBooking(bookingId);
    if (
      booking.status === BookingStatus.CANCELLED ||
      booking.status === BookingStatus.PICKED_UP ||
      booking.status === BookingStatus.COMPLETED
    ) {
      throw new BadRequestException('Booking is not eligible for pickup');
    }

    const summary = await this.paymentsService.getPaymentSummaryForBooking(booking.id);
    if (!summary.canPickup) {
      const pickupBlockedReasons = Array.isArray((summary as any).pickupBlockedReasons)
        ? ((summary as any).pickupBlockedReasons as string[])
        : [];
      await this.auditDisputesService.log({
        action: AuditAction.STATUS_CHANGE,
        entity: 'PickupDesk',
        entityId: booking.id,
        bookingId: booking.id,
        rentalId: booking.rental?.id ?? undefined,
        actorId: pickedUpById,
        summary: `Blocked pickup for booking ${booking.id} because payment requirements are not satisfied`,
        after: {
          rentalRemaining: summary.rentalRemaining,
          securityDepositOutstanding: (summary as any).securityDepositRemainingForPickup,
          bookingStatus: booking.status,
        },
        metadata: {
          step: 'pickup_blocked_unpaid',
          canPickup: summary.canPickup,
          pickupBlockedReasons: (summary as any).pickupBlockedReasons ?? [],
        },
      });

      if (pickupBlockedReasons.includes('rental_unpaid')) {
        throw new BadRequestException('Rental payment is still outstanding for this rental order');
      }
      if (
        pickupBlockedReasons.includes('deposit_missing')
        || Number((summary as any).securityDepositRemainingForPickup ?? 0) > 0
      ) {
        throw new BadRequestException('Security deposit is still required before pickup');
      }
      throw new BadRequestException('Booking is not yet ready for pickup');
    }

    const expectedProducts = this.expectedProducts(booking);
    if (!expectedProducts.length) {
      throw new BadRequestException('Booking does not have products ready for pickup');
    }
    if (!Array.isArray(images) || images.length < 4) {
      throw new BadRequestException('Handover requires 4 evidence images before confirmation');
    }
    const blockedProducts = expectedProducts.filter((product) => product.status === InventoryItemStatus.MAINTENANCE || product.status === InventoryItemStatus.DAMAGED);
    if (blockedProducts.length > 0) {
      throw new BadRequestException(`One or more products are blocked for pickup: ${blockedProducts.map((product) => product.name).join(', ')}`);
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
      await tx.handoverRecord.upsert({
        where: { bookingId: booking.id },
        update: {
          images: JSON.stringify(images),
          note: conditionNotes,
          createdById: pickedUpById,
        },
        create: {
          bookingId: booking.id,
          images: JSON.stringify(images),
          note: conditionNotes,
          createdById: pickedUpById,
        },
      });
      const inventoryItemIds = expectedProducts.map((product) => product.id);
      await tx.inventoryItem.updateMany({
        where: { id: { in: inventoryItemIds } },
        data: { status: InventoryItemStatus.RENTED },
      });
      await tx.product.updateMany({
        where: {
          id: {
            in: [...new Set(expectedProducts.map((product) => product.productId))],
          },
        },
        data: { status: ProductStatus.RENTED },
      });
      await tx.bookingItem.updateMany({
        where: { bookingId: booking.id, inventoryItemId: { in: inventoryItemIds } },
        data: {
          pickupStatus: 'PICKED_UP' as any,
          handoverImages: JSON.stringify(images),
        },
      });

      await this.auditDisputesService.log({
        action: AuditAction.UPDATE,
        entity: 'HandoverRecord',
        entityId: booking.id,
        bookingId: booking.id,
        rentalId: updatedRental.id,
        actorId: pickedUpById,
        summary: `Uploaded handover evidence for booking ${booking.id}`,
        after: {
          imageCount: images.length,
          note: conditionNotes,
        },
        metadata: {
          step: 'upload_handover_images',
          images,
        },
      }, tx);

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
          images,
          inventoryItemIds: expectedProducts.map((product) => product.id),
          conditionNotes,
        },
      }, tx);

      return updatedRental;
    });
  }
}
