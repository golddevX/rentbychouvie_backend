import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LeadAppointmentIntent } from '@prisma/client';
import {
  ArrayNotEmpty,
  IsArray,
  IsEmail,
  IsEnum,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreatePublicLeadDto {
  @ApiProperty({ example: 'Linh Nguyen' })
  @IsString()
  customerName!: string;

  @ApiProperty({ example: '+84901234567' })
  @IsString()
  phone!: string;

  @ApiPropertyOptional({ example: 'linh.nguyen@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({ example: '2026-05-20T10:00:00.000Z' })
  @IsISO8601()
  pickupDate!: string;

  @ApiProperty({ example: '2026-05-23T18:00:00.000Z' })
  @IsISO8601()
  returnDate!: string;

  @ApiProperty({ enum: LeadAppointmentIntent, example: LeadAppointmentIntent.FITTING })
  @IsEnum(LeadAppointmentIntent)
  appointmentIntent!: LeadAppointmentIntent;

  @ApiProperty({ enum: ['percent', 'custom_amount'], example: 'percent' })
  @IsString()
  selectedDepositType!: 'percent' | 'custom_amount';

  @ApiPropertyOptional({ example: 50, nullable: true })
  @IsOptional()
  @IsNumber()
  selectedDepositRate?: number | null;

  @ApiPropertyOptional({ example: 1500000, nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  customDepositAmount?: number | null;

  @ApiProperty({ example: ['clu7prd0000008l43a9d6qk2'] })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  productIds!: string[];

  @ApiPropertyOptional({ example: 'Khach muon fitting buoi chieu.' })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({ example: 'website' })
  @IsOptional()
  @IsString()
  source?: string;

  @ApiPropertyOptional({ example: 165 })
  @IsOptional()
  @IsNumber()
  height?: number;

  @ApiPropertyOptional({ example: 50 })
  @IsOptional()
  @IsNumber()
  weight?: number;

  @ApiPropertyOptional({ example: 'Bust 84, Waist 64, Hips 90' })
  @IsOptional()
  @IsString()
  measurements?: string;

  @ApiPropertyOptional({ example: 'https://example.com/face-image.jpg' })
  @IsOptional()
  @IsString()
  faceImage?: string;
}
