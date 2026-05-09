import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ReceiptType } from '@prisma/client';
import { PDFDocument, rgb } from 'pdf-lib';
import { PrismaService } from '../prisma/prisma.service';
import { buildPaginatedResult, resolvePagination } from '../shared/pagination';

@Injectable()
export class ReceiptsService {
  constructor(private prisma: PrismaService) {}

  async findAll(filters?: {
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
    const sortBy = ['createdAt', 'printedAt', 'receiptNumber'].includes(String(filters?.sortBy))
      ? String(filters?.sortBy)
      : 'createdAt';
    const sortOrder = filters?.sortOrder === 'asc' ? 'asc' : 'desc';
    const normalizedSearch = String(filters?.search ?? '').trim();
    const dateFrom = filters?.dateFrom ? new Date(filters.dateFrom) : undefined;
    const dateTo = filters?.dateTo ? new Date(filters.dateTo) : undefined;
    const where: Prisma.ReceiptWhereInput = {
      archivedAt: filters?.includeArchived ? undefined : null,
      ...(normalizedSearch
        ? {
            OR: [
              { receiptNumber: { contains: normalizedSearch, mode: 'insensitive' } },
              { paymentId: { contains: normalizedSearch, mode: 'insensitive' } },
              { payment: { is: { rental: { is: { booking: { is: { customer: { is: { name: { contains: normalizedSearch, mode: 'insensitive' } } } } } } } } } },
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
      payment: {
        include: {
          rental: {
            include: { booking: { include: { customer: true } } },
          },
        },
      },
      createdBy: { select: { id: true, fullName: true, email: true } },
    } satisfies Prisma.ReceiptInclude;

    const [total, data] = await Promise.all([
      this.prisma.receipt.count({ where }),
      this.prisma.receipt.findMany({
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
    const receipt = await this.prisma.receipt.findUnique({
      where: { id, archivedAt: null },
      include: {
        payment: {
          include: {
            rental: {
              include: { booking: { include: { customer: true } } },
            },
          },
        },
        createdBy: { select: { id: true, fullName: true, email: true } },
      },
    });

    if (!receipt) {
      throw new NotFoundException('Receipt not found');
    }

    return receipt;
  }

  async update(id: string, data: { type?: ReceiptType; pdfUrl?: string }) {
    await this.findById(id);
    return this.prisma.receipt.update({
      where: { id },
      data,
      include: { payment: true, createdBy: true },
    });
  }

  async archive(id: string) {
    await this.findById(id);
    return this.prisma.receipt.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
  }

  async print(id: string) {
    await this.findById(id);
    return this.prisma.receipt.update({
      where: { id },
      data: {
        printedAt: new Date(),
        printedCount: { increment: 1 },
      },
    });
  }

  async getPdf(id: string) {
    const receipt = await this.findById(id);
    if (receipt.pdfUrl) {
      return { pdfUrl: receipt.pdfUrl };
    }

    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([612, 792]);
    const { height } = page.getSize();
    const customer = receipt.payment.rental?.booking?.customer;
    if (!customer) {
      throw new BadRequestException('Receipt is not linked to a booking customer');
    }

    page.drawText('RENTAL FASHION RECEIPT', {
      x: 50,
      y: height - 50,
      size: 18,
      color: rgb(0, 0, 0),
    });
    page.drawText(`Receipt: ${receipt.receiptNumber}`, { x: 50, y: height - 90, size: 12 });
    page.drawText(`Customer: ${customer.name}`, { x: 50, y: height - 115, size: 12 });
    page.drawText(`Amount: ${receipt.payment.amount}`, { x: 50, y: height - 140, size: 12 });

    const pdfUrl = `data:application/pdf;base64,${Buffer.from(await pdfDoc.save()).toString('base64')}`;

    await this.prisma.receipt.update({
      where: { id },
      data: { pdfUrl },
    });

    return { pdfUrl };
  }
}
