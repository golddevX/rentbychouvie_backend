import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ReceiptType } from '@prisma/client';
import { PDFDocument, rgb } from 'pdf-lib';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ReceiptsService {
  constructor(private prisma: PrismaService) {}

  async findAll(includeArchived = false) {
    return this.prisma.receipt.findMany({
      where: { archivedAt: includeArchived ? undefined : null },
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
      orderBy: { createdAt: 'desc' },
    });
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
