import { ApiProperty } from '@nestjs/swagger';
import { PaymentGateway, PaymentMethod, PaymentStatus, PaymentType } from '@prisma/client';
import { IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreatePaymentDto {
  @ApiProperty({ example: 'clu7rental0000008l47b3mtyx9' })
  @IsString()
  rentalId!: string;

  @ApiProperty({ example: 'clu7book0000008l49ra8vg12', required: false })
  @IsOptional()
  @IsString()
  bookingId?: string;

  @ApiProperty({ enum: PaymentType, example: PaymentType.RENTAL_PAYMENT, required: false })
  @IsOptional()
  @IsEnum(PaymentType)
  type?: PaymentType;

  @ApiProperty({ example: 850000, minimum: 0 })
  @IsNumber()
  @Min(0)
  amount!: number;

  @ApiProperty({ example: 600000, minimum: 0 })
  @IsNumber()
  @Min(0)
  rentalAmount!: number;

  @ApiProperty({ example: 250000, minimum: 0, required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  depositAmount?: number;

  @ApiProperty({ example: 500000, minimum: 0, required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  securityDepositAmount?: number;

  @ApiProperty({ enum: PaymentMethod, example: PaymentMethod.CASH })
  @IsEnum(PaymentMethod)
  paymentMethod!: PaymentMethod;

  @ApiProperty({ example: 'Booking deposit collected at counter.', required: false })
  @IsOptional()
  @IsString()
  description?: string;
}

export class ProcessPaymentDto {
  @ApiProperty({ example: 'BANK-20260422-001', required: false })
  @IsOptional()
  @IsString()
  externalTransactionId?: string;
}

export class RefundPaymentDto {
  @ApiProperty({ example: 100000, minimum: 0 })
  @IsNumber()
  @Min(0)
  refundAmount!: number;
}

export class InitializePaymentDto {
  @ApiProperty({ enum: PaymentGateway, example: PaymentGateway.PAYOS, required: false })
  @IsOptional()
  @IsEnum(PaymentGateway)
  provider?: PaymentGateway;

  @ApiProperty({ example: 'https://app.example.com/payments/return', required: false })
  @IsOptional()
  @IsString()
  returnUrl?: string;

  @ApiProperty({ example: 'https://api.example.com/api/payments/webhook/payos', required: false })
  @IsOptional()
  @IsString()
  callbackUrl?: string;

  @ApiProperty({ example: 'VND', default: 'VND', required: false })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiProperty({ example: 'booking-clu7book-deposit-v1', required: false })
  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}

export class InitializeBookingPaymentDto extends InitializePaymentDto {
  @ApiProperty({
    enum: ['deposit', 'remaining', 'full'],
    example: 'deposit',
    required: false,
    description: 'deposit locks inventory; remaining/full settles rental balance.',
  })
  @IsOptional()
  @IsString()
  paymentType?: 'deposit' | 'remaining' | 'full';

  @ApiProperty({ example: 250000, minimum: 0, required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  depositAmount?: number;
}

export class UpdatePaymentStatusDto {
  @ApiProperty({ enum: PaymentStatus, example: PaymentStatus.COMPLETED })
  @IsEnum(PaymentStatus)
  status!: PaymentStatus;
}

export class CancelPaymentDto {
  @ApiProperty({ example: 'Customer selected another payment method.', required: false })
  @IsOptional()
  @IsString()
  reason?: string;
}
