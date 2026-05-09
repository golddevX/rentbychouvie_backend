import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { LeadAppointmentIntent } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LeadsService } from '../leads/leads.service';
import { ProductsService } from '../products/products.service';
import { ProductAvailabilityService } from '../products/product-availability.service';
import { SiteSettingsService } from '../site-settings/site-settings.service';
import { CreatePublicLeadDto } from './dto/create-public-lead.dto';

@Injectable()
export class PublicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly productsService: ProductsService,
    private readonly leadsService: LeadsService,
    private readonly productAvailabilityService: ProductAvailabilityService,
    private readonly siteSettingsService: SiteSettingsService,
  ) {}

  private slugify(value: string) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  private isUnavailableStatus(status?: string | null) {
    return ['maintenance', 'damaged', 'retired'].includes(String(status || '').toLowerCase());
  }

  private sanitizePhone(phone: string) {
    return phone.replace(/[^\d+]/g, '');
  }

  private fallbackEmail(phone: string) {
    const digits = this.sanitizePhone(phone).replace(/[^\d]/g, '') || 'guest';
    return `lead-${digits}@website.local`;
  }

  private composeLeadNote(dto: CreatePublicLeadDto) {
    const lines = [
      dto.note?.trim() || null,
      dto.height ? `Height: ${dto.height}` : null,
      dto.weight ? `Weight: ${dto.weight}` : null,
      dto.measurements?.trim() ? `Measurements: ${dto.measurements.trim()}` : null,
      dto.faceImage?.trim() ? `Face image: ${dto.faceImage.trim()}` : null,
    ].filter(Boolean) as string[];

    return lines.join('\n');
  }

  private mapProductSummary(product: any) {
    return {
      id: product.id,
      slug: this.slugify(product.name) || product.id,
      name: product.name,
      description: product.description || '',
      category: product.category,
      image: product.image,
      images: product.images ?? (product.image ? [product.image] : []),
      rentalPrice: Number(product.rentalPrice ?? product.price ?? 0),
      productValue: Number(product.productValue ?? product.price ?? 0),
      status: String(product.status ?? 'available').toLowerCase(),
      manualStatus: String(product.manualStatus ?? product.status ?? 'available').toLowerCase(),
      size: product.size ?? null,
      color: product.color ?? null,
      accessories: product.accessories ?? null,
      nextAvailableDate: product.nextAvailableDate ?? null,
      nearestSchedule: product.nearestSchedule ?? null,
      availability: null,
    };
  }

  private mapProductDetail(product: any, relatedProducts: any[]) {
    return {
      ...this.mapProductSummary(product),
      summary: product.summary ?? null,
      availability: product.availability ?? null,
      variants: Array.isArray(product.variants) ? product.variants : [],
      relatedProducts: relatedProducts.map((item) => this.mapProductSummary(item)),
    };
  }

  private async resolveProductId(idOrSlug: string) {
    const direct = await this.prisma.product.findFirst({
      where: {
        id: idOrSlug,
        archivedAt: null,
        isActive: true,
      },
      select: { id: true },
    });

    if (direct) {
      return direct.id;
    }

    const candidates = await this.prisma.product.findMany({
      where: {
        archivedAt: null,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
      },
    });

    const match = candidates.find((item) => this.slugify(item.name) === idOrSlug);
    if (!match) {
      throw new NotFoundException('Product not found');
    }

    return match.id;
  }

  async getClientSettings() {
    return this.siteSettingsService.getPublicClientSettings();
  }

  async listProducts(query?: {
    category?: string;
    search?: string;
    status?: string;
  }) {
    const result = await this.productsService.findAll({
      category: query?.category,
      search: query?.search,
      status: query?.status,
      limit: 100,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });

    return result.data.map((product) => this.mapProductSummary(product));
  }

  async getProduct(idOrSlug: string) {
    const id = await this.resolveProductId(idOrSlug);
    const product = await this.productsService.findById(id);
    const related = await this.productsService.findAll({
      category: product.category,
      limit: 8,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });

    return this.mapProductDetail(
      product,
      related.data.filter((item) => item.id !== product.id).slice(0, 4),
    );
  }

  async getProductAvailability(idOrSlug: string, pickupDate?: string, returnDate?: string) {
    const id = await this.resolveProductId(idOrSlug);
    const response = await this.productsService.getAvailability(id, pickupDate, returnDate);

    return {
      ...response,
      product: this.mapProductSummary(response.product),
    };
  }

  async createLead(dto: CreatePublicLeadDto) {
    const pickupDate = new Date(dto.pickupDate);
    const returnDate = new Date(dto.returnDate);
    if (Number.isNaN(pickupDate.getTime()) || Number.isNaN(returnDate.getTime())) {
      throw new BadRequestException('Invalid pickup or return date');
    }
    if (returnDate.getTime() <= pickupDate.getTime()) {
      throw new BadRequestException('Return date must be after pickup date');
    }

    const uniqueProductIds = Array.from(new Set(dto.productIds.filter(Boolean)));
    if (!uniqueProductIds.length) {
      throw new BadRequestException('At least one product is required');
    }
    if (dto.selectedDepositType === 'custom_amount' && !Number(dto.customDepositAmount)) {
      throw new BadRequestException('Custom deposit amount is required');
    }

    const products = await this.prisma.product.findMany({
      where: {
        id: { in: uniqueProductIds },
        archivedAt: null,
        isActive: true,
      },
      select: {
        id: true,
        status: true,
      },
    });

    if (products.length !== uniqueProductIds.length) {
      throw new BadRequestException('One or more selected products were not found');
    }

    for (const product of products) {
      if (this.isUnavailableStatus(String(product.status).toLowerCase())) {
        throw new BadRequestException(`Product ${product.id} is not available`);
      }
      const availability = await this.productAvailabilityService.checkAvailability(
        product.id,
        pickupDate,
        returnDate,
      );
      if (!availability.available) {
        throw new BadRequestException(`Product ${product.id} is unavailable for selected dates`);
      }
    }

    const lead = await this.leadsService.create({
      email: dto.email?.trim() || this.fallbackEmail(dto.phone),
      name: dto.customerName.trim(),
      phone: dto.phone.trim(),
      source: dto.source?.trim() || 'website',
      notes: this.composeLeadNote(dto),
      productIds: uniqueProductIds,
      pickupDate: pickupDate.toISOString(),
      returnDate: returnDate.toISOString(),
      appointmentIntent: dto.appointmentIntent as LeadAppointmentIntent,
      depositType: dto.selectedDepositType,
      selectedDepositRate: dto.selectedDepositRate ?? undefined,
      customDepositAmount: dto.customDepositAmount ?? undefined,
    });

    return {
      id: lead.id,
      status: lead.status,
      source: lead.source,
      customer: lead.customer,
      pickupDate: lead.pickupDate,
      returnDate: lead.returnDate,
      appointmentIntent: lead.appointmentIntent,
      selectedDepositType:
        lead.selectedDepositType === 'CUSTOM_AMOUNT' ? 'custom_amount' : 'percent',
      selectedDepositRate: lead.selectedDepositRate,
      customDepositAmount: lead.customDepositAmount,
      depositRequired: lead.depositAmountRequired,
      productCount: lead.items?.length ?? 0,
      productIds: lead.items?.map((item) => item.productId) ?? [],
    };
  }
}
