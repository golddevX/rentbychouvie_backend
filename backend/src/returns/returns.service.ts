import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, BookingStatus, PaymentMethod, PaymentStatus, PaymentType, RentalStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RentalPricingService, ReturnCondition } from '../pricing/rental-pricing.service';
import { AuditDisputesService } from '../audit-disputes/audit-disputes.service';

@Injectable()
export class ReturnsService {
  constructor(
    private prisma: PrismaService,
    private pricingService: RentalPricingService,
    private auditDisputesService: AuditDisputesService,
  ) {}

  private async findRentalByBooking(bookingId: string) {
    const rental = await this.prisma.rental.findUnique({
      where: { bookingId },
      include: {
        booking: {
          include: {
            customer: true,
            items: {
              include: { inventoryItem: true, product: true, variant: true },
            },
          },
        },
        inventoryItems: true,
        payments: true,
        returnInspections: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!rental) throw new NotFoundException('Rental not found for booking');
    return rental;
  }

  async inspect(
    bookingId: string,
    input: {
      condition: ReturnCondition;
      images: string[];
      notes?: string;
      declaredDamageFee?: number;
      inspectedById?: string;
    },
  ) {
    const rental = await this.findRentalByBooking(bookingId);
    const suggestedFee = this.pricingService.suggestDamageFee(
      input.condition,
      input.declaredDamageFee,
    );

    const inspection = await this.prisma.returnInspection.create({
      data: {
        rentalId: rental.id,
        condition: input.condition,
        imageUrls: JSON.stringify(input.images),
        notes: input.notes,
        suggestedFee,
        inspectedById: input.inspectedById,
      },
    });

    await this.auditDisputesService.log({
      action: AuditAction.RETURN_INSPECTED,
      entity: 'ReturnInspection',
      entityId: inspection.id,
      bookingId,
      rentalId: rental.id,
      returnInspectionId: inspection.id,
      actorId: input.inspectedById,
      summary: `Inspected return as ${input.condition}`,
      before: rental.returnInspections[0] ?? null,
      after: inspection,
      metadata: {
        suggestedFee,
        imageCount: input.images.length,
      },
    });

    return {
      bookingId,
      rentalId: rental.id,
      condition: input.condition,
      suggestedFee,
      inspection,
      pricingRule: 'Suggested by RentalPricingService based on return condition and declared damage.',
    };
  }

  async settle(
    bookingId: string,
    input: {
      qrCodes: string[];
      condition: ReturnCondition;
      actualReturnDate?: string;
      damageFee?: number;
      accessoryLostValues?: number[];
      affectsNextBooking?: boolean;
      notes?: string;
      returnedById?: string;
    },
  ) {
    const rental = await this.findRentalByBooking(bookingId);
    const returnReadyStatuses: RentalStatus[] = [
      RentalStatus.PICKED_UP,
      RentalStatus.IN_RENTAL,
      RentalStatus.RETURNED,
    ];
    if (!returnReadyStatuses.includes(rental.status)) {
      throw new BadRequestException('Rental must be picked up before settlement');
    }

    const scannedItems = await this.prisma.inventoryItem.findMany({
      where: { qrCode: { in: input.qrCodes } },
    });
    if (scannedItems.length !== input.qrCodes.length) {
      throw new BadRequestException('One or more returned QR codes were not found');
    }

    const expectedItemIds = new Set(rental.inventoryItems.map((item) => item.id));
    const scannedItemIds = new Set(scannedItems.map((item) => item.id));
    if ([...expectedItemIds].some((id) => !scannedItemIds.has(id))) {
      throw new BadRequestException('Returned QR does not match expected booking items');
    }

    let nextBookingImpactFee = 0;
    if (input.affectsNextBooking) {
      const nextBooking = await this.prisma.bookingItem.findFirst({
        where: {
          inventoryItemId: { in: [...expectedItemIds] },
          bookingId: { not: rental.bookingId },
          booking: {
            archivedAt: null,
            startDate: { gte: rental.scheduledReturnDate },
            status: { in: [BookingStatus.CONFIRMED, BookingStatus.SCHEDULED_PICKUP] },
          },
        },
        include: { booking: true },
        orderBy: { booking: { startDate: 'asc' } },
      });
      nextBookingImpactFee = Number(nextBooking?.booking.totalPrice ?? 0);
    }

    const accessoryLostFee = (input.accessoryLostValues ?? []).reduce(
      (sum, value) => sum + Math.max(Number(value || 0), 0),
      0,
    );
    const actualReturnDate = input.actualReturnDate ? new Date(input.actualReturnDate) : new Date();
    const settlement = this.pricingService.calculateSettlement({
      scheduledReturnDate: rental.scheduledReturnDate,
      actualReturnDate,
      totalPrice: Number(rental.booking.totalPrice || 0),
      rentalDays: Number(rental.booking.rentalDays || 1),
      securityDepositHeld: Number(rental.booking.securityDepositHeld || 0),
      condition: input.condition,
      damageFee: input.damageFee,
      accessoryLostFee,
      nextBookingImpactFee,
    });

    return this.prisma.$transaction(async (tx) => {
      const updatedRental = await tx.rental.update({
        where: { id: rental.id },
        data: {
          status: RentalStatus.COMPLETED,
          actualReturnDate,
          returnedById: input.returnedById,
          returnConditionNotes: input.notes,
          damageCost: settlement.damageFee,
        },
      });

      await tx.booking.update({
        where: { id: rental.bookingId },
        data: { status: BookingStatus.COMPLETED },
      });
      await tx.inventoryItem.updateMany({
        where: { id: { in: [...expectedItemIds] } },
        data: { status: settlement.damageFee > 0 ? 'DAMAGED' : 'AVAILABLE' },
      });

      if (settlement.totalFees > 0) {
        await tx.payment.create({
          data: {
            rentalId: rental.id,
            bookingId: rental.bookingId,
            type: PaymentType.FEE,
            amount: settlement.totalFees,
            rentalAmount: 0,
            damageAmount: settlement.damageFee,
            otherFees:
              settlement.lateFee +
              settlement.cleaningHold +
              settlement.accessoryLostFee +
              settlement.nextBookingImpactFee,
            paymentMethod: PaymentMethod.PENDING,
            status: PaymentStatus.PENDING,
            description: `Return settlement fees for booking ${rental.bookingId}`,
          },
        });
      }

      if (settlement.refund > 0) {
        await tx.payment.create({
          data: {
            rentalId: rental.id,
            bookingId: rental.bookingId,
            type: PaymentType.REFUND,
            amount: settlement.refund,
            amountRefunded: settlement.refund,
            rentalAmount: 0,
            refundAmount: settlement.refund,
            paymentMethod: PaymentMethod.CASH,
            status: PaymentStatus.COMPLETED,
            description: `Security deposit refund for booking ${rental.bookingId}`,
            paidAt: new Date(),
          },
        });
      }

      await this.auditDisputesService.log({
        action: AuditAction.RETURN_SETTLED,
        entity: 'Rental',
        entityId: rental.id,
        bookingId,
        rentalId: rental.id,
        actorId: input.returnedById,
        summary: `Settled return for booking ${bookingId}`,
        before: rental,
        after: updatedRental,
        metadata: {
          settlement,
          qrCodes: input.qrCodes,
          condition: input.condition,
        },
      }, tx);

      return {
        bookingId,
        rental: updatedRental,
        settlement,
      };
    });
  }
}
