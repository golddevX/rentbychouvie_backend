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
import { PaymentsService } from '../payments/payments.service';
import { CollectBookingPaymentDto } from '../payments/dto/payment.dto';
import { FinalizeReturnSettlementDto } from '../payments/dto/payment.dto';
import { PaginationQueryDto } from '../shared/dto/pagination-query.dto';

const LEGACY_BOOKING_STATUS_ALIASES = ['LATE_RETURN', 'DAMAGE_REVIEW'] as const;
type LegacyBookingStatusAlias = (typeof LEGACY_BOOKING_STATUS_ALIASES)[number];

function normalizeBookingStatusFilter(value?: string): BookingStatus | LegacyBookingStatusAlias | null {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (!normalized) return null;
  if (Object.values(BookingStatus).includes(normalized as BookingStatus)) {
    return normalized as BookingStatus;
  }
  if (LEGACY_BOOKING_STATUS_ALIASES.includes(normalized as LegacyBookingStatusAlias)) {
    return normalized as LegacyBookingStatusAlias;
  }
  return null;
}

@ApiTags('Booking')
@ApiBearerAuth()
@Controller('bookings')
@UseGuards(AuthGuard('jwt'))
export class BookingsController {
  constructor(
    private readonly bookingsService: BookingsService,
    private readonly paymentsService: PaymentsService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List bookings',
    description: 'Operations view of bookings with customer, reserved items, rental, and payments.',
  })
  @ApiQuery({ name: 'status', enum: BookingStatus, required: false })
  async findAll(
    @Query() query: PaginationQueryDto,
    @Query('status') status?: string,
    @Query('statuses') statuses?: string,
  ) {
    const normalizedStatus = normalizeBookingStatusFilter(status);
    if (status && !normalizedStatus) {
      throw new BadRequestException('Invalid booking status');
    }
    const parsedStatuses = statuses
      ? statuses.split(',').map((item) => item.trim()).filter(Boolean)
      : [];
    const normalizedStatuses = parsedStatuses
      .map((value) => normalizeBookingStatusFilter(value))
      .filter((value): value is BookingStatus | LegacyBookingStatusAlias => Boolean(value));
    if (parsedStatuses.length !== normalizedStatuses.length) {
      throw new BadRequestException('Invalid booking statuses');
    }
    const legacyStatuses = normalizedStatuses.filter(
      (value): value is LegacyBookingStatusAlias => LEGACY_BOOKING_STATUS_ALIASES.includes(value as LegacyBookingStatusAlias),
    );
    const directStatuses = normalizedStatuses.filter(
      (value): value is BookingStatus => Object.values(BookingStatus).includes(value as BookingStatus),
    );
    const directStatus = Object.values(BookingStatus).includes(normalizedStatus as BookingStatus)
      ? normalizedStatus as BookingStatus
      : undefined;
    const singleLegacyStatus = normalizedStatus && LEGACY_BOOKING_STATUS_ALIASES.includes(normalizedStatus as LegacyBookingStatusAlias)
      ? normalizedStatus as LegacyBookingStatusAlias
      : undefined;

    return this.bookingsService.findAll({
      page: query.page,
      limit: query.limit,
      search: query.search,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      sortBy: query.sortBy ?? 'createdAt',
      sortOrder: query.sortOrder ?? 'desc',
      status: directStatus,
      statuses: directStatuses,
      legacyStatuses: [...legacyStatuses, ...(singleLegacyStatus ? [singleLegacyStatus] : [])],
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

  @Get(':id/payment-summary')
  @UseGuards(RolesGuard)
  @Roles(UserRole.CASHIER, UserRole.OPERATOR, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get booking payment summary' })
  async paymentSummary(@Param('id') id: string) {
    return this.paymentsService.getPaymentSummaryForBooking(id);
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
        bookingDepositRequired: 500000,
        securityDepositRequired: 1000000,
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
      'When cumulative security deposit reaches the configured threshold, the backend re-checks item overlaps, marks items RESERVED, creates/updates the rental, and confirms the booking.',
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

  @Post(':id/collect-rental-payment')
  @UseGuards(RolesGuard)
  @Roles(UserRole.CASHIER, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Collect remaining rental payment for booking' })
  @ApiBody({ type: CollectBookingPaymentDto })
  async collectRentalPayment(
    @Param('id') id: string,
    @Body() body: CollectBookingPaymentDto,
    @CurrentUser() user: any,
  ) {
    return this.paymentsService.collectRentalPayment(id, {
      amount: body.amount,
      paymentMethod: body.paymentMethod,
      description: body.description,
      processedById: user?.id ?? user?.sub,
    });
  }

  @Post(':id/collect-security-deposit')
  @UseGuards(RolesGuard)
  @Roles(UserRole.CASHIER, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Collect security deposit for booking' })
  @ApiBody({ type: CollectBookingPaymentDto })
  async collectSecurityDeposit(
    @Param('id') id: string,
    @Body() body: CollectBookingPaymentDto,
    @CurrentUser() user: any,
  ) {
    return this.paymentsService.collectSecurityDeposit(id, {
      amount: body.amount,
      paymentMethod: body.paymentMethod,
      description: body.description,
      processedById: user?.id ?? user?.sub,
    });
  }

  @Post(':id/finalize-return-settlement')
  @UseGuards(RolesGuard)
  @Roles(UserRole.CASHIER, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Finalize return settlement and post payment history' })
  @ApiBody({ type: FinalizeReturnSettlementDto })
  async finalizeReturnSettlement(
    @Param('id') id: string,
    @Body() body: FinalizeReturnSettlementDto,
    @CurrentUser() user: any,
  ) {
    return this.paymentsService.finalizeReturnSettlement(id, {
      paymentMethod: body.paymentMethod,
      description: body.description,
      applyRentalToDeposit: body.applyRentalToDeposit,
      processedById: user?.id ?? user?.sub,
    });
  }

  @Patch(':id/archive')
  @UseGuards(RolesGuard)
  @Roles(UserRole.MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Archive booking' })
  async archive(@Param('id') id: string, @CurrentUser() user: any) {
    return this.bookingsService.archive(id, user?.id ?? user?.sub);
  }
}
