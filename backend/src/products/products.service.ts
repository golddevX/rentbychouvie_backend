import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  async findAll(filters?: { category?: string; search?: string }) {
    return this.prisma.product.findMany({
      where: {
        isActive: true,
        category: filters?.category,
        ...(filters?.search
          ? {
              OR: [
                { name: { contains: filters.search, mode: 'insensitive' } },
                { description: { contains: filters.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: { variants: { where: { archivedAt: null, isActive: true } } },
    });
  }

  async findById(id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, isActive: true },
      include: {
        variants: { where: { archivedAt: null, isActive: true } },
        inventoryItems: {
          where: { status: 'AVAILABLE' },
          select: { id: true, status: true, variantId: true },
        },
      },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return product;
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
