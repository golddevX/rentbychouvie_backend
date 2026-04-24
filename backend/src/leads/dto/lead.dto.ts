import { ApiProperty } from '@nestjs/swagger';
import { LeadAppointmentIntent, LeadStatus, PaymentMethod } from '@prisma/client';
import { IsEmail, IsEnum, IsISO8601, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateLeadDto {
  @ApiProperty({ example: 'linh.nguyen@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'Linh Nguyen' })
  @IsString()
  name!: string;

  @ApiProperty({ example: '+84901234567' })
  @IsString()
  phone!: string;

  @ApiProperty({ example: 'instagram', required: false })
  @IsOptional()
  @IsString()
  source?: string;

  @ApiProperty({
    example: 'Customer needs two dresses for a wedding weekend.',
    required: false,
  })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({ example: 'clu7prd0000008l43a9d6qk2', required: false })
  @IsOptional()
  @IsString()
  productId?: string;

  @ApiProperty({ example: 'clu7var0000008l4czg5as9f', required: false })
  @IsOptional()
  @IsString()
  variantId?: string;

  @ApiProperty({ example: 'clu7inv0000008l4xj3g6fdj', required: false })
  @IsOptional()
  @IsString()
  inventoryItemId?: string;

  @ApiProperty({ example: 'M', required: false })
  @IsOptional()
  @IsString()
  size?: string;

  @ApiProperty({ example: 'Red', required: false })
  @IsOptional()
  @IsString()
  color?: string;

  @ApiProperty({ example: '2026-05-01T10:00:00.000Z', required: false })
  @IsOptional()
  @IsISO8601()
  pickupDate?: string;

  @ApiProperty({ example: '2026-05-04T18:00:00.000Z', required: false })
  @IsOptional()
  @IsISO8601()
  returnDate?: string;

  @ApiProperty({ enum: LeadAppointmentIntent, example: LeadAppointmentIntent.FITTING, required: false })
  @IsOptional()
  @IsEnum(LeadAppointmentIntent)
  appointmentIntent?: LeadAppointmentIntent;

  @ApiProperty({ example: 350000, required: false })
  @IsOptional()
  @IsNumber()
  quotedPrice?: number;
}

export class ContactLeadDto {
  @ApiProperty({
    example: 'Customer confirmed dates and wants a deposit link.',
    required: false,
  })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class RequestLeadDepositDto {
  @ApiProperty({ example: 250000, required: false })
  @IsOptional()
  @IsNumber()
  quotedPrice?: number;

  @ApiProperty({ example: 125000, required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  depositAmount?: number;

  @ApiProperty({
    example: '2026-04-22T14:00:00.000Z',
    description: 'Optional explicit deadline. Defaults to five hours from request time.',
    required: false,
  })
  @IsOptional()
  @IsISO8601()
  depositDeadlineAt?: string;
}

export class SelectLeadProductDto {
  @ApiProperty({ example: 'clu7prd0000008l43a9d6qk2' })
  @IsString()
  productId!: string;

  @ApiProperty({ example: 'clu7var0000008l4czg5as9f', required: false })
  @IsOptional()
  @IsString()
  variantId?: string;

  @ApiProperty({ example: 'clu7inv0000008l4xj3g6fdj', required: false })
  @IsOptional()
  @IsString()
  inventoryItemId?: string;

  @ApiProperty({ example: 'M', required: false })
  @IsOptional()
  @IsString()
  size?: string;

  @ApiProperty({ example: 'Red', required: false })
  @IsOptional()
  @IsString()
  color?: string;

  @ApiProperty({ example: '2026-05-01T10:00:00.000Z' })
  @IsISO8601()
  pickupDate!: string;

  @ApiProperty({ example: '2026-05-04T18:00:00.000Z' })
  @IsISO8601()
  returnDate!: string;

  @ApiProperty({ enum: LeadAppointmentIntent, example: LeadAppointmentIntent.FITTING })
  @IsEnum(LeadAppointmentIntent)
  appointmentIntent!: LeadAppointmentIntent;

  @ApiProperty({ example: 350000, required: false })
  @IsOptional()
  @IsNumber()
  quotedPrice?: number;

  @ApiProperty({ example: 'Customer prefers slim fit.', required: false })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class ReceiveLeadDepositDto {
  @ApiProperty({ example: 125000, minimum: 0 })
  @IsNumber()
  @Min(0)
  amount!: number;

  @ApiProperty({ enum: PaymentMethod, example: PaymentMethod.CASH, required: false })
  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  @ApiProperty({ example: 'Collected at showroom.', required: false })
  @IsOptional()
  @IsString()
  description?: string;
}

export class UpdateLeadDto {
  @ApiProperty({ enum: LeadStatus, example: LeadStatus.CONTACTED, required: false })
  @IsOptional()
  @IsEnum(LeadStatus)
  status?: LeadStatus;

  @ApiProperty({ example: 'Customer prefers size M, red color.', required: false })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({ example: 350000, required: false })
  @IsOptional()
  @IsNumber()
  quotedPrice?: number;

  @ApiProperty({ example: '2026-05-01T10:00:00.000Z', required: false })
  @IsOptional()
  @IsISO8601()
  pickupDate?: string;

  @ApiProperty({ example: '2026-05-04T18:00:00.000Z', required: false })
  @IsOptional()
  @IsISO8601()
  returnDate?: string;
}

export class UpdateLeadStatusDto {
  @ApiProperty({
    enum: LeadStatus,
    example: LeadStatus.CANCELLED,
    description: 'Manual lead statuses only. Workflow statuses must go through dedicated LeadWorkflowService endpoints.',
  })
  @IsEnum(LeadStatus)
  status!: LeadStatus;
}

export class AssignLeadDto {
  @ApiProperty({ example: 'clu7u4p9d000008l4b75g9zx1' })
  @IsString()
  userId!: string;
}

export class ConvertLeadToBookingDto {
  @ApiProperty({
    example: 'clu7vj9it000208l412pt9y41',
    required: false,
    description: 'Optional existing booking id for manager-controlled linking after appointment completion.',
  })
  @IsOptional()
  @IsString()
  bookingId?: string;
}
