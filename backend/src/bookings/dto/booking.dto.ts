import { ApiProperty } from '@nestjs/swagger';
import { BookingStatus, PaymentMethod } from '@prisma/client';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class BookingItemRequestDto {
  @ApiProperty({
    example: 'clu7inv0000008l4xj3g6fdj',
    required: false,
    description: 'Exact physical inventory item. If omitted, productId/variantId availability is used.',
  })
  @IsOptional()
  @IsString()
  inventoryItemId?: string;

  @ApiProperty({
    example: 'clu7prd0000008l43a9d6qk2',
    required: false,
    description: 'Product to reserve when the frontend does not pick a specific QR item.',
  })
  @IsOptional()
  @IsString()
  productId?: string;

  @ApiProperty({
    example: 'clu7var0000008l4czg5as9f',
    required: false,
    description: 'Variant to reserve. Availability is checked for the requested date range.',
  })
  @IsOptional()
  @IsString()
  variantId?: string;

  @ApiProperty({ example: 1, minimum: 1, default: 1, required: false })
  @IsOptional()
  @IsNumber()
  @Min(1)
  quantity?: number;
}

export class CreateBookingDto {
  @ApiProperty({ example: 'clu7cus0000008l4z2bqkhk9' })
  @IsString()
  customerId!: string;

  @ApiProperty({ example: 'clu7lead0000008l4c1jlav50', required: false })
  @IsOptional()
  @IsString()
  leadId?: string;

  @ApiProperty({ example: '2026-05-01T10:00:00.000Z' })
  @IsISO8601()
  pickupDate!: string;

  @ApiProperty({ example: '2026-05-04T18:00:00.000Z' })
  @IsISO8601()
  returnDate!: string;

  @ApiProperty({
    example: 3,
    minimum: 1,
    maximum: 3,
    description: 'Commercial rental duration. Calendar range may be longer and creates early pickup fees.',
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(3)
  durationDays?: number;

  @ApiProperty({ type: [BookingItemRequestDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BookingItemRequestDto)
  items!: BookingItemRequestDto[];

  @ApiProperty({ example: ['veil', 'garment bag'], type: [String], required: false })
  @IsOptional()
  @IsArray()
  accessories?: string[];

  @ApiProperty({ example: 'Customer requests pickup after 6pm.', required: false })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateBookingStatusDto {
  @ApiProperty({ enum: BookingStatus, example: BookingStatus.CONFIRMED })
  @IsEnum(BookingStatus)
  status!: BookingStatus;
}

export class RecordBookingDepositDto {
  @ApiProperty({ example: 250000, minimum: 0 })
  @IsNumber()
  @Min(0)
  amount!: number;

  @ApiProperty({ enum: PaymentMethod, example: PaymentMethod.CASH, required: false })
  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;
}

export class ConfirmBookingDto {
  @ApiProperty({ example: 'Manager approved after deposit verification.', required: false })
  @IsOptional()
  @IsString()
  notes?: string;
}
