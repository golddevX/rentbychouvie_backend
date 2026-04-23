import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import { Roles } from '../shared/decorators/roles.decorator';
import { RolesGuard } from '../shared/guards/roles.guard';
import { RentalOrdersService } from './rental-orders.service';

@Controller('rental-orders')
@UseGuards(AuthGuard('jwt'))
export class RentalOrdersController {
  constructor(private readonly rentalOrdersService: RentalOrdersService) {}

  @Get()
  async findAll(
    @Query('status') status?: string,
    @Query('paymentStatus') paymentStatus?: string,
    @Query('includeArchived') includeArchived?: string,
  ) {
    return this.rentalOrdersService.findAll({
      status,
      paymentStatus,
      includeArchived: includeArchived === 'true',
    });
  }

  @Get(':id')
  async findById(@Param('id') id: string) {
    return this.rentalOrdersService.findById(id);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.SALES, UserRole.OPERATOR, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  async create(@Body() body: any, @CurrentUser() user: any) {
    return this.rentalOrdersService.create({
      ...body,
      createdById: user?.id,
    });
  }

  @Post('availability/check')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SALES, UserRole.OPERATOR, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  async checkAvailability(
    @Body() body: { startDateTime: string; endDateTime: string; inventoryItemIds: string[]; rentalOrderId?: string },
  ) {
    if (!body?.startDateTime || !body?.endDateTime || !Array.isArray(body.inventoryItemIds)) {
      throw new BadRequestException('startDateTime, endDateTime and inventoryItemIds are required');
    }
    return this.rentalOrdersService.checkAvailability(body);
  }

  @Patch(':id/status')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SALES, UserRole.OPERATOR, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  async updateStatus(
    @Param('id') id: string,
    @Body() body: { status: string },
    @CurrentUser() user: any,
  ) {
    if (!body?.status) throw new BadRequestException('status is required');
    return this.rentalOrdersService.updateStatus(id, body.status, user?.id ?? user?.sub);
  }

  @Patch(':id/payment-status')
  @UseGuards(RolesGuard)
  @Roles(UserRole.CASHIER, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  async updatePaymentStatus(
    @Param('id') id: string,
    @Body() body: { paymentStatus: string },
    @CurrentUser() user: any,
  ) {
    if (!body?.paymentStatus) throw new BadRequestException('paymentStatus is required');
    return this.rentalOrdersService.updatePaymentStatus(id, body.paymentStatus, user?.id ?? user?.sub);
  }

  @Patch(':id/archive')
  @UseGuards(RolesGuard)
  @Roles(UserRole.MANAGER, UserRole.SUPER_ADMIN)
  async archive(@Param('id') id: string, @CurrentUser() user: any) {
    return this.rentalOrdersService.archive(id, user?.id ?? user?.sub);
  }
}
