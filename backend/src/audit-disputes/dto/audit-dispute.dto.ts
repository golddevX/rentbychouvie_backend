import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsEnum,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import {
  DisputeCategory,
  DisputePriority,
  DisputeResolutionOutcome,
  DisputeStatus,
} from '@prisma/client';

export class CreateDisputeDto {
  @ApiProperty({ example: 'Customer disputes damage fee on hem repair' })
  @IsString()
  title!: string;

  @ApiProperty({ enum: DisputeCategory, example: DisputeCategory.DAMAGE_FEE })
  @IsEnum(DisputeCategory)
  category!: DisputeCategory;

  @ApiProperty({ enum: DisputePriority, example: DisputePriority.HIGH, required: false })
  @IsOptional()
  @IsEnum(DisputePriority)
  priority?: DisputePriority;

  @ApiProperty({ example: 'Customer says the gown was stained at pickup.' })
  @IsString()
  summary!: string;

  @ApiProperty({ example: 'Request full deposit refund.', required: false })
  @IsOptional()
  @IsString()
  customerPosition?: string;

  @ApiProperty({ example: 'Compare pickup photos against return inspection.', required: false })
  @IsOptional()
  @IsString()
  internalNotes?: string;

  @ApiProperty({ example: 500000, minimum: 0, required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  requestedAmount?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  bookingId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  rentalId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  rentalOrderId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  paymentId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  inventoryItemId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  returnInspectionId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  assignedToId?: string;

  @ApiProperty({ example: '2026-04-25T10:00:00.000Z', required: false })
  @IsOptional()
  @IsISO8601()
  dueAt?: string;
}

export class UpdateDisputeDto {
  @ApiProperty({ enum: DisputeStatus, required: false })
  @IsOptional()
  @IsEnum(DisputeStatus)
  status?: DisputeStatus;

  @ApiProperty({ enum: DisputePriority, required: false })
  @IsOptional()
  @IsEnum(DisputePriority)
  priority?: DisputePriority;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  assignedToId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  internalNotes?: string;

  @ApiProperty({ example: 250000, minimum: 0, required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  approvedAmount?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsISO8601()
  dueAt?: string;
}

export class AddEvidenceDto {
  @ApiProperty({ example: 'return-hem-photo.jpg' })
  @IsString()
  fileName!: string;

  @ApiProperty({ example: 'https://cdn.example.com/evidence/return-hem-photo.jpg' })
  @IsString()
  fileUrl!: string;

  @ApiProperty({ example: 'image/jpeg', required: false })
  @IsOptional()
  @IsString()
  mimeType?: string;

  @ApiProperty({ example: 340102, minimum: 0, required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  fileSize?: number;

  @ApiProperty({ example: 'return_photo', required: false })
  @IsOptional()
  @IsString()
  evidenceType?: string;

  @ApiProperty({ example: 'Uploaded by return desk during customer call.', required: false })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiProperty({ example: 'sha256:...', required: false })
  @IsOptional()
  @IsString()
  checksum?: string;
}

export class ResolveDisputeDto {
  @ApiProperty({ enum: DisputeResolutionOutcome, example: DisputeResolutionOutcome.PARTIAL_ADJUSTMENT })
  @IsEnum(DisputeResolutionOutcome)
  outcome!: DisputeResolutionOutcome;

  @ApiProperty({ example: 'Approve partial refund after manager review.' })
  @IsString()
  resolutionSummary!: string;

  @ApiProperty({ example: 250000, minimum: 0, required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  approvedAmount?: number;
}

export class AuditQueryDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  entity?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  entityId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  bookingId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  paymentId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  inventoryItemId?: string;

  @ApiProperty({ type: [String], required: false })
  @IsOptional()
  @IsArray()
  actions?: string[];
}
