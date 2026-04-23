import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, InventoryItemStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import * as QRCode from 'qrcode';
import { v4 as uuidv4 } from 'uuid';
import { AuditDisputesService } from '../audit-disputes/audit-disputes.service';

@Injectable()
export class InventoryService {
  constructor(
    private prisma: PrismaService,
    private auditDisputesService: AuditDisputesService,
  ) {}

  async findAllItems(filters?: {
    productId?: string;
    status?: InventoryItemStatus;
  }) {
    const where: Prisma.InventoryItemWhereInput = { ...filters, archivedAt: null };

    return this.prisma.inventoryItem.findMany({
      where,
      include: {
        product: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findItemById(id: string) {
    return this.prisma.inventoryItem.findUnique({
      where: { id, archivedAt: null },
      include: {
        product: true,
        variant: true,
        rentals: true,
      },
    });
  }

  async findByQRCode(qrCode: string) {
    const item = await this.prisma.inventoryItem.findUnique({
      where: { qrCode, archivedAt: null },
      include: {
        product: true,
        variant: true,
        rentals: {
          where: { status: 'IN_RENTAL' },
          include: {
            booking: {
              include: { customer: true },
            },
          },
        },
      },
    });

    if (!item) {
      throw new NotFoundException('Item not found');
    }

    return item;
  }

  async resolveQRCode(qrCode: string) {
    const item = await this.prisma.inventoryItem.findUnique({
      where: { qrCode, archivedAt: null },
      include: {
        product: true,
        variant: true,
        bookingItems: {
          include: {
            booking: {
              include: { customer: true },
            },
          },
        },
        rentals: {
          include: {
            booking: { include: { customer: true } },
          },
        },
      },
    });

    if (!item) {
      const rotated = await this.prisma.inventoryItem.findFirst({
        where: {
          archivedAt: null,
          previousQrCodes: {
            contains: qrCode,
          },
        },
        select: {
          id: true,
          qrCode: true,
        },
      });

      if (rotated) {
        throw new BadRequestException({
          message: 'QR code is no longer active',
          code: 'QR_ROTATED',
          itemId: rotated.id,
          latestQrCode: rotated.qrCode,
        });
      }

      throw new NotFoundException('Item not found');
    }

    const currentRental = item.rentals.find((rental) =>
      ['PICKED_UP', 'IN_RENTAL', 'CONFIRMED'].includes(rental.status),
    );

    const upcomingBookings = item.bookingItems
      .map((bookingItem) => bookingItem.booking)
      .filter((booking) => booking.endDate >= new Date())
      .sort((a, b) => a.startDate.getTime() - b.startDate.getTime())
      .slice(0, 5)
      .map((booking) => ({
        id: booking.id,
        status: booking.status,
        startDate: booking.startDate,
        endDate: booking.endDate,
        customer: {
          id: booking.customer.id,
          name: booking.customer.name,
          phone: booking.customer.phone,
        },
      }));

    return {
      item: {
        id: item.id,
        productId: item.productId,
        productName: item.product.name,
        variantName: item.variant?.name ?? null,
        size: item.variant?.size ?? null,
        color: item.variant?.color ?? null,
        qrCode: item.qrCode,
        qrVersion: item.qrVersion,
        serialNumber: item.serialNumber,
        status: item.status,
        condition: item.condition,
      },
      currentBooking: currentRental
        ? {
            id: currentRental.booking.id,
            status: currentRental.booking.status,
            startDate: currentRental.booking.startDate,
            endDate: currentRental.booking.endDate,
            customer: {
              id: currentRental.booking.customer.id,
              name: currentRental.booking.customer.name,
              phone: currentRental.booking.customer.phone,
            },
          }
        : null,
      upcomingBookings,
      availableSlots: [
        {
          startDate: new Date(Date.now() + 2 * 86400000),
          endDate: new Date(Date.now() + 4 * 86400000),
        },
        {
          startDate: new Date(Date.now() + 9 * 86400000),
          endDate: new Date(Date.now() + 13 * 86400000),
        },
      ],
    };
  }

  async createItem(data: {
    productId: string;
    variantId?: string;
    condition?: string;
    imageUrls?: string[];
    actorId?: string;
  }) {
    const qrCode = uuidv4();

    const item = await this.prisma.inventoryItem.create({
      data: {
        productId: data.productId,
        variantId: data.variantId,
        qrCode,
        serialNumber: `${Date.now()}-${Math.random().toString(36).substring(7)}`,
        condition: data.condition || 'excellent',
        imageUrls: data.imageUrls ? JSON.stringify(data.imageUrls) : undefined,
        status: 'AVAILABLE',
      },
      include: {
        product: true,
        variant: true,
      },
    });

    await this.auditDisputesService.log({
      action: AuditAction.CREATE,
      entity: 'InventoryItem',
      entityId: item.id,
      inventoryItemId: item.id,
      actorId: data.actorId,
      summary: `Created inventory item ${item.serialNumber}`,
      after: item,
    });

    return item;
  }

  async updateItemStatus(
    id: string,
    status: InventoryItemStatus,
    notes?: string,
    actorId?: string,
  ) {
    const before = await this.findItemById(id);
    const after = await this.prisma.inventoryItem.update({
      where: { id },
      data: {
        status,
      },
    });

    await this.auditDisputesService.log({
      action: AuditAction.STATUS_CHANGE,
      entity: 'InventoryItem',
      entityId: id,
      inventoryItemId: id,
      actorId,
      summary: `Inventory status changed to ${status}`,
      before,
      after,
      metadata: { notes },
    });

    return after;
  }

  async blockDates(
    inventoryItemId: string,
    startDate: string,
    endDate: string,
    reason: string,
  ) {
    return this.prisma.calendarBlock.create({
      data: {
        inventoryItemId,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        reason,
      },
    });
  }

  async getItemStatus(itemId: string) {
    const item = await this.findItemById(itemId);
    if (!item) {
      throw new NotFoundException('Item not found');
    }

    const activeRental = item.rentals[0];

    return {
      item,
      currentStatus: item.status,
      inRental: !!activeRental,
      rental: activeRental || null,
    };
  }

  async generateQRCode(itemId: string) {
    const item = await this.findItemById(itemId);
    if (!item) {
      throw new NotFoundException('Item not found');
    }

    return QRCode.toDataURL(item.qrCode);
  }

  async regenerateQRCode(itemId: string, actorId?: string) {
    const item = await this.findItemById(itemId);
    if (!item) {
      throw new NotFoundException('Item not found');
    }

    const previousCodes = item.previousQrCodes
      ? JSON.parse(item.previousQrCodes) as string[]
      : [];
    const newCode = uuidv4();

    const updated = await this.prisma.inventoryItem.update({
      where: { id: itemId },
      data: {
        qrCode: newCode,
        qrVersion: { increment: 1 },
        previousQrCodes: JSON.stringify([...previousCodes, item.qrCode]),
      },
      include: { product: true, variant: true },
    });

    await this.auditDisputesService.log({
      action: AuditAction.UPDATE,
      entity: 'InventoryItem',
      entityId: itemId,
      inventoryItemId: itemId,
      actorId,
      summary: `Rotated QR code for ${item.serialNumber}`,
      before: item,
      after: updated,
      metadata: {
        previousQrCode: item.qrCode,
        newQrCode: updated.qrCode,
      },
    });

    return updated;
  }

  async getItemSchedule(itemId: string) {
    const item = await this.prisma.inventoryItem.findUnique({
      where: { id: itemId, archivedAt: null },
      include: {
        product: true,
        bookingItems: {
          include: {
            booking: {
              include: { customer: true },
            },
          },
        },
        rentals: {
          include: {
            booking: { include: { customer: true } },
          },
        },
      },
    });

    if (!item) {
      throw new NotFoundException('Item not found');
    }

    const upcomingBookings = item.bookingItems
      .map((bookingItem) => bookingItem.booking)
      .filter((booking) => booking.endDate >= new Date());

    return {
      item,
      currentBooking:
        item.rentals.find((rental) =>
          ['PICKED_UP', 'IN_RENTAL'].includes(rental.status),
        )?.booking ?? null,
      upcomingBookings,
      availableSlots: [
        { startDate: new Date(), endDate: new Date(Date.now() + 3 * 86400000) },
        {
          startDate: new Date(Date.now() + 7 * 86400000),
          endDate: new Date(Date.now() + 14 * 86400000),
        },
      ],
    };
  }

  async archiveItem(itemId: string, actorId?: string) {
    const before = await this.findItemById(itemId);
    const after = await this.prisma.inventoryItem.update({
      where: { id: itemId },
      data: { archivedAt: new Date() },
    });

    await this.auditDisputesService.log({
      action: AuditAction.ARCHIVE,
      entity: 'InventoryItem',
      entityId: itemId,
      inventoryItemId: itemId,
      actorId,
      summary: 'Archived inventory item',
      before,
      after,
    });

    return after;
  }
}
