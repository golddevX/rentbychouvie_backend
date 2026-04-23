import { ApiProperty } from '@nestjs/swagger';
import { LeadStatus } from '@prisma/client';
import { IsEmail, IsEnum, IsISO8601, IsNumber, IsOptional, IsString } from 'class-validator';

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

  @ApiProperty({
    example: '2026-04-22T14:00:00.000Z',
    description: 'Optional explicit deadline. Defaults to five hours from request time.',
    required: false,
  })
  @IsOptional()
  @IsISO8601()
  depositDeadlineAt?: string;
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
}

export class UpdateLeadStatusDto {
  @ApiProperty({
    enum: LeadStatus,
    example: LeadStatus.DEPOSIT_REQUESTED,
    description: 'Lead lifecycle state shown in Swagger as enum values.',
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
  @ApiProperty({ example: 'clu7vj9it000208l412pt9y41' })
  @IsString()
  bookingId!: string;
}
