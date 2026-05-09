import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  BookingStatus,
  LeadDepositType,
  LeadStatus,
  PaymentGateway,
  PaymentMethod,
  PaymentStatus,
  PaymentTransactionStatus,
  PaymentType,
  Prisma,
  ProductHoldStatus,
  RentalStatus,
} from '@prisma/client';
import { PDFDocument, rgb } from 'pdf-lib';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentGatewayService } from './providers/payment-gateway.service';
import { AuditDisputesService } from '../audit-disputes/audit-disputes.service';
import { RentalPricingService } from '../pricing/rental-pricing.service';
import { buildPaginatedResult, resolvePagination } from '../shared/pagination';

type ReturnSettlementDraft = {
  version: 1;
  status: 'pending_payment' | 'settled';
  condition: string;
  applyRentalToDeposit: boolean;
  actualReturnDate?: string | null;
  notes?: string;
  lateDays: number;
  fees: {
    lateFee: number;
    dirtyFee: number;
    damageFee: number;
    accessoryFee: number;
    otherFee: number;
  };
  updatedAt: string;
};

@Injectable()
export class PaymentsService {
  constructor(
    private prisma: PrismaService,
    private paymentGatewayService: PaymentGatewayService,
    private auditDisputesService: AuditDisputesService,
    private pricingService: RentalPricingService,
  ) {}

  private bookingInclude() {
    return {
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
      rental: {
        include: {
          payments: {
            where: { archivedAt: null },
            orderBy: { createdAt: 'desc' as const },
          },
          inventoryItems: true,
          returnInspections: {
            orderBy: { createdAt: 'desc' as const },
          },
        },
      },
      payments: {
        where: { archivedAt: null },
        orderBy: { createdAt: 'desc' as const },
      },
    };
  }

  private leadInclude() {
    return {
      customer: true,
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
        orderBy: { createdAt: 'asc' as const },
      },
      payments: {
        where: { archivedAt: null },
        orderBy: { createdAt: 'desc' as const },
      },
    };
  }

  private activeLeadItems(lead: any) {
    const items = (lead?.items ?? []).filter((item: any) => String(item.status ?? '').toLowerCase() !== 'removed');
    if (items.length > 0) return items;
    if (!lead?.productId || !lead?.product) return [];
    return [{
      id: `legacy-${lead.id}-${lead.productId}`,
      productId: lead.productId,
      inventoryItemId: null,
      product: lead.product,
      inventoryItem: null,
      productValueAtTime: Number((lead.product as any).productValue ?? lead.product.price ?? 0),
      rentalPriceAtTime: Number((lead.product as any).rentalPrice ?? lead.product.price ?? 0),
      status: 'REQUESTED',
    }];
  }

  private bookingProductRows(booking: any) {
    if (Array.isArray(booking?.items) && booking.items.length > 0) {
      return booking.items.map((item: any) => ({
        productId: item.productId,
        inventoryItemId: item.inventoryItemId,
        productName: item.product?.name ?? item.inventoryItem?.product?.name,
        productImage: item.product?.image ?? item.inventoryItem?.product?.image ?? null,
        qrCode: item.inventoryItem?.qrCode ?? (item.product as any)?.qrCode ?? item.inventoryItemId ?? item.productId,
        serialNumber: item.inventoryItem?.serialNumber ?? null,
        status: String(item.inventoryItem?.status ?? item.pickupStatus ?? '').toLowerCase() || undefined,
        productValue: Math.max(
          Number(item.productValueAtTime || 0),
          Number(item.product?.productValue ?? 0),
          Number(item.product?.price ?? 0),
          0,
        ),
        rentalPrice: Math.max(
          Number(item.rentalPriceAtTime || 0),
          Number(item.product?.rentalPrice ?? 0),
          Number(item.product?.price ?? 0),
          0,
        ),
      }));
    }
    return this.activeLeadItems(booking?.lead).map((item: any) => ({
      productId: item.productId,
      inventoryItemId: item.inventoryItemId,
      productName: item.product?.name ?? item.inventoryItem?.product?.name,
      productImage: item.product?.image ?? item.inventoryItem?.product?.image ?? null,
      qrCode: item.inventoryItem?.qrCode ?? (item.product as any)?.qrCode ?? item.inventoryItemId ?? item.productId,
      serialNumber: item.inventoryItem?.serialNumber ?? null,
      status: String(item.inventoryItem?.status ?? item.status ?? '').toLowerCase() || undefined,
      productValue: Math.max(
        Number(item.productValueAtTime || 0),
        Number(item.product?.productValue ?? 0),
        Number(item.product?.price ?? 0),
        0,
      ),
      rentalPrice: Math.max(
        Number(item.rentalPriceAtTime || 0),
        Number(item.product?.rentalPrice ?? 0),
        Number(item.product?.price ?? 0),
        0,
      ),
    }));
  }

  private positiveCompletedAmount(payment: {
    type: PaymentType;
    amount: number;
    amountPaid: number;
    status: PaymentStatus;
  }) {
    if (payment.status !== PaymentStatus.COMPLETED) return 0;
    if (payment.type === PaymentType.REFUND) return 0;
    return Number(payment.amountPaid || payment.amount || 0);
  }

  private paymentMetadata(payment: { metadata?: Prisma.JsonValue | null }) {
    const raw = payment.metadata;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return raw as Record<string, any>;
  }

  private paymentRole(payment: { metadata?: Prisma.JsonValue | null }) {
    const role = this.paymentMetadata(payment).paymentRole;
    return typeof role === 'string' ? role : undefined;
  }

  private isReturnCashCollection(payment: {
    type: PaymentType;
    metadata?: Prisma.JsonValue | null;
  }) {
    return payment.type === PaymentType.FEE && this.paymentRole(payment) === 'return_cash_collection';
  }

  private isReturnRentalSettledFromDeposit(payment: {
    type: PaymentType;
    metadata?: Prisma.JsonValue | null;
  }) {
    return payment.type === PaymentType.RENTAL_PAYMENT && this.paymentRole(payment) === 'return_rental_from_deposit';
  }

  private parseReturnSettlementDraft(value?: string | null): ReturnSettlementDraft | null {
    if (!value) return null;
    try {
      const parsed = JSON.parse(value);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      const draft = parsed as Record<string, any>;
      const fees = draft.fees && typeof draft.fees === 'object' && !Array.isArray(draft.fees)
        ? draft.fees as Record<string, any>
        : {};
      return {
        version: 1,
        status: draft.status === 'settled' ? 'settled' : 'pending_payment',
        condition: String(draft.condition ?? 'clean'),
        applyRentalToDeposit: draft.applyRentalToDeposit !== false,
        actualReturnDate:
          typeof draft.actualReturnDate === 'string' && draft.actualReturnDate.trim().length > 0
            ? draft.actualReturnDate
            : null,
        notes: typeof draft.notes === 'string' ? draft.notes : undefined,
        lateDays: Math.max(Number(draft.lateDays || 0), 0),
        fees: {
          lateFee: Math.max(Number(fees.lateFee || 0), 0),
          dirtyFee: Math.max(Number(fees.dirtyFee || 0), 0),
          damageFee: Math.max(Number(fees.damageFee || 0), 0),
          accessoryFee: Math.max(Number(fees.accessoryFee || 0), 0),
          otherFee: Math.max(Number(fees.otherFee || 0), 0),
        },
        updatedAt:
          typeof draft.updatedAt === 'string' && draft.updatedAt.trim().length > 0
            ? draft.updatedAt
            : new Date(0).toISOString(),
      };
    } catch {
      return null;
    }
  }

  private returnFeeBreakdownFromPayments(payments: Array<{
    type: PaymentType;
    amount: number;
    amountPaid: number;
    status: PaymentStatus;
    metadata?: Prisma.JsonValue | null;
  }>) {
    return payments.reduce(
      (acc, payment) => {
        if (payment.status !== PaymentStatus.COMPLETED || this.isReturnCashCollection(payment)) {
          return acc;
        }
        const amount = Number(payment.amountPaid || payment.amount || 0);
        if (payment.type === PaymentType.LATE_FEE) acc.lateFee += amount;
        else if (payment.type === PaymentType.DAMAGE_FEE) acc.damageFee += amount;
        else if (payment.type === PaymentType.ACCESSORY_FEE) acc.accessoryFee += amount;
        else if (payment.type === PaymentType.DIRTY_HOLD) acc.dirtyFee += amount;
        else if (payment.type === PaymentType.FEE) acc.otherFee += amount;
        return acc;
      },
      {
        lateFee: 0,
        dirtyFee: 0,
        damageFee: 0,
        accessoryFee: 0,
        otherFee: 0,
      },
    );
  }

  private returnCashCollectedTotal(payments: Array<{
    type: PaymentType;
    amount: number;
    amountPaid: number;
    status: PaymentStatus;
    metadata?: Prisma.JsonValue | null;
  }>) {
    return payments.reduce((sum, payment) => {
      if (payment.status !== PaymentStatus.COMPLETED || !this.isReturnCashCollection(payment)) {
        return sum;
      }
      return sum + Number(payment.amountPaid || payment.amount || 0);
    }, 0);
  }

  private sourceStage(payment: { metadata?: Prisma.JsonValue | null }) {
    const stage = this.paymentMetadata(payment).sourceStage;
    return typeof stage === 'string' ? stage : undefined;
  }

  private isSecurityDepositPayment(payment: {
    type: PaymentType;
    metadata?: Prisma.JsonValue | null;
  }) {
    if (payment.type === PaymentType.SECURITY_DEPOSIT) return true;
    if (payment.type !== PaymentType.BOOKING_DEPOSIT) return false;
    const stage = this.sourceStage(payment);
    return stage === 'lead' || stage === 'booking' || stage === 'pickup' || !stage;
  }

  private securityDepositAmount(payment: {
    type: PaymentType;
    amount: number;
    amountPaid: number;
    securityDepositAmount?: number;
    status: PaymentStatus;
    metadata?: Prisma.JsonValue | null;
  }) {
    if (payment.status !== PaymentStatus.COMPLETED || !this.isSecurityDepositPayment(payment)) {
      return 0;
    }
    return Number(payment.securityDepositAmount || payment.amountPaid || payment.amount || 0);
  }

  private completedAmount(payment: {
    amount: number;
    amountPaid: number;
    status: PaymentStatus;
  }) {
    if (payment.status !== PaymentStatus.COMPLETED) return 0;
    return Number(payment.amountPaid || payment.amount || 0);
  }

  private paymentTypeAmount(payment: {
    type: PaymentType;
    amount: number;
    amountPaid: number;
    amountRefunded?: number;
    status: PaymentStatus;
  }) {
    if (payment.status !== PaymentStatus.COMPLETED) return 0;
    return Number(payment.amountPaid || payment.amount || 0);
  }

  private isFeeType(type: PaymentType) {
    return (
      type === PaymentType.FEE ||
      type === PaymentType.LATE_FEE ||
      type === PaymentType.DAMAGE_FEE ||
      type === PaymentType.ACCESSORY_FEE ||
      type === PaymentType.DIRTY_HOLD
    );
  }

  private isPickupCollectionStage(status: BookingStatus) {
    return !([
      BookingStatus.CANCELLED,
      BookingStatus.PICKED_UP,
      BookingStatus.RETURN_PENDING,
      BookingStatus.RETURNED,
      BookingStatus.SETTLEMENT_PENDING,
      BookingStatus.COMPLETED,
    ] as BookingStatus[]).includes(status);
  }

  private isReturnSettlementStage(status: BookingStatus) {
    return ([
      BookingStatus.RETURN_PENDING,
      BookingStatus.RETURNED,
      BookingStatus.SETTLEMENT_PENDING,
      BookingStatus.COMPLETED,
    ] as BookingStatus[]).includes(status);
  }

  private depositSummaryStatus(input: {
    requestedAmount: number;
    paidAmount: number;
    refundedAmount: number;
    deadline?: Date | null;
  }) {
    if (input.refundedAmount >= input.paidAmount && input.refundedAmount > 0) return 'refunded';
    if (input.paidAmount > 0) return 'deposit_paid';
    if (input.deadline && input.deadline.getTime() < Date.now()) return 'deposit_expired';
    if (input.requestedAmount > 0) return 'deposit_requested';
    return 'none';
  }

  private bookingPaymentStatusFromSummary(summary: {
    rentalRemaining: number;
    securityDepositRemainingForPickup: number;
    refundsPending: boolean;
    totalPaid: number;
    securityDepositPaid: number;
  }) {
    if (summary.refundsPending) return 'refund_pending';
    if (summary.rentalRemaining > 0 && summary.totalPaid <= 0) return 'unpaid';
    if (summary.rentalRemaining > 0) return 'partially_paid';
    if (summary.securityDepositRemainingForPickup > 0) return 'security_deposit_pending';
    if (summary.securityDepositPaid > 0) return 'security_deposit_paid';
    if (summary.totalPaid > 0) return 'rental_paid';
    return 'unpaid';
  }

  private depositTypeValue(raw?: string | null) {
    return String(raw ?? '').toUpperCase() === LeadDepositType.CUSTOM_AMOUNT
      ? 'custom_amount'
      : 'percent';
  }

  private async ensureRentalForBooking(
    booking: Awaited<ReturnType<PaymentsService['findBookingOrThrow']>>,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    if (booking.rental) return booking.rental;
    const inventoryItemIds = booking.items
      .map((item) => item.inventoryItemId)
      .filter((id): id is string => Boolean(id));
    return client.rental.create({
      data: {
        bookingId: booking.id,
        status: RentalStatus.PENDING_PAYMENT,
        scheduledPickupDate: booking.pickupDate ?? booking.startDate,
        scheduledReturnDate: booking.returnDate ?? booking.endDate,
        ...(inventoryItemIds.length
          ? {
              inventoryItems: {
                connect: inventoryItemIds.map((id) => ({ id })),
              },
            }
          : {}),
      },
      include: {
        payments: {
          where: { archivedAt: null },
          orderBy: { createdAt: 'desc' as const },
        },
      },
    });
  }

  async findBookingOrThrow(
    bookingId: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const booking = await client.booking.findFirst({
      where: { id: bookingId, archivedAt: null },
      include: this.bookingInclude(),
    });

    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    return booking;
  }

  async findLeadOrThrow(
    leadId: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const lead = await client.lead.findFirst({
      where: { id: leadId, archivedAt: null },
      include: this.leadInclude(),
    });

    if (!lead) {
      throw new NotFoundException('Lead not found');
    }

    return lead;
  }

  private async applyCompletedPayment(paymentId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        rental: {
          include: {
            booking: {
              include: this.bookingInclude(),
            },
          },
        },
      },
    });

    if (!payment?.rental?.booking) return;

    const booking = payment.rental.booking;
    await this.syncBookingDerivedState(booking.id);
  }

  async getPaymentsByLead(leadId: string) {
    await this.findLeadOrThrow(leadId);
    return this.prisma.payment.findMany({
      where: {
        leadId,
        archivedAt: null,
      },
      include: {
        booking: {
          include: {
            customer: true,
          },
        },
        processedBy: {
          select: { id: true, fullName: true, email: true },
        },
        rental: {
          include: {
            booking: {
              include: { customer: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getPaymentsByBooking(bookingId: string) {
    const booking = await this.findBookingOrThrow(bookingId);
    const paymentFilters: Prisma.PaymentWhereInput[] = [{ bookingId }];
    if (booking.leadId) {
      paymentFilters.push({ leadId: booking.leadId });
    }
    return this.prisma.payment.findMany({
      where: {
        archivedAt: null,
        OR: paymentFilters,
      },
      include: {
        processedBy: {
          select: { id: true, fullName: true, email: true },
        },
        rental: {
          include: {
            booking: {
              include: { customer: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getPaymentSummaryForLead(
    leadId: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const lead = await this.findLeadOrThrow(leadId, client);
    const payments = await client.payment.findMany({
      where: {
        leadId,
        archivedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });
    const completedSecurityDeposit = payments.reduce(
      (sum, payment) => sum + this.securityDepositAmount(payment),
      0,
    );
    const completedRefunds = payments
      .filter((payment) => payment.type === PaymentType.REFUND)
      .reduce((sum, payment) => sum + this.completedAmount(payment), 0);
    const leadItems = this.activeLeadItems(lead);
    const leadProductValue = leadItems.reduce(
      (sum: number, item: any) =>
        sum
        + Math.max(
          Number(item.productValueAtTime || 0),
          Number(item.product?.productValue ?? 0),
          Number(item.product?.price ?? 0),
          0,
        ),
      0,
    );
    const productValue = leadProductValue > 0
      ? leadProductValue
      : Math.max(Number(lead.quotedPrice ?? 0), 0);
    const rentalTotal = leadItems.reduce(
      (sum: number, item: any) =>
        sum
        + Math.max(
          Number(item.rentalPriceAtTime || 0),
          Number(item.product?.rentalPrice ?? 0),
          Number(item.product?.price ?? 0),
          0,
        ),
      0,
    );
    const policy = this.pricingService.getDepositPolicy();
    const requestedDeposit = this.pricingService.calculateRequestedDeposit({
      productValue,
      depositType: this.depositTypeValue((lead as any).selectedDepositType),
      depositRate: (lead as any).selectedDepositRate,
      customAmount: (lead as any).customDepositAmount,
      policy,
    });
    const selectedDepositRate = requestedDeposit.selectedDepositRate;
    const securityDepositRequiredByRate = Math.max(
      Number(lead.depositAmountRequired || 0),
      requestedDeposit.requiredAmount,
    );
    const depositStatus = this.depositSummaryStatus({
      requestedAmount: securityDepositRequiredByRate,
      paidAmount: completedSecurityDeposit,
      refundedAmount: completedRefunds,
      deadline: lead.depositDeadlineAt,
    });

    return {
      leadId: lead.id,
      productValue,
      productValueTotal: productValue,
      selectedDepositType: requestedDeposit.depositType,
      selectedDepositRate,
      customDepositAmount: requestedDeposit.customAmount,
      depositPolicy: policy,
      securityDepositRequiredByRate,
      securityDepositFullAmount: productValue,
      securityDepositPaid: completedSecurityDeposit,
      securityDepositRemainingForSelectedRate: Math.max(securityDepositRequiredByRate - completedSecurityDeposit, 0),
      securityDepositRemainingForFull: Math.max(productValue - completedSecurityDeposit, 0),
      requestedDepositAmount: securityDepositRequiredByRate,
      paidBookingDepositAmount: completedSecurityDeposit,
      refundedAmount: completedRefunds,
      depositStatus,
      depositDeadline: lead.depositDeadlineAt,
      rentalTotal,
      products: leadItems.map((item: any) => ({
        id: item.productId,
        productId: item.productId,
        name: item.product?.name ?? '-',
        image: item.product?.image ?? null,
        productValue: Math.max(
          Number(item.productValueAtTime || 0),
          Number(item.product?.productValue ?? 0),
          Number(item.product?.price ?? 0),
          0,
        ),
        rentalPrice: Math.max(
          Number(item.rentalPriceAtTime || 0),
          Number(item.product?.rentalPrice ?? 0),
          Number(item.product?.price ?? 0),
          0,
        ),
        status: String(item.status ?? '').toLowerCase(),
        qrCode: (item.product as any)?.qrCode ?? item.productId,
      })),
      canReserve:
        completedSecurityDeposit >= securityDepositRequiredByRate &&
        lead.status !== LeadStatus.CANCELLED &&
        lead.status !== LeadStatus.LOST,
      canReceiveDeposit:
        !lead.bookingId &&
        lead.status !== LeadStatus.CANCELLED &&
        lead.status !== LeadStatus.LOST &&
        Math.max(securityDepositRequiredByRate - completedSecurityDeposit, 0) > 0,
      canRefundDeposit:
        !lead.bookingId &&
        completedSecurityDeposit > completedRefunds,
      workflowBlockCode: lead.workflowBlockCode,
      workflowBlockMessage: lead.workflowBlockMessage,
      payments,
    };
  }

  async getPaymentSummaryForBooking(
    bookingId: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const booking = await this.findBookingOrThrow(bookingId, client);
    const paymentFilters: Prisma.PaymentWhereInput[] = [{ bookingId }];
    if (booking.leadId) {
      paymentFilters.push({ leadId: booking.leadId });
    }
    const payments = await client.payment.findMany({
      where: {
        archivedAt: null,
        OR: paymentFilters,
        status: {
          in: [
            PaymentStatus.PENDING,
            PaymentStatus.PROCESSING,
            PaymentStatus.COMPLETED,
            PaymentStatus.FAILED,
            PaymentStatus.REFUNDED,
            PaymentStatus.PARTIALLY_REFUNDED,
          ],
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const completedPayments = payments.filter((payment) => payment.status === PaymentStatus.COMPLETED);
    const rentalPaid = completedPayments
      .filter((payment) => payment.type === PaymentType.RENTAL_PAYMENT)
      .reduce((sum, payment) => sum + Number(payment.amountPaid || payment.amount || 0), 0);
    const securityDepositPaid = completedPayments.reduce(
      (sum, payment) => sum + this.securityDepositAmount(payment),
      0,
    );
    const completedReturnFeeBreakdown = this.returnFeeBreakdownFromPayments(completedPayments);
    const returnCashCollected = this.returnCashCollectedTotal(completedPayments);
    const returnRentalSettledFromDeposit = completedPayments.reduce((sum, payment) => {
      if (!this.isReturnRentalSettledFromDeposit(payment)) {
        return sum;
      }
      return sum + Number(payment.amountPaid || payment.amount || 0);
    }, 0);
    const feesTotal = completedPayments
      .filter((payment) => this.isFeeType(payment.type) && !this.isReturnCashCollection(payment))
      .reduce((sum, payment) => sum + Number(payment.amountPaid || payment.amount || 0), 0);
    const refundsTotal = completedPayments
      .filter((payment) => payment.type === PaymentType.REFUND)
      .reduce((sum, payment) => sum + Number(payment.amountPaid || payment.amount || 0), 0);

    const productRows = this.bookingProductRows(booking);
    const rentalTotal = Number(booking.totalPrice || productRows.reduce((sum: number, item: any) => sum + item.rentalPrice, 0) || 0);
    const rentalRemaining = Math.max(rentalTotal - rentalPaid, 0);
    const productValue = Math.max(
      Number((booking as any).productValueTotal || (booking as any).productValue || 0),
      productRows.reduce((sum: number, item: any) => sum + item.productValue, 0),
      0,
    );
    const depositPolicy = this.pricingService.getDepositPolicy(
      (booking as any).depositPolicySnapshot && typeof (booking as any).depositPolicySnapshot === 'object'
        ? ((booking as any).depositPolicySnapshot as Record<string, any>)
        : undefined,
    );
    const requestedDeposit = this.pricingService.calculateRequestedDeposit({
      productValue,
      depositType: this.depositTypeValue((booking as any).selectedDepositType),
      depositRate: (booking as any).selectedDepositRate,
      customAmount: (booking as any).customDepositAmount,
      policy: depositPolicy,
    });
    const selectedDepositRate = requestedDeposit.selectedDepositRate;
    const depositRequired = Math.max(
      Number((booking as any).depositRequired || 0),
      requestedDeposit.requiredAmount,
    );
    const pickupPosition = this.pricingService.calculateAmountDueBeforePickup({
      rentalTotal,
      rentalPaid,
      depositRequired,
      securityDepositPaid,
      rentalPaymentPolicy:
        (booking as any).rentalPaymentPolicySnapshot && typeof (booking as any).rentalPaymentPolicySnapshot === 'object'
          ? ((booking as any).rentalPaymentPolicySnapshot as Record<string, any>)
          : undefined,
    });
    const totalPaid = rentalPaid + securityDepositPaid + feesTotal;
    const pickupCollectionOpen = this.isPickupCollectionStage(booking.status);
    const returnSettlementStage = this.isReturnSettlementStage(booking.status);
    const returnSettlementDraft = this.parseReturnSettlementDraft(booking.rental?.returnConditionNotes);
    const activeReturnFees =
      returnSettlementDraft?.status === 'pending_payment'
        ? {
            lateFee: returnSettlementDraft.fees.lateFee,
            dirtyFee: returnSettlementDraft.fees.dirtyFee,
            damageFee: returnSettlementDraft.fees.damageFee,
            accessoryFee: returnSettlementDraft.fees.accessoryFee,
            otherFee: returnSettlementDraft.fees.otherFee,
          }
        : completedReturnFeeBreakdown;
    const assessedReturnFeesTotal =
      activeReturnFees.lateFee
      + activeReturnFees.dirtyFee
      + activeReturnFees.damageFee
      + activeReturnFees.accessoryFee
      + activeReturnFees.otherFee;
    const applyRentalToDeposit = returnSettlementDraft?.applyRentalToDeposit !== false;
    const securityDepositRemainingForPickup = pickupCollectionOpen
      ? pickupPosition.depositOutstandingForPickup
      : 0;
    const returnLiabilityTotal =
      assessedReturnFeesTotal
      + (applyRentalToDeposit ? rentalRemaining + returnRentalSettledFromDeposit : 0);
    const depositCreditRemaining = Math.max(securityDepositPaid - refundsTotal, 0);
    const returnFeeAmountDue = Math.max(assessedReturnFeesTotal - depositCreditRemaining - returnCashCollected, 0);
    const returnAmountDue = returnSettlementStage
      ? applyRentalToDeposit
        ? Math.max(returnLiabilityTotal - depositCreditRemaining - returnCashCollected, 0)
        : returnFeeAmountDue + rentalRemaining
      : rentalRemaining;
    const refundableDepositAmount = returnSettlementStage
      ? Math.max(depositCreditRemaining - returnLiabilityTotal, 0)
      : 0;
    const amountDueNow = pickupCollectionOpen
      ? pickupPosition.amountDueNow
      : returnSettlementStage
        ? returnAmountDue
        : rentalRemaining;
    const canPickup =
      booking.status !== BookingStatus.CANCELLED &&
      booking.status !== BookingStatus.PICKED_UP &&
      booking.status !== BookingStatus.COMPLETED &&
      booking.status !== BookingStatus.SETTLEMENT_PENDING &&
      pickupPosition.canPickup;
    const returnSettlementPreview = {
      lateDays: returnSettlementDraft?.lateDays ?? 0,
      lateFee: activeReturnFees.lateFee,
      dirtyFee: activeReturnFees.dirtyFee,
      damageFee: activeReturnFees.damageFee,
      accessoryFee: activeReturnFees.accessoryFee,
      otherFee: activeReturnFees.otherFee,
      totalCharges: assessedReturnFeesTotal,
      rentalRemaining,
      depositCreditRemaining,
      cashCollected: returnCashCollected,
      refundNow: refundableDepositAmount,
      amountDueFromCustomer: applyRentalToDeposit ? returnAmountDue : returnFeeAmountDue,
      applyRentalToDeposit,
      status: returnSettlementDraft?.status ?? 'settled',
      hasDraft: Boolean(returnSettlementDraft?.status === 'pending_payment'),
      actualReturnDate: returnSettlementDraft?.actualReturnDate ?? booking.rental?.actualReturnDate?.toISOString?.() ?? null,
      notes: returnSettlementDraft?.notes ?? null,
    };

    return {
      bookingId: booking.id,
      rentalId: booking.rental?.id ?? null,
      leadId: booking.leadId ?? null,
      appointmentId: booking.appointmentId ?? null,
      productValue,
      productValueTotal: productValue,
      selectedDepositType: requestedDeposit.depositType,
      selectedDepositRate,
      customDepositAmount: requestedDeposit.customAmount,
      depositPolicy,
      securityDepositRequiredByRate: depositRequired,
      securityDepositFullAmount: productValue,
      securityDepositRemainingForSelectedRate: Math.max(depositRequired - securityDepositPaid, 0),
      securityDepositRemainingForFull: Math.max(productValue - securityDepositPaid, 0),
      rentalTotal,
      bookingDepositPaid: securityDepositPaid,
      rentalPaid,
      rentalRemaining,
      depositRequired,
      depositPaid: securityDepositPaid,
      depositRemaining: Math.max(depositRequired - securityDepositPaid, 0),
      securityDepositRequired: depositRequired,
      securityDepositPaid,
      securityDepositOutstanding: securityDepositRemainingForPickup,
      securityDepositRemainingForPickup,
      securityDepositMode: 'cash',
      feesTotal,
      refundsTotal,
      refundableDepositAmount,
      totalPaid,
      amountDueNow,
      amountDueBeforePickup: pickupPosition.amountDueNow,
      amountDueAtReturn: returnAmountDue,
      rentalOutstandingAtReturn: rentalRemaining,
      collectionStage: pickupCollectionOpen
        ? 'pickup_collection'
        : returnSettlementStage
          ? 'return_settlement'
          : 'post_pickup',
      canReserve: securityDepositPaid >= depositRequired,
      canPickup,
      pickupBlockedReasons: pickupPosition.pickupBlockedReasons,
      returnSettlementPreview,
      returnSettlementDraftActive: Boolean(returnSettlementDraft?.status === 'pending_payment'),
      paymentStatus: this.bookingPaymentStatusFromSummary({
        rentalRemaining,
        securityDepositRemainingForPickup,
        refundsPending: booking.status === BookingStatus.SETTLEMENT_PENDING,
        totalPaid,
        securityDepositPaid,
      }),
      products: productRows.map((item: any) => ({
        id: item.inventoryItemId ?? item.productId,
        productId: item.productId,
        inventoryItemId: item.inventoryItemId ?? null,
        name: item.productName ?? '-',
        image: item.productImage ?? null,
        qrCode: item.qrCode ?? null,
        serialNumber: item.serialNumber ?? null,
        status: item.status,
        productValue: item.productValue,
        rentalPrice: item.rentalPrice,
      })),
      payments,
    };
  }

  async syncBookingDerivedState(
    bookingId: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const booking = await this.findBookingOrThrow(bookingId, client);
    const summary = await this.getPaymentSummaryForBooking(bookingId, client);

    let nextStatus = booking.status;
    if (booking.status === BookingStatus.CANCELLED || booking.status === BookingStatus.PICKED_UP || booking.status === BookingStatus.RETURN_PENDING || booking.status === BookingStatus.RETURNED || booking.status === BookingStatus.COMPLETED) {
      nextStatus = booking.status;
    } else if (booking.status === BookingStatus.SETTLEMENT_PENDING) {
      nextStatus =
        summary.rentalRemaining <= 0 && Number((summary as any).refundableDepositAmount ?? 0) <= 0
          ? BookingStatus.COMPLETED
          : BookingStatus.SETTLEMENT_PENDING;
    } else if ((summary as any).securityDepositRemainingForPickup > 0) {
      nextStatus = BookingStatus.AWAITING_SECURITY_DEPOSIT;
    } else if (summary.pickupBlockedReasons.includes('rental_unpaid')) {
      nextStatus = BookingStatus.AWAITING_REMAINING_PAYMENT;
    } else {
      nextStatus = BookingStatus.READY_FOR_PICKUP;
    }

    const updated = await client.booking.update({
      where: { id: bookingId },
      data: {
        bookingDepositPaid: summary.securityDepositPaid,
        depositRequired: Number((summary as any).depositRequired ?? summary.securityDepositRequiredByRate ?? 0),
        depositPaid: summary.securityDepositPaid,
        rentalPaid: summary.rentalPaid,
        productValueTotal: Number((summary as any).productValueTotal ?? summary.productValue ?? 0),
        securityDepositHeld: summary.securityDepositPaid,
        status: nextStatus,
        lockedAt: summary.securityDepositPaid > 0 && !booking.lockedAt ? new Date() : booking.lockedAt,
      },
      include: this.bookingInclude(),
    });

    if (booking.rental) {
      await client.rental.update({
        where: { id: booking.rental.id },
        data: {
          status:
            nextStatus === BookingStatus.PICKED_UP
              ? RentalStatus.PICKED_UP
              : nextStatus === BookingStatus.COMPLETED
                ? RentalStatus.COMPLETED
                : nextStatus === BookingStatus.SETTLEMENT_PENDING || nextStatus === BookingStatus.RETURNED
                  ? RentalStatus.RETURNED
                  : RentalStatus.PENDING_PAYMENT,
        },
      }).catch(() => undefined);
    }

    return {
      booking: updated,
      summary,
    };
  }

  async findAll(filters?: {
    status?: PaymentStatus;
    rentalId?: string;
    bookingId?: string;
    leadId?: string;
    page?: number;
    limit?: number;
    search?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    dateFrom?: string;
    dateTo?: string;
  }) {
    const { page, limit, skip, take } = resolvePagination(filters);
    const sortBy = ['createdAt', 'paidAt'].includes(String(filters?.sortBy))
      ? String(filters?.sortBy)
      : 'createdAt';
    const sortOrder = filters?.sortOrder === 'asc' ? 'asc' : 'desc';
    const normalizedSearch = String(filters?.search ?? '').trim();
    const dateFrom = filters?.dateFrom ? new Date(filters.dateFrom) : undefined;
    const dateTo = filters?.dateTo ? new Date(filters.dateTo) : undefined;
    const where: Prisma.PaymentWhereInput = {
      archivedAt: null,
      status: filters?.status,
      rentalId: filters?.rentalId,
      bookingId: filters?.bookingId,
      leadId: filters?.leadId,
      ...(normalizedSearch
        ? {
            OR: [
              { id: { contains: normalizedSearch, mode: 'insensitive' } },
              { description: { contains: normalizedSearch, mode: 'insensitive' } },
              { bookingId: { contains: normalizedSearch, mode: 'insensitive' } },
              { leadId: { contains: normalizedSearch, mode: 'insensitive' } },
              { rental: { is: { booking: { is: { customer: { is: { name: { contains: normalizedSearch, mode: 'insensitive' } } } } } } } },
              { rental: { is: { booking: { is: { customer: { is: { phone: { contains: normalizedSearch, mode: 'insensitive' } } } } } } } },
            ],
          }
        : {}),
      ...(dateFrom || dateTo
        ? {
            createdAt: {
              ...(dateFrom ? { gte: dateFrom } : {}),
              ...(dateTo ? { lte: dateTo } : {}),
            },
          }
        : {}),
    };

    const include = {
      rental: {
        include: {
          booking: {
            include: { customer: true },
          },
        },
      },
      processedBy: {
        select: { id: true, fullName: true, email: true },
      },
      receipts: true,
      transactions: true,
    } satisfies Prisma.PaymentInclude;

    const [total, data] = await Promise.all([
      this.prisma.payment.count({ where }),
      this.prisma.payment.findMany({
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
    const payment = await this.prisma.payment.findUnique({
      where: { id, archivedAt: null },
      include: {
        rental: {
          include: {
            booking: {
              include: { customer: true, items: true },
            },
          },
        },
        receipts: true,
        transactions: true,
      },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    return payment;
  }

  private async createCompletedPaymentRecord(
    data: {
      bookingId?: string;
      rentalId?: string;
      leadId?: string;
      type: PaymentType;
      amount: number;
      paymentMethod: PaymentMethod;
      description?: string;
      processedById?: string;
      rentalAmount?: number;
      depositAmount?: number;
      securityDepositAmount?: number;
      damageAmount?: number;
      otherFees?: number;
      refundAmount?: number;
      metadata?: Prisma.InputJsonValue;
    },
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    return client.payment.create({
      data: {
        bookingId: data.bookingId,
        rentalId: data.rentalId,
        leadId: data.leadId,
        type: data.type,
        amount: Number(data.amount || 0),
        amountPaid: Number(data.amount || 0),
        paymentMethod: data.paymentMethod,
        status: PaymentStatus.COMPLETED,
        paidAt: new Date(),
        description: data.description,
        processedById: data.processedById,
        rentalAmount: Number(data.rentalAmount || 0),
        depositAmount: Number(data.depositAmount || 0),
        securityDepositAmount: Number(data.securityDepositAmount || 0),
        damageAmount: Number(data.damageAmount || 0),
        otherFees: Number(data.otherFees || 0),
        refundAmount: Number(data.refundAmount || 0),
        metadata: data.metadata,
      },
    });
  }

  async collectRentalPayment(
    bookingId: string,
    input: {
      amount: number;
      paymentMethod: PaymentMethod;
      description?: string;
      processedById?: string;
    },
  ) {
    if (Number(input.amount) <= 0) {
      throw new BadRequestException('Rental payment amount must be greater than 0');
    }

    return this.prisma.$transaction(async (tx) => {
      const booking = await this.findBookingOrThrow(bookingId, tx);
      if (booking.status === BookingStatus.CANCELLED) {
        throw new BadRequestException('Cancelled rental orders cannot collect new money');
      }
      const rental = await this.ensureRentalForBooking(booking, tx);
      const summary = await this.getPaymentSummaryForBooking(bookingId, tx);
      if (summary.rentalRemaining <= 0) {
        throw new BadRequestException('Rental balance is already clear');
      }

      const payment = await this.createCompletedPaymentRecord({
        bookingId: booking.id,
        rentalId: rental.id,
        type: PaymentType.RENTAL_PAYMENT,
        amount: Math.min(Number(input.amount), summary.rentalRemaining),
        rentalAmount: Math.min(Number(input.amount), summary.rentalRemaining),
        paymentMethod: input.paymentMethod,
        description: input.description ?? `Collected rental payment for booking ${booking.id}`,
        processedById: input.processedById,
        metadata: {
          sourceStage: 'booking',
          rentalTotalAtTime: summary.rentalTotal,
          note: input.description ?? null,
        },
      }, tx);

      const synced = await this.syncBookingDerivedState(booking.id, tx);
      await this.auditDisputesService.log({
        action: AuditAction.PAYMENT_PROCESSED,
        entity: 'Payment',
        entityId: payment.id,
        paymentId: payment.id,
        bookingId: booking.id,
        rentalId: rental.id,
        actorId: input.processedById,
        summary: `Collected rental payment for booking ${booking.id}`,
        after: {
          payment,
          bookingStatus: synced.booking.status,
        },
      }, tx);

      return {
        payment,
        summary: synced.summary,
        booking: synced.booking,
      };
    });
  }

  async collectSecurityDeposit(
    bookingId: string,
    input: {
      amount: number;
      paymentMethod: PaymentMethod;
      description?: string;
      processedById?: string;
    },
  ) {
    if (Number(input.amount) <= 0) {
      throw new BadRequestException('Security deposit amount must be greater than 0');
    }

    return this.prisma.$transaction(async (tx) => {
      const booking = await this.findBookingOrThrow(bookingId, tx);
      if (booking.status === BookingStatus.CANCELLED) {
        throw new BadRequestException('Cancelled rental orders cannot collect new money');
      }
      const rental = await this.ensureRentalForBooking(booking, tx);
      const summary = await this.getPaymentSummaryForBooking(bookingId, tx);
      const securityDepositRemainingForFull = Math.max(
        Number((summary as any).depositRemaining ?? (summary as any).securityDepositRemainingForSelectedRate ?? 0),
        0,
      );
      if (securityDepositRemainingForFull <= 0) {
        throw new BadRequestException('Security deposit is already fully collected');
      }

      const payment = await this.createCompletedPaymentRecord({
        bookingId: booking.id,
        rentalId: rental.id,
        type: PaymentType.SECURITY_DEPOSIT,
        amount: Math.min(Number(input.amount), securityDepositRemainingForFull),
        securityDepositAmount: Math.min(Number(input.amount), securityDepositRemainingForFull),
        paymentMethod: input.paymentMethod,
        description: input.description ?? `Collected security deposit for booking ${booking.id}`,
        processedById: input.processedById,
        metadata: {
          sourceStage: 'booking',
          depositRate: (summary as any).selectedDepositRate,
          productValueAtTime: (summary as any).productValue,
          rentalTotalAtTime: summary.rentalTotal,
          note: input.description ?? null,
        },
      }, tx);

      const synced = await this.syncBookingDerivedState(booking.id, tx);
      await this.auditDisputesService.log({
        action: AuditAction.PAYMENT_PROCESSED,
        entity: 'Payment',
        entityId: payment.id,
        paymentId: payment.id,
        bookingId: booking.id,
        rentalId: rental.id,
        actorId: input.processedById,
        summary: `Collected security deposit for booking ${booking.id}`,
        after: {
          payment,
          bookingStatus: synced.booking.status,
        },
      }, tx);

      return {
        payment,
        summary: synced.summary,
        booking: synced.booking,
      };
    });
  }

  async createRefund(
    input: {
      amount: number;
      paymentMethod?: PaymentMethod;
      sourcePaymentId?: string;
      leadId?: string;
      bookingId?: string;
      rentalId?: string;
      description?: string;
      processedById?: string;
    },
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    if (Number(input.amount) <= 0) {
      throw new BadRequestException('Refund amount must be greater than 0');
    }

    let sourcePayment:
      | Awaited<ReturnType<PaymentsService['findById']>>
      | null = null;
    if (input.sourcePaymentId) {
      sourcePayment = await this.findById(input.sourcePaymentId);
    }

    const refund = await this.createCompletedPaymentRecord({
      bookingId: input.bookingId ?? sourcePayment?.bookingId ?? sourcePayment?.rental?.booking?.id,
      rentalId: input.rentalId ?? sourcePayment?.rentalId ?? undefined,
      leadId: input.leadId ?? sourcePayment?.leadId ?? undefined,
      type: PaymentType.REFUND,
      amount: Number(input.amount),
      refundAmount: Number(input.amount),
      paymentMethod: input.paymentMethod ?? PaymentMethod.CASH,
      description: input.description ?? `Refund for payment ${input.sourcePaymentId ?? 'manual'}`,
      processedById: input.processedById,
      metadata: {
        sourceStage: input.bookingId ? 'return' : 'lead',
        sourcePaymentId: input.sourcePaymentId ?? null,
      },
    }, client);

    if (sourcePayment) {
      await client.payment.update({
        where: { id: sourcePayment.id },
        data: {
          amountRefunded: {
            increment: Number(input.amount),
          },
          refundAmount: {
            increment: Number(input.amount),
          },
          status:
            Number(sourcePayment.amountRefunded || 0) + Number(input.amount) >= Number(sourcePayment.amount)
              ? PaymentStatus.REFUNDED
              : PaymentStatus.PARTIALLY_REFUNDED,
        },
      });
    }

    return refund;
  }

  async finalizeReturnSettlement(
    bookingId: string,
    input: {
      paymentMethod: PaymentMethod;
      description?: string;
      applyRentalToDeposit?: boolean;
      processedById?: string;
    },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const booking = await this.findBookingOrThrow(bookingId, tx);
      const summary = await this.getPaymentSummaryForBooking(bookingId, tx);
      const draft = this.parseReturnSettlementDraft(booking.rental?.returnConditionNotes);

      if (!booking.rental) {
        throw new BadRequestException('Rental not found for booking');
      }
      if (!draft || draft.status !== 'pending_payment') {
        throw new BadRequestException('Return inspection has no pending settlement draft');
      }

      const feeEntries: Array<{
        type: PaymentType;
        amount: number;
        description: string;
        damageAmount?: number;
        otherFees?: number;
      }> = [
        {
          type: PaymentType.LATE_FEE,
          amount: draft.fees.lateFee,
          description: `Phí trả trễ cho đơn thuê ${booking.id}`,
          otherFees: draft.fees.lateFee,
        },
        {
          type: PaymentType.DIRTY_HOLD,
          amount: draft.fees.dirtyFee,
          description: `Phí vệ sinh cho đơn thuê ${booking.id}`,
          otherFees: draft.fees.dirtyFee,
        },
        {
          type: PaymentType.DAMAGE_FEE,
          amount: draft.fees.damageFee,
          description: `Phí hư hại cho đơn thuê ${booking.id}`,
          damageAmount: draft.fees.damageFee,
        },
        {
          type: PaymentType.ACCESSORY_FEE,
          amount: draft.fees.accessoryFee,
          description: `Phí thiếu phụ kiện cho đơn thuê ${booking.id}`,
          otherFees: draft.fees.accessoryFee,
        },
        {
          type: PaymentType.FEE,
          amount: draft.fees.otherFee,
          description: `Phí khác khi nhận trả cho đơn thuê ${booking.id}`,
          otherFees: draft.fees.otherFee,
        },
      ];

      for (const fee of feeEntries) {
        if (fee.amount <= 0) continue;
        await this.createCompletedPaymentRecord({
          bookingId: booking.id,
          rentalId: booking.rental.id,
          type: fee.type,
          amount: fee.amount,
          paymentMethod: PaymentMethod.PENDING,
          description: fee.description,
          processedById: input.processedById,
          rentalAmount: 0,
          damageAmount: fee.damageAmount ?? 0,
          otherFees: fee.otherFees ?? 0,
          metadata: {
            sourceStage: 'return',
            paymentRole: 'return_charge',
            returnSettlementDraftUpdatedAt: draft.updatedAt,
          },
        }, tx);
      }

      const applyRentalToDeposit = input.applyRentalToDeposit ?? draft.applyRentalToDeposit !== false;
      const settlementPreview = (summary as any).returnSettlementPreview ?? {};
      const totalCharges = Math.max(Number(settlementPreview.totalCharges ?? 0), 0);
      const rentalRemaining = Math.max(Number(settlementPreview.rentalRemaining ?? 0), 0);
      const depositCreditRemaining = Math.max(Number(settlementPreview.depositCreditRemaining ?? 0), 0);
      const feeCoveredByDeposit = Math.min(totalCharges, depositCreditRemaining);
      const feeCashCollection = Math.max(totalCharges - feeCoveredByDeposit, 0);
      const depositAfterFees = Math.max(depositCreditRemaining - feeCoveredByDeposit, 0);
      const rentalCoveredByDeposit = applyRentalToDeposit ? Math.min(rentalRemaining, depositAfterFees) : 0;
      const rentalCashCollection = applyRentalToDeposit ? Math.max(rentalRemaining - rentalCoveredByDeposit, 0) : 0;

      if (rentalCoveredByDeposit > 0) {
        await this.createCompletedPaymentRecord({
          bookingId: booking.id,
          rentalId: booking.rental.id,
          type: PaymentType.RENTAL_PAYMENT,
          amount: rentalCoveredByDeposit,
          paymentMethod: PaymentMethod.PENDING,
          description: `Tiền thuê được khấu trừ từ cọc cho đơn thuê ${booking.id}`,
          processedById: input.processedById,
          rentalAmount: rentalCoveredByDeposit,
          metadata: {
            sourceStage: 'return',
            paymentRole: 'return_rental_from_deposit',
            returnSettlementDraftUpdatedAt: draft.updatedAt,
          },
        }, tx);
      }

      if (rentalCashCollection > 0) {
        await this.createCompletedPaymentRecord({
          bookingId: booking.id,
          rentalId: booking.rental.id,
          type: PaymentType.RENTAL_PAYMENT,
          amount: rentalCashCollection,
          paymentMethod: input.paymentMethod,
          description: input.description ?? `Khách thanh toán thêm tiền thuê khi nhận trả cho đơn thuê ${booking.id}`,
          processedById: input.processedById,
          rentalAmount: rentalCashCollection,
          metadata: {
            sourceStage: 'return',
            paymentRole: 'return_rental_cash_collection',
            returnSettlementDraftUpdatedAt: draft.updatedAt,
          },
        }, tx);
      }

      const amountDueFromCustomer = Math.max(
        Number((summary as any).returnSettlementPreview?.amountDueFromCustomer ?? 0),
        0,
      );
      if (feeCashCollection > 0 || (amountDueFromCustomer > 0 && rentalCashCollection <= 0)) {
        await this.createCompletedPaymentRecord({
          bookingId: booking.id,
          rentalId: booking.rental.id,
          type: PaymentType.FEE,
          amount: feeCashCollection > 0 ? feeCashCollection : amountDueFromCustomer,
          paymentMethod: input.paymentMethod,
          description: input.description ?? `Khách thanh toán thêm phí nhận trả cho đơn thuê ${booking.id}`,
          processedById: input.processedById,
          rentalAmount: 0,
          otherFees: 0,
          metadata: {
            sourceStage: 'return',
            paymentRole: 'return_cash_collection',
            returnSettlementDraftUpdatedAt: draft.updatedAt,
          },
        }, tx);
      }

      const refundableDepositAmount = Math.max(
        applyRentalToDeposit ? depositAfterFees - rentalRemaining : depositAfterFees,
        0,
      );
      if (refundableDepositAmount > 0 && (applyRentalToDeposit || rentalRemaining <= 0)) {
        const sourceDeposit = await tx.payment.findFirst({
          where: {
            archivedAt: null,
            status: PaymentStatus.COMPLETED,
            type: { in: [PaymentType.SECURITY_DEPOSIT, PaymentType.BOOKING_DEPOSIT] },
            OR: [
              { bookingId: booking.id },
              ...(booking.leadId ? [{ leadId: booking.leadId }] : []),
            ],
          },
          orderBy: { paidAt: 'desc' },
        });
        await this.createRefund({
          amount: refundableDepositAmount,
          paymentMethod: input.paymentMethod,
          sourcePaymentId: sourceDeposit?.id,
          bookingId: booking.id,
          rentalId: booking.rental.id,
          description: input.description ?? `Hoàn lại cọc còn dư cho đơn thuê ${booking.id}`,
          processedById: input.processedById,
        }, tx);
      }

      const settledDraft: ReturnSettlementDraft = {
        ...draft,
        status: 'settled',
        applyRentalToDeposit,
        updatedAt: new Date().toISOString(),
      };

      await tx.rental.update({
        where: { id: booking.rental.id },
        data: {
          status: RentalStatus.COMPLETED,
          returnConditionNotes: JSON.stringify(settledDraft),
        },
      });
      await tx.booking.update({
        where: { id: booking.id },
        data: {
          status: BookingStatus.SETTLEMENT_PENDING,
        },
      });

      const synced = await this.syncBookingDerivedState(booking.id, tx);
      await this.auditDisputesService.log({
        action: AuditAction.PAYMENT_PROCESSED,
        entity: 'Booking',
        entityId: booking.id,
        bookingId: booking.id,
        rentalId: booking.rental.id,
        actorId: input.processedById,
        summary: `Finalized return settlement for booking ${booking.id}`,
        after: {
          bookingStatus: synced.booking.status,
          returnSettlementDraftUpdatedAt: settledDraft.updatedAt,
        },
      }, tx);

      return {
        booking: synced.booking,
        summary: synced.summary,
      };
    });
  }

  async create(data: {
    rentalId: string;
    bookingId?: string;
    type?: PaymentType;
    amount: number;
    rentalAmount: number;
    depositAmount?: number;
    securityDepositAmount?: number;
    damageAmount?: number;
    otherFees?: number;
    refundAmount?: number;
    paymentMethod: PaymentMethod;
    description?: string;
    processedById?: string;
  }) {
    const payment = await this.prisma.payment.create({
      data: {
        rentalId: data.rentalId,
        bookingId: data.bookingId,
        type: data.type ?? PaymentType.RENTAL_PAYMENT,
        amount: data.amount,
        rentalAmount: data.rentalAmount,
        depositAmount: data.depositAmount || 0,
        securityDepositAmount: data.securityDepositAmount || 0,
        damageAmount: data.damageAmount || 0,
        otherFees: data.otherFees || 0,
        refundAmount: data.refundAmount || 0,
        paymentMethod: data.paymentMethod,
        description: data.description,
        processedById: data.processedById,
        status: 'PENDING',
      },
      include: {
        rental: true,
      },
    });

    await this.auditDisputesService.log({
      action: AuditAction.PAYMENT_POSTED,
      entity: 'Payment',
      entityId: payment.id,
      paymentId: payment.id,
      rentalId: payment.rentalId ?? undefined,
      bookingId: payment.bookingId ?? undefined,
      actorId: data.processedById,
      summary: `Created ${payment.type} payment for ${payment.amount}`,
      after: payment,
    });

    return payment;
  }

  async process(
    paymentId: string,
    processedById: string,
    externalTransactionId?: string,
  ) {
    const current = await this.findById(paymentId);
    const payment = await this.prisma.payment.update({
      where: { id: paymentId },
      data: {
        status: 'COMPLETED',
        amountPaid: current.amount,
        processedById,
        externalTransactionId,
        paidAt: new Date(),
      },
      include: { rental: true },
    });

    await this.applyCompletedPayment(payment.id);

    await this.auditDisputesService.log({
      action: AuditAction.PAYMENT_PROCESSED,
      entity: 'Payment',
      entityId: payment.id,
      paymentId: payment.id,
      rentalId: payment.rentalId ?? undefined,
      bookingId: current.bookingId ?? current.rental?.booking?.id,
      actorId: processedById,
      summary: `Processed payment ${payment.id}`,
      before: current,
      after: payment,
      metadata: { externalTransactionId },
    });

    return payment;
  }

  async initializePayment(paymentId: string, input: {
    provider?: PaymentGateway;
    returnUrl?: string;
    callbackUrl?: string;
    currency?: string;
    idempotencyKey?: string;
  }) {
    const payment = await this.findById(paymentId);
    const provider = input.provider ?? PaymentGateway.PAYOS;
    const adapter = this.paymentGatewayService.getAdapter(provider);
    const idempotencyKey = input.idempotencyKey ?? randomUUID();

    const checkout = await adapter.initializeCheckout({
      amount: payment.amount,
      currency: input.currency ?? 'VND',
      orderCode: payment.id,
      description: payment.description ?? `Payment ${payment.id}`,
      returnUrl: input.returnUrl,
      callbackUrl: input.callbackUrl,
      idempotencyKey,
      metadata: {
        paymentId: payment.id,
        rentalId: payment.rentalId ?? undefined,
      },
    });

    const transaction = await this.prisma.paymentTransaction.create({
      data: {
        paymentId: payment.id,
        provider: checkout.provider,
        status: PaymentTransactionStatus.PENDING,
        amount: payment.amount,
        currency: input.currency ?? 'VND',
        checkoutUrl: checkout.checkoutUrl,
        providerTransactionId: checkout.providerTransactionId,
        idempotencyKey,
        callbackUrl: input.callbackUrl,
        returnUrl: input.returnUrl,
        metadata: JSON.stringify(checkout.raw ?? {}),
      },
    });

    await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.PROCESSING,
        paymentMethod: provider === PaymentGateway.PAYOS ? PaymentMethod.BANK_TRANSFER : PaymentMethod.PENDING,
      },
    });

    await this.auditDisputesService.log({
      action: AuditAction.PAYMENT_POSTED,
      entity: 'PaymentTransaction',
      entityId: transaction.id,
      paymentId: payment.id,
      rentalId: payment.rentalId ?? undefined,
      bookingId: payment.bookingId ?? payment.rental?.booking?.id,
      summary: `Initialized ${provider} checkout for payment ${payment.id}`,
      after: transaction,
    });

    return transaction;
  }

  async initializeBookingPayment(bookingId: string, input: {
    provider?: PaymentGateway;
    returnUrl?: string;
    callbackUrl?: string;
    currency?: string;
    idempotencyKey?: string;
    paymentType?: 'deposit' | 'remaining' | 'full';
    depositAmount?: number;
  }) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId, archivedAt: null },
      include: {
        lead: {
          include: {
            product: true,
          },
        },
        items: true,
        rental: {
          include: {
            payments: {
              where: { archivedAt: null },
              orderBy: { createdAt: 'desc' },
            },
          },
        },
      },
    });

    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    const rental =
      booking.rental ??
      (await this.prisma.rental.create({
        data: (() => {
          const inventoryItemIds = booking.items
            .map((item) => item.inventoryItemId)
            .filter((id): id is string => Boolean(id));
          return {
            bookingId: booking.id,
            status: 'PENDING_PAYMENT' as const,
            scheduledPickupDate: booking.startDate,
            scheduledReturnDate: booking.endDate,
            ...(inventoryItemIds.length
              ? {
                  inventoryItems: {
                    connect: inventoryItemIds.map((id) => ({ id })),
                  },
                }
              : {}),
          };
        })(),
      }));

    const paymentType = input.paymentType ?? 'full';
    const summary = await this.getPaymentSummaryForBooking(booking.id);
    const depositDue = Math.max(Number((summary as any).securityDepositRemainingForFull ?? 0), 0);
    const remainingRentalDue = Math.max(Number(summary.rentalRemaining || 0), 0);
    const fullDue = depositDue + remainingRentalDue;
    const amount = paymentType === 'deposit' ? depositDue : paymentType === 'remaining' ? remainingRentalDue : fullDue;

    if (amount <= 0) {
      throw new BadRequestException('Booking has no outstanding amount for this payment type');
    }

    const depositPortion = paymentType === 'deposit' ? amount : Math.min(depositDue, amount);
    const rentalPortion = paymentType === 'remaining' ? amount : Math.max(amount - depositPortion, 0);
    const operationPaymentType =
      paymentType === 'deposit'
        ? PaymentType.SECURITY_DEPOSIT
        : PaymentType.RENTAL_PAYMENT;
    const description =
      paymentType === 'deposit'
        ? `Security deposit payment for booking ${booking.id}`
        : paymentType === 'remaining'
          ? `Remaining payment for booking ${booking.id}`
          : `Full payment for booking ${booking.id}`;

    let payment = await this.prisma.payment.findFirst({
      where: {
        rentalId: rental.id,
        archivedAt: null,
        status: { in: [PaymentStatus.PENDING, PaymentStatus.PROCESSING] },
        description,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!payment) {
      payment = await this.prisma.payment.create({
        data: {
          rentalId: rental.id,
          bookingId: booking.id,
          type: operationPaymentType,
          amount,
          rentalAmount: rentalPortion,
          securityDepositAmount: depositPortion,
          paymentMethod: PaymentMethod.PENDING,
          status: PaymentStatus.PENDING,
          description,
          metadata: {
            sourceStage: paymentType === 'deposit' ? 'pickup' : 'booking',
            depositRate: (summary as any).selectedDepositRate,
            productValueAtTime: (summary as any).productValue,
            rentalTotalAtTime: summary.rentalTotal,
          },
        },
      });
    }

    if (payment.status === PaymentStatus.COMPLETED) {
      throw new BadRequestException('Booking payment already completed');
    }

    const transaction = await this.initializePayment(payment.id, input);
    return {
      ...transaction,
      bookingId: booking.id,
      rentalId: rental.id,
      paymentId: payment.id,
      paymentType,
      amount,
      depositAmount: depositPortion,
      rentalAmount: rentalPortion,
      outstandingAmount: fullDue,
    };
  }

  async initializeRentalOrderPayment(orderId: string, input: {
    provider?: PaymentGateway;
    returnUrl?: string;
    callbackUrl?: string;
    currency?: string;
    idempotencyKey?: string;
  }) {
    const order = await this.prisma.rentalOrder.findUnique({
      where: { id: orderId, archivedAt: null },
    });
    if (!order) {
      throw new NotFoundException('Rental order not found');
    }

    const provider = input.provider ?? PaymentGateway.PAYOS;
    const adapter = this.paymentGatewayService.getAdapter(provider);
    const idempotencyKey = input.idempotencyKey ?? randomUUID();

    const checkout = await adapter.initializeCheckout({
      amount: order.totalAmount,
      currency: input.currency ?? 'VND',
      orderCode: order.orderCode,
      description: `Rental order ${order.orderCode}`,
      returnUrl: input.returnUrl,
      callbackUrl: input.callbackUrl,
      idempotencyKey,
      metadata: {
        rentalOrderId: order.id,
        orderCode: order.orderCode,
      },
    });

    const transaction = await this.prisma.paymentTransaction.create({
      data: {
        rentalOrderId: order.id,
        provider: checkout.provider,
        status: PaymentTransactionStatus.PENDING,
        amount: order.totalAmount,
        currency: input.currency ?? 'VND',
        checkoutUrl: checkout.checkoutUrl,
        providerTransactionId: checkout.providerTransactionId,
        idempotencyKey,
        callbackUrl: input.callbackUrl,
        returnUrl: input.returnUrl,
        metadata: JSON.stringify(checkout.raw ?? {}),
      },
    });

    await this.prisma.rentalOrder.update({
      where: { id: order.id },
      data: {
        paymentStatus: 'PARTIALLY_PAID',
      },
    });

    return transaction;
  }

  async retryPayment(paymentId: string, input: {
    provider?: PaymentGateway;
    returnUrl?: string;
    callbackUrl?: string;
    currency?: string;
  }) {
    await this.cancelPayment(paymentId, 'Retry requested');
    return this.initializePayment(paymentId, input);
  }

  async retryRentalOrderPayment(orderId: string, input: {
    provider?: PaymentGateway;
    returnUrl?: string;
    callbackUrl?: string;
    currency?: string;
  }) {
    await this.cancelRentalOrderPayment(orderId, 'Retry requested');
    return this.initializeRentalOrderPayment(orderId, input);
  }

  async cancelPayment(paymentId: string, reason = 'Cancelled by operator') {
    const payment = await this.findById(paymentId);
    const latest = await this.prisma.paymentTransaction.findFirst({
      where: {
        paymentId: payment.id,
        status: { in: [PaymentTransactionStatus.PENDING, PaymentTransactionStatus.PROCESSING] },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (latest) {
      await this.prisma.paymentTransaction.update({
        where: { id: latest.id },
        data: {
          status: PaymentTransactionStatus.CANCELLED,
          failReason: reason,
          canceledAt: new Date(),
        },
      });
    }

    return this.prisma.payment.update({
      where: { id: payment.id },
      data: { status: PaymentStatus.FAILED },
    });
  }

  async cancelRentalOrderPayment(orderId: string, reason = 'Cancelled by operator') {
    const order = await this.prisma.rentalOrder.findUnique({
      where: { id: orderId, archivedAt: null },
    });
    if (!order) throw new NotFoundException('Rental order not found');

    const latest = await this.prisma.paymentTransaction.findFirst({
      where: {
        rentalOrderId: order.id,
        status: { in: [PaymentTransactionStatus.PENDING, PaymentTransactionStatus.PROCESSING] },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (latest) {
      await this.prisma.paymentTransaction.update({
        where: { id: latest.id },
        data: {
          status: PaymentTransactionStatus.CANCELLED,
          failReason: reason,
          canceledAt: new Date(),
        },
      });
    }

    return this.prisma.rentalOrder.update({
      where: { id: order.id },
      data: { paymentStatus: 'FAILED' },
    });
  }

  async handleProviderWebhook(provider: string, payload: Record<string, any>, signature?: string) {
    const adapter = this.paymentGatewayService.getWebhookAdapter(provider);
    const verified = await adapter.verifyWebhook(payload, signature);

    const existingEvent = await this.prisma.paymentTransaction.findFirst({
      where: { providerEventId: verified.providerEventId },
    });
    if (existingEvent) {
      return { ok: true, idempotent: true, transactionId: existingEvent.id };
    }

    const tx = await this.prisma.paymentTransaction.findFirst({
      where: {
        provider: verified.provider,
        providerTransactionId: verified.providerTransactionId,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!tx) {
      throw new NotFoundException('Payment transaction not found for webhook');
    }

    const status =
      verified.status === 'SUCCESS'
        ? PaymentTransactionStatus.SUCCESS
        : verified.status === 'FAILED'
          ? PaymentTransactionStatus.FAILED
          : verified.status === 'CANCELLED'
            ? PaymentTransactionStatus.CANCELLED
            : verified.status === 'PROCESSING'
              ? PaymentTransactionStatus.PROCESSING
              : PaymentTransactionStatus.PENDING;

    const updatedTx = await this.prisma.paymentTransaction.update({
      where: { id: tx.id },
      data: {
        status,
        providerEventId: verified.providerEventId,
        failReason: status === PaymentTransactionStatus.FAILED ? 'Gateway failure' : tx.failReason,
        paidAt: status === PaymentTransactionStatus.SUCCESS ? new Date() : tx.paidAt,
        canceledAt: status === PaymentTransactionStatus.CANCELLED ? new Date() : tx.canceledAt,
        metadata: JSON.stringify(verified.raw ?? {}),
      },
    });

    if (tx.paymentId) {
      await this.prisma.payment.update({
        where: { id: tx.paymentId },
        data: {
          status:
            status === PaymentTransactionStatus.SUCCESS
              ? PaymentStatus.COMPLETED
              : status === PaymentTransactionStatus.FAILED
                ? PaymentStatus.FAILED
                : status === PaymentTransactionStatus.CANCELLED
                  ? PaymentStatus.FAILED
                  : PaymentStatus.PROCESSING,
          amountPaid: status === PaymentTransactionStatus.SUCCESS ? (verified.amount ?? tx.amount) : undefined,
          paidAt: status === PaymentTransactionStatus.SUCCESS ? new Date() : undefined,
          externalTransactionId: verified.providerTransactionId,
        },
      });

      if (status === PaymentTransactionStatus.SUCCESS) {
        await this.applyCompletedPayment(tx.paymentId);
      }
    }

    if (tx.rentalOrderId) {
      await this.prisma.rentalOrder.update({
        where: { id: tx.rentalOrderId },
        data: {
          paymentStatus:
            status === PaymentTransactionStatus.SUCCESS
              ? 'PAID'
              : status === PaymentTransactionStatus.FAILED || status === PaymentTransactionStatus.CANCELLED
                ? 'FAILED'
                : 'PARTIALLY_PAID',
          status: status === PaymentTransactionStatus.SUCCESS ? 'CONFIRMED' : undefined,
        },
      });
    }

    return { ok: true, transactionId: updatedTx.id };
  }

  async refund(paymentId: string, refundAmount: number, actorId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const payment = await this.findById(paymentId);
      const refundableAmount = Math.max(
        Number(payment.amount || 0) - Number(payment.amountRefunded || 0),
        0,
      );

      if (refundableAmount <= 0) {
        throw new BadRequestException('A completed payment is required before issuing a refund');
      }

      const amount = Math.min(Number(refundAmount || 0), refundableAmount);
      const refund = await this.createRefund({
        amount,
        paymentMethod: PaymentMethod.CASH,
        sourcePaymentId: payment.id,
        leadId: payment.leadId ?? undefined,
        bookingId: payment.bookingId ?? payment.rental?.booking?.id ?? undefined,
        rentalId: payment.rentalId ?? undefined,
        description: `Refunded ${amount} from payment ${payment.id}`,
        processedById: actorId,
      }, tx);

      if (refund.bookingId) {
        await this.syncBookingDerivedState(refund.bookingId, tx);
      }

      await this.auditDisputesService.log({
        action: AuditAction.REFUND_PROCESSED,
        entity: 'Payment',
        entityId: refund.id,
        paymentId: refund.id,
        rentalId: refund.rentalId ?? undefined,
        bookingId: refund.bookingId ?? undefined,
        actorId,
        summary: `Refunded ${amount} from payment ${paymentId}`,
        before: payment,
        after: refund,
      }, tx);

      return refund;
    });
  }

  async updateStatus(paymentId: string, status: PaymentStatus, actorId?: string) {
    const before = await this.findById(paymentId);
    const after = await this.prisma.payment.update({
      where: { id: paymentId },
      data: { status },
      include: { rental: true, receipts: true, transactions: true },
    });

    await this.auditDisputesService.log({
      action: AuditAction.STATUS_CHANGE,
      entity: 'Payment',
      entityId: paymentId,
      paymentId,
      rentalId: after.rentalId ?? undefined,
      bookingId: after.bookingId ?? undefined,
      actorId,
      summary: `Payment status changed to ${status}`,
      before,
      after,
    });

    return after;
  }

  async archive(paymentId: string, actorId?: string) {
    const before = await this.findById(paymentId);
    const after = await this.prisma.payment.update({
      where: { id: paymentId },
      data: { archivedAt: new Date() },
    });

    await this.auditDisputesService.log({
      action: AuditAction.ARCHIVE,
      entity: 'Payment',
      entityId: paymentId,
      paymentId,
      rentalId: after.rentalId ?? undefined,
      bookingId: after.bookingId ?? undefined,
      actorId,
      summary: 'Archived payment',
      before,
      after,
    });

    return after;
  }

  async generateReceipt(paymentId: string, createdById: string) {
    const payment = await this.findById(paymentId);
    if (!payment.rental?.booking?.customer) {
      throw new BadRequestException('Receipt requires a booking-linked payment');
    }

    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([612, 792]);
    const { height } = page.getSize();

    page.drawText('RENTAL FASHION RECEIPT', {
      x: 50,
      y: height - 50,
      size: 20,
      color: rgb(0, 0, 0),
    });

    let y = height - 100;
    const lineHeight = 20;

    page.drawText(`Receipt #: ${payment.id}`, { x: 50, y, size: 12 });
    y -= lineHeight;

    page.drawText(`Date: ${new Date().toLocaleDateString()}`, {
      x: 50,
      y,
      size: 12,
    });
    y -= lineHeight * 2;

    page.drawText(`Customer: ${payment.rental.booking.customer.name}`, {
      x: 50,
      y,
      size: 12,
    });
    y -= lineHeight;

    page.drawText(`Rental Amount: $${payment.rentalAmount}`, {
      x: 50,
      y,
      size: 12,
    });
    y -= lineHeight;

    if (payment.depositAmount > 0) {
      page.drawText(`Deposit: $${payment.depositAmount}`, {
        x: 50,
        y,
        size: 12,
      });
      y -= lineHeight;
    }

    if (payment.damageAmount > 0) {
      page.drawText(`Damage Fee: $${payment.damageAmount}`, {
        x: 50,
        y,
        size: 12,
      });
      y -= lineHeight;
    }

    y -= lineHeight;
    page.drawText(`Total: $${payment.amount}`, {
      x: 50,
      y,
      size: 14,
      color: rgb(1, 0, 0),
    });

    const pdfBytes = await pdfDoc.save();
    const pdfBase64 = Buffer.from(pdfBytes).toString('base64');

    const receipt = await this.prisma.receipt.create({
      data: {
        paymentId,
        receiptNumber: `RCP-${Date.now()}`,
        pdfUrl: `data:application/pdf;base64,${pdfBase64}`,
        createdById,
      },
    });

    await this.auditDisputesService.log({
      action: AuditAction.CREATE,
      entity: 'Receipt',
      entityId: receipt.id,
      paymentId,
      bookingId: payment.bookingId ?? payment.rental?.booking?.id,
      rentalId: payment.rentalId ?? undefined,
      actorId: createdById,
      summary: `Generated receipt ${receipt.receiptNumber}`,
      after: receipt,
    });

    return receipt;
  }

  async getDailyRevenue(date: string) {
    const startDate = new Date(date);
    const endDate = new Date(date);
    endDate.setDate(endDate.getDate() + 1);

    return this.prisma.payment.aggregate({
      where: {
        status: 'COMPLETED',
        paidAt: {
          gte: startDate,
          lt: endDate,
        },
      },
      _sum: {
        amount: true,
      },
      _count: true,
    });
  }
}
