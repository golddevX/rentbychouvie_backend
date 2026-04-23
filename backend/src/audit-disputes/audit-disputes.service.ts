import { Injectable, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  DisputeResolutionOutcome,
  DisputeStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type PrismaClientLike = PrismaService | Prisma.TransactionClient;

export type AuditLogInput = {
  action: AuditAction;
  entity: string;
  entityId: string;
  summary: string;
  label?: string;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
  actorId?: string;
  bookingId?: string;
  rentalId?: string;
  rentalOrderId?: string;
  paymentId?: string;
  inventoryItemId?: string;
  returnInspectionId?: string;
  disputeId?: string;
};

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

@Injectable()
export class AuditDisputesService {
  constructor(private prisma: PrismaService) {}

  private async resolveActor(client: PrismaClientLike, actorId?: string) {
    if (!actorId) return undefined;
    const actor = await client.user.findUnique({
      where: { id: actorId },
      select: { id: true },
    });
    return actor?.id;
  }

  async log(input: AuditLogInput, client: PrismaClientLike = this.prisma) {
    const actorId = await this.resolveActor(client, input.actorId);
    return client.auditLog.create({
      data: {
        action: input.action,
        entity: input.entity,
        entityId: input.entityId,
        label: input.label,
        summary: input.summary,
        before: toJson(input.before),
        after: toJson(input.after),
        metadata: toJson(input.metadata),
        actorId,
        bookingId: input.bookingId,
        rentalId: input.rentalId,
        rentalOrderId: input.rentalOrderId,
        paymentId: input.paymentId,
        inventoryItemId: input.inventoryItemId,
        returnInspectionId: input.returnInspectionId,
        disputeId: input.disputeId,
      },
    });
  }

  async findAuditLogs(filters?: {
    entity?: string;
    entityId?: string;
    bookingId?: string;
    paymentId?: string;
    inventoryItemId?: string;
  }) {
    return this.prisma.auditLog.findMany({
      where: {
        entity: filters?.entity,
        entityId: filters?.entityId,
        bookingId: filters?.bookingId,
        paymentId: filters?.paymentId,
        inventoryItemId: filters?.inventoryItemId,
      },
      include: {
        actor: { select: { id: true, fullName: true, email: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 150,
    });
  }

  async createDispute(input: {
    title: string;
    category: any;
    priority?: any;
    summary: string;
    customerPosition?: string;
    internalNotes?: string;
    requestedAmount?: number;
    bookingId?: string;
    rentalId?: string;
    rentalOrderId?: string;
    paymentId?: string;
    inventoryItemId?: string;
    returnInspectionId?: string;
    assignedToId?: string;
    dueAt?: string;
    createdById?: string;
  }) {
    const createdById = await this.resolveActor(this.prisma, input.createdById);
    const assignedToId = await this.resolveActor(this.prisma, input.assignedToId);
    const caseNumber = `DSP-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`;

    return this.prisma.$transaction(async (tx) => {
      const dispute = await tx.dispute.create({
        data: {
          caseNumber,
          title: input.title,
          category: input.category,
          priority: input.priority,
          summary: input.summary,
          customerPosition: input.customerPosition,
          internalNotes: input.internalNotes,
          requestedAmount: Number(input.requestedAmount ?? 0),
          bookingId: input.bookingId,
          rentalId: input.rentalId,
          rentalOrderId: input.rentalOrderId,
          paymentId: input.paymentId,
          inventoryItemId: input.inventoryItemId,
          returnInspectionId: input.returnInspectionId,
          assignedToId,
          createdById,
          dueAt: input.dueAt ? new Date(input.dueAt) : undefined,
        },
        include: this.disputeInclude(),
      });

      await this.log({
        action: AuditAction.DISPUTE_OPENED,
        entity: 'Dispute',
        entityId: dispute.id,
        disputeId: dispute.id,
        bookingId: dispute.bookingId ?? undefined,
        rentalId: dispute.rentalId ?? undefined,
        rentalOrderId: dispute.rentalOrderId ?? undefined,
        paymentId: dispute.paymentId ?? undefined,
        inventoryItemId: dispute.inventoryItemId ?? undefined,
        returnInspectionId: dispute.returnInspectionId ?? undefined,
        actorId: createdById,
        summary: `Opened dispute ${dispute.caseNumber}`,
        after: dispute,
      }, tx);

      return dispute;
    });
  }

  private disputeInclude() {
    return {
      assignedTo: { select: { id: true, fullName: true, email: true, role: true } },
      createdBy: { select: { id: true, fullName: true, email: true, role: true } },
      resolvedBy: { select: { id: true, fullName: true, email: true, role: true } },
      evidence: {
        include: {
          uploadedBy: { select: { id: true, fullName: true, email: true, role: true } },
        },
        orderBy: { createdAt: 'desc' as const },
      },
    };
  }

  async findDisputes(filters?: { status?: DisputeStatus | string; priority?: string; bookingId?: string }) {
    return this.prisma.dispute.findMany({
      where: {
        status: filters?.status as DisputeStatus | undefined,
        priority: filters?.priority as any,
        bookingId: filters?.bookingId,
      },
      include: this.disputeInclude(),
      orderBy: [
        { status: 'asc' },
        { priority: 'desc' },
        { createdAt: 'desc' },
      ],
    });
  }

  async findDisputeById(id: string) {
    const dispute = await this.prisma.dispute.findUnique({
      where: { id },
      include: this.disputeInclude(),
    });

    if (!dispute) throw new NotFoundException('Dispute not found');

    const audit = await this.prisma.auditLog.findMany({
      where: {
        OR: [
          { disputeId: dispute.id },
          dispute.bookingId ? { bookingId: dispute.bookingId } : undefined,
          dispute.rentalId ? { rentalId: dispute.rentalId } : undefined,
          dispute.rentalOrderId ? { rentalOrderId: dispute.rentalOrderId } : undefined,
          dispute.paymentId ? { paymentId: dispute.paymentId } : undefined,
          dispute.inventoryItemId ? { inventoryItemId: dispute.inventoryItemId } : undefined,
          dispute.returnInspectionId ? { returnInspectionId: dispute.returnInspectionId } : undefined,
        ].filter(Boolean) as Prisma.AuditLogWhereInput[],
      },
      include: {
        actor: { select: { id: true, fullName: true, email: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    const [booking, payment, inventoryItem, rentalOrder] = await Promise.all([
      dispute.bookingId
        ? this.prisma.booking.findUnique({
            where: { id: dispute.bookingId },
            include: {
              customer: true,
              items: { include: { product: true, variant: true, inventoryItem: true } },
              rental: { include: { payments: true, returnInspections: true } },
            },
          })
        : null,
      dispute.paymentId
        ? this.prisma.payment.findUnique({
            where: { id: dispute.paymentId },
            include: { rental: { include: { booking: { include: { customer: true } } } }, transactions: true },
          })
        : null,
      dispute.inventoryItemId
        ? this.prisma.inventoryItem.findUnique({
            where: { id: dispute.inventoryItemId },
            include: { product: true, variant: true },
          })
        : null,
      dispute.rentalOrderId
        ? this.prisma.rentalOrder.findUnique({
            where: { id: dispute.rentalOrderId },
            include: { customer: true, items: { include: { product: true, inventoryItem: true } }, transactions: true },
          })
        : null,
    ]);

    return {
      ...dispute,
      audit,
      context: {
        booking,
        payment,
        inventoryItem,
        rentalOrder,
      },
    };
  }

  async updateDispute(id: string, input: {
    status?: DisputeStatus;
    priority?: any;
    assignedToId?: string;
    internalNotes?: string;
    approvedAmount?: number;
    dueAt?: string;
    actorId?: string;
  }) {
    const before = await this.findDisputeById(id);
    const assignedToId = await this.resolveActor(this.prisma, input.assignedToId);
    const updated = await this.prisma.dispute.update({
      where: { id },
      data: {
        status: input.status,
        priority: input.priority,
        assignedToId,
        internalNotes: input.internalNotes,
        approvedAmount: input.approvedAmount,
        dueAt: input.dueAt ? new Date(input.dueAt) : undefined,
      },
      include: this.disputeInclude(),
    });

    await this.log({
      action: AuditAction.DISPUTE_UPDATED,
      entity: 'Dispute',
      entityId: updated.id,
      disputeId: updated.id,
      bookingId: updated.bookingId ?? undefined,
      rentalId: updated.rentalId ?? undefined,
      rentalOrderId: updated.rentalOrderId ?? undefined,
      paymentId: updated.paymentId ?? undefined,
      inventoryItemId: updated.inventoryItemId ?? undefined,
      returnInspectionId: updated.returnInspectionId ?? undefined,
      actorId: input.actorId,
      summary: `Updated dispute ${updated.caseNumber}`,
      before,
      after: updated,
    });

    return updated;
  }

  async addEvidence(id: string, input: {
    fileName: string;
    fileUrl: string;
    mimeType?: string;
    fileSize?: number;
    evidenceType?: string;
    note?: string;
    checksum?: string;
    uploadedById?: string;
  }) {
    const dispute = await this.prisma.dispute.findUnique({ where: { id } });
    if (!dispute) throw new NotFoundException('Dispute not found');
    const uploadedById = await this.resolveActor(this.prisma, input.uploadedById);

    const evidence = await this.prisma.disputeEvidence.create({
      data: {
        disputeId: id,
        fileName: input.fileName,
        fileUrl: input.fileUrl,
        mimeType: input.mimeType,
        fileSize: input.fileSize,
        evidenceType: input.evidenceType ?? 'attachment',
        note: input.note,
        checksum: input.checksum,
        uploadedById,
      },
      include: {
        uploadedBy: { select: { id: true, fullName: true, email: true, role: true } },
      },
    });

    await this.log({
      action: AuditAction.DISPUTE_UPDATED,
      entity: 'DisputeEvidence',
      entityId: evidence.id,
      disputeId: dispute.id,
      bookingId: dispute.bookingId ?? undefined,
      rentalId: dispute.rentalId ?? undefined,
      paymentId: dispute.paymentId ?? undefined,
      inventoryItemId: dispute.inventoryItemId ?? undefined,
      actorId: uploadedById,
      summary: `Added evidence to ${dispute.caseNumber}`,
      after: evidence,
    });

    return evidence;
  }

  async resolveDispute(id: string, input: {
    outcome: DisputeResolutionOutcome;
    resolutionSummary: string;
    approvedAmount?: number;
    resolvedById?: string;
  }) {
    const before = await this.findDisputeById(id);
    const resolvedById = await this.resolveActor(this.prisma, input.resolvedById);
    const updated = await this.prisma.dispute.update({
      where: { id },
      data: {
        status: DisputeStatus.RESOLVED,
        resolutionOutcome: input.outcome,
        resolutionSummary: input.resolutionSummary,
        approvedAmount: Number(input.approvedAmount ?? before.approvedAmount ?? 0),
        resolvedById,
        resolvedAt: new Date(),
      },
      include: this.disputeInclude(),
    });

    await this.log({
      action: AuditAction.DISPUTE_RESOLVED,
      entity: 'Dispute',
      entityId: updated.id,
      disputeId: updated.id,
      bookingId: updated.bookingId ?? undefined,
      rentalId: updated.rentalId ?? undefined,
      rentalOrderId: updated.rentalOrderId ?? undefined,
      paymentId: updated.paymentId ?? undefined,
      inventoryItemId: updated.inventoryItemId ?? undefined,
      returnInspectionId: updated.returnInspectionId ?? undefined,
      actorId: resolvedById,
      summary: `Resolved dispute ${updated.caseNumber} with ${input.outcome}`,
      before,
      after: updated,
      metadata: {
        outcome: input.outcome,
        approvedAmount: updated.approvedAmount,
      },
    });

    return updated;
  }
}
