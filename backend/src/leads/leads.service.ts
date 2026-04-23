import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LeadStatus } from '@prisma/client';

const ONE_HOUR_MS = 60 * 60 * 1000;
const FIVE_HOURS_MS = 5 * ONE_HOUR_MS;

@Injectable()
export class LeadsService {
  constructor(private prisma: PrismaService) {}

  async findAll(filters?: { status?: LeadStatus; assignedToId?: string }) {
    return this.prisma.lead.findMany({
      where: { ...filters, archivedAt: null },
      include: {
        customer: true,
        assignedTo: {
          select: { id: true, fullName: true, email: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string) {
    return this.prisma.lead.findUnique({
      where: { id, archivedAt: null },
      include: {
        customer: true,
        assignedTo: {
          select: { id: true, fullName: true, email: true },
        },
      },
    });
  }

  async create(data: {
    email: string;
    name: string;
    phone: string;
    source?: string;
    notes?: string;
  }) {
    const customer = await this.prisma.customer.upsert({
      where: { email: data.email },
      update: {},
      create: {
        email: data.email,
        name: data.name,
        phone: data.phone,
      },
    });

    return this.prisma.lead.create({
      data: {
        customerId: customer.id,
        source: data.source || 'web',
        notes: data.notes,
        status: LeadStatus.NEW,
        contactDeadlineAt: new Date(Date.now() + ONE_HOUR_MS),
      },
      include: { customer: true },
    });
  }

  async update(id: string, data: any) {
    return this.prisma.lead.update({
      where: { id },
      data,
      include: { customer: true, assignedTo: true },
    });
  }

  async convertToBooking(leadId: string, bookingId: string) {
    return this.prisma.lead.update({
      where: { id: leadId },
      data: {
        status: LeadStatus.BOOKING_CREATED,
        convertedToBookingId: bookingId,
      },
    });
  }

  async assignTo(leadId: string, userId: string) {
    return this.prisma.lead.update({
      where: { id: leadId },
      data: {
        assignedToId: userId,
        status: LeadStatus.CONTACTED,
        contactedAt: new Date(),
      },
    });
  }

  async updateStatus(id: string, status: LeadStatus) {
    const nextData: any = { status };
    if (status === LeadStatus.CONTACTED) {
      nextData.contactedAt = new Date();
    }
    if (status === LeadStatus.DEPOSIT_REQUESTED) {
      nextData.depositRequestedAt = new Date();
      nextData.depositDeadlineAt = new Date(Date.now() + FIVE_HOURS_MS);
    }
    if (status === LeadStatus.DEPOSIT_RECEIVED) {
      nextData.depositReceivedAt = new Date();
    }

    return this.prisma.lead.update({
      where: { id },
      data: nextData,
      include: { customer: true, assignedTo: true },
    });
  }

  async markContacted(id: string, notes?: string) {
    const lead = await this.updateStatus(id, LeadStatus.CONTACTED);
    if (!notes) return lead;

    return this.prisma.lead.update({
      where: { id },
      data: { notes },
      include: { customer: true, assignedTo: true },
    });
  }

  async requestDeposit(id: string, input?: { quotedPrice?: number; depositDeadlineAt?: string }) {
    return this.prisma.lead.update({
      where: { id },
      data: {
        status: LeadStatus.DEPOSIT_REQUESTED,
        quotedPrice: input?.quotedPrice,
        depositRequestedAt: new Date(),
        depositDeadlineAt: input?.depositDeadlineAt
          ? new Date(input.depositDeadlineAt)
          : new Date(Date.now() + FIVE_HOURS_MS),
      },
      include: { customer: true, assignedTo: true },
    });
  }

  async releaseExpiredDepositHolds() {
    return this.prisma.lead.updateMany({
      where: {
        status: LeadStatus.DEPOSIT_REQUESTED,
        depositDeadlineAt: { lt: new Date() },
      },
      data: {
        status: LeadStatus.LOST,
        lostReason: 'Deposit not received within 5 hours; schedule released',
      },
    });
  }

  async archive(id: string) {
    return this.prisma.lead.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
  }
}
