import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LeadAppointmentIntent, LeadDepositStatus, LeadStatus, ProductHoldStatus } from '@prisma/client';

const ONE_HOUR_MS = 60 * 60 * 1000;

@Injectable()
export class LeadsService {
  constructor(private prisma: PrismaService) {}

  private serializeRentalDates(pickupDate: Date, returnDate: Date) {
    return JSON.stringify({
      startDate: pickupDate.toISOString(),
      endDate: returnDate.toISOString(),
    });
  }

  private leadInclude() {
    return {
      customer: true,
      assignedTo: {
        select: { id: true, fullName: true, email: true },
      },
      product: true,
      variant: true,
      inventoryItem: {
        include: {
          product: true,
          variant: true,
        },
      },
      payments: {
        where: { archivedAt: null },
        orderBy: { createdAt: 'desc' as const },
      },
    };
  }

  private async decorateLead<T extends { appointmentId?: string | null; bookingId?: string | null; convertedToBookingId?: string | null }>(lead: T | null) {
    if (!lead) return lead;
    const bookingId = lead.bookingId ?? lead.convertedToBookingId ?? undefined;
    const [appointment, booking] = await Promise.all([
      lead.appointmentId
        ? this.prisma.appointment.findFirst({
            where: { id: lead.appointmentId, archivedAt: null },
          })
        : null,
      bookingId
        ? this.prisma.booking.findFirst({
            where: { id: bookingId, archivedAt: null },
            include: {
              customer: true,
              items: {
                include: {
                  product: true,
                  variant: true,
                  inventoryItem: true,
                },
              },
              payments: true,
              rental: { include: { payments: true } },
            },
          })
        : null,
    ]);

    return {
      ...lead,
      appointment,
      booking,
    };
  }

  async findAll(filters?: { status?: LeadStatus; assignedToId?: string }) {
    const leads = await this.prisma.lead.findMany({
      where: { ...filters, archivedAt: null },
      include: this.leadInclude(),
      orderBy: { createdAt: 'desc' },
    });

    return Promise.all(leads.map((lead) => this.decorateLead(lead)));
  }

  async findById(id: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id, archivedAt: null },
      include: this.leadInclude(),
    });

    return this.decorateLead(lead);
  }

  async create(data: {
    email: string;
    name: string;
    phone: string;
    source?: string;
    notes?: string;
    productId?: string;
    variantId?: string;
    inventoryItemId?: string;
    size?: string;
    color?: string;
    pickupDate?: string;
    returnDate?: string;
    appointmentIntent?: LeadAppointmentIntent;
    quotedPrice?: number;
  }) {
    const customer = await this.prisma.customer.upsert({
      where: { email: data.email },
      update: {
        name: data.name,
        phone: data.phone,
      },
      create: {
        email: data.email,
        name: data.name,
        phone: data.phone,
      },
    });

    let productContext:
      | {
          productId: string;
          variantId?: string;
          inventoryItemId?: string;
          pickupDate: Date;
          returnDate: Date;
          appointmentIntent: LeadAppointmentIntent;
          requestedSize?: string;
          requestedColor?: string;
        }
      | undefined;

    if (data.productId) {
      if (!data.pickupDate || !data.returnDate || !data.appointmentIntent) {
        throw new BadRequestException('Client lead requires product, desired dates, and appointment intent');
      }

      const pickupDate = new Date(data.pickupDate);
      const returnDate = new Date(data.returnDate);
      if (Number.isNaN(pickupDate.getTime()) || Number.isNaN(returnDate.getTime())) {
        throw new BadRequestException('Invalid pickup or return date');
      }
      if (returnDate.getTime() <= pickupDate.getTime()) {
        throw new BadRequestException('Return date must be after pickup date');
      }

      const product = await this.prisma.product.findFirst({
        where: { id: data.productId, isActive: true, archivedAt: null },
      });
      if (!product) {
        throw new BadRequestException('Product not found');
      }

      let variant:
        | {
            id: string;
            size: string | null;
            color: string | null;
          }
        | null = null;

      if (data.variantId) {
        variant = await this.prisma.productVariant.findFirst({
          where: {
            id: data.variantId,
            productId: data.productId,
            archivedAt: null,
            isActive: true,
          },
          select: { id: true, size: true, color: true },
        });
        if (!variant) {
          throw new BadRequestException('Variant not found');
        }
      }

      if (data.inventoryItemId) {
        const inventoryItem = await this.prisma.inventoryItem.findFirst({
          where: {
            id: data.inventoryItemId,
            productId: data.productId,
            variantId: data.variantId ?? undefined,
            archivedAt: null,
          },
          select: { id: true },
        });
        if (!inventoryItem) {
          throw new BadRequestException('Inventory item does not match selected product');
        }
      }

      productContext = {
        productId: data.productId,
        variantId: data.variantId,
        inventoryItemId: data.inventoryItemId,
        pickupDate,
        returnDate,
        appointmentIntent: data.appointmentIntent,
        requestedSize: data.size ?? variant?.size ?? undefined,
        requestedColor: data.color ?? variant?.color ?? undefined,
      };
    }

    return this.prisma.lead.create({
      data: {
        customerId: customer.id,
        source: data.source || 'web',
        notes: data.notes,
        status: productContext ? LeadStatus.PRODUCT_SELECTED : LeadStatus.NEW,
        productHoldStatus: ProductHoldStatus.NONE,
        depositStatus: LeadDepositStatus.NONE,
        contactDeadlineAt: new Date(Date.now() + ONE_HOUR_MS),
        productId: productContext?.productId,
        variantId: productContext?.variantId,
        inventoryItemId: productContext?.inventoryItemId,
        pickupDate: productContext?.pickupDate,
        returnDate: productContext?.returnDate,
        rentalDates: productContext
          ? this.serializeRentalDates(productContext.pickupDate, productContext.returnDate)
          : undefined,
        appointmentIntent: productContext?.appointmentIntent,
        requestedSize: productContext?.requestedSize,
        requestedColor: productContext?.requestedColor,
        quotedPrice: data.quotedPrice,
      },
      include: this.leadInclude(),
    });
  }

  async update(id: string, data: any) {
    return this.prisma.lead.update({
      where: { id },
      data,
      include: this.leadInclude(),
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

  async archive(id: string) {
    return this.prisma.lead.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
  }
}
