import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditAction, BookingStatus, InventoryItem, PaymentMethod, Prisma, Product, ProductVariant } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RentalPricingService } from '../pricing/rental-pricing.service';
import { AuditDisputesService } from '../audit-disputes/audit-disputes.service';

const ONE_DAY_MS = 1000 * 60 * 60 * 24;

@Injectable()
export class BookingsService {
  constructor(
    private prisma: PrismaService,
    private pricingService: RentalPricingService,
    private auditDisputesService: AuditDisputesService,
  ) {}

  private effectivePickupDate(date: Date) {
    const effective = new Date(date);
    if (effective.getHours() >= 20) {
      effective.setDate(effective.getDate() + 1);
      effective.setHours(0, 0, 0, 0);
    }
    return effective;
  }

  private durationFromDates(pickupDate: Date, returnDate: Date) {
    const effectivePickup = this.effectivePickupDate(pickupDate);
    return Math.max(1, Math.ceil((returnDate.getTime() - effectivePickup.getTime()) / ONE_DAY_MS));
  }

  private async findOverlappingLockedItemIds(
    inventoryItemIds: string[],
    startDate: Date,
    endDate: Date,
    excludeBookingId?: string,
  ) {
    const conflicts = await this.prisma.bookingItem.findMany({
      where: {
        inventoryItemId: { in: inventoryItemIds },
        bookingId: excludeBookingId ? { not: excludeBookingId } : undefined,
        booking: {
          archivedAt: null,
          status: {
            in: [
              BookingStatus.DEPOSIT_RECEIVED,
              BookingStatus.CONFIRMED,
              BookingStatus.SCHEDULED_PICKUP,
              BookingStatus.PICKED_UP,
              BookingStatus.RETURN_PENDING,
            ],
          },
          startDate: { lt: endDate },
          endDate: { gt: startDate },
        },
      },
      select: { inventoryItemId: true },
    });

    return new Set(conflicts.map((item) => item.inventoryItemId));
  }

  private async resolveRequestedItems(
    items: Array<{
      inventoryItemId?: string;
      productId?: string;
      variantId?: string;
      quantity?: number;
    }>,
    startDate: Date,
    endDate: Date,
  ) {
    const exactIds = items
      .map((item) => item.inventoryItemId)
      .filter((id): id is string => Boolean(id));
    const resolved = new Map<
      string,
      InventoryItem & { product: Product; variant: ProductVariant | null }
    >();

    if (exactIds.length > 0) {
      const exactItems = await this.prisma.inventoryItem.findMany({
        where: {
          id: { in: exactIds },
          archivedAt: null,
          status: { notIn: ['DAMAGED', 'RETIRED', 'MAINTENANCE'] },
        },
        include: { product: true, variant: true },
      });

      if (exactItems.length !== exactIds.length) {
        throw new BadRequestException('One or more requested inventory items are unavailable');
      }

      const locked = await this.findOverlappingLockedItemIds(exactIds, startDate, endDate);
      if (locked.size > 0) {
        throw new BadRequestException('One or more inventory items are already locked for this schedule');
      }

      exactItems.forEach((item) => resolved.set(item.id, item));
    }

    for (const requested of items.filter((item) => !item.inventoryItemId)) {
      if (!requested.productId) {
        throw new BadRequestException('Each booking item requires inventoryItemId or productId');
      }

      const quantity = Math.max(Number(requested.quantity || 1), 1);
      const candidates = await this.prisma.inventoryItem.findMany({
        where: {
          productId: requested.productId,
          variantId: requested.variantId,
          archivedAt: null,
          status: { notIn: ['DAMAGED', 'RETIRED', 'MAINTENANCE'] },
          id: { notIn: [...resolved.keys()] },
        },
        include: { product: true, variant: true },
        orderBy: { createdAt: 'asc' },
      });
      const locked = await this.findOverlappingLockedItemIds(
        candidates.map((item) => item.id),
        startDate,
        endDate,
      );
      const available = candidates.filter((item) => !locked.has(item.id));

      if (available.length < quantity) {
        throw new BadRequestException('Not enough variant availability for the requested schedule');
      }

      available.slice(0, quantity).forEach((item) => resolved.set(item.id, item));
    }

    return [...resolved.values()];
  }

  async findAll(filters?: { customerId?: string; status?: BookingStatus }) {
    const where: Prisma.BookingWhereInput = { ...filters, archivedAt: null };

    return this.prisma.booking.findMany({
      where,
      include: {
        customer: true,
        items: {
          include: {
            product: true,
            inventoryItem: true,
          },
        },
        rental: {
          include: {
            payments: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string) {
    return this.prisma.booking.findUnique({
      where: { id, archivedAt: null },
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
            payments: {
              include: { transactions: true },
              orderBy: { createdAt: 'desc' },
            },
          },
        },
      },
    });
  }

  async create(data: {
    customerId: string;
    startDate: string;
    endDate: string;
    pickupDate?: string;
    returnDate?: string;
    durationDays?: number;
    accessories?: string[];
    status?: BookingStatus;
    leadId?: string;
    notes?: string;
    items: Array<{
      inventoryItemId?: string;
      productId?: string;
      variantId?: string;
      quantity?: number;
    }>;
    createdById?: string;
  }) {
    const pickupDate = new Date(data.pickupDate ?? data.startDate);
    const returnDate = new Date(data.returnDate ?? data.endDate);
    const startDate = pickupDate;
    const endDate = returnDate;
    const requestedDuration = Math.min(3, Math.max(1, Number(data.durationDays || this.durationFromDates(pickupDate, returnDate))));
    const rentalDays = this.durationFromDates(pickupDate, returnDate);

    if (!data.createdById) {
      throw new BadRequestException('createdById is required');
    }

    const inventoryItems = await this.resolveRequestedItems(data.items, startDate, endDate);

    const itemById = new Map(inventoryItems.map((item) => [item.id, item]));
    const basePrices = inventoryItems.map((item) => Number(item.product.price));
    const basePrice = this.pricingService.calculateBasePrice(basePrices);
    const rentalPrice = inventoryItems.reduce(
      (sum, item) =>
        sum +
        this.pricingService.calculateRentalPriceForDuration(
          Number(item.product.price),
          requestedDuration,
        ),
      0,
    );
    const earlyFee = this.pricingService.calculateEarlyPickupFee(requestedDuration, rentalDays);
    const totalPrice = rentalPrice + earlyFee;
    const deposit = this.pricingService.calculateDeposit(totalPrice, Math.max(...basePrices));

    const booking = await this.prisma.booking.create({
      data: {
        leadId: data.leadId,
        customerId: data.customerId,
        status: data.status ?? BookingStatus.DEPOSIT_REQUESTED,
        startDate,
        endDate,
        rentalDays,
        pickupDate,
        returnDate,
        durationDays: requestedDuration,
        basePrice,
        priceAdjustment: totalPrice - basePrice,
        totalPrice,
        bookingDepositRequired: deposit.bookingDeposit,
        securityDepositRequired: deposit.securityDeposit,
        securityDepositOption: deposit.securityDepositOption,
        accessories: data.accessories ? JSON.stringify(data.accessories) : undefined,
        notes: data.notes,
        createdById: data.createdById,
        items: {
          create: inventoryItems.map((item) => ({
            inventoryItemId: item.id,
            pricePerDay: this.pricingService.calculateRentalPriceForDuration(
              Number(itemById.get(item.id)!.product.price),
              requestedDuration,
            ),
            productId: itemById.get(item.id)!.productId,
            variantId: itemById.get(item.id)!.variantId,
          })),
        },
      },
      include: {
        items: true,
        customer: true,
      },
    });

    await this.auditDisputesService.log({
      action: AuditAction.CREATE,
      entity: 'Booking',
      entityId: booking.id,
      bookingId: booking.id,
      actorId: data.createdById,
      summary: `Created booking for ${booking.customer.name}`,
      after: booking,
      metadata: {
        requestedItemCount: data.items.length,
        pricing: {
          basePrice,
          totalPrice,
          bookingDeposit: deposit.bookingDeposit,
          securityDeposit: deposit.securityDeposit,
        },
      },
    });

    return booking;
  }

  async getAvailability(startDate: string, endDate: string) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const lockedItems = await this.prisma.bookingItem.findMany({
      where: {
        booking: {
          archivedAt: null,
          status: {
            in: [
              BookingStatus.DEPOSIT_RECEIVED,
              BookingStatus.CONFIRMED,
              BookingStatus.SCHEDULED_PICKUP,
              BookingStatus.PICKED_UP,
              BookingStatus.RETURN_PENDING,
            ],
          },
          startDate: { lt: end },
          endDate: { gt: start },
        },
      },
      select: { inventoryItemId: true },
    });

    return this.prisma.inventoryItem.findMany({
      where: {
        status: { notIn: ['DAMAGED', 'RETIRED', 'MAINTENANCE'] },
        id: { notIn: lockedItems.map((item) => item.inventoryItemId) },
      },
      include: {
        product: true,
        variant: true,
      },
    });
  }

  async getCalendarBlocks(date: string) {
    const targetDate = new Date(date);
    return this.prisma.calendarBlock.findMany({
      where: {
        startDate: { lte: targetDate },
        endDate: { gte: targetDate },
      },
    });
  }

  async updateStatus(id: string, status: BookingStatus, actorId?: string) {
    const before = await this.prisma.booking.findUnique({
      where: { id },
      include: { customer: true, items: true, rental: true },
    });
    const after = await this.prisma.booking.update({
      where: { id },
      data: { status },
      include: { customer: true, items: true, rental: true },
    });

    await this.auditDisputesService.log({
      action: AuditAction.STATUS_CHANGE,
      entity: 'Booking',
      entityId: id,
      bookingId: id,
      rentalId: after.rental?.id,
      actorId,
      summary: `Booking status changed to ${status}`,
      before,
      after,
    });

    return after;
  }

  async recordBookingDeposit(
    id: string,
    amount: number,
    paymentMethod: PaymentMethod = PaymentMethod.CASH,
    actorId?: string,
  ) {
    const booking = await this.prisma.booking.findUnique({
      where: { id, archivedAt: null },
      include: { items: true, rental: true, customer: true },
    });

    if (!booking) {
      throw new BadRequestException('Booking not found');
    }

    const paid = Number(booking.bookingDepositPaid) + Math.max(Number(amount), 0);
    const depositComplete = paid >= Number(booking.bookingDepositRequired);

    return this.prisma.$transaction(async (tx) => {
      if (depositComplete) {
        const conflicts = await tx.bookingItem.findMany({
          where: {
            inventoryItemId: { in: booking.items.map((item) => item.inventoryItemId) },
            bookingId: { not: booking.id },
            booking: {
              archivedAt: null,
              status: {
                in: [
                  BookingStatus.DEPOSIT_RECEIVED,
                  BookingStatus.CONFIRMED,
                  BookingStatus.SCHEDULED_PICKUP,
                  BookingStatus.PICKED_UP,
                  BookingStatus.RETURN_PENDING,
                ],
              },
              startDate: { lt: booking.endDate },
              endDate: { gt: booking.startDate },
            },
          },
          select: { inventoryItemId: true },
        });

        if (conflicts.length > 0) {
          throw new BadRequestException('Inventory cannot be locked because another deposit already holds this schedule');
        }
      }

      const rental =
        booking.rental ??
        (await tx.rental.create({
          data: {
            bookingId: booking.id,
            status: depositComplete ? 'CONFIRMED' : 'PENDING_PAYMENT',
            scheduledPickupDate: booking.pickupDate ?? booking.startDate,
            scheduledReturnDate: booking.returnDate ?? booking.endDate,
            inventoryItems: {
              connect: booking.items.map((item) => ({ id: item.inventoryItemId })),
            },
          },
        }));

      const updated = await tx.booking.update({
        where: { id },
        data: {
          bookingDepositPaid: paid,
          status: depositComplete ? BookingStatus.CONFIRMED : BookingStatus.DEPOSIT_REQUESTED,
          lockedAt: depositComplete && !booking.lockedAt ? new Date() : booking.lockedAt,
        },
        include: { items: true, customer: true },
      });

      if (amount > 0) {
        const payment = await tx.payment.create({
          data: {
            bookingId: booking.id,
            rentalId: rental.id,
            type: 'BOOKING_DEPOSIT',
            amount,
            amountPaid: amount,
            rentalAmount: 0,
            depositAmount: amount,
            paymentMethod,
            status: 'COMPLETED',
            paidAt: new Date(),
            description: `Booking deposit for booking ${booking.id}`,
          },
        });

        await this.auditDisputesService.log({
          action: AuditAction.PAYMENT_POSTED,
          entity: 'Payment',
          entityId: payment.id,
          paymentId: payment.id,
          bookingId: booking.id,
          rentalId: rental.id,
          actorId,
          summary: `Recorded booking deposit ${amount}`,
          after: payment,
        }, tx);
      }

      if (depositComplete) {
        await tx.inventoryItem.updateMany({
          where: { id: { in: booking.items.map((item) => item.inventoryItemId) } },
          data: { status: 'RESERVED' },
        });

        await tx.rental.update({
          where: { id: rental.id },
          data: { status: 'CONFIRMED' },
        });
      }

      await this.auditDisputesService.log({
        action: depositComplete ? AuditAction.INVENTORY_LOCKED : AuditAction.UPDATE,
        entity: 'Booking',
        entityId: booking.id,
        bookingId: booking.id,
        rentalId: rental.id,
        actorId,
        summary: depositComplete
          ? `Booking deposit complete; inventory locked`
          : `Booking deposit recorded; deposit still incomplete`,
        before: booking,
        after: updated,
        metadata: {
          amount,
          paymentMethod,
          depositComplete,
          inventoryItemIds: booking.items.map((item) => item.inventoryItemId),
        },
      }, tx);

      return updated;
    });
  }

  async archive(id: string, actorId?: string) {
    const before = await this.prisma.booking.findUnique({ where: { id } });
    const after = await this.prisma.booking.update({
      where: { id },
      data: { archivedAt: new Date() },
    });

    await this.auditDisputesService.log({
      action: AuditAction.ARCHIVE,
      entity: 'Booking',
      entityId: id,
      bookingId: id,
      actorId,
      summary: 'Archived booking',
      before,
      after,
    });

    return after;
  }
}
