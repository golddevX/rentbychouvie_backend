import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  UseGuards,
  Query,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { BookingsService } from './bookings.service';
import { Roles } from '../shared/decorators/roles.decorator';
import { RolesGuard } from '../shared/guards/roles.guard';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import { BookingStatus, PaymentMethod, UserRole } from '@prisma/client';
import {
  ConfirmBookingDto,
  CreateBookingDto,
  RecordBookingDepositDto,
  UpdateBookingStatusDto,
} from './dto/booking.dto';

@ApiTags('Booking')
@ApiBearerAuth()
@Controller('bookings')
@UseGuards(AuthGuard('jwt'))
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Get()
  @ApiOperation({
    summary: 'List bookings',
    description: 'Operations view of bookings with customer, reserved items, rental, and payments.',
  })
  @ApiQuery({ name: 'status', enum: BookingStatus, required: false })
  async findAll(@Query('status') status?: string) {
    if (status && !Object.values(BookingStatus).includes(status as BookingStatus)) {
      throw new BadRequestException('Invalid booking status');
    }

    return this.bookingsService.findAll({
      status: status as BookingStatus | undefined,
    });
  }

  @Get('calendar/:date')
  @ApiOperation({ summary: 'Get inventory calendar blocks for a date' })
  async getCalendarBlocks(@Param('date') date: string) {
    return this.bookingsService.getCalendarBlocks(date);
  }

  @Get('availability')
  @ApiOperation({
    summary: 'Get date-aware inventory availability',
    description: 'Returns physical items available for the requested date range. Items locked by paid deposits are excluded.',
  })
  @ApiQuery({ name: 'startDate', example: '2026-05-01T10:00:00.000Z' })
  @ApiQuery({ name: 'endDate', example: '2026-05-04T18:00:00.000Z' })
  async getAvailability(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.bookingsService.getAvailability(startDate, endDate);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get booking by id' })
  async findById(@Param('id') id: string) {
    return this.bookingsService.findById(id);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.SALES, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Create booking quote/reservation request',
    description:
      'Prices the requested rental through RentalPricingService and attaches exact inventory items. Inventory is not locked until deposit is completed.',
  })
  @ApiBody({ type: CreateBookingDto })
  @ApiOkResponse({
    schema: {
      example: {
        id: 'clu7book0000008l49ra8vg12',
        status: 'DEPOSIT_REQUESTED',
        totalPrice: 850000,
        bookingDepositRequired: 425000,
        securityDepositRequired: 500000,
        items: [{ inventoryItemId: 'clu7inv0000008l4xj3g6fdj' }],
      },
    },
  })
  async create(@Body() body: CreateBookingDto, @CurrentUser() user: any) {
    const createdById = user?.id ?? user?.sub;
    return this.bookingsService.create({
      ...body,
      startDate: body.pickupDate,
      endDate: body.returnDate,
      createdById,
    });
  }

  @Post(':id/confirm')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SALES, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Confirm booking manually',
    description: 'Administrative operation for bookings that have been externally verified. Normal flow confirms through /bookings/{id}/deposit.',
  })
  @ApiBody({ type: ConfirmBookingDto })
  async confirm(
    @Param('id') id: string,
    @Body() _body: ConfirmBookingDto,
    @CurrentUser() user: any,
  ) {
    return this.bookingsService.updateStatus(id, BookingStatus.CONFIRMED, user?.id ?? user?.sub);
  }

  @Patch(':id/status')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SALES, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Set booking status explicitly' })
  @ApiBody({ type: UpdateBookingStatusDto })
  async updateStatus(
    @Param('id') id: string,
    @Body() body: UpdateBookingStatusDto,
    @CurrentUser() user: any,
  ) {
    if (!Object.values(BookingStatus).includes(body.status as BookingStatus)) {
      throw new BadRequestException('Invalid booking status');
    }

    return this.bookingsService.updateStatus(id, body.status as BookingStatus, user?.id ?? user?.sub);
  }

  @Post(':id/deposit')
  @UseGuards(RolesGuard)
  @Roles(UserRole.CASHIER, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Record booking deposit and lock inventory',
    description:
      'When cumulative deposit reaches bookingDepositRequired, the backend re-checks item overlaps, marks items RESERVED, creates/updates the rental, and confirms the booking.',
  })
  @ApiBody({ type: RecordBookingDepositDto })
  async recordBookingDeposit(
    @Param('id') id: string,
    @Body() body: RecordBookingDepositDto,
    @CurrentUser() user: any,
  ) {
    return this.bookingsService.recordBookingDeposit(
      id,
      Number(body.amount || 0),
      body.paymentMethod ?? PaymentMethod.CASH,
      user?.id ?? user?.sub,
    );
  }

  @Post(':id/booking-deposit')
  @UseGuards(RolesGuard)
  @Roles(UserRole.CASHIER, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Legacy alias for booking deposit' })
  @ApiBody({ type: RecordBookingDepositDto })
  async recordBookingDepositAlias(
    @Param('id') id: string,
    @Body() body: RecordBookingDepositDto,
    @CurrentUser() user: any,
  ) {
    return this.bookingsService.recordBookingDeposit(
      id,
      Number(body.amount || 0),
      body.paymentMethod ?? PaymentMethod.CASH,
      user?.id ?? user?.sub,
    );
  }

  @Patch(':id/archive')
  @UseGuards(RolesGuard)
  @Roles(UserRole.MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Archive booking' })
  async archive(@Param('id') id: string, @CurrentUser() user: any) {
    return this.bookingsService.archive(id, user?.id ?? user?.sub);
  }
}
