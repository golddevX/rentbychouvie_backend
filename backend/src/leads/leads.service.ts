import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LeadAppointmentIntent, LeadDepositStatus, LeadDepositType, LeadStatus, Prisma, ProductHoldStatus } from '@prisma/client';
import { buildPaginatedResult, resolvePagination } from '../shared/pagination';
import { RentalPricingService } from '../pricing/rental-pricing.service';

const ONE_HOUR_MS = 60 * 60 * 1000;

@Injectable()
export class LeadsService {
  constructor(
    private prisma: PrismaService,
    private readonly rentalPricingService: RentalPricingService,
  ) {}

  private isReasonableEntityId(value?: string | null) {
    if (typeof value !== 'string') return false;
    const normalized = value.trim();
    if (!normalized || normalized.length > 120) return false;
    if (normalized.startsWith('data:') || normalized.startsWith('[') || normalized.includes('base64,')) return false;
    return true;
  }

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
      items: {
        include: {
          product: true,
          inventoryItem: {
            include: {
              product: true,
              variant: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' as const },
      },
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
    const bookingId = this.isReasonableEntityId(lead.bookingId)
      ? lead.bookingId ?? undefined
      : this.isReasonableEntityId(lead.convertedToBookingId)
        ? lead.convertedToBookingId ?? undefined
        : undefined;
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
      bookingId: booking?.id ?? null,
      convertedToBookingId: booking?.id ?? null,
      appointment,
      booking,
    };
  }

  async findAll(filters?: {
    status?: LeadStatus;
    assignedToId?: string;
    source?: string;
    page?: number;
    limit?: number;
    search?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    dateFrom?: string;
    dateTo?: string;
  }) {
    const { page, limit, skip, take } = resolvePagination(filters);
    const sortBy = ['createdAt', 'updatedAt', 'contactDeadlineAt', 'depositDeadlineAt'].includes(String(filters?.sortBy))
      ? String(filters?.sortBy)
      : 'createdAt';
    const sortOrder = filters?.sortOrder === 'asc' ? 'asc' : 'desc';
    const normalizedSearch = String(filters?.search ?? '').trim();
    const dateFrom = filters?.dateFrom ? new Date(filters.dateFrom) : undefined;
    const dateTo = filters?.dateTo ? new Date(filters.dateTo) : undefined;
    const where: Prisma.LeadWhereInput = {
      archivedAt: null,
      status: filters?.status,
      assignedToId: filters?.assignedToId,
      source: filters?.source,
      ...(normalizedSearch
        ? {
            OR: [
              { notes: { contains: normalizedSearch, mode: 'insensitive' } },
              { source: { contains: normalizedSearch, mode: 'insensitive' } },
              { customer: { name: { contains: normalizedSearch, mode: 'insensitive' } } },
              { customer: { email: { contains: normalizedSearch, mode: 'insensitive' } } },
              { customer: { phone: { contains: normalizedSearch, mode: 'insensitive' } } },
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

    const [total, leads] = await Promise.all([
      this.prisma.lead.count({ where }),
      this.prisma.lead.findMany({
        where,
        include: this.leadInclude(),
        orderBy: { [sortBy]: sortOrder },
        skip,
        take,
      }),
    ]);

    const data = await Promise.all(leads.map((lead) => this.decorateLead(lead)));
    return buildPaginatedResult(data, { page, limit, total });
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
    productIds?: string[];
    variantId?: string;
    size?: string;
    color?: string;
    pickupDate?: string;
    returnDate?: string;
    appointmentIntent?: LeadAppointmentIntent;
    quotedPrice?: number;
    depositType?: 'percent' | 'custom_amount';
    selectedDepositRate?: number;
    customDepositAmount?: number;
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
          primaryProductId: string;
          selectedProducts: Array<any>;
          pickupDate?: Date;
          returnDate?: Date;
          appointmentIntent?: LeadAppointmentIntent;
          requestedSize?: string;
          requestedColor?: string;
          quotedPrice?: number;
        }
      | undefined;

    const requestedProductIds = Array.from(
      new Set(
        [
          ...(Array.isArray(data.productIds) ? data.productIds : []),
          ...(data.productId ? [data.productId] : []),
        ].filter(Boolean),
      ),
    );

    if (requestedProductIds.length > 0) {
      const selectedProducts = requestedProductIds.length > 0
        ? await this.prisma.product.findMany({
            where: {
              id: { in: requestedProductIds },
              archivedAt: null,
            },
            select: {
              id: true,
              name: true,
              productValue: true,
              rentalPrice: true,
              price: true,
            },
          })
        : [];
      if (selectedProducts.length !== requestedProductIds.length) {
        throw new BadRequestException('One or more selected products were not found');
      }
      const hasRentalSchedule = Boolean(data.pickupDate && data.returnDate && data.appointmentIntent);
      const pickupDate = hasRentalSchedule ? new Date(data.pickupDate!) : undefined;
      const returnDate = hasRentalSchedule ? new Date(data.returnDate!) : undefined;
      if (data.pickupDate || data.returnDate || data.appointmentIntent) {
        if (!hasRentalSchedule) {
          throw new BadRequestException('Product selection requires pickup date, return date, and appointment intent');
        }
        if (!pickupDate || !returnDate || Number.isNaN(pickupDate.getTime()) || Number.isNaN(returnDate.getTime())) {
          throw new BadRequestException('Invalid pickup or return date');
        }
        if (returnDate.getTime() <= pickupDate.getTime()) {
          throw new BadRequestException('Return date must be after pickup date');
        }
      }

      productContext = {
        primaryProductId: selectedProducts[0].id,
        selectedProducts,
        pickupDate,
        returnDate,
        appointmentIntent: hasRentalSchedule ? data.appointmentIntent : undefined,
        requestedSize: data.size,
        requestedColor: data.color,
        quotedPrice:
          data.quotedPrice
          ?? selectedProducts.reduce(
            (sum, product) => sum + Math.max(Number(product.rentalPrice || product.price || 0), 0),
            0,
          ),
      };
    }

    const totalProductValue = productContext?.selectedProducts.reduce(
      (sum, product) => sum + Math.max(Number(product.productValue ?? product.price ?? 0), 0),
      0,
    ) ?? 0;
    const requestedDeposit = this.rentalPricingService.calculateRequestedDeposit({
      productValue: totalProductValue,
      depositType: data.depositType,
      depositRate: data.selectedDepositRate,
      customAmount: data.customDepositAmount,
    });

    return this.prisma.lead.create({
      data: {
        customerId: customer.id,
        source: data.source || 'web',
        notes: data.notes,
        status: productContext ? LeadStatus.PRODUCT_SELECTED : LeadStatus.NEW,
        productHoldStatus: ProductHoldStatus.NONE,
        depositStatus: LeadDepositStatus.NONE,
        contactDeadlineAt: new Date(Date.now() + ONE_HOUR_MS),
        depositAmountRequired: requestedDeposit.requiredAmount,
        productId: productContext?.primaryProductId,
        inventoryItemId: null,
        selectedDepositType: requestedDeposit.depositType === 'custom_amount' ? LeadDepositType.CUSTOM_AMOUNT : LeadDepositType.PERCENT,
        selectedDepositRate: Number(requestedDeposit.selectedDepositRate ?? 50),
        customDepositAmount: requestedDeposit.customAmount,
        pickupDate: productContext?.pickupDate,
        returnDate: productContext?.returnDate,
        rentalDates: productContext?.pickupDate && productContext?.returnDate
          ? this.serializeRentalDates(productContext.pickupDate, productContext.returnDate)
          : undefined,
        appointmentIntent: productContext?.appointmentIntent,
        requestedSize: productContext?.requestedSize,
        requestedColor: productContext?.requestedColor,
        quotedPrice: productContext?.quotedPrice ?? data.quotedPrice,
        items: productContext
          ? {
              create: productContext.selectedProducts.map((product) => {
                return {
                  productId: product.id,
                  inventoryItemId: null,
                  productNameAtTime: product.name ?? null,
                  productValueAtTime: Math.max(
                    Number(product.productValue ?? 0),
                    Number(product.price ?? 0),
                    0,
                  ),
                  rentalPriceAtTime: Math.max(
                    Number(product.rentalPrice ?? 0),
                    Number(product.price ?? 0),
                    0,
                  ),
                  status: 'REQUESTED' as const,
                };
              }),
            }
          : undefined,
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
