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
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { Roles } from '../shared/decorators/roles.decorator';
import { RolesGuard } from '../shared/guards/roles.guard';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import { PaymentGateway, PaymentStatus, PaymentType, UserRole } from '@prisma/client';
import {
  CancelPaymentDto,
  CreatePaymentDto,
  InitializeBookingPaymentDto,
  InitializePaymentDto,
  ProcessPaymentDto,
  RefundPaymentDto,
  UpdatePaymentStatusDto,
} from './dto/payment.dto';

@ApiTags('Payment')
@ApiBearerAuth()
@Controller('payments')
@UseGuards(AuthGuard('jwt'))
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get()
  @UseGuards(RolesGuard)
  @Roles(
    UserRole.CASHIER,
    UserRole.OPERATOR,
    UserRole.MANAGER,
    UserRole.SUPER_ADMIN,
  )
  @ApiOperation({
    summary: 'List payments',
    description: 'Cashier/admin payment ledger for booking deposits, rental payments, fees, and refunds.',
  })
  @ApiQuery({ name: 'status', enum: PaymentStatus, required: false })
  async findAll(@Query('status') status?: string) {
    if (status && !Object.values(PaymentStatus).includes(status as PaymentStatus)) {
      throw new BadRequestException('Invalid payment status');
    }

    return this.paymentsService.findAll({
      status: status as PaymentStatus | undefined,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get payment by id' })
  async findById(@Param('id') id: string) {
    return this.paymentsService.findById(id);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.CASHIER, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Create manual payment record',
    description: 'For counter payments or imported gateway records. Deposit payments should usually use /bookings/{id}/deposit.',
  })
  @ApiBody({ type: CreatePaymentDto })
  @ApiOkResponse({
    schema: {
      example: {
        id: 'clu7pay0000008l4czd77h0f',
        bookingId: 'clu7book0000008l49ra8vg12',
        type: 'BOOKING_DEPOSIT',
        amount: 425000,
        status: 'PENDING',
      },
    },
  })
  async create(@Body() body: CreatePaymentDto, @CurrentUser() user: any) {
    const type = body.type
      ? String(body.type).toUpperCase() as PaymentType
      : undefined;
    if (type && !Object.values(PaymentType).includes(type)) {
      throw new BadRequestException('Invalid payment type');
    }

    return this.paymentsService.create({
      ...body,
      type,
      processedById: user?.id ?? user?.sub,
    });
  }

  @Patch(':id/process')
  @UseGuards(RolesGuard)
  @Roles(UserRole.CASHIER, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Mark payment completed',
    description: 'Applies completed booking deposits to booking state and inventory locks.',
  })
  @ApiBody({ type: ProcessPaymentDto })
  async process(
    @Param('id') id: string,
    @Body() body: ProcessPaymentDto,
    @CurrentUser() user: any,
  ) {
    return this.paymentsService.process(id, user.id, body.externalTransactionId);
  }

  @Patch(':id/refund')
  @UseGuards(RolesGuard)
  @Roles(UserRole.CASHIER, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Refund payment amount' })
  @ApiBody({ type: RefundPaymentDto })
  async refund(
    @Param('id') id: string,
    @Body() body: RefundPaymentDto,
    @CurrentUser() user: any,
  ) {
    return this.paymentsService.refund(id, body.refundAmount, user?.id ?? user?.sub);
  }

  @Post(':id/initialize')
  @UseGuards(RolesGuard)
  @Roles(UserRole.CASHIER, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Initialize gateway checkout for existing payment',
    description: 'Creates a PaymentTransaction with provider checkout URL.',
  })
  @ApiBody({ type: InitializePaymentDto })
  async initialize(
    @Param('id') id: string,
    @Body() body: InitializePaymentDto,
  ) {
    return this.paymentsService.initializePayment(id, {
      provider: body.provider ? (String(body.provider).toUpperCase() as PaymentGateway) : undefined,
      returnUrl: body.returnUrl,
      callbackUrl: body.callbackUrl,
      currency: body.currency,
      idempotencyKey: body.idempotencyKey,
    });
  }

  @Post(':id/retry')
  @UseGuards(RolesGuard)
  @Roles(UserRole.CASHIER, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Cancel pending transaction and create a new checkout' })
  @ApiBody({ type: InitializePaymentDto })
  async retry(
    @Param('id') id: string,
    @Body() body: InitializePaymentDto,
  ) {
    return this.paymentsService.retryPayment(id, {
      provider: body.provider ? (body.provider.toUpperCase() as PaymentGateway) : undefined,
      returnUrl: body.returnUrl,
      callbackUrl: body.callbackUrl,
      currency: body.currency,
    });
  }

  @Post(':id/cancel')
  @UseGuards(RolesGuard)
  @Roles(UserRole.CASHIER, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Cancel pending payment checkout' })
  @ApiBody({ type: CancelPaymentDto })
  async cancel(@Param('id') id: string, @Body() body: CancelPaymentDto) {
    return this.paymentsService.cancelPayment(id, body.reason);
  }

  @Post('rental-orders/:orderId/initialize')
  @UseGuards(RolesGuard)
  @Roles(UserRole.CASHIER, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Initialize gateway checkout for rental order' })
  @ApiBody({ type: InitializePaymentDto })
  async initializeRentalOrder(
    @Param('orderId') orderId: string,
    @Body() body: InitializePaymentDto,
  ) {
    return this.paymentsService.initializeRentalOrderPayment(orderId, {
      provider: body.provider ? (body.provider.toUpperCase() as PaymentGateway) : undefined,
      returnUrl: body.returnUrl,
      callbackUrl: body.callbackUrl,
      currency: body.currency,
      idempotencyKey: body.idempotencyKey,
    });
  }

  @Post('rental-orders/:orderId/retry')
  @UseGuards(RolesGuard)
  @Roles(UserRole.CASHIER, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Retry rental order checkout' })
  @ApiBody({ type: InitializePaymentDto })
  async retryRentalOrder(
    @Param('orderId') orderId: string,
    @Body() body: InitializePaymentDto,
  ) {
    return this.paymentsService.retryRentalOrderPayment(orderId, {
      provider: body.provider ? (body.provider.toUpperCase() as PaymentGateway) : undefined,
      returnUrl: body.returnUrl,
      callbackUrl: body.callbackUrl,
      currency: body.currency,
    });
  }

  @Post('bookings/:bookingId/initialize')
  @UseGuards(RolesGuard)
  @Roles(UserRole.CASHIER, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Initialize booking payment',
    description: 'Creates checkout for deposit, remaining balance, or full booking payment. Completed deposit locks inventory.',
  })
  @ApiBody({ type: InitializeBookingPaymentDto })
  async initializeBooking(
    @Param('bookingId') bookingId: string,
    @Body() body: InitializeBookingPaymentDto,
  ) {
    return this.paymentsService.initializeBookingPayment(bookingId, {
      provider: body.provider ? (body.provider.toUpperCase() as PaymentGateway) : undefined,
      returnUrl: body.returnUrl,
      callbackUrl: body.callbackUrl,
      currency: body.currency,
      idempotencyKey: body.idempotencyKey,
      paymentType: body.paymentType,
      depositAmount: body.depositAmount,
    });
  }

  @Patch(':id/status')
  @UseGuards(RolesGuard)
  @Roles(UserRole.CASHIER, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Set payment status explicitly' })
  @ApiBody({ type: UpdatePaymentStatusDto })
  async updateStatus(
    @Param('id') id: string,
    @Body() body: UpdatePaymentStatusDto,
    @CurrentUser() user: any,
  ) {
    if (!Object.values(PaymentStatus).includes(body.status as PaymentStatus)) {
      throw new BadRequestException('Invalid payment status');
    }

    return this.paymentsService.updateStatus(id, body.status as PaymentStatus, user?.id ?? user?.sub);
  }

  @Patch(':id/archive')
  @UseGuards(RolesGuard)
  @Roles(UserRole.MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Archive payment' })
  async archive(@Param('id') id: string, @CurrentUser() user: any) {
    return this.paymentsService.archive(id, user?.id ?? user?.sub);
  }

  @Post(':id/receipt')
  @UseGuards(RolesGuard)
  @Roles(UserRole.CASHIER, UserRole.OPERATOR, UserRole.MANAGER)
  @ApiOperation({ summary: 'Generate receipt PDF for payment' })
  async generateReceipt(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    return this.paymentsService.generateReceipt(id, user.id);
  }

  @Get(':id/receipt')
  @ApiOperation({ summary: 'Get payment with receipts' })
  async getReceipt(@Param('id') id: string) {
    return this.paymentsService.findById(id);
  }
}
