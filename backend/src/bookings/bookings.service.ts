import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditAction, BookingItemReturnStatus, BookingStatus, InventoryItem, LeadDepositType, LeadStatus, PaymentMethod, Prisma, Product, ProductHoldStatus, ProductVariant, ReturnItemCondition } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RentalPricingService } from '../pricing/rental-pricing.service';
import { AuditDisputesService } from '../audit-disputes/audit-disputes.service';
import { buildPaginatedResult, resolvePagination } from '../shared/pagination';

const ONE_DAY_MS = 1000 * 60 * 60 * 24;
type LegacyBookingStatusAlias = 'LATE_RETURN' | 'DAMAGE_REVIEW';

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
    leadId?: string,
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

      const reservedByLeads = await this.findReservedLeadItemIds(exactIds, startDate, endDate);
      const conflictingLeadItems = [...reservedByLeads.entries()]
        .filter(([, reservedLeadId]) => reservedLeadId !== leadId)
        .map(([inventoryItemId]) => inventoryItemId);
      if (conflictingLeadItems.length > 0) {
        throw new BadRequestException('One or more inventory items are already reserved by another lead');
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
          status: { notIn: ['DAMAGED', 'RETIRED', 'MAINTENANCE', 'RESERVED'] },
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

  private async findReservedLeadItemIds(
    inventoryItemIds: string[],
    startDate: Date,
    endDate: Date,
  ) {
    if (inventoryItemIds.length === 0) {
      return new Map<string, string>();
    }

    const leadItems = await this.prisma.leadItem.findMany({
      where: {
        inventoryItemId: { in: inventoryItemIds },
        status: 'RESERVED' as any,
        lead: {
          archivedAt: null,
          status: {
            in: [
              LeadStatus.DEPOSIT_RECEIVED,
              LeadStatus.APPOINTMENT_CREATED,
              LeadStatus.APPOINTMENT_COMPLETED,
            ],
          },
          productHoldStatus: ProductHoldStatus.RESERVED,
          bookingId: null,
          pickupDate: { lt: endDate },
          returnDate: { gt: startDate },
        },
      },
      select: {
        leadId: true,
        inventoryItemId: true,
      },
    });

    return new Map(
      leadItems
        .filter((item) => Boolean(item.inventoryItemId))
        .map((item) => [item.inventoryItemId!, item.leadId]),
    );
  }

  async findAll(filters?: {
    customerId?: string;
    status?: BookingStatus;
    statuses?: BookingStatus[];
    legacyStatuses?: LegacyBookingStatusAlias[];
    page?: number;
    limit?: number;
    search?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    dateFrom?: string;
    dateTo?: string;
  }) {
    const { page, limit, skip, take } = resolvePagination(filters);
    const sortBy = ['createdAt', 'pickupDate', 'returnDate', 'startDate', 'endDate'].includes(String(filters?.sortBy))
      ? String(filters?.sortBy)
      : 'createdAt';
    const sortOrder = filters?.sortOrder === 'asc' ? 'asc' : 'desc';
    const normalizedSearch = String(filters?.search ?? '').trim();
    const dateFrom = filters?.dateFrom ? new Date(filters.dateFrom) : undefined;
    const dateTo = filters?.dateTo ? new Date(filters.dateTo) : undefined;
    const now = new Date();
    const directStatuses = filters?.statuses?.length
      ? filters.statuses
      : filters?.status
        ? [filters.status]
        : [];
    const legacyStatuses = new Set(filters?.legacyStatuses ?? []);
    const statusClauses: Prisma.BookingWhereInput[] = [];

    if (directStatuses.length > 0) {
      statusClauses.push({ status: { in: directStatuses } });
    }

    if (legacyStatuses.has('LATE_RETURN')) {
      statusClauses.push({
        status: { in: [BookingStatus.PICKED_UP, BookingStatus.RETURN_PENDING] },
        returnDate: { lt: now },
      });
    }

    if (legacyStatuses.has('DAMAGE_REVIEW')) {
      statusClauses.push({
        OR: [
          { status: BookingStatus.SETTLEMENT_PENDING },
          {
            items: {
              some: {
                OR: [
                  { condition: { in: [ReturnItemCondition.DAMAGED, ReturnItemCondition.MISSING_ACCESSORY, ReturnItemCondition.MISSING_ITEM] } },
                  { returnStatus: { in: [BookingItemReturnStatus.DAMAGED, BookingItemReturnStatus.MAINTENANCE, BookingItemReturnStatus.MISSING, BookingItemReturnStatus.DISPUTE] } },
                ],
              },
            },
          },
        ],
      });
    }

    const where: Prisma.BookingWhereInput = {
      archivedAt: null,
      customerId: filters?.customerId,
      ...(normalizedSearch
        ? {
            OR: [
              { id: { contains: normalizedSearch, mode: 'insensitive' } },
              { customer: { is: { name: { contains: normalizedSearch, mode: 'insensitive' } } } },
              { customer: { is: { phone: { contains: normalizedSearch, mode: 'insensitive' } } } },
              { customer: { is: { email: { contains: normalizedSearch, mode: 'insensitive' } } } },
            ],
          }
        : {}),
      ...(statusClauses.length === 1
        ? statusClauses[0]
        : statusClauses.length > 1
          ? { OR: statusClauses }
          : {}),
      ...(dateFrom || dateTo
        ? {
            pickupDate: {
              ...(dateFrom ? { gte: dateFrom } : {}),
              ...(dateTo ? { lte: dateTo } : {}),
            },
          }
        : {}),
    };

    const include = {
      customer: true,
      lead: {
        include: {
          product: true,
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
            orderBy: { createdAt: 'asc' as const },
          },
        },
      },
      items: {
        include: {
          product: true,
          inventoryItem: true,
        },
      },
      handoverRecord: true,
      rental: {
        include: {
          payments: true,
        },
      },
    } satisfies Prisma.BookingInclude;

    const [total, data] = await Promise.all([
      this.prisma.booking.count({ where }),
      this.prisma.booking.findMany({
        where,
        include,
        orderBy: { [sortBy]: sortOrder },
        skip,
        take,
      }),
    ]);

    return buildPaginatedResult(data, { page, limit, total });
  }

  async findById(id: string) {
    return this.prisma.booking.findUnique({
      where: { id, archivedAt: null },
      include: {
        customer: true,
        lead: {
          include: {
            product: true,
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
              orderBy: { createdAt: 'asc' as const },
            },
          },
        },
        items: {
          include: {
            product: true,
            variant: true,
            inventoryItem: true,
          },
        },
        handoverRecord: true,
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
    if (data.leadId) {
      const lead = await this.prisma.lead.findFirst({
        where: { id: data.leadId, archivedAt: null },
        select: {
          id: true,
          status: true,
          bookingId: true,
        },
      });

      if (!lead) {
        throw new BadRequestException('Lead not found');
      }
      if (lead.bookingId || lead.status === LeadStatus.BOOKING_CREATED) {
        throw new BadRequestException('Lead has already been converted to booking');
      }
      if (lead.status !== LeadStatus.APPOINTMENT_COMPLETED) {
        throw new BadRequestException('Booking can only be created after appointment is completed');
      }

      throw new BadRequestException('Use the lead workflow conversion endpoint to create a booking from lead');
    }

    const pickupDate = new Date(data.pickupDate ?? data.startDate);
    const returnDate = new Date(data.returnDate ?? data.endDate);
    const startDate = pickupDate;
    const endDate = returnDate;
    const requestedDuration = Math.min(3, Math.max(1, Number(data.durationDays || this.durationFromDates(pickupDate, returnDate))));
    const rentalDays = this.durationFromDates(pickupDate, returnDate);

    if (!data.createdById) {
      throw new BadRequestException('createdById is required');
    }

    const inventoryItems = await this.resolveRequestedItems(data.items, startDate, endDate, data.leadId);

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
    const productValue = inventoryItems.reduce(
      (sum, item) => sum + Math.max(Number(item.product.productValue || item.product.price || 0), 0),
      0,
    );
    const depositPolicy = this.pricingService.getDepositPolicy();
    const rentalPaymentPolicy = this.pricingService.getRentalPaymentPolicy();
    const selectedDepositRate = depositPolicy.defaultDepositRate;
    const requiredSecurityDeposit = this.pricingService.calculateRequestedDeposit({
      productValue,
      depositType: 'percent',
      depositRate: selectedDepositRate,
      policy: depositPolicy,
    }).requiredAmount;

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
        productValue,
        productValueTotal: productValue,
        selectedDepositType: LeadDepositType.PERCENT,
        selectedDepositRate,
        depositPolicySnapshot: depositPolicy as unknown as Prisma.InputJsonValue,
        rentalPaymentPolicySnapshot: rentalPaymentPolicy as unknown as Prisma.InputJsonValue,
        bookingDepositRequired: requiredSecurityDeposit,
        depositRequired: requiredSecurityDeposit,
        securityDepositRequired: productValue,
        securityDepositOption: 'cash',
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
            productNameAtTime: itemById.get(item.id)!.product.name,
            variantId: itemById.get(item.id)!.variantId,
            productValueAtTime: Math.max(Number(itemById.get(item.id)!.product.productValue || itemById.get(item.id)!.product.price || 0), 0),
            rentalPriceAtTime: Math.max(Number(itemById.get(item.id)!.product.rentalPrice || itemById.get(item.id)!.product.price || 0), 0),
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
      summary: `Created booking ${booking.id}`,
      after: booking,
      metadata: {
        requestedItemCount: data.items.length,
        pricing: {
          basePrice,
          totalPrice,
          selectedDepositRate,
          requiredSecurityDeposit,
          securityDeposit: productValue,
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
    const lockedInventoryItemIds = lockedItems
      .map((item) => item.inventoryItemId)
      .filter((id): id is string => Boolean(id));

    return this.prisma.inventoryItem.findMany({
      where: {
        status: { notIn: ['DAMAGED', 'RETIRED', 'MAINTENANCE', 'RESERVED'] },
        id: { notIn: lockedInventoryItemIds },
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
    const bookingInventoryItemIds = booking.items
      .map((item) => item.inventoryItemId)
      .filter((id): id is string => Boolean(id));

    return this.prisma.$transaction(async (tx) => {
      if (depositComplete) {
        const conflicts = await tx.bookingItem.findMany({
          where: {
            inventoryItemId: { in: bookingInventoryItemIds },
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
            ...(bookingInventoryItemIds.length
              ? {
                  inventoryItems: {
                    connect: bookingInventoryItemIds.map((inventoryItemId) => ({ id: inventoryItemId })),
                  },
                }
              : {}),
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
            type: 'SECURITY_DEPOSIT',
            amount,
            amountPaid: amount,
            rentalAmount: 0,
            securityDepositAmount: amount,
            paymentMethod,
            status: 'COMPLETED',
            paidAt: new Date(),
            description: `Security deposit for booking ${booking.id}`,
            metadata: {
              sourceStage: 'booking',
              depositRate: booking.selectedDepositRate,
              productValueAtTime: booking.productValue,
              rentalTotalAtTime: booking.totalPrice,
            },
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
          summary: `Recorded security deposit ${amount}`,
          after: payment,
        }, tx);
      }

      if (depositComplete) {
        await tx.inventoryItem.updateMany({
          where: { id: { in: bookingInventoryItemIds } },
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
          ? `Security deposit threshold reached; inventory locked`
          : `Security deposit recorded; deposit threshold still incomplete`,
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
