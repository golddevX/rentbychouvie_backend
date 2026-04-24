import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, BookingStatus, PaymentGateway, PaymentMethod, PaymentStatus, PaymentTransactionStatus, PaymentType, Prisma } from '@prisma/client';
import { PDFDocument, rgb } from 'pdf-lib';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentGatewayService } from './providers/payment-gateway.service';
import { AuditDisputesService } from '../audit-disputes/audit-disputes.service';

@Injectable()
export class PaymentsService {
  constructor(
    private prisma: PrismaService,
    private paymentGatewayService: PaymentGatewayService,
    private auditDisputesService: AuditDisputesService,
  ) {}

  private async applyCompletedPayment(paymentId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        rental: {
          include: {
            booking: { include: { items: true } },
          },
        },
      },
    });

    if (!payment?.rental?.booking) return;

    const booking = payment.rental.booking;
    if (payment.type === PaymentType.BOOKING_DEPOSIT) {
      const paid = Number(booking.bookingDepositPaid || 0) + Number(payment.amountPaid || payment.amount || 0);
      const depositComplete = paid >= Number(booking.bookingDepositRequired || 0);

      await this.prisma.booking.update({
        where: { id: booking.id },
        data: {
          bookingDepositPaid: paid,
          status: depositComplete ? BookingStatus.CONFIRMED : BookingStatus.DEPOSIT_REQUESTED,
          lockedAt: depositComplete && !booking.lockedAt ? new Date() : booking.lockedAt,
        },
      });

      if (depositComplete) {
        await this.prisma.inventoryItem.updateMany({
          where: { id: { in: booking.items.map((item) => item.inventoryItemId) } },
          data: { status: 'RESERVED' },
        });
      }
    }

    if ((payment.type === PaymentType.BOOKING_DEPOSIT || payment.type === PaymentType.RENTAL_PAYMENT) && payment.rental) {
      await this.prisma.rental.update({
        where: { id: payment.rental.id },
        data: { status: 'CONFIRMED' },
      }).catch(() => undefined);
    }
  }

  async findAll(filters?: { status?: PaymentStatus; rentalId?: string }) {
    const where: Prisma.PaymentWhereInput = { ...filters, archivedAt: null };

    return this.prisma.payment.findMany({
      where,
      include: {
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
      },
      orderBy: { createdAt: 'desc' },
    });
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
        data: {
          bookingId: booking.id,
          status: 'PENDING_PAYMENT',
          scheduledPickupDate: booking.startDate,
          scheduledReturnDate: booking.endDate,
          inventoryItems: {
            connect: booking.items.map((item) => ({ id: item.inventoryItemId })),
          },
        },
      }));

    const paymentType = input.paymentType ?? 'full';
    const requestedDeposit = Math.max(Number(input.depositAmount ?? booking.bookingDepositRequired ?? booking.totalPrice * 0.5), 0);
    const existingPayments = await this.prisma.payment.findMany({
      where: {
        rentalId: rental.id,
        archivedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });
    const paidTotal = existingPayments
      .filter((item) => item.status === PaymentStatus.COMPLETED)
      .reduce((sum, item) => sum + Number(item.amountPaid || item.amount), 0);
    const paidDeposit = existingPayments
      .filter((item) => item.status === PaymentStatus.COMPLETED)
      .reduce((sum, item) => sum + Number(item.depositAmount || 0), 0);
    const depositDue = Math.max(requestedDeposit - paidDeposit, 0);
    const fullDue = Math.max(booking.totalPrice + requestedDeposit - paidTotal, 0);
    const amount =
      paymentType === 'deposit'
        ? depositDue
        : fullDue;

    if (amount <= 0) {
      throw new BadRequestException('Booking has no outstanding amount for this payment type');
    }

    const depositPortion = Math.min(depositDue, amount);
    const rentalPortion = Math.max(amount - depositPortion, 0);
    const operationPaymentType =
      paymentType === 'deposit'
        ? PaymentType.BOOKING_DEPOSIT
        : PaymentType.RENTAL_PAYMENT;
    const description =
      paymentType === 'deposit'
        ? `Deposit payment for booking ${booking.id}`
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
          depositAmount: depositPortion,
          paymentMethod: PaymentMethod.PENDING,
          status: PaymentStatus.PENDING,
          description,
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
    const payment = await this.findById(paymentId);

    const newAmountRefunded = Math.min(
      payment.amountRefunded + refundAmount,
      payment.amount,
    );

    const before = await this.findById(paymentId);
    const after = await this.prisma.payment.update({
      where: { id: paymentId },
      data: {
        amountRefunded: newAmountRefunded,
        refundAmount: newAmountRefunded,
        status:
          newAmountRefunded === payment.amount
            ? 'REFUNDED'
            : 'PARTIALLY_REFUNDED',
      },
    });

    await this.auditDisputesService.log({
      action: AuditAction.REFUND_PROCESSED,
      entity: 'Payment',
      entityId: paymentId,
      paymentId,
      rentalId: payment.rentalId ?? undefined,
      bookingId: payment.bookingId ?? payment.rental?.booking?.id,
      actorId,
      summary: `Refunded ${refundAmount} from payment ${paymentId}`,
      before,
      after,
    });

    return after;
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
