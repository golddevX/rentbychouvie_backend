import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, Prisma, RentalOrderPaymentStatus, RentalOrderStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditDisputesService } from '../audit-disputes/audit-disputes.service';

const ORDER_STATUS_MAP: Record<string, RentalOrderStatus> = {
  draft: RentalOrderStatus.DRAFT,
  pending_confirmation: RentalOrderStatus.PENDING_CONFIRMATION,
  confirmed: RentalOrderStatus.CONFIRMED,
  preparing: RentalOrderStatus.PREPARING,
  picked_up: RentalOrderStatus.PICKED_UP,
  rented_out: RentalOrderStatus.RENTED_OUT,
  returned: RentalOrderStatus.RETURNED,
  overdue: RentalOrderStatus.OVERDUE,
  cancelled: RentalOrderStatus.CANCELLED,
};

const PAYMENT_STATUS_MAP: Record<string, RentalOrderPaymentStatus> = {
  unpaid: RentalOrderPaymentStatus.UNPAID,
  partially_paid: RentalOrderPaymentStatus.PARTIALLY_PAID,
  paid: RentalOrderPaymentStatus.PAID,
  refunded: RentalOrderPaymentStatus.REFUNDED,
  failed: RentalOrderPaymentStatus.FAILED,
};

@Injectable()
export class RentalOrdersService {
  constructor(
    private prisma: PrismaService,
    private auditDisputesService: AuditDisputesService,
  ) {}

  private toOrderStatus(status?: string) {
    if (!status) return RentalOrderStatus.DRAFT;
    const normalized = ORDER_STATUS_MAP[status.toLowerCase()];
    if (!normalized) throw new BadRequestException('Invalid rental order status');
    return normalized;
  }

  private toPaymentStatus(status?: string) {
    if (!status) return RentalOrderPaymentStatus.UNPAID;
    const normalized = PAYMENT_STATUS_MAP[status.toLowerCase()];
    if (!normalized) throw new BadRequestException('Invalid rental order payment status');
    return normalized;
  }

  private toApiStatus(status: RentalOrderStatus) {
    return status.toLowerCase();
  }

  private toApiPaymentStatus(status: RentalOrderPaymentStatus) {
    return status.toLowerCase();
  }

  private normalizeDateRange(startDateTime: string, endDateTime: string) {
    const start = new Date(startDateTime);
    const end = new Date(endDateTime);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('Invalid date-time range');
    }
    if (start.getTime() >= end.getTime()) {
      throw new BadRequestException('Invalid date range: startDateTime must be before endDateTime');
    }
    if (start.getTime() < Date.now()) {
      throw new BadRequestException('Past rental order is not allowed');
    }
    return { start, end };
  }

  private async resolveCustomer(payload: { customerId?: string; email?: string; name?: string; phone?: string }) {
    if (payload.customerId) {
      const customer = await this.prisma.customer.findUnique({ where: { id: payload.customerId } });
      if (!customer || customer.archivedAt) {
        throw new NotFoundException('Customer not found');
      }
      return customer.id;
    }
    if (!payload.email) {
      throw new BadRequestException('customerId or email is required');
    }

    const customer = await this.prisma.customer.upsert({
      where: { email: payload.email },
      update: {
        name: payload.name ?? undefined,
        phone: payload.phone ?? undefined,
      },
      create: {
        email: payload.email,
        name: payload.name ?? payload.email,
        phone: payload.phone ?? 'N/A',
      },
    });
    return customer.id;
  }

  private async assertItemAvailability(inventoryItemIds: string[], start: Date, end: Date, rentalOrderId?: string) {
    if (!inventoryItemIds.length) return;

    const inventoryItems = await this.prisma.inventoryItem.findMany({
      where: {
        id: { in: inventoryItemIds },
        archivedAt: null,
      },
      select: { id: true, status: true },
    });

    if (inventoryItems.length !== inventoryItemIds.length) {
      throw new BadRequestException('One or more inventory items are unavailable');
    }

    const unavailableNow = inventoryItems.some((item) => item.status !== 'AVAILABLE');
    if (unavailableNow) {
      throw new BadRequestException('One or more inventory items are not currently available');
    }

    const bookingConflicts = await this.prisma.bookingItem.findMany({
      where: {
        inventoryItemId: { in: inventoryItemIds },
        booking: {
          archivedAt: null,
          status: { not: 'CANCELLED' },
          startDate: { lt: end },
          endDate: { gt: start },
        },
      },
      select: {
        inventoryItemId: true,
        booking: { select: { id: true, startDate: true, endDate: true, status: true } },
      },
    });

    if (bookingConflicts.length > 0) {
      throw new BadRequestException('Inventory is already booked in this date-time range');
    }

    const rentalOrderConflicts = await this.prisma.rentalOrderItem.findMany({
      where: {
        inventoryItemId: { in: inventoryItemIds },
        rentalOrder: {
          archivedAt: null,
          id: rentalOrderId ? { not: rentalOrderId } : undefined,
          status: { not: RentalOrderStatus.CANCELLED },
          startDateTime: { lt: end },
          endDateTime: { gt: start },
        },
      },
      select: {
        inventoryItemId: true,
        rentalOrder: { select: { id: true, orderCode: true, startDateTime: true, endDateTime: true, status: true } },
      },
    });

    if (rentalOrderConflicts.length > 0) {
      throw new BadRequestException('Inventory is already reserved by another rental order');
    }
  }

  private mapOrderForApi(order: any) {
    return {
      ...order,
      status: this.toApiStatus(order.status),
      paymentStatus: this.toApiPaymentStatus(order.paymentStatus),
    };
  }

  async findAll(filters?: { status?: string; paymentStatus?: string; includeArchived?: boolean }) {
    const where: Prisma.RentalOrderWhereInput = {
      archivedAt: filters?.includeArchived ? undefined : null,
      status: filters?.status ? this.toOrderStatus(filters.status) : undefined,
      paymentStatus: filters?.paymentStatus ? this.toPaymentStatus(filters.paymentStatus) : undefined,
    };

    const rows = await this.prisma.rentalOrder.findMany({
      where,
      include: {
        customer: true,
        createdBy: { select: { id: true, fullName: true, email: true } },
        items: {
          include: {
            product: true,
            inventoryItem: true,
          },
        },
        transactions: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return rows.map((row) => this.mapOrderForApi(row));
  }

  async findById(id: string) {
    const order = await this.prisma.rentalOrder.findUnique({
      where: { id },
      include: {
        customer: true,
        createdBy: { select: { id: true, fullName: true, email: true } },
        items: {
          include: {
            product: true,
            inventoryItem: true,
          },
        },
        transactions: true,
      },
    });

    if (!order || order.archivedAt) {
      throw new NotFoundException('Rental order not found');
    }

    return this.mapOrderForApi(order);
  }

  async create(payload: {
    customerId?: string;
    email?: string;
    name?: string;
    phone?: string;
    startDateTime: string;
    endDateTime: string;
    quantity?: number;
    depositAmount?: number;
    additionalFees?: number;
    discountAmount?: number;
    notes?: string;
    status?: string;
    paymentStatus?: string;
    createdById?: string;
    items: Array<{
      inventoryItemId?: string;
      productId?: string;
      quantity?: number;
      unitPrice?: number;
      notes?: string;
    }>;
  }) {
    if (!payload.items?.length) {
      throw new BadRequestException('At least one item is required');
    }

    const { start, end } = this.normalizeDateRange(payload.startDateTime, payload.endDateTime);
    const customerId = await this.resolveCustomer(payload);
    const inventoryItemIds = payload.items.map((item) => item.inventoryItemId).filter(Boolean) as string[];

    await this.assertItemAvailability(inventoryItemIds, start, end);

    const subtotal = payload.items.reduce(
      (sum, item) => sum + Number(item.unitPrice ?? 0) * Number(item.quantity ?? 1),
      0,
    );
    const depositAmount = Number(payload.depositAmount ?? 0);
    const additionalFees = Number(payload.additionalFees ?? 0);
    const discountAmount = Number(payload.discountAmount ?? 0);
    const totalAmount = subtotal + depositAmount + additionalFees - discountAmount;
    const durationHours = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60));

    const order = await this.prisma.rentalOrder.create({
      data: {
        orderCode: `RO-${Date.now().toString().slice(-8)}`,
        customerId,
        status: this.toOrderStatus(payload.status),
        paymentStatus: this.toPaymentStatus(payload.paymentStatus),
        startDateTime: start,
        endDateTime: end,
        quantity: Number(payload.quantity ?? payload.items.length),
        durationHours,
        subtotal,
        depositAmount,
        additionalFees,
        discountAmount,
        totalAmount,
        notes: payload.notes,
        createdById: payload.createdById,
        items: {
          create: payload.items.map((item) => ({
            inventoryItemId: item.inventoryItemId,
            productId: item.productId,
            quantity: Number(item.quantity ?? 1),
            unitPrice: Number(item.unitPrice ?? 0),
            notes: item.notes,
          })),
        },
      },
      include: {
        customer: true,
        createdBy: { select: { id: true, fullName: true, email: true } },
        items: {
          include: {
            product: true,
            inventoryItem: true,
          },
        },
        transactions: true,
      },
    });

    await this.auditDisputesService.log({
      action: AuditAction.CREATE,
      entity: 'RentalOrder',
      entityId: order.id,
      rentalOrderId: order.id,
      actorId: payload.createdById,
      summary: `Created rental order ${order.orderCode}`,
      after: order,
    });

    return this.mapOrderForApi(order);
  }

  async updateStatus(id: string, status: string, actorId?: string) {
    const before = await this.findById(id);
    const order = await this.prisma.rentalOrder.update({
      where: { id },
      data: { status: this.toOrderStatus(status) },
      include: {
        customer: true,
        createdBy: { select: { id: true, fullName: true, email: true } },
        items: { include: { product: true, inventoryItem: true } },
        transactions: true,
      },
    });

    await this.auditDisputesService.log({
      action: AuditAction.STATUS_CHANGE,
      entity: 'RentalOrder',
      entityId: id,
      rentalOrderId: id,
      actorId,
      summary: `Rental order status changed to ${order.status}`,
      before,
      after: order,
    });

    return this.mapOrderForApi(order);
  }

  async updatePaymentStatus(id: string, paymentStatus: string, actorId?: string) {
    const before = await this.findById(id);
    const order = await this.prisma.rentalOrder.update({
      where: { id },
      data: { paymentStatus: this.toPaymentStatus(paymentStatus) },
      include: {
        customer: true,
        createdBy: { select: { id: true, fullName: true, email: true } },
        items: { include: { product: true, inventoryItem: true } },
        transactions: true,
      },
    });

    await this.auditDisputesService.log({
      action: AuditAction.STATUS_CHANGE,
      entity: 'RentalOrder',
      entityId: id,
      rentalOrderId: id,
      actorId,
      summary: `Rental order payment status changed to ${order.paymentStatus}`,
      before,
      after: order,
    });

    return this.mapOrderForApi(order);
  }

  async archive(id: string, actorId?: string) {
    const before = await this.findById(id);
    const after = await this.prisma.rentalOrder.update({
      where: { id },
      data: { archivedAt: new Date() },
    });

    await this.auditDisputesService.log({
      action: AuditAction.ARCHIVE,
      entity: 'RentalOrder',
      entityId: id,
      rentalOrderId: id,
      actorId,
      summary: 'Archived rental order',
      before,
      after,
    });

    return after;
  }

  async checkAvailability(input: {
    startDateTime: string;
    endDateTime: string;
    inventoryItemIds: string[];
    rentalOrderId?: string;
  }) {
    const { start, end } = this.normalizeDateRange(input.startDateTime, input.endDateTime);
    await this.assertItemAvailability(input.inventoryItemIds, start, end, input.rentalOrderId);
    return { available: true };
  }
}
