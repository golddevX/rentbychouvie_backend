import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, BookingStatus, Prisma, ProductStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProductAvailabilityService, ProductScheduleSlot } from './product-availability.service';
import { AuditDisputesService } from '../audit-disputes/audit-disputes.service';
import * as QRCode from 'qrcode';
import { v4 as uuidv4 } from 'uuid';
import { buildPaginatedResult, resolvePagination } from '../shared/pagination';

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly availabilityService: ProductAvailabilityService,
    private readonly auditDisputesService: AuditDisputesService,
  ) {}

  private parseImageList(value?: string | null, fallback?: string | null) {
    const values = [value, fallback].filter(Boolean) as string[];
    for (const candidate of values) {
      try {
        const parsed = JSON.parse(candidate);
        if (Array.isArray(parsed)) {
          return parsed.map((entry) => String(entry || '').trim()).filter(Boolean);
        }
      } catch {
        // keep legacy single image string as-is
      }
      if (candidate.trim()) {
        return [candidate.trim()];
      }
    }
    return [] as string[];
  }

  private toNumber(value: Prisma.Decimal | number | string | null | undefined) {
    return Number(value ?? 0);
  }

  private normalizeStatus(status: ProductStatus | string | null | undefined) {
    return String(status ?? ProductStatus.AVAILABLE).toLowerCase();
  }

  private selectOptionVariant(
    product: {
      id: string;
      code: string | null;
      variants?: Array<{
        id: string;
        name: string;
        sku: string;
        size: string | null;
        color: string | null;
        material: string | null;
        imageUrls: string | null;
      }>;
    },
  ) {
    const defaultSku = `${product.code ?? product.id}-DEFAULT`;
    return (
      product.variants?.find((variant) => variant.sku === defaultSku)
      ?? product.variants?.[0]
      ?? null
    );
  }

  private deriveOperationalStatus(
    product: { status: ProductStatus | string | null },
    schedule: ProductScheduleSlot[],
  ) {
    const manualStatus = String(product.status ?? ProductStatus.AVAILABLE).toUpperCase();
    if (['MAINTENANCE', 'DAMAGED', 'RETIRED'].includes(manualStatus)) {
      return manualStatus.toLowerCase();
    }

    const now = new Date();
    const activeBooking = schedule.find((slot) =>
      slot.sourceType === 'booking'
      && slot.startDate <= now
      && slot.endDate > now
      && ['picked_up', 'return_pending'].includes(slot.status),
    );
    if (activeBooking) {
      return 'rented';
    }

    const activeHold = schedule.find((slot) =>
      ['lead', 'booking'].includes(slot.sourceType)
      && slot.endDate > now,
    );
    if (activeHold) {
      return 'reserved';
    }

    return 'available';
  }

  private deriveNextAction(status: string, nearestSlot: ProductScheduleSlot | null) {
    if (status === 'maintenance' || status === 'damaged') return 'review_maintenance';
    if (status === 'retired') return 'retired';
    if (status === 'rented') return 'open_booking';
    if (status === 'reserved') {
      return nearestSlot?.sourceType === 'lead' ? 'open_lead' : 'open_booking';
    }
    return 'quick_lead';
  }

  private productCore(product: any, schedule: ProductScheduleSlot[]) {
    const primaryVariant = this.selectOptionVariant(product);
    const images = this.parseImageList(product.image, primaryVariant?.imageUrls ?? null);
    const nearestSlot = schedule.find((slot) => slot.endDate >= new Date()) ?? null;
    const operationalStatus = this.deriveOperationalStatus(product, schedule);
    const nextAvailableSlot = schedule.find((slot) => slot.endDate > new Date());

    return {
      id: product.id,
      code: product.code ?? product.id,
      qrCode: product.qrCode ?? product.code ?? product.id,
      name: product.name,
      description: product.description ?? '',
      category: product.category,
      images,
      image: images[0] ?? null,
      productValue: this.toNumber(product.productValue ?? product.price),
      rentalPrice: this.toNumber(product.rentalPrice ?? product.price),
      size: primaryVariant?.size ?? null,
      color: primaryVariant?.color ?? null,
      accessories: primaryVariant?.material ?? null,
      note: null,
      status: operationalStatus,
      manualStatus: this.normalizeStatus(product.status),
      nearestSchedule: nearestSlot
        ? {
            sourceType: nearestSlot.sourceType,
            sourceId: nearestSlot.sourceId,
            status: nearestSlot.status,
            startDate: nearestSlot.startDate,
            endDate: nearestSlot.endDate,
            customerName: nearestSlot.customerName ?? null,
            customerPhone: nearestSlot.customerPhone ?? null,
            leadId: nearestSlot.leadId ?? null,
            bookingId: nearestSlot.bookingId ?? null,
            reason: nearestSlot.reason ?? null,
          }
        : null,
      nextAvailableDate: nextAvailableSlot?.endDate ?? null,
      nextAction: this.deriveNextAction(operationalStatus, nearestSlot),
      canCreateLead: operationalStatus === 'available',
      variants: (product.variants ?? []).map((variant: any) => ({
        ...variant,
        imageUrls: this.parseImageList(variant.imageUrls),
      })),
    };
  }

  private async loadProductOrThrow(id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, isActive: true, archivedAt: null },
      include: {
        variants: {
          where: { archivedAt: null, isActive: true },
          orderBy: { createdAt: 'asc' },
        },
        inventoryItems: {
          where: { archivedAt: null },
          select: {
            id: true,
            qrCode: true,
            serialNumber: true,
            status: true,
            condition: true,
            imageUrls: true,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return product;
  }

  private async syncOptionVariant(
    tx: Prisma.TransactionClient,
    product: { id: string; code: string | null; name: string },
    input: { size?: string; color?: string; accessories?: string; images?: string[] },
  ) {
    const hasOptionData = [input.size, input.color, input.accessories].some((value) => Boolean(String(value ?? '').trim()));
    if (!hasOptionData) {
      return null;
    }

    const defaultSku = `${product.code ?? product.id}-DEFAULT`;
    const existing = await tx.productVariant.findFirst({
      where: {
        productId: product.id,
        archivedAt: null,
        OR: [
          { sku: defaultSku },
          { name: 'Default option' },
        ],
      },
    });

    const data = {
      productId: product.id,
      name: existing?.name ?? 'Default option',
      sku: existing?.sku ?? defaultSku,
      size: input.size?.trim() || null,
      color: input.color?.trim() || null,
      material: input.accessories?.trim() || null,
      imageUrls: input.images?.length ? JSON.stringify(input.images) : existing?.imageUrls ?? null,
    };

    if (existing) {
      return tx.productVariant.update({
        where: { id: existing.id },
        data,
      });
    }

    return tx.productVariant.create({ data });
  }

  async findAll(filters?: {
    category?: string;
    search?: string;
    status?: string;
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }) {
    const products = await this.prisma.product.findMany({
      where: {
        isActive: true,
        archivedAt: null,
        category: filters?.category,
        ...(filters?.search
          ? {
              OR: [
                { name: { contains: filters.search, mode: 'insensitive' } },
                { description: { contains: filters.search, mode: 'insensitive' } },
                { code: { contains: filters.search, mode: 'insensitive' } },
                { qrCode: { contains: filters.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: {
        variants: { where: { archivedAt: null, isActive: true }, orderBy: { createdAt: 'asc' } },
        inventoryItems: {
          where: { archivedAt: null },
          select: {
            id: true,
            qrCode: true,
            serialNumber: true,
            status: true,
            condition: true,
            imageUrls: true,
          },
        },
      },
    });

    const mapped = await Promise.all(products.map(async (product) => {
      const schedule = await this.availabilityService.getProductSchedule(product.id);
      const core = this.productCore(product, schedule);

      const rentalCount = await this.prisma.bookingItem.count({
        where: {
          productId: product.id,
          booking: { archivedAt: null },
        },
      });
      const bookingItems = await this.prisma.bookingItem.findMany({
        where: {
          productId: product.id,
          booking: { archivedAt: null },
        },
        select: {
          rentalPriceAtTime: true,
          pricePerDay: true,
        },
      });
      const revenue = bookingItems.reduce((sum, item) => (
        sum + Math.max(this.toNumber(item.rentalPriceAtTime), this.toNumber(item.pricePerDay), 0)
      ), 0);

      return {
        ...core,
        rentalCount,
        revenue,
        createdAt: product.createdAt,
        updatedAt: product.updatedAt,
      };
    }));

    const filtered = (!filters?.status || filters.status === 'all')
      ? mapped
      : mapped.filter((product) => product.status === String(filters.status).toLowerCase());
    const sortBy = ['createdAt', 'updatedAt', 'name', 'rentalCount', 'revenue'].includes(String(filters?.sortBy))
      ? String(filters?.sortBy)
      : 'createdAt';
    const sortOrder = filters?.sortOrder === 'asc' ? 'asc' : 'desc';
    const sorted = [...filtered].sort((a: any, b: any) => {
      const left = a?.[sortBy];
      const right = b?.[sortBy];
      if (left == null && right == null) return 0;
      if (left == null) return sortOrder === 'asc' ? -1 : 1;
      if (right == null) return sortOrder === 'asc' ? 1 : -1;
      if (left instanceof Date && right instanceof Date) {
        return sortOrder === 'asc' ? left.getTime() - right.getTime() : right.getTime() - left.getTime();
      }
      if (typeof left === 'number' && typeof right === 'number') {
        return sortOrder === 'asc' ? left - right : right - left;
      }
      return sortOrder === 'asc'
        ? String(left).localeCompare(String(right))
        : String(right).localeCompare(String(left));
    });
    const { page, limit, skip, take } = resolvePagination(filters);
    return buildPaginatedResult(sorted.slice(skip, skip + take), {
      page,
      limit,
      total: sorted.length,
    });
  }

  async findById(id: string) {
    const product = await this.loadProductOrThrow(id);
    const [schedule, relatedLeadItems, relatedBookingItems, maintenanceBlocks] = await Promise.all([
      this.availabilityService.getProductSchedule(id),
      this.prisma.leadItem.findMany({
        where: {
          productId: id,
          lead: {
            archivedAt: null,
          },
        },
        include: {
          lead: {
            include: {
              customer: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
      this.prisma.bookingItem.findMany({
        where: {
          productId: id,
          booking: {
            archivedAt: null,
          },
        },
        include: {
          booking: {
            include: {
              customer: true,
            },
          },
        },
        orderBy: { booking: { createdAt: 'desc' } },
        take: 8,
      }),
      this.prisma.calendarBlock.findMany({
        where: {
          inventoryItemId: {
            in: product.inventoryItems.map((item) => item.id),
          },
        },
        orderBy: { startDate: 'desc' },
        take: 8,
      }),
    ]);

    const core = this.productCore(product, schedule);
    const bookingItemRows = await this.prisma.bookingItem.findMany({
      where: {
        productId: id,
        booking: { archivedAt: null },
      },
      select: {
        rentalPriceAtTime: true,
        pricePerDay: true,
      },
    });

    return {
      ...core,
      totalItems: product.inventoryItems.length,
      inventoryItems: product.inventoryItems.map((item) => ({
        ...item,
        imageUrls: this.parseImageList(item.imageUrls),
        status: String(item.status).toLowerCase(),
      })),
      summary: {
        rentalCount: relatedBookingItems.length,
        revenue: bookingItemRows.reduce((sum, item) => (
          sum + Math.max(this.toNumber(item.rentalPriceAtTime), this.toNumber(item.pricePerDay), 0)
        ), 0),
        scheduleState: core.status,
        todayAvailable: core.status === 'available',
      },
      availability: {
        todayAvailable: core.status === 'available',
        nextAvailableDate: await this.availabilityService.getNextAvailableDate(id),
        reservedSlots: schedule,
        availableSlots: await this.availabilityService.getAvailableSlots(id),
      },
      relatedLeads: relatedLeadItems.map((item) => ({
        id: item.lead.id,
        status: String(item.lead.status).toLowerCase(),
        customerName: item.lead.customer.name,
        customerPhone: item.lead.customer.phone,
        pickupDate: item.lead.pickupDate,
        returnDate: item.lead.returnDate,
      })),
      relatedBookings: relatedBookingItems.map((item) => ({
        id: item.booking.id,
        status: String(item.booking.status).toLowerCase(),
        customerName: item.booking.customer.name,
        customerPhone: item.booking.customer.phone,
        pickupDate: item.booking.pickupDate ?? item.booking.startDate,
        returnDate: item.booking.returnDate ?? item.booking.endDate,
      })),
      maintenanceBlocks: maintenanceBlocks.map((block) => ({
        id: block.id,
        reason: block.reason,
        startDate: block.startDate,
        endDate: block.endDate,
      })),
    };
  }

  async findByCodeOrQr(code: string) {
    const product = await this.prisma.product.findFirst({
      where: {
        archivedAt: null,
        isActive: true,
        OR: [
          { qrCode: code },
          { code },
        ],
      },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return this.findById(product.id);
  }

  async getAvailability(productId: string, pickupDate?: string, returnDate?: string) {
    const product = await this.loadProductOrThrow(productId);
    const schedule = await this.availabilityService.getProductSchedule(productId);
    const core = this.productCore(product, schedule);
    const nextAvailableDate = await this.availabilityService.getNextAvailableDate(productId);
    const explicitCheck = pickupDate && returnDate
      ? await this.availabilityService.checkAvailability(productId, new Date(pickupDate), new Date(returnDate))
      : null;

    return {
      product: core,
      availability: {
        todayAvailable: core.status === 'available',
        reservedSlots: schedule,
        nextAvailableDate,
        explicitCheck,
      },
    };
  }

  async getSchedule(productId: string) {
    await this.loadProductOrThrow(productId);
    const [reservedSlots, availableSlots, nextAvailableDate] = await Promise.all([
      this.availabilityService.getProductSchedule(productId),
      this.availabilityService.getAvailableSlots(productId),
      this.availabilityService.getNextAvailableDate(productId),
    ]);

    return {
      reservedSlots,
      availableSlots,
      nextAvailableDate,
    };
  }

  async generateQRCode(productId: string) {
    const product = await this.loadProductOrThrow(productId);
    return QRCode.toDataURL(product.qrCode ?? product.code ?? product.id);
  }

  async regenerateQRCode(productId: string, actorId?: string) {
    const before = await this.loadProductOrThrow(productId);
    const updated = await this.prisma.product.update({
      where: { id: productId },
      data: {
        qrCode: uuidv4(),
      },
    });

    await this.auditDisputesService.log({
      action: AuditAction.UPDATE,
      entity: 'Product',
      entityId: productId,
      actorId,
      summary: `Regenerated product QR for ${before.name}`,
      before: {
        qrCode: before.qrCode,
      },
      after: {
        qrCode: updated.qrCode,
      },
    });

    return this.findById(productId);
  }

  async createProduct(data: any, actorId?: string) {
    const images = Array.isArray(data?.images)
      ? data.images.map((entry: unknown) => String(entry || '').trim()).filter(Boolean)
      : [];

    const created = await this.prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          code: data?.code?.trim() || undefined,
          qrCode: data?.qrCode?.trim() || data?.code?.trim() || uuidv4(),
          name: String(data?.name || '').trim(),
          description: data?.description?.trim() || null,
          category: String(data?.category || 'general').trim(),
          price: this.toNumber(data?.rentalPrice),
          productValue: this.toNumber(data?.productValue),
          rentalPrice: this.toNumber(data?.rentalPrice),
          image: images.length ? JSON.stringify(images) : null,
          status: Object.values(ProductStatus).includes(String(data?.status || '').toUpperCase() as ProductStatus)
            ? String(data?.status).toUpperCase() as ProductStatus
            : ProductStatus.AVAILABLE,
        },
      });

      await this.syncOptionVariant(tx, product, {
        size: data?.size,
        color: data?.color,
        accessories: data?.accessories,
        images,
      });

      await this.auditDisputesService.log({
        action: AuditAction.CREATE,
        entity: 'Product',
        entityId: product.id,
        actorId,
        summary: `Created product ${product.name}`,
        after: product,
      }, tx);

      return product;
    });

    return this.findById(created.id);
  }

  async updateProduct(id: string, data: any, actorId?: string) {
    const before = await this.loadProductOrThrow(id);
    const images = Array.isArray(data?.images)
      ? data.images.map((entry: unknown) => String(entry || '').trim()).filter(Boolean)
      : undefined;

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.product.update({
        where: { id },
        data: {
          code: data?.code === undefined ? undefined : (data.code?.trim() || null),
          qrCode: data?.qrCode === undefined ? undefined : (data.qrCode?.trim() || null),
          name: data?.name === undefined ? undefined : String(data.name || '').trim(),
          description: data?.description === undefined ? undefined : (data.description?.trim() || null),
          category: data?.category === undefined ? undefined : String(data.category || '').trim(),
          price: data?.rentalPrice === undefined ? undefined : this.toNumber(data?.rentalPrice),
          productValue: data?.productValue === undefined ? undefined : this.toNumber(data?.productValue),
          rentalPrice: data?.rentalPrice === undefined ? undefined : this.toNumber(data?.rentalPrice),
          image: images === undefined ? undefined : (images.length ? JSON.stringify(images) : null),
          status: data?.status && Object.values(ProductStatus).includes(String(data.status).toUpperCase() as ProductStatus)
            ? String(data.status).toUpperCase() as ProductStatus
            : undefined,
        },
      });

      await this.syncOptionVariant(tx, updated, {
        size: data?.size,
        color: data?.color,
        accessories: data?.accessories,
        images,
      });

      await this.auditDisputesService.log({
        action: AuditAction.UPDATE,
        entity: 'Product',
        entityId: id,
        actorId,
        summary: `Updated product ${updated.name}`,
        before,
        after: updated,
      }, tx);
    });

    return this.findById(id);
  }

  async updateProductStatus(id: string, status: ProductStatus, note?: string, actorId?: string) {
    const before = await this.loadProductOrThrow(id);
    await this.prisma.product.update({
      where: { id },
      data: { status },
    });

    await this.auditDisputesService.log({
      action: AuditAction.STATUS_CHANGE,
      entity: 'Product',
      entityId: id,
      actorId,
      summary: `Product status changed to ${status}`,
      before: { status: before.status },
      after: { status },
      metadata: { note },
    });

    return this.findById(id);
  }

  async archiveProduct(id: string, actorId?: string) {
    const before = await this.loadProductOrThrow(id);
    await this.prisma.product.update({
      where: { id },
      data: {
        archivedAt: new Date(),
        isActive: false,
        status: ProductStatus.RETIRED,
      },
    });

    await this.auditDisputesService.log({
      action: AuditAction.ARCHIVE,
      entity: 'Product',
      entityId: id,
      actorId,
      summary: `Archived product ${before.name}`,
      before,
      after: { archivedAt: new Date(), status: ProductStatus.RETIRED },
    });

    return { success: true };
  }

  async resolveScanProfile(code: string) {
    const product = await this.prisma.product.findFirst({
      where: {
        archivedAt: null,
        isActive: true,
        OR: [
          { qrCode: code },
          { code },
        ],
      },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return this.getAvailability(product.id);
  }

  async createVariant(productId: string, data: {
    name: string;
    sku: string;
    size?: string;
    color?: string;
    material?: string;
    imageUrls?: string[];
  }) {
    await this.findById(productId);
    return this.prisma.productVariant.create({
      data: {
        productId,
        name: data.name,
        sku: data.sku,
        size: data.size,
        color: data.color,
        material: data.material,
        imageUrls: data.imageUrls ? JSON.stringify(data.imageUrls) : undefined,
      },
    });
  }

  async updateVariant(id: string, data: any) {
    return this.prisma.productVariant.update({
      where: { id },
      data: {
        ...data,
        imageUrls: Array.isArray(data.imageUrls)
          ? JSON.stringify(data.imageUrls)
          : data.imageUrls,
      },
    });
  }

  async archiveVariant(id: string) {
    return this.prisma.productVariant.update({
      where: { id },
      data: { archivedAt: new Date(), isActive: false },
    });
  }
}
