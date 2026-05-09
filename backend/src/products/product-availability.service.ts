import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { BookingStatus, LeadStatus, ProductHoldStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type ProductScheduleSlot = {
  sourceType: 'lead' | 'booking' | 'maintenance';
  sourceId: string;
  status: string;
  startDate: Date;
  endDate: Date;
  customerName?: string | null;
  customerPhone?: string | null;
  leadId?: string | null;
  bookingId?: string | null;
  reason?: string | null;
};

@Injectable()
export class ProductAvailabilityService {
  constructor(private readonly prisma: PrismaService) {}

  private ensureValidDates(pickupDate: Date, returnDate: Date) {
    if (Number.isNaN(pickupDate.getTime()) || Number.isNaN(returnDate.getTime())) {
      throw new BadRequestException('Invalid availability dates');
    }
  }

  private overlaps(startDate: Date, endDate: Date, slot: ProductScheduleSlot) {
    return startDate < slot.endDate && endDate > slot.startDate;
  }

  async getProductSchedule(productId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, archivedAt: null, isActive: true },
      select: {
        id: true,
        inventoryItems: {
          where: { archivedAt: null },
          select: { id: true },
        },
      },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const activeLeadStatuses: LeadStatus[] = [
      LeadStatus.DEPOSIT_RECEIVED,
      LeadStatus.APPOINTMENT_CREATED,
      LeadStatus.APPOINTMENT_COMPLETED,
    ];
    const activeBookingStatuses: BookingStatus[] = [
      BookingStatus.DEPOSIT_RECEIVED,
      BookingStatus.CONFIRMED,
      BookingStatus.AWAITING_REMAINING_PAYMENT,
      BookingStatus.AWAITING_SECURITY_DEPOSIT,
      BookingStatus.READY_FOR_PICKUP,
      BookingStatus.SCHEDULED_PICKUP,
      BookingStatus.PICKED_UP,
      BookingStatus.RETURN_PENDING,
      BookingStatus.RETURNED,
      BookingStatus.SETTLEMENT_PENDING,
    ];
    const inventoryItemIds = product.inventoryItems.map((item) => item.id);

    const [leadItems, bookingItems, maintenanceBlocks] = await Promise.all([
      this.prisma.leadItem.findMany({
        where: {
          productId,
          status: 'RESERVED',
          lead: {
            archivedAt: null,
            bookingId: null,
            productHoldStatus: ProductHoldStatus.RESERVED,
            status: { in: activeLeadStatuses },
            pickupDate: { not: null },
            returnDate: { not: null },
          },
        },
        include: {
          lead: {
            include: {
              customer: true,
            },
          },
        },
      }),
      this.prisma.bookingItem.findMany({
        where: {
          productId,
          booking: {
            archivedAt: null,
            status: { in: activeBookingStatuses },
          },
        },
        include: {
          booking: {
            include: {
              customer: true,
            },
          },
        },
      }),
      this.prisma.calendarBlock.findMany({
        where: {
          inventoryItemId: { in: inventoryItemIds },
          endDate: { gte: new Date('2020-01-01T00:00:00.000Z') },
        },
      }),
    ]);

    const slots: ProductScheduleSlot[] = [
      ...leadItems
        .filter((item) => item.lead.pickupDate && item.lead.returnDate)
        .map((item) => ({
          sourceType: 'lead' as const,
          sourceId: item.leadId,
          leadId: item.leadId,
          status: String(item.lead.status).toLowerCase(),
          startDate: item.lead.pickupDate!,
          endDate: item.lead.returnDate!,
          customerName: item.lead.customer.name,
          customerPhone: item.lead.customer.phone,
        })),
      ...bookingItems
        .filter((item) => item.booking.startDate && item.booking.endDate)
        .map((item) => ({
          sourceType: 'booking' as const,
          sourceId: item.bookingId,
          bookingId: item.bookingId,
          status: String(item.booking.status).toLowerCase(),
          startDate: item.booking.pickupDate ?? item.booking.startDate,
          endDate: item.booking.returnDate ?? item.booking.endDate,
          customerName: item.booking.customer.name,
          customerPhone: item.booking.customer.phone,
        })),
      ...maintenanceBlocks.map((block) => ({
        sourceType: 'maintenance' as const,
        sourceId: block.id,
        status: 'maintenance',
        startDate: block.startDate,
        endDate: block.endDate,
        reason: block.reason,
      })),
    ];

    return slots.sort((left, right) => left.startDate.getTime() - right.startDate.getTime());
  }

  async checkAvailability(productId: string, pickupDate: Date, returnDate: Date) {
    this.ensureValidDates(pickupDate, returnDate);
    const schedule = await this.getProductSchedule(productId);
    const blockingSlots = schedule.filter((slot) => this.overlaps(pickupDate, returnDate, slot));

    return {
      available: blockingSlots.length === 0,
      blockingSlots,
    };
  }

  async getAvailableSlots(
    productId: string,
    dateRange?: { startDate?: Date; endDate?: Date },
  ) {
    const startDate = dateRange?.startDate ?? new Date();
    const endDate = dateRange?.endDate ?? new Date(startDate.getTime() + 30 * 86400000);
    this.ensureValidDates(startDate, endDate);

    const schedule = await this.getProductSchedule(productId);
    const relevant = schedule
      .filter((slot) => slot.endDate > startDate && slot.startDate < endDate)
      .sort((left, right) => left.startDate.getTime() - right.startDate.getTime());

    const slots: Array<{ startDate: Date; endDate: Date }> = [];
    let cursor = new Date(startDate);

    for (const blocked of relevant) {
      if (cursor < blocked.startDate) {
        slots.push({ startDate: new Date(cursor), endDate: new Date(blocked.startDate) });
      }
      if (blocked.endDate > cursor) {
        cursor = new Date(blocked.endDate);
      }
    }

    if (cursor < endDate) {
      slots.push({ startDate: new Date(cursor), endDate: new Date(endDate) });
    }

    return slots;
  }

  async getNextAvailableDate(productId: string) {
    const now = new Date();
    const schedule = await this.getProductSchedule(productId);
    const future = schedule
      .filter((slot) => slot.endDate > now)
      .sort((left, right) => left.startDate.getTime() - right.startDate.getTime());

    let cursor = new Date(now);
    for (const blocked of future) {
      if (cursor < blocked.startDate) {
        return cursor;
      }
      if (blocked.endDate > cursor) {
        cursor = new Date(blocked.endDate);
      }
    }

    return cursor;
  }
}
