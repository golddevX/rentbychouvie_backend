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
  LeadAppointmentIntent,
  LeadDepositStatus,
  LeadDepositType,
  LeadStatus,
  InventoryItemStatus,
  PaymentMethod,
  PaymentStatus,
  PaymentType,
  Prisma,
  ProductHoldStatus,
  ProductStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RentalPricingService } from '../pricing/rental-pricing.service';
import { AuditDisputesService } from '../audit-disputes/audit-disputes.service';
import { PaymentsService } from '../payments/payments.service';

const ONE_DAY_MS = 1000 * 60 * 60 * 24;
const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;

type PrismaClientLike = PrismaService | Prisma.TransactionClient;

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
    private readonly paymentsService: PaymentsService,
  ) {}

  private leadInclude() {
    return {
      customer: true,
      assignedTo: {
        select: { id: true, fullName: true, email: true, role: true },
      },
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

  private activeLeadItems(lead: Awaited<ReturnType<LeadWorkflowService['getLeadOrThrow']>>) {
    const items = (lead.items ?? []).filter((item) => item.status !== 'REMOVED');
    if (items.length > 0) return items;
    if (!lead.productId || !lead.product) return [];
    return [{
      id: `legacy-${lead.id}-${lead.productId}`,
      leadId: lead.id,
      productId: lead.productId,
      inventoryItemId: null,
      inventoryItem: null,
      product: lead.product,
      productValueAtTime: Number((lead.product as any).productValue ?? lead.product.price ?? 0),
      rentalPriceAtTime: Number((lead.product as any).rentalPrice ?? lead.product.price ?? 0),
      status: 'REQUESTED',
      createdAt: lead.createdAt ?? new Date(),
      updatedAt: lead.updatedAt ?? new Date(),
    }];
  }

  private reservedLeadItems(lead: Awaited<ReturnType<LeadWorkflowService['getLeadOrThrow']>>) {
    return this.activeLeadItems(lead).filter((item) => item.status === 'RESERVED');
  }

  private async syncLeadPrimaryProduct(
    leadId: string,
    client: PrismaClientLike = this.prisma,
  ) {
    const firstActiveItem = await client.leadItem.findFirst({
      where: {
        leadId,
        status: { not: 'REMOVED' as any },
      },
      orderBy: { createdAt: 'asc' },
      select: { productId: true },
    });

    await client.lead.update({
      where: { id: leadId },
      data: {
        productId: firstActiveItem?.productId ?? null,
        inventoryItemId: null,
      },
    });
  }

  private ensureProductSelectionReady(lead: Awaited<ReturnType<LeadWorkflowService['getLeadOrThrow']>>) {
    const items = this.activeLeadItems(lead);
    if (items.length === 0) {
      throw new BadRequestException('Lead does not have any selected products');
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
    if (this.reservedLeadItems(lead).length === 0) {
      throw new BadRequestException('Lead must reserve at least one selected product before booking conversion');
    }
  }

  private clearWorkflowBlock() {
    return {
      workflowBlockCode: null,
      workflowBlockMessage: null,
    };
  }

  private statusAfterDepositReversal(lead: Awaited<ReturnType<LeadWorkflowService['getLeadOrThrow']>>) {
    if (lead.status === LeadStatus.CONTACTED || lead.contactedAt) return LeadStatus.CONTACTED;
    if (this.activeLeadItems(lead).length > 0 && lead.pickupDate && lead.returnDate) return LeadStatus.PRODUCT_SELECTED;
    return LeadStatus.NEW;
  }

  private async latestCompletedLeadDepositPayment(
    leadId: string,
    client: PrismaClientLike = this.prisma,
  ) {
    return client.payment.findFirst({
      where: {
        leadId,
        archivedAt: null,
        type: {
          in: [PaymentType.SECURITY_DEPOSIT, PaymentType.BOOKING_DEPOSIT],
        },
        status: PaymentStatus.COMPLETED,
      },
      orderBy: { createdAt: 'desc' },
    });
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

  private productValueForLead(lead: Awaited<ReturnType<LeadWorkflowService['getLeadOrThrow']>>) {
    const total = this.activeLeadItems(lead).reduce((sum, item) => (
      sum
      + Math.max(
        Number(item.productValueAtTime || 0),
        Number((item.product as any)?.productValue ?? 0),
        Number(item.product?.price ?? 0),
        0,
      )
    ), 0);
    if (total > 0) {
      return total;
    }
    return Math.max(Number(lead.quotedPrice ?? 0), 0);
  }

  private rentalPriceForLead(lead: Awaited<ReturnType<LeadWorkflowService['getLeadOrThrow']>>) {
    return this.activeLeadItems(lead).reduce((sum, item) => (
      sum
      + Math.max(
        Number(item.rentalPriceAtTime || 0),
        Number((item.product as any)?.rentalPrice ?? 0),
        Number(item.product?.price ?? 0),
        0,
      )
    ), 0);
  }

  private async releaseReservedProductIfNeeded(
    lead: Awaited<ReturnType<LeadWorkflowService['getLeadOrThrow']>>,
    client: PrismaClientLike = this.prisma,
  ) {
    const reservedItems = this.reservedLeadItems(lead);
    if (lead.bookingId || reservedItems.length === 0) {
      return;
    }
    await client.product.updateMany({
      where: {
        id: {
          in: [...new Set(reservedItems.map((item) => item.productId))],
        },
      },
      data: { status: ProductStatus.AVAILABLE },
    });
    await client.leadItem.updateMany({
      where: {
        leadId: lead.id,
        status: 'RESERVED' as any,
      },
      data: { status: 'REQUESTED' as any },
    });
  }

  private calculateLeadPricing(lead: Awaited<ReturnType<LeadWorkflowService['getLeadOrThrow']>>) {
    this.ensureProductSelectionReady(lead);

    const pickupDate = new Date(lead.pickupDate!);
    const returnDate = new Date(lead.returnDate!);
    const rentalDays = this.durationFromDates(pickupDate, returnDate);
    const items = this.activeLeadItems(lead);
    const productValue = this.productValueForLead(lead);
    const rentalPrice = items.reduce((sum, item) => {
      const unitPrice = Math.max(
        Number(item.rentalPriceAtTime || 0),
        Number((item.product as any)?.rentalPrice ?? 0),
        Number(item.product?.price ?? 0),
        0,
      );
      return sum + this.pricingService.calculateRentalTotal({
        dailyRentalPrice: unitPrice,
        rentalDays,
      }).rentalTotal;
    }, 0);
    const totalPrice = rentalPrice;
    const deposit = this.pricingService.calculateDeposit(totalPrice, productValue);

    return {
      pickupDate,
      returnDate,
      rentalDays,
      durationDays: rentalDays,
      basePrice: rentalPrice,
      productValue,
      rentalPrice,
      totalPrice,
      deposit,
    };
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
        staffId: lead.assignedToId ?? undefined,
        leadId: lead.id,
      },
    });

    await client.lead.update({
      where: { id: lead.id },
      data: {
        appointmentId: appointment.id,
        status: LeadStatus.APPOINTMENT_CREATED,
        ...this.clearWorkflowBlock(),
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

  async expireDeposit(leadId: string, actorId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.getLeadOrThrow(leadId, tx);
      if (before.status !== LeadStatus.DEPOSIT_REQUESTED) {
        return before;
      }

      await this.releaseReservedProductIfNeeded(before, tx);

      const after = await tx.lead.update({
        where: { id: leadId },
        data: {
          status: LeadStatus.DEPOSIT_EXPIRED,
          depositStatus: LeadDepositStatus.EXPIRED,
          productHoldStatus: ProductHoldStatus.RELEASED,
          lostReason: before.lostReason ?? 'Deposit not received within 5 hours',
          workflowBlockCode: 'deposit_expired',
          workflowBlockMessage: 'Deposit request expired before payment was received.',
        },
        include: this.leadInclude(),
      });

      await this.auditDisputesService.log({
        action: AuditAction.STATUS_CHANGE,
        entity: 'LeadWorkflow',
        entityId: leadId,
        actorId,
        summary: 'Expired lead deposit request',
        before,
        after,
        metadata: { step: 'expire_deposit' },
      }, tx);

      return after;
    });
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
      await this.expireDeposit(lead.id, actorId);
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

      await this.releaseReservedProductIfNeeded(before, tx);

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
      productId?: string;
      productIds?: string[];
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
    const requestedProductIds = Array.from(
      new Set(
        [
          ...(Array.isArray(input.productIds) ? input.productIds : []),
          ...(input.productId ? [input.productId] : []),
        ].filter(Boolean),
      ),
    );
    if (!requestedProductIds.length) {
      throw new BadRequestException('At least one product is required');
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
      const selectedProducts = requestedProductIds.length > 0
        ? await tx.product.findMany({
            where: {
              id: { in: requestedProductIds },
              archivedAt: null,
            },
          })
        : [];
      if (selectedProducts.length !== requestedProductIds.length) {
        throw new BadRequestException('One or more selected products were not found');
      }

      const after = await tx.lead.update({
        where: { id: leadId },
        data: {
          status: LeadStatus.PRODUCT_SELECTED,
          productHoldStatus: ProductHoldStatus.NONE,
          productId: selectedProducts[0]?.id ?? null,
          variantId: null,
          inventoryItemId: null,
          pickupDate,
          returnDate,
          rentalDates: this.serializeRentalDates(pickupDate, returnDate),
          appointmentIntent: input.appointmentIntent,
          requestedSize: input.size ?? null,
          requestedColor: input.color ?? null,
          notes: input.notes ?? before.notes,
          quotedPrice:
            input.quotedPrice
            ?? selectedProducts.reduce(
              (sum, product) => sum + Math.max(
                Number((product as any)?.rentalPrice ?? product.price ?? 0),
                0,
              ),
              0,
            ),
          items: {
            deleteMany: {},
            create: selectedProducts.map((product) => ({
              productId: product.id,
              inventoryItemId: null,
              productNameAtTime: product.name ?? null,
              productValueAtTime: Math.max(
                Number((product as any)?.productValue ?? 0),
                Number(product.price ?? 0),
                0,
              ),
              rentalPriceAtTime: Math.max(
                Number((product as any)?.rentalPrice ?? 0),
                Number(product.price ?? 0),
                0,
              ),
              status: 'REQUESTED' as const,
            })),
          },
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
          productIds: requestedProductIds,
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
      depositRate?: number;
      depositType?: 'percent' | 'custom_amount';
      customDepositAmount?: number;
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
      const depositPolicy = this.pricingService.getDepositPolicy();
      const productValue = Math.max(Number(pricing.productValue || 0), 0);
      const requestedDeposit = this.pricingService.calculateRequestedDeposit({
        productValue,
        depositType:
          input?.depositType
          ?? ((before as any).selectedDepositType === LeadDepositType.CUSTOM_AMOUNT ? 'custom_amount' : 'percent'),
        depositRate: input?.depositRate ?? (before as any).selectedDepositRate,
        customAmount: input?.customDepositAmount ?? (before as any).customDepositAmount,
        policy: depositPolicy,
      });
      const depositAmountRequired = requestedDeposit.requiredAmount;
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
          selectedDepositType:
            requestedDeposit.depositType === 'custom_amount'
              ? LeadDepositType.CUSTOM_AMOUNT
              : LeadDepositType.PERCENT,
          selectedDepositRate: requestedDeposit.selectedDepositRate,
          customDepositAmount: requestedDeposit.customAmount,
          depositRequestedAt: new Date(),
          depositDeadlineAt: deadline,
          ...this.clearWorkflowBlock(),
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
          selectedDepositRate: requestedDeposit.selectedDepositRate,
          selectedDepositType: requestedDeposit.depositType,
          customDepositAmount: requestedDeposit.customAmount,
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
      depositRate?: number;
      depositType?: 'percent' | 'custom_amount';
      customDepositAmount?: number;
    },
    actorId?: string,
  ) {
    await this.expirePendingDeposits(actorId);

    return this.prisma.$transaction(async (tx) => {
      const before = await this.getLeadOrThrow(leadId, tx);
      this.ensureProductSelectionReady(before);
      if (before.bookingId || before.status === LeadStatus.BOOKING_CREATED) {
        throw new BadRequestException('Lead has already been converted to booking');
      }
      if (before.status === LeadStatus.CANCELLED || before.status === LeadStatus.LOST) {
        throw new BadRequestException('Lead is not ready to receive deposit');
      }
      const existingCompletedDeposit = await this.latestCompletedLeadDepositPayment(before.id, tx);
      if (existingCompletedDeposit) {
        const existingAppointment = before.appointmentId
          ? await tx.appointment.findFirst({ where: { id: before.appointmentId, archivedAt: null } })
          : null;
        return {
          ...(await this.getLeadOrThrow(before.id, tx)),
          payment: existingCompletedDeposit,
          appointment: existingAppointment,
        };
      }

      const pricing = this.calculateLeadPricing(before);
      const depositPolicy = this.pricingService.getDepositPolicy();
      const productValue = Math.max(Number(pricing.productValue || 0), 0);
      const requestedDeposit = this.pricingService.calculateRequestedDeposit({
        productValue,
        depositType:
          input.depositType
          ?? ((before as any).selectedDepositType === LeadDepositType.CUSTOM_AMOUNT ? 'custom_amount' : 'percent'),
        depositRate: input.depositRate ?? (before as any).selectedDepositRate,
        customAmount: input.customDepositAmount ?? (before as any).customDepositAmount,
        policy: depositPolicy,
      });
      const requiredDepositAmount = requestedDeposit.requiredAmount;
      if (Number(input.amount) < 0) {
        throw new BadRequestException('Deposit amount must be zero or greater');
      }
      if (Number(input.amount) < requiredDepositAmount) {
        throw new BadRequestException('Security deposit does not satisfy the requested deposit amount');
      }
      const requestedItems = this.activeLeadItems(before);

      const payment = await tx.payment.create({
        data: {
          leadId: before.id,
          type: PaymentType.SECURITY_DEPOSIT,
          amount: Number(input.amount),
          amountPaid: Number(input.amount),
          rentalAmount: 0,
          securityDepositAmount: Number(input.amount),
          paymentMethod: input.paymentMethod ?? PaymentMethod.CASH,
          status: PaymentStatus.COMPLETED,
          paidAt: new Date(),
          description: input.description ?? `Lead security deposit received for ${before.customer.name}`,
          processedById: await this.resolveActorId(actorId, tx),
          metadata: {
            sourceStage: 'lead',
            depositType: requestedDeposit.depositType,
            depositRate: requestedDeposit.selectedDepositRate,
            customDepositAmount: requestedDeposit.customAmount,
            productValueAtTime: productValue,
            rentalTotalAtTime: Number(pricing.totalPrice || before.quotedPrice || 0),
            note: input.description ?? null,
          },
        },
      });

      const leadAfterDeposit = await tx.lead.update({
        where: { id: before.id },
        data: {
          status: LeadStatus.DEPOSIT_RECEIVED,
          depositStatus: LeadDepositStatus.RECEIVED,
          productHoldStatus: ProductHoldStatus.RESERVED,
          depositAmountPaid: { increment: Number(input.amount) },
          depositAmountRequired: requiredDepositAmount,
          selectedDepositType:
            requestedDeposit.depositType === 'custom_amount'
              ? LeadDepositType.CUSTOM_AMOUNT
              : LeadDepositType.PERCENT,
          selectedDepositRate: requestedDeposit.selectedDepositRate,
          customDepositAmount: requestedDeposit.customAmount,
          depositReceivedAt: new Date(),
          depositDeadlineAt: null,
          ...this.clearWorkflowBlock(),
        },
        include: this.leadInclude(),
      });

      await tx.product.updateMany({
        where: {
          id: {
            in: [...new Set(requestedItems.map((item) => item.productId))],
          },
        },
        data: { status: ProductStatus.RESERVED },
      });
      await tx.leadItem.updateMany({
        where: {
          leadId: before.id,
          status: { not: 'REMOVED' as any },
        },
        data: { status: 'RESERVED' as any },
      });

      await this.auditDisputesService.log({
        action: AuditAction.PAYMENT_POSTED,
        entity: 'LeadWorkflow',
        entityId: before.id,
        actorId,
        paymentId: payment.id,
        summary: `Received lead deposit ${input.amount}`,
        before,
        after: {
          paymentId: payment.id,
          leadStatus: leadAfterDeposit.status,
          productIds: requestedItems.map((item) => item.productId),
        },
        metadata: {
          step: 'receive_deposit',
          amount: input.amount,
          paymentMethod: input.paymentMethod ?? PaymentMethod.CASH,
          selectedDepositRate: requestedDeposit.selectedDepositRate,
          selectedDepositType: requestedDeposit.depositType,
          customDepositAmount: requestedDeposit.customAmount,
        },
      }, tx);

      try {
        const appointment = await this.createAppointmentRecord(leadAfterDeposit, actorId, tx);
        return tx.lead.findFirst({
          where: { id: before.id },
          include: this.leadInclude(),
        }).then((lead) => ({
          ...lead,
          payment,
          appointment,
        }));
      } catch (error: any) {
        const blockedLead = await tx.lead.update({
          where: { id: before.id },
          data: {
            status: LeadStatus.DEPOSIT_RECEIVED,
            depositStatus: LeadDepositStatus.RECEIVED,
            productHoldStatus: ProductHoldStatus.RESERVED,
            appointmentId: null,
            workflowBlockCode: 'appointment_failed',
            workflowBlockMessage: error?.message ?? 'Unable to auto-create appointment after receiving deposit.',
          },
          include: this.leadInclude(),
        });

        await this.auditDisputesService.log({
          action: AuditAction.STATUS_CHANGE,
          entity: 'LeadWorkflow',
          entityId: before.id,
          actorId,
          paymentId: payment.id,
          summary: `Lead deposit received but appointment creation failed for lead ${before.id}`,
          before: leadAfterDeposit,
          after: blockedLead,
          metadata: {
            step: 'receive_deposit_appointment_failed',
            error: error?.message,
          },
        }, tx);

        return {
          ...blockedLead,
          payment,
          appointment: null,
        };
      }
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
      if (this.reservedLeadItems(lead).length === 0) {
        throw new BadRequestException('Lead must reserve selected products before appointment');
      }

      const appointment = await this.createAppointmentRecord(lead, actorId, tx);
      const refreshedLead = await this.getLeadOrThrow(leadId, tx);
      return {
        ...refreshedLead,
        appointment,
      };
    });
  }

  async retryCreateAppointment(leadId: string, actorId?: string) {
    return this.createAppointmentFromLead(leadId, actorId);
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

      const existingByLead = await tx.booking.findFirst({
        where: {
          leadId: lead.id,
          archivedAt: null,
        },
        include: {
          customer: true,
          items: { include: { product: true, variant: true, inventoryItem: true } },
          payments: true,
          rental: { include: { payments: true } },
        },
      });
      if (existingByLead) {
        if (!lead.bookingId) {
          await tx.lead.update({
            where: { id: lead.id },
            data: {
              status: LeadStatus.BOOKING_CREATED,
              bookingId: existingByLead.id,
              convertedToBookingId: existingByLead.id,
              productHoldStatus: ProductHoldStatus.CONVERTED_TO_BOOKING,
              ...this.clearWorkflowBlock(),
            },
          });
        }
        return existingByLead;
      }

      this.ensureLeadReadyForBooking(lead);

      const actor = await this.resolveActorId(actorId, tx);
      const createdById = actor ?? lead.assignedToId;
      if (!createdById) {
        throw new BadRequestException('A valid actor is required to create booking from lead');
      }

      const pricing = this.calculateLeadPricing(lead);
      const reservedItems = this.reservedLeadItems(lead);
      if (reservedItems.length === 0) {
        throw new BadRequestException('Lead does not have any reserved products ready for booking');
      }

      const booking = await tx.booking.create({
        data: {
          leadId: lead.id,
          customerId: lead.customerId,
          status: BookingStatus.DEPOSIT_RECEIVED,
          appointmentId: lead.appointmentId ?? undefined,
          startDate: pricing.pickupDate,
          endDate: pricing.returnDate,
          rentalDays: pricing.rentalDays,
          pickupDate: pricing.pickupDate,
          returnDate: pricing.returnDate,
          durationDays: pricing.durationDays,
          basePrice: pricing.basePrice,
          priceAdjustment: pricing.totalPrice - pricing.basePrice,
          totalPrice: pricing.totalPrice,
          productValue: Math.max(Number(pricing.productValue || 0), 0),
          productValueTotal: Math.max(Number(pricing.productValue || 0), 0),
          selectedDepositType:
            (lead as any).selectedDepositType === LeadDepositType.CUSTOM_AMOUNT
              ? LeadDepositType.CUSTOM_AMOUNT
              : LeadDepositType.PERCENT,
          selectedDepositRate: Number((lead as any).selectedDepositRate || 50),
          customDepositAmount: Number((lead as any).customDepositAmount || 0) || null,
          depositPolicySnapshot: this.pricingService.getDepositPolicy() as unknown as Prisma.InputJsonValue,
          rentalPaymentPolicySnapshot: this.pricingService.getRentalPaymentPolicy() as unknown as Prisma.InputJsonValue,
          bookingDepositRequired: Math.max(Number(lead.depositAmountRequired || 0), 0),
          bookingDepositPaid: Math.max(Number(lead.depositAmountPaid || 0), 0),
          depositRequired: Math.max(Number(lead.depositAmountRequired || 0), 0),
          depositPaid: Math.max(Number(lead.depositAmountPaid || 0), 0),
          rentalPaid: 0,
          securityDepositRequired: Math.max(Number(pricing.productValue || 0), 0),
          securityDepositOption: 'cash',
          lockedAt: new Date(),
          notes: lead.notes,
          createdById,
          items: {
            create: reservedItems.map((item) => ({
              inventoryItemId: item.inventoryItemId ?? undefined,
              productId: item.productId,
              productNameAtTime: item.product?.name ?? null,
              pricePerDay: Math.max(
                Number(item.rentalPriceAtTime || 0),
                Number((item.product as any)?.rentalPrice ?? 0),
                Number(item.product?.price ?? 0),
                0,
              ),
              productValueAtTime: Math.max(
                Number(item.productValueAtTime || 0),
                Number((item.product as any)?.productValue ?? 0),
                Number(item.product?.price ?? 0),
                0,
              ),
              rentalPriceAtTime: Math.max(
                Number(item.rentalPriceAtTime || 0),
                Number((item.product as any)?.rentalPrice ?? 0),
                Number(item.product?.price ?? 0),
                0,
              ),
            })),
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
          status: 'PENDING_PAYMENT',
          scheduledPickupDate: pricing.pickupDate,
          scheduledReturnDate: pricing.returnDate,
          ...(reservedItems.some((item) => item.inventoryItemId)
            ? {
                inventoryItems: {
                  connect: reservedItems
                    .map((item) => item.inventoryItemId)
                    .filter((id): id is string => Boolean(id))
                    .map((id) => ({ id })),
                },
              }
            : {}),
        },
      });

      const leadDepositPayment = await tx.payment.findFirst({
        where: {
          leadId: lead.id,
          bookingId: null,
          type: {
            in: [PaymentType.SECURITY_DEPOSIT, PaymentType.BOOKING_DEPOSIT],
          },
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

        await tx.booking.update({
          where: { id: booking.id },
          data: {
            bookingDepositPaymentId: leadDepositPayment.id,
          },
        });
      }

      await tx.inventoryItem.updateMany({
        where: {
          id: {
            in: reservedItems
              .map((item) => item.inventoryItemId)
              .filter((id): id is string => Boolean(id)),
          },
        },
        data: { status: InventoryItemStatus.RESERVED },
      });
      await tx.product.updateMany({
        where: {
          id: {
            in: [...new Set(reservedItems.map((item) => item.productId))],
          },
        },
        data: { status: ProductStatus.RESERVED },
      });
      await tx.leadItem.updateMany({
        where: {
          leadId: lead.id,
          inventoryItemId: {
            in: reservedItems
              .map((item) => item.inventoryItemId)
              .filter((id): id is string => Boolean(id)),
          },
        },
        data: { status: 'RESERVED' as any },
      });

      const afterLead = await tx.lead.update({
        where: { id: lead.id },
        data: {
          status: LeadStatus.BOOKING_CREATED,
          bookingId: booking.id,
          convertedToBookingId: booking.id,
          productHoldStatus: ProductHoldStatus.CONVERTED_TO_BOOKING,
          ...this.clearWorkflowBlock(),
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

      await this.paymentsService.syncBookingDerivedState(booking.id, tx);

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
      if (this.activeLeadItems(lead).length === 0) {
        throw new BadRequestException('Lead does not include selected products');
      }

      await tx.booking.update({
        where: { id: booking.id },
        data: {
          leadId: lead.id,
          appointmentId: lead.appointmentId ?? booking.appointmentId ?? undefined,
        },
      });

      const after = await tx.lead.update({
        where: { id: lead.id },
        data: {
          status: LeadStatus.BOOKING_CREATED,
          bookingId: booking.id,
          convertedToBookingId: booking.id,
          productHoldStatus: ProductHoldStatus.CONVERTED_TO_BOOKING,
          ...this.clearWorkflowBlock(),
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
          ...this.clearWorkflowBlock(),
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
        try {
          await this.createBookingFromLead(appointment.leadId, actorId);
        } catch (error: any) {
          await this.prisma.lead.update({
            where: { id: appointment.leadId },
            data: {
              workflowBlockCode: 'booking_failed',
              workflowBlockMessage: error?.message ?? 'Unable to auto-create booking after appointment completion.',
            },
          });
          await this.auditDisputesService.log({
            action: AuditAction.STATUS_CHANGE,
            entity: 'LeadWorkflow',
            entityId: appointment.leadId,
            actorId,
            summary: `Appointment completed but booking creation failed for lead ${appointment.leadId}`,
            after: {
              workflowBlockCode: 'booking_failed',
              workflowBlockMessage: error?.message ?? 'Unable to auto-create booking after appointment completion.',
            },
            metadata: {
              step: 'complete_appointment_booking_failed',
              appointmentId,
              error: error?.message,
            },
          });
        }
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
            workflowBlockCode: status === AppointmentStatus.NO_SHOW ? 'appointment_no_show' : 'appointment_cancelled',
            workflowBlockMessage:
              status === AppointmentStatus.NO_SHOW
                ? 'Appointment marked no-show. Reservation still requires manager follow-up.'
                : 'Appointment was cancelled before booking conversion.',
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

  async retryCreateBooking(leadId: string, actorId?: string) {
    return this.createBookingFromLead(leadId, actorId);
  }

  async refundDeposit(leadId: string, actorId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const lead = await this.getLeadOrThrow(leadId, tx);
      if (lead.bookingId || lead.status === LeadStatus.BOOKING_CREATED) {
        throw new BadRequestException('Cannot refund lead deposit after booking has been created');
      }

      const depositPayment = await this.latestCompletedLeadDepositPayment(lead.id, tx);
      if (!depositPayment) {
        throw new BadRequestException('No completed security deposit exists for this lead');
      }

      const refundableAmount = Math.max(
        Number(depositPayment.amount || 0) - Number(depositPayment.amountRefunded || 0),
        0,
      );
      if (refundableAmount <= 0) {
        throw new BadRequestException('Lead deposit has already been fully refunded');
      }

      const refund = await this.paymentsService.createRefund({
        amount: refundableAmount,
        sourcePaymentId: depositPayment.id,
        leadId: lead.id,
        description: `Refunded lead security deposit for lead ${lead.id}`,
        processedById: actorId,
      }, tx);

      if (lead.appointmentId) {
        await tx.appointment.updateMany({
          where: {
            id: lead.appointmentId,
            archivedAt: null,
            status: { notIn: [AppointmentStatus.CANCELLED, AppointmentStatus.NO_SHOW] },
          },
          data: {
            status: AppointmentStatus.CANCELLED,
            lifecycleStatus: 'cancelled',
          },
        });
      }

      await this.releaseReservedProductIfNeeded(lead, tx);

      const after = await tx.lead.update({
        where: { id: lead.id },
        data: {
          status: this.statusAfterDepositReversal(lead),
          depositStatus: LeadDepositStatus.NONE,
          productHoldStatus: ProductHoldStatus.RELEASED,
          depositAmountPaid: 0,
          depositReceivedAt: null,
          appointmentId: null,
          ...this.clearWorkflowBlock(),
        },
        include: this.leadInclude(),
      });

      await this.auditDisputesService.log({
        action: AuditAction.REFUND_PROCESSED,
        entity: 'LeadWorkflow',
        entityId: lead.id,
        actorId,
        paymentId: refund.id,
        summary: `Refunded security deposit for lead ${lead.id}`,
        before: lead,
        after,
        metadata: {
          step: 'refund_deposit',
          sourcePaymentId: depositPayment.id,
          refundPaymentId: refund.id,
          amount: refundableAmount,
        },
      }, tx);

      return {
        ...after,
        refund,
      };
    });
  }
}

