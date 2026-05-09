import { Injectable, NotFoundException } from '@nestjs/common';
import { PreviewRequestStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildPaginatedResult, resolvePagination } from '../shared/pagination';

@Injectable()
export class PreviewRequestsService {
  constructor(private prisma: PrismaService) {}

  async findAll(filters?: {
    status?: PreviewRequestStatus;
    assignedToId?: string;
    includeArchived?: boolean;
    page?: number;
    limit?: number;
    search?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    dateFrom?: string;
    dateTo?: string;
  }) {
    const { page, limit, skip, take } = resolvePagination(filters);
    const sortBy = ['createdAt', 'updatedAt', 'garmentName'].includes(String(filters?.sortBy))
      ? String(filters?.sortBy)
      : 'createdAt';
    const sortOrder = filters?.sortOrder === 'asc' ? 'asc' : 'desc';
    const normalizedSearch = String(filters?.search ?? '').trim();
    const dateFrom = filters?.dateFrom ? new Date(filters.dateFrom) : undefined;
    const dateTo = filters?.dateTo ? new Date(filters.dateTo) : undefined;
    const where: Prisma.PreviewRequestWhereInput = {
      archivedAt: filters?.includeArchived ? undefined : null,
      status: filters?.status,
      assignedToId: filters?.assignedToId,
      ...(normalizedSearch
        ? {
            OR: [
              { garmentName: { contains: normalizedSearch, mode: 'insensitive' } },
              { notes: { contains: normalizedSearch, mode: 'insensitive' } },
              { resultNotes: { contains: normalizedSearch, mode: 'insensitive' } },
              { customer: { is: { name: { contains: normalizedSearch, mode: 'insensitive' } } } },
              { customer: { is: { email: { contains: normalizedSearch, mode: 'insensitive' } } } },
              { customer: { is: { phone: { contains: normalizedSearch, mode: 'insensitive' } } } },
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
      customer: true,
      assignedTo: { select: { id: true, fullName: true, email: true, role: true } },
    } satisfies Prisma.PreviewRequestInclude;

    const [total, data] = await Promise.all([
      this.prisma.previewRequest.count({ where }),
      this.prisma.previewRequest.findMany({
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
