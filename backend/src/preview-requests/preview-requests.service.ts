import { Injectable, NotFoundException } from '@nestjs/common';
import { PreviewRequestStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PreviewRequestsService {
  constructor(private prisma: PrismaService) {}

  async findAll(filters?: {
    status?: PreviewRequestStatus;
    assignedToId?: string;
    includeArchived?: boolean;
  }) {
    const where: Prisma.PreviewRequestWhereInput = {
      archivedAt: filters?.includeArchived ? undefined : null,
      status: filters?.status,
      assignedToId: filters?.assignedToId,
    };

    return this.prisma.previewRequest.findMany({
      where,
      include: {
        customer: true,
        assignedTo: { select: { id: true, fullName: true, email: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string) {
    const request = await this.prisma.previewRequest.findUnique({
      where: { id },
      include: {
        customer: true,
        assignedTo: { select: { id: true, fullName: true, email: true, role: true } },
      },
    });

    if (!request || request.archivedAt) {
      throw new NotFoundException('Preview request not found');
    }

    return request;
  }

  async create(data: {
    customerId?: string;
    email?: string;
    name?: string;
    phone?: string;
    leadId?: string;
    bookingId?: string;
    garmentName: string;
    sourceImageUrl?: string;
    notes?: string;
    assignedToId?: string;
  }) {
    const customerId =
      data.customerId ??
      (
        await this.prisma.customer.upsert({
          where: { email: data.email ?? `preview-${Date.now()}@local.test` },
          update: { name: data.name, phone: data.phone },
          create: {
            email: data.email ?? `preview-${Date.now()}@local.test`,
            name: data.name ?? 'Preview customer',
            phone: data.phone ?? 'N/A',
          },
        })
      ).id;

    return this.prisma.previewRequest.create({
      data: {
        customerId,
        leadId: data.leadId,
        bookingId: data.bookingId,
        garmentName: data.garmentName,
        sourceImageUrl: data.sourceImageUrl,
        notes: data.notes,
        assignedToId: data.assignedToId,
      },
      include: { customer: true, assignedTo: true },
    });
  }

  async update(id: string, data: any) {
    await this.findById(id);
    return this.prisma.previewRequest.update({
      where: { id },
      data,
      include: { customer: true, assignedTo: true },
    });
  }

  async updateStatus(id: string, status: PreviewRequestStatus) {
    await this.findById(id);
    return this.prisma.previewRequest.update({
      where: { id },
      data: { status },
      include: { customer: true, assignedTo: true },
    });
  }

  async archive(id: string) {
    await this.findById(id);
    return this.prisma.previewRequest.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
  }
}
