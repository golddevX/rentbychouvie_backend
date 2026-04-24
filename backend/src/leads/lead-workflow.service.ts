import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AppointmentStatus,
  AppointmentType,
  AuditAction,
  BookingStatus,
  InventoryItemStatus,
  LeadAppointmentIntent,
  LeadDepositStatus,
  LeadStatus,
  PaymentMethod,
  PaymentStatus,
  PaymentType,
  Prisma,
  ProductHoldStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RentalPricingService } from '../pricing/rental-pricing.service';
import { AuditDisputesService } from '../audit-disputes/audit-disputes.service';

const ONE_DAY_MS = 1000 * 60 * 60 * 24;
const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;

type PrismaClientLike = PrismaService | Prisma.TransactionClient;

const ACTIVE_RESERVED_LEAD_STATUSES: LeadStatus[] = [
  LeadStatus.DEPOSIT_RECEIVED,
  LeadStatus.APPOINTMENT_CREATED,
  LeadStatus.APPOINTMENT_COMPLETED,
  LeadStatus.BOOKING_CREATED,
];

const MANUAL_LEAD_STATUSES: LeadStatus[] = [
  LeadStatus.CONTACTED,
  LeadStatus.LOST,
  LeadStatus.CANCELLED,
];

@Injectable()
export class LeadWorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricingService: RentalPricingService,
    private readonly auditDisputesService: AuditDisputesService,
  ) {}

  private leadInclude() {
    return {
      customer: true,
      assignedTo: {
        select: { id: true, fullName: true, email: true, role: true },
      },
      product: true,
      variant: true,
      inventoryItem: {
        include: {
          product: true,
          variant: true,
        },
      },
      payments: {
        where: { archivedAt: null },
        orderBy: { createdAt: 'desc' as const },
      },
    };
  }

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

  private serializeRentalDates(pickupDate: Date, returnDate: Date) {
    return JSON.stringify({
      startDate: pickupDate.toISOString(),
      endDate: returnDate.toISOString(),
    });
  }

  private async resolveActorId(actorId?: string, client: PrismaClientLike = this.prisma) {
    if (!actorId) return undefined;
    const actor = await client.user.findUnique({
      where: { id: actorId },
      select: { id: true },
    });
    return actor?.id;
  }

  private async getLeadOrThrow(leadId: string, client: PrismaClientLike = this.prisma) {
    const lead = await client.lead.findFirst({
      where: { id: leadId, archivedAt: null },
      include: this.leadInclude(),
    });

    if (!lead) {
      throw new NotFoundException('Lead not found');
    }

    return lead;
  }

  private async getAppointmentOrThrow(appointmentId: string, client: PrismaClientLike = this.prisma) {
    const appointment = await client.appointment.findFirst({
      where: { id: appointmentId, archivedAt: null },
    });

    if (!appointment) {
      throw new NotFoundException('Appointment not found');
    }

    return appointment;
  }

  private async getBookingOrThrow(bookingId: string, client: PrismaClientLike = this.prisma) {
    const booking = await client.booking.findFirst({
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
        payments: true,
        rental: { include: { payments: true } },
      },
    });

    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    return booking;
  }

  private ensureProductSelectionReady(lead: Awaited<ReturnType<LeadWorkflowService['getLeadOrThrow']>>) {
    if (!lead.productId) {
      throw new BadRequestException('Lead does not have a selected product');
    }
    if (!lead.pickupDate || !lead.returnDate) {
      throw new BadRequestException('Lead must include pickup and return dates');
    }
    if (lead.returnDate.getTime() <= lead.pickupDate.getTime()) {
      throw new BadRequestException('Return date must be after pickup date');
    }
  }

  private ensureDepositWindowOpen(lead: Awaited<ReturnType<LeadWorkflowService['getLeadOrThrow']>>) {
    if (lead.status === LeadStatus.DEPOSIT_EXPIRED) {
      throw new BadRequestException('Deposit request has expired');
    }
    if (lead.status === LeadStatus.BOOKING_CREATED) {
      throw new BadRequestException('Lead has already been converted to booking');
    }
  }

  private ensureLeadReadyForBooking(lead: Awaited<ReturnType<LeadWorkflowService['getLeadOrThrow']>>) {
    if (lead.bookingId || lead.status === LeadStatus.BOOKING_CREATED) {
      throw new BadRequestException('Lead has already been converted to booking');
    }
    if (lead.status !== LeadStatus.APPOINTMENT_COMPLETED) {
      throw new BadRequestException('Booking can only be created after appointment is completed');
    }
  }

  private mapIntentToAppointmentType(intent?: LeadAppointmentIntent | null) {
    if (intent === LeadAppointmentIntent.PICKUP) return AppointmentType.PICKUP;
    if (intent === LeadAppointmentIntent.DELIVERY) return AppointmentType.DELIVERY_PREPARATION;
    return AppointmentType.FITTING;
  }

  private buildAppointmentSchedule(lead: Awaited<ReturnType<LeadWorkflowService['getLeadOrThrow']>>) {
    const fallback = new Date(Date.now() + 2 * 60 * 60 * 1000);
    fallback.setMinutes(0, 0, 0);
    const start = lead.pickupDate ? new Date(lead.pickupDate) : fallback;
    if (start.getTime() < Date.now()) {
      start.setTime(fallback.getTime());
    }
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    return { start, end };
  }

  private async findOverlappingLockedItemIds(
    inventoryItemIds: string[],
    startDate: Date,
    endDate: Date,
    client: PrismaClientLike = this.prisma,
    excludeBookingId?: string,
  ) {
    if (inventoryItemIds.length === 0) return new Set<string>();

    const conflicts = await client.bookingItem.findMany({
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

  private async findReservedLeadConflicts(
    inventoryItemIds: string[],
    startDate: Date,
    endDate: Date,
    leadId: string,
    client: PrismaClientLike = this.prisma,
  ) {
    if (inventoryItemIds.length === 0) return new Set<string>();

    const reservedLeads = await client.lead.findMany({
      where: {
        id: { not: leadId },
        archivedAt: null,
        inventoryItemId: { in: inventoryItemIds },
        status: { in: ACTIVE_RESERVED_LEAD_STATUSES },
        productHoldStatus: ProductHoldStatus.RESERVED,
        bookingId: null,
        pickupDate: { lt: endDate },
        returnDate: { gt: startDate },
      },
      select: { inventoryItemId: true },
    });

    return new Set(
      reservedLeads
        .map((item) => item.inventoryItemId)
        .filter((value): value is string => Boolean(value)),
    );
  }

  private async releaseReservedInventoryIfNeeded(
    lead: Awaited<ReturnType<LeadWorkflowService['getLeadOrThrow']>>,
    client: PrismaClientLike = this.prisma,
  ) {
    if (
      !lead.inventoryItemId ||
      lead.productHoldStatus !== ProductHoldStatus.RESERVED ||
      lead.bookingId
    ) {
      return;
    }

    await client.inventoryItem.updateMany({
      where: {
        id: lead.inventoryItemId,
        status: InventoryItemStatus.RESERVED,
      },
      data: { status: InventoryItemStatus.AVAILABLE },
    });
  }

  private calculateLeadPricing(lead: Awaited<ReturnType<LeadWorkflowService['getLeadOrThrow']>>) {
    this.ensureProductSelectionReady(lead);

    const pickupDate = new Date(lead.pickupDate!);
    const returnDate = new Date(lead.returnDate!);
    const rentalDays = this.durationFromDates(pickupDate, returnDate);
    const durationDays = Math.min(3, Math.max(1, rentalDays));
    const basePrice = Number(lead.product?.price ?? 0);
    const rentalPrice = this.pricingService.calculateRentalPriceForDuration(basePrice, durationDays);
    const earlyFee = this.pricingService.calculateEarlyPickupFee(durationDays, rentalDays);
    const totalPrice = rentalPrice + earlyFee;
    const deposit = this.pricingService.calculateDeposit(totalPrice, basePrice);

    return {
      pickupDate,
      returnDate,
      rentalDays,
      durationDays,
      basePrice,
      rentalPrice,
      totalPrice,
      deposit,
    };
  }

  private async resolveInventoryItemForLead(
    lead: Awaited<ReturnType<LeadWorkflowService['getLeadOrThrow']>>,
    client: PrismaClientLike = this.prisma,
  ) {
    this.ensureProductSelectionReady(lead);

    const pickupDate = new Date(lead.pickupDate!);
    const returnDate = new Date(lead.returnDate!);

    if (lead.inventoryItemId) {
      const item = await client.inventoryItem.findFirst({
        where: {
          id: lead.inventoryItemId,
          archivedAt: null,
        },
        include: {
          product: true,
          variant: true,
        },
      });

      if (!item) {
        throw new BadRequestException('Selected inventory item was not found');
      }
      if (
        item.status === InventoryItemStatus.DAMAGED ||
        item.status === InventoryItemStatus.RETIRED ||
        item.status === InventoryItemStatus.MAINTENANCE
      ) {
        throw new BadRequestException('Selected inventory item is unavailable');
      }
      if (item.productId !== lead.productId) {
        throw new BadRequestException('Inventory item does not belong to selected product');
      }
      if (lead.variantId && item.variantId !== lead.variantId) {
        throw new BadRequestException('Inventory item does not belong to selected variant');
      }

      const bookingConflicts = await this.findOverlappingLockedItemIds([item.id], pickupDate, returnDate, client);
      if (bookingConflicts.size > 0) {
        throw new BadRequestException('Selected inventory item is already locked for the requested schedule');
      }

      const leadConflicts = await this.findReservedLeadConflicts([item.id], pickupDate, returnDate, lead.id, client);
      if (leadConflicts.size > 0) {
        throw new BadRequestException('Selected inventory item is reserved by another lead');
      }

      return item;
    }

    const candidates = await client.inventoryItem.findMany({
      where: {
        productId: lead.productId!,
        variantId: lead.variantId ?? undefined,
        archivedAt: null,
        status: InventoryItemStatus.AVAILABLE,
        ...(lead.requestedSize || lead.requestedColor
          ? {
              variant: {
                size: lead.requestedSize ?? undefined,
                color: lead.requestedColor ?? undefined,
              },
            }
          : {}),
      },
      include: {
        product: true,
        variant: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    if (candidates.length === 0) {
      throw new BadRequestException('No available inventory item matches the selected lead product');
    }

    const bookingConflicts = await this.findOverlappingLockedItemIds(
      candidates.map((item) => item.id),
      pickupDate,
      returnDate,
      client,
    );
    const leadConflicts = await this.findReservedLeadConflicts(
      candidates.map((item) => item.id),
      pickupDate,
      returnDate,
      lead.id,
      client,
    );

    const available = candidates.find((item) => !bookingConflicts.has(item.id) && !leadConflicts.has(item.id));
    if (!available) {
      throw new BadRequestException('No inventory item is available for the selected lead schedule');
    }

    return available;
  }

  private async createAppointmentRecord(
    lead: Awaited<ReturnType<LeadWorkflowService['getLeadOrThrow']>>,
    actorId?: string,
    client: PrismaClientLike = this.prisma,
  ) {
    if (lead.appointmentId) {
      const existing = await client.appointment.findFirst({
        where: { id: lead.appointmentId, archivedAt: null },
      });
      if (
        existing &&
        existing.status !== AppointmentStatus.CANCELLED &&
        existing.status !== AppointmentStatus.NO_SHOW
      ) {
        return existing;
      }
    }

    const { start, end } = this.buildAppointmentSchedule(lead);
    const appointment = await client.appointment.create({
      data: {
        customerId: lead.customerId,
        type: this.mapIntentToAppointmentType(lead.appointmentIntent),
        status: AppointmentStatus.SCHEDULED,
        scheduledAt: start,
        startTime: start,
        endTime: end,
        durationMinutes: 60,
        durationHours: 1,
        lifecycleStatus: 'pending',
        notes: lead.notes,
        resourceItemId: lead.inventoryItemId ?? undefined,
        staffId: lead.assignedToId ?? undefined,
        leadId: lead.id,
      },
    });

    await client.lead.update({
      where: { id: lead.id },
      data: {
        appointmentId: appointment.id,
        status: LeadStatus.APPOINTMENT_CREATED,
      },
    });

    await this.auditDisputesService.log({
      action: AuditAction.CREATE,
      entity: 'LeadWorkflow',
      entityId: lead.id,
      actorId,
      summary: `Auto-created appointment ${appointment.id} from lead`,
      after: {
        leadId: lead.id,
        appointmentId: appointment.id,
        type: appointment.type,
      },
      metadata: {
        step: 'auto_create_appointment',
        appointmentIntent: lead.appointmentIntent,
      },
    }, client);

    return appointment;
  }

  async expirePendingDeposits(actorId?: string) {
    const now = new Date();
    const expiredLeads = await this.prisma.lead.findMany({
      where: {
        archivedAt: null,
        status: LeadStatus.DEPOSIT_REQUESTED,
        depositDeadlineAt: { lt: now },
      },
      include: this.leadInclude(),
    });

    for (const lead of expiredLeads) {
      await this.prisma.$transaction(async (tx) => {
        const before = await tx.lead.findFirst({
          where: { id: lead.id },
          include: this.leadInclude(),
        });
        const after = await tx.lead.update({
          where: { id: lead.id },
          data: {
            status: LeadStatus.DEPOSIT_EXPIRED,
            depositStatus: LeadDepositStatus.EXPIRED,
            productHoldStatus: ProductHoldStatus.RELEASED,
            lostReason: before?.lostReason ?? 'Deposit not received within 5 hours',
          },
          include: this.leadInclude(),
        });

        await this.auditDisputesService.log({
          action: AuditAction.STATUS_CHANGE,
          entity: 'LeadWorkflow',
          entityId: lead.id,
          actorId,
          summary: 'Expired lead deposit request',
          before,
          after,
          metadata: { step: 'expire_deposit' },
        }, tx);
      });
    }

    return expiredLeads.length;
  }

  async markContacted(leadId: string, notes?: string, actorId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.getLeadOrThrow(leadId, tx);
      const after = await tx.lead.update({
        where: { id: leadId },
        data: {
          status: LeadStatus.CONTACTED,
          contactedAt: new Date(),
          notes: notes ?? before.notes,
        },
        include: this.leadInclude(),
      });

      await this.auditDisputesService.log({
        action: AuditAction.STATUS_CHANGE,
        entity: 'LeadWorkflow',
        entityId: leadId,
        actorId,
        summary: 'Marked lead as contacted',
        before,
        after,
        metadata: { step: 'mark_contacted' },
      }, tx);

      return after;
    });
  }

  async updateManualStatus(leadId: string, status: LeadStatus, actorId?: string) {
    if (!MANUAL_LEAD_STATUSES.includes(status)) {
      throw new BadRequestException('Use LeadWorkflowService actions for workflow statuses');
    }

    if (status === LeadStatus.CONTACTED) {
      return this.markContacted(leadId, undefined, actorId);
    }

    return this.prisma.$transaction(async (tx) => {
      const before = await this.getLeadOrThrow(leadId, tx);

      if (before.status === LeadStatus.BOOKING_CREATED || before.bookingId) {
        throw new BadRequestException('Cannot manually change lead outcome after booking conversion');
      }

      await this.releaseReservedInventoryIfNeeded(before, tx);

      const after = await tx.lead.update({
        where: { id: leadId },
        data: {
          status,
          productHoldStatus: ProductHoldStatus.RELEASED,
          appointmentId: null,
        },
        include: this.leadInclude(),
      });

      await this.auditDisputesService.log({
        action: AuditAction.STATUS_CHANGE,
        entity: 'LeadWorkflow',
        entityId: leadId,
        actorId,
        summary: `Updated lead outcome to ${status}`,
        before,
        after,
        metadata: { step: 'manual_lead_status' },
      }, tx);

      return after;
    });
  }

  async selectProductForLead(
    leadId: string,
    input: {
      productId: string;
      variantId?: string;
      inventoryItemId?: string;
      pickupDate: string;
      returnDate: string;
      appointmentIntent: LeadAppointmentIntent;
      size?: string;
      color?: string;
      notes?: string;
      quotedPrice?: number;
    },
    actorId?: string,
  ) {
    await this.expirePendingDeposits(actorId);
    const pickupDate = new Date(input.pickupDate);
    const returnDate = new Date(input.returnDate);
    if (Number.isNaN(pickupDate.getTime()) || Number.isNaN(returnDate.getTime())) {
      throw new BadRequestException('Invalid pickup or return date');
    }
    if (returnDate.getTime() <= pickupDate.getTime()) {
      throw new BadRequestException('Return date must be after pickup date');
    }

    return this.prisma.$transaction(async (tx) => {
      const before = await this.getLeadOrThrow(leadId, tx);
      if (
        before.status === LeadStatus.DEPOSIT_RECEIVED ||
        before.status === LeadStatus.APPOINTMENT_CREATED ||
        before.status === LeadStatus.APPOINTMENT_COMPLETED ||
        before.status === LeadStatus.BOOKING_CREATED
      ) {
        throw new BadRequestException('Cannot change selected product after deposit has been received');
      }
      const product = await tx.product.findFirst({
        where: { id: input.productId, archivedAt: null, isActive: true },
      });
      if (!product) {
        throw new BadRequestException('Product not found');
      }

      let variantData: { id: string; size: string | null; color: string | null } | null = null;
      if (input.variantId) {
        const variant = await tx.productVariant.findFirst({
          where: {
            id: input.variantId,
            productId: input.productId,
            archivedAt: null,
            isActive: true,
          },
          select: { id: true, size: true, color: true },
        });
        if (!variant) {
          throw new BadRequestException('Variant not found');
        }
        variantData = variant;
      }

      if (input.inventoryItemId) {
        const inventoryItem = await tx.inventoryItem.findFirst({
          where: {
            id: input.inventoryItemId,
            productId: input.productId,
            variantId: input.variantId ?? undefined,
            archivedAt: null,
          },
          select: { id: true },
        });
        if (!inventoryItem) {
          throw new BadRequestException('Inventory item does not match selected product');
        }
      }

      const after = await tx.lead.update({
        where: { id: leadId },
        data: {
          status: LeadStatus.PRODUCT_SELECTED,
          productHoldStatus: ProductHoldStatus.NONE,
          productId: input.productId,
          variantId: input.variantId,
          inventoryItemId: input.inventoryItemId,
          pickupDate,
          returnDate,
          rentalDates: this.serializeRentalDates(pickupDate, returnDate),
          appointmentIntent: input.appointmentIntent,
          requestedSize: input.size ?? variantData?.size ?? undefined,
          requestedColor: input.color ?? variantData?.color ?? undefined,
          notes: input.notes ?? before.notes,
          quotedPrice: input.quotedPrice ?? before.quotedPrice,
        },
        include: this.leadInclude(),
      });

      await this.auditDisputesService.log({
        action: AuditAction.UPDATE,
        entity: 'LeadWorkflow',
        entityId: leadId,
        actorId,
        summary: `Selected product for lead`,
        before,
        after,
        metadata: {
          step: 'select_product',
          productId: input.productId,
          variantId: input.variantId,
          inventoryItemId: input.inventoryItemId,
        },
      }, tx);

      return after;
    });
  }

  async requestDeposit(
    leadId: string,
    input?: {
      quotedPrice?: number;
      depositDeadlineAt?: string;
      depositAmount?: number;
    },
    actorId?: string,
  ) {
    await this.expirePendingDeposits(actorId);

    return this.prisma.$transaction(async (tx) => {
      const before = await this.getLeadOrThrow(leadId, tx);
      this.ensureProductSelectionReady(before);
      this.ensureDepositWindowOpen(before);

      const pricing = this.calculateLeadPricing(before);
      const quotedPrice = input?.quotedPrice ?? before.quotedPrice ?? pricing.totalPrice;
      const depositAmountRequired = Math.max(
        Number(input?.depositAmount ?? before.depositAmountRequired ?? 0),
        Math.ceil(Number(quotedPrice || pricing.totalPrice) * 0.5),
      );
      const deadline = input?.depositDeadlineAt
        ? new Date(input.depositDeadlineAt)
        : new Date(Date.now() + FIVE_HOURS_MS);

      const after = await tx.lead.update({
        where: { id: leadId },
        data: {
          status: LeadStatus.DEPOSIT_REQUESTED,
          depositStatus: LeadDepositStatus.REQUESTED,
          productHoldStatus: ProductHoldStatus.PENDING_DEPOSIT,
          quotedPrice,
          depositAmountRequired,
          depositRequestedAt: new Date(),
          depositDeadlineAt: deadline,
        },
        include: this.leadInclude(),
      });

      await this.auditDisputesService.log({
        action: AuditAction.UPDATE,
        entity: 'LeadWorkflow',
        entityId: leadId,
        actorId,
        summary: 'Requested deposit for lead',
        before,
        after,
        metadata: {
          step: 'request_deposit',
          depositDeadlineAt: deadline.toISOString(),
          depositAmountRequired,
        },
      }, tx);

      return after;
    });
  }

  async receiveDeposit(
    leadId: string,
    input: {
      amount: number;
      paymentMethod?: PaymentMethod;
      description?: string;
    },
    actorId?: string,
  ) {
    await this.expirePendingDeposits(actorId);
    if (Number(input.amount) <= 0) {
      throw new BadRequestException('Deposit amount must be greater than 0');
    }

    return this.prisma.$transaction(async (tx) => {
      const before = await this.getLeadOrThrow(leadId, tx);
      this.ensureProductSelectionReady(before);
      this.ensureDepositWindowOpen(before);
      if (
        before.status !== LeadStatus.DEPOSIT_REQUESTED &&
        before.status !== LeadStatus.PRODUCT_SELECTED &&
        before.status !== LeadStatus.CONTACTED
      ) {
        throw new BadRequestException('Lead is not ready to receive deposit');
      }

      const reservedItem = await this.resolveInventoryItemForLead(before, tx);
      const payment = await tx.payment.create({
        data: {
          leadId: before.id,
          type: PaymentType.BOOKING_DEPOSIT,
          amount: Number(input.amount),
          amountPaid: Number(input.amount),
          rentalAmount: 0,
          depositAmount: Number(input.amount),
          paymentMethod: input.paymentMethod ?? PaymentMethod.CASH,
          status: PaymentStatus.COMPLETED,
          paidAt: new Date(),
          description: input.description ?? `Lead deposit received for ${before.customer.name}`,
          processedById: await this.resolveActorId(actorId, tx),
        },
      });

      const leadAfterDeposit = await tx.lead.update({
        where: { id: before.id },
        data: {
          status: LeadStatus.DEPOSIT_RECEIVED,
          depositStatus: LeadDepositStatus.RECEIVED,
          productHoldStatus: ProductHoldStatus.RESERVED,
          inventoryItemId: reservedItem.id,
          depositAmountPaid: { increment: Number(input.amount) },
          depositAmountRequired: before.depositAmountRequired > 0
            ? before.depositAmountRequired
            : this.calculateLeadPricing(before).deposit.bookingDeposit,
          depositReceivedAt: new Date(),
        },
        include: this.leadInclude(),
      });

      await tx.inventoryItem.update({
        where: { id: reservedItem.id },
        data: { status: InventoryItemStatus.RESERVED },
      });

      await this.auditDisputesService.log({
        action: AuditAction.PAYMENT_POSTED,
        entity: 'LeadWorkflow',
        entityId: before.id,
        actorId,
        paymentId: payment.id,
        inventoryItemId: reservedItem.id,
        summary: `Received lead deposit ${input.amount}`,
        before,
        after: {
          paymentId: payment.id,
          leadStatus: leadAfterDeposit.status,
          inventoryItemId: reservedItem.id,
        },
        metadata: {
          step: 'receive_deposit',
          amount: input.amount,
          paymentMethod: input.paymentMethod ?? PaymentMethod.CASH,
        },
      }, tx);

      const appointment = await this.createAppointmentRecord(leadAfterDeposit, actorId, tx);

      return tx.lead.findFirst({
        where: { id: before.id },
        include: this.leadInclude(),
      }).then((lead) => ({
        ...lead,
        payment,
        appointment,
      }));
    });
  }

  async createAppointmentFromLead(leadId: string, actorId?: string) {
    await this.expirePendingDeposits(actorId);

    return this.prisma.$transaction(async (tx) => {
      const lead = await this.getLeadOrThrow(leadId, tx);
      this.ensureProductSelectionReady(lead);

      if (lead.status !== LeadStatus.DEPOSIT_RECEIVED && lead.status !== LeadStatus.APPOINTMENT_CREATED) {
        throw new BadRequestException('Lead must have a received deposit before creating appointment');
      }
      if (!lead.inventoryItemId) {
        throw new BadRequestException('Lead must reserve an inventory item before appointment');
      }

      const appointment = await this.createAppointmentRecord(lead, actorId, tx);
      const refreshedLead = await this.getLeadOrThrow(leadId, tx);
      return {
        ...refreshedLead,
        appointment,
      };
    });
  }

  async createBookingFromLead(
    leadId: string,
    actorId?: string,
  ) {
    await this.expirePendingDeposits(actorId);

    return this.prisma.$transaction(async (tx) => {
      const lead = await this.getLeadOrThrow(leadId, tx);
      this.ensureProductSelectionReady(lead);

      if (lead.bookingId) {
        const existingBooking = await tx.booking.findFirst({
          where: { id: lead.bookingId, archivedAt: null },
          include: {
            customer: true,
            items: { include: { product: true, variant: true, inventoryItem: true } },
            payments: true,
            rental: { include: { payments: true } },
          },
        });
      if (existingBooking) return existingBooking;
      }

      this.ensureLeadReadyForBooking(lead);
      if (!lead.inventoryItemId) {
        throw new BadRequestException('Lead must reserve an inventory item before booking conversion');
      }

      const actor = await this.resolveActorId(actorId, tx);
      const createdById = actor ?? lead.assignedToId;
      if (!createdById) {
        throw new BadRequestException('A valid actor is required to create booking from lead');
      }

      const reservedItem = await this.resolveInventoryItemForLead(lead, tx);
      const pricing = this.calculateLeadPricing(lead);
      const conflictingBookings = await this.findOverlappingLockedItemIds(
        [reservedItem.id],
        pricing.pickupDate,
        pricing.returnDate,
        tx,
      );
      if (conflictingBookings.size > 0) {
        throw new BadRequestException('Reserved inventory item conflicts with another booking');
      }

      const booking = await tx.booking.create({
        data: {
          leadId: lead.id,
          customerId: lead.customerId,
          status: BookingStatus.DEPOSIT_RECEIVED,
          startDate: pricing.pickupDate,
          endDate: pricing.returnDate,
          rentalDays: pricing.rentalDays,
          pickupDate: pricing.pickupDate,
          returnDate: pricing.returnDate,
          durationDays: pricing.durationDays,
          basePrice: pricing.basePrice,
          priceAdjustment: pricing.totalPrice - pricing.basePrice,
          totalPrice: pricing.totalPrice,
          bookingDepositRequired: pricing.deposit.bookingDeposit,
          bookingDepositPaid: Math.max(Number(lead.depositAmountPaid || 0), 0),
          securityDepositRequired: pricing.deposit.securityDeposit,
          securityDepositOption: pricing.deposit.securityDepositOption,
          lockedAt: new Date(),
          notes: lead.notes,
          createdById,
          items: {
            create: {
              inventoryItemId: reservedItem.id,
              productId: reservedItem.productId,
              variantId: reservedItem.variantId,
              pricePerDay: pricing.rentalPrice,
            },
          },
        },
        include: {
          customer: true,
          items: {
            include: {
              product: true,
              variant: true,
              inventoryItem: true,
            },
          },
        },
      });

      const rental = await tx.rental.create({
        data: {
          bookingId: booking.id,
          status: 'CONFIRMED',
          scheduledPickupDate: pricing.pickupDate,
          scheduledReturnDate: pricing.returnDate,
          inventoryItems: {
            connect: [{ id: reservedItem.id }],
          },
        },
      });

      const leadDepositPayment = await tx.payment.findFirst({
        where: {
          leadId: lead.id,
          bookingId: null,
          type: PaymentType.BOOKING_DEPOSIT,
          status: PaymentStatus.COMPLETED,
          archivedAt: null,
        },
        orderBy: { createdAt: 'desc' },
      });

      if (leadDepositPayment) {
        await tx.payment.update({
          where: { id: leadDepositPayment.id },
          data: {
            bookingId: booking.id,
            rentalId: rental.id,
            description: `Lead deposit converted to booking ${booking.id}`,
          },
        });
      }

      await tx.inventoryItem.update({
        where: { id: reservedItem.id },
        data: { status: InventoryItemStatus.RESERVED },
      });

      const afterLead = await tx.lead.update({
        where: { id: lead.id },
        data: {
          status: LeadStatus.BOOKING_CREATED,
          bookingId: booking.id,
          convertedToBookingId: booking.id,
          productHoldStatus: ProductHoldStatus.CONVERTED_TO_BOOKING,
        },
        include: this.leadInclude(),
      });

      if (lead.appointmentId) {
        await tx.appointment.updateMany({
          where: { id: lead.appointmentId, bookingId: null },
          data: { bookingId: booking.id },
        });
      }

      await this.auditDisputesService.log({
        action: AuditAction.CREATE,
        entity: 'LeadWorkflow',
        entityId: lead.id,
        actorId,
        bookingId: booking.id,
        rentalId: rental.id,
        inventoryItemId: reservedItem.id,
        summary: `Auto-created booking ${booking.id} from lead`,
        before: lead,
        after: afterLead,
        metadata: {
          step: 'auto_create_booking',
          bookingId: booking.id,
          rentalId: rental.id,
          pricing,
        },
      }, tx);

      return tx.booking.findFirst({
        where: { id: booking.id },
        include: {
          customer: true,
          items: {
            include: {
              product: true,
              variant: true,
              inventoryItem: true,
            },
          },
          payments: true,
          rental: { include: { payments: true } },
        },
      });
    });
  }

  async linkExistingBookingToLead(
    leadId: string,
    bookingId: string,
    actorId?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const lead = await this.getLeadOrThrow(leadId, tx);
      this.ensureProductSelectionReady(lead);
      this.ensureLeadReadyForBooking(lead);

      const booking = await this.getBookingOrThrow(bookingId, tx);
      if (booking.leadId && booking.leadId !== lead.id) {
        throw new BadRequestException('Booking is already linked to another lead');
      }
      if (booking.customerId !== lead.customerId) {
        throw new BadRequestException('Booking customer does not match lead customer');
      }
      if (lead.inventoryItemId && !booking.items.some((item) => item.inventoryItemId === lead.inventoryItemId)) {
        throw new BadRequestException('Booking does not include the reserved inventory item from lead');
      }

      await tx.booking.update({
        where: { id: booking.id },
        data: { leadId: lead.id },
      });

      const after = await tx.lead.update({
        where: { id: lead.id },
        data: {
          status: LeadStatus.BOOKING_CREATED,
          bookingId: booking.id,
          convertedToBookingId: booking.id,
          productHoldStatus: ProductHoldStatus.CONVERTED_TO_BOOKING,
        },
        include: this.leadInclude(),
      });

      if (lead.appointmentId) {
        await tx.appointment.updateMany({
          where: { id: lead.appointmentId, bookingId: null },
          data: { bookingId: booking.id },
        });
      }

      await this.auditDisputesService.log({
        action: AuditAction.UPDATE,
        entity: 'LeadWorkflow',
        entityId: lead.id,
        actorId,
        bookingId: booking.id,
        summary: `Linked existing booking ${booking.id} to lead`,
        before: lead,
        after,
        metadata: {
          step: 'link_existing_booking',
          bookingId: booking.id,
        },
      }, tx);

      return this.getBookingOrThrow(booking.id, tx);
    });
  }

  async completeAppointment(appointmentId: string, actorId?: string) {
    await this.expirePendingDeposits(actorId);

    return this.prisma.$transaction(async (tx) => {
      const appointment = await this.getAppointmentOrThrow(appointmentId, tx);
      const before = appointment;
      const completed = await tx.appointment.update({
        where: { id: appointmentId },
        data: {
          status: AppointmentStatus.COMPLETED,
          lifecycleStatus: 'completed',
        },
      });

      if (!appointment.leadId) {
        await this.auditDisputesService.log({
          action: AuditAction.STATUS_CHANGE,
          entity: 'Appointment',
          entityId: appointmentId,
          actorId,
          summary: `Completed appointment ${appointmentId}`,
          before,
          after: completed,
        }, tx);
        return completed;
      }

      const lead = await this.getLeadOrThrow(appointment.leadId, tx);
      const leadAfterComplete = await tx.lead.update({
        where: { id: lead.id },
        data: {
          status: LeadStatus.APPOINTMENT_COMPLETED,
          appointmentId: appointment.id,
        },
        include: this.leadInclude(),
      });

      await this.auditDisputesService.log({
        action: AuditAction.STATUS_CHANGE,
        entity: 'LeadWorkflow',
        entityId: lead.id,
        actorId,
        summary: `Completed appointment ${appointmentId} from lead`,
        before: {
          appointment,
          leadStatus: lead.status,
        },
        after: {
          appointment: completed,
          leadStatus: leadAfterComplete.status,
        },
        metadata: { step: 'complete_appointment' },
      }, tx);

      return completed;
    }).then(async (completed) => {
      const appointment = await this.prisma.appointment.findFirst({
        where: { id: appointmentId },
        select: { leadId: true },
      });
      if (appointment?.leadId) {
        await this.createBookingFromLead(appointment.leadId, actorId);
      }
      return this.prisma.appointment.findFirst({
        where: { id: appointmentId },
        include: {
          customer: true,
          staff: true,
          resourceItem: true,
        },
      });
    });
  }

  async handleAppointmentCancelledOrNoShow(
    appointmentId: string,
    status: AppointmentStatus,
    actorId?: string,
  ) {
    if (status !== AppointmentStatus.CANCELLED && status !== AppointmentStatus.NO_SHOW) {
      throw new BadRequestException('Appointment status must be cancelled or no_show');
    }
    return this.prisma.$transaction(async (tx) => {
      const appointment = await this.getAppointmentOrThrow(appointmentId, tx);
      const updated = await tx.appointment.update({
        where: { id: appointmentId },
        data: {
          status,
          lifecycleStatus: status === AppointmentStatus.NO_SHOW ? 'no_show' : 'cancelled',
        },
      });

      if (appointment.leadId) {
        await tx.lead.update({
          where: { id: appointment.leadId },
          data: {
            status: LeadStatus.DEPOSIT_RECEIVED,
            productHoldStatus: ProductHoldStatus.RESERVED,
            appointmentId: null,
          },
        });

        await this.auditDisputesService.log({
          action: AuditAction.STATUS_CHANGE,
          entity: 'LeadWorkflow',
          entityId: appointment.leadId,
          actorId,
          summary: `Appointment ${status.toLowerCase()} without booking conversion`,
          before: appointment,
          after: updated,
          metadata: {
            step: 'appointment_not_converted',
            keepReservation: true,
          },
        }, tx);
      }

      return updated;
    });
  }
}
