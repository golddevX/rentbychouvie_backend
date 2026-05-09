import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ProductStatus, UserRole } from '@prisma/client';
import { ProductsService } from './products.service';
import { RolesGuard } from '../shared/guards/roles.guard';
import { Roles } from '../shared/decorators/roles.decorator';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import { PaginationQueryDto } from '../shared/dto/pagination-query.dto';

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  async findAll(
    @Query() query: PaginationQueryDto,
    @Query('category') category?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
  ) {
    return this.productsService.findAll({
      page: query.page,
      limit: query.limit,
      sortBy: query.sortBy ?? 'createdAt',
      sortOrder: query.sortOrder ?? 'desc',
      category,
      search,
      status,
    });
  }

  @Get(':id')
  async findById(@Param('id') id: string) {
    return this.productsService.findById(id);
  }

  @Get(':id/availability')
  async getAvailability(
    @Param('id') id: string,
    @Query('pickupDate') pickupDate?: string,
    @Query('returnDate') returnDate?: string,
  ) {
    return this.productsService.getAvailability(id, pickupDate, returnDate);
  }

  @Get(':id/schedule')
  async getSchedule(@Param('id') id: string) {
    return this.productsService.getSchedule(id);
  }

  @Get(':id/qr-image')
  async getQrImage(@Param('id') id: string) {
    return this.productsService.generateQRCode(id);
  }

  @Post()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.MANAGER, UserRole.SUPER_ADMIN)
  async create(@Body() body: any, @CurrentUser() user: any) {
    return this.productsService.createProduct(body, user?.id ?? user?.sub);
  }

  @Patch(':id')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.MANAGER, UserRole.SUPER_ADMIN)
  async update(@Param('id') id: string, @Body() body: any, @CurrentUser() user: any) {
    return this.productsService.updateProduct(id, body, user?.id ?? user?.sub);
  }

  @Patch(':id/status')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.OPERATOR, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  async updateStatus(
    @Param('id') id: string,
    @Body() body: { status: string; note?: string },
    @CurrentUser() user: any,
  ) {
    const status = String(body?.status || '').toUpperCase();
    if (!Object.values(ProductStatus).includes(status as ProductStatus)) {
      throw new BadRequestException('Invalid product status');
    }
    return this.productsService.updateProductStatus(id, status as ProductStatus, body?.note, user?.id ?? user?.sub);
  }

  @Patch(':id/regenerate-qr')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.OPERATOR, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  async regenerateQr(@Param('id') id: string, @CurrentUser() user: any) {
    return this.productsService.regenerateQRCode(id, user?.id ?? user?.sub);
  }

  @Patch(':id/archive')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.MANAGER, UserRole.SUPER_ADMIN)
  async archive(@Param('id') id: string, @CurrentUser() user: any) {
    return this.productsService.archiveProduct(id, user?.id ?? user?.sub);
  }

  @Post(':id/variants')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.MANAGER, UserRole.SUPER_ADMIN)
  async createVariant(@Param('id') id: string, @Body() body: any) {
    return this.productsService.createVariant(id, body);
  }

  @Patch('variants/:id')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.MANAGER, UserRole.SUPER_ADMIN)
  async updateVariant(@Param('id') id: string, @Body() body: any) {
    return this.productsService.updateVariant(id, body);
  }

  @Patch('variants/:id/archive')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.MANAGER, UserRole.SUPER_ADMIN)
  async archiveVariant(@Param('id') id: string) {
    return this.productsService.archiveVariant(id);
  }
}
