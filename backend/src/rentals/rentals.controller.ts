import { Controller, Get, Post, Body, Param, Patch, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RentalsService } from './rentals.service';
import { Roles } from '../shared/decorators/roles.decorator';
import { RolesGuard } from '../shared/guards/roles.guard';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import { RentalStatus, UserRole } from '@prisma/client';

@Controller('rentals')
@UseGuards(AuthGuard('jwt'))
export class RentalsController {
  constructor(private readonly rentalsService: RentalsService) {}

  @Get()
  async findAll() {
    return this.rentalsService.findAll();
  }

  @Get('active')
  async findActive() {
    return this.rentalsService.findAll({ status: RentalStatus.IN_RENTAL });
  }

  @Get(':id')
  async findById(@Param('id') id: string) {
    return this.rentalsService.findById(id);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.SALES, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  async createFromBooking(@Body() body: { bookingId: string }) {
    return this.rentalsService.createFromBooking(body.bookingId);
  }

  @Post(':id/pickup')
  @UseGuards(RolesGuard)
  @Roles(UserRole.OPERATOR, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  async processPickup(
    @Param('id') id: string,
    @Body()
    body: {
      qrCodes: string[];
      conditionNotes?: string;
    },
    @CurrentUser() user: any,
  ) {
    return this.rentalsService.processPickup(
      id,
      body.qrCodes,
      user.id,
      body.conditionNotes,
    );
  }

  @Post(':id/return')
  @UseGuards(RolesGuard)
  @Roles(UserRole.OPERATOR, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  async processReturn(
    @Param('id') id: string,
    @Body()
    body: {
      qrCodes: string[];
      conditionNotes?: string;
      damageAmount?: number;
    },
    @CurrentUser() user: any,
  ) {
    return this.rentalsService.processReturn(
      id,
      body.qrCodes,
      user.id,
      body.conditionNotes,
      body.damageAmount,
    );
  }

  @Post(':id/return/settlement')
  @UseGuards(RolesGuard)
  @Roles(UserRole.OPERATOR, UserRole.CASHIER, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  async calculateReturnSettlement(
    @Param('id') id: string,
    @Body()
    body: {
      condition?: 'clean' | 'dirty' | 'damaged' | 'incomplete';
      actualReturnDate?: string;
      accessoryLostValues?: number[];
      affectsNextBooking?: boolean;
    },
  ) {
    return this.rentalsService.calculateReturnSettlement(id, body);
  }

  @Patch(':id/confirm-payment')
  @UseGuards(RolesGuard)
  @Roles(UserRole.CASHIER, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  async confirmPayment(@Param('id') id: string) {
    return this.rentalsService.confirmPayment(id);
  }

  @Patch(':id/complete')
  @UseGuards(RolesGuard)
  @Roles(UserRole.MANAGER, UserRole.SUPER_ADMIN)
  async completeRental(@Param('id') id: string) {
    return this.rentalsService.completeRental(id);
  }
}
