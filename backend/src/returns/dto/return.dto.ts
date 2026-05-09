import { ApiProperty } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsBoolean, IsISO8601, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class ReturnProductInspectionDto {
  @ApiProperty({ example: 'clu7inv0000008l43a9d6qk2' })
  @IsString()
  inventoryItemId!: string;

  @ApiProperty({ enum: ['good', 'dirty', 'damaged', 'missing_accessory', 'missing_item'], example: 'good' })
  @IsString()
  condition!: 'good' | 'dirty' | 'damaged' | 'missing_accessory' | 'missing_item';

  @ApiProperty({ type: [String], example: ['https://cdn.example.com/returns/product-1.jpg'], required: false })
  @IsOptional()
  @IsArray()
  images?: string[];

  @ApiProperty({ example: 150000, minimum: 0, required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  damageFee?: number;

  @ApiProperty({ example: 50000, minimum: 0, required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  accessoryFee?: number;
}

export class InspectReturnDto {
  @ApiProperty({
    enum: ['clean', 'dirty', 'damaged', 'incomplete'],
    example: 'damaged',
    description: 'Observed return condition used for inspection and operational status. Damage fees are entered manually.',
  })
  @IsString()
  condition!: 'clean' | 'dirty' | 'damaged' | 'incomplete';

  @ApiProperty({ type: [String], example: ['https://cdn.example.com/returns/img-1.jpg'] })
  @IsArray()
  images!: string[];

  @ApiProperty({ example: 'Small tear near hem.', required: false })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({ example: 150000, minimum: 0, required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  declaredDamageFee?: number;

  @ApiProperty({ type: [ReturnProductInspectionDto], required: false })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReturnProductInspectionDto)
  items?: ReturnProductInspectionDto[];
}

export class SettleReturnDto {
  @ApiProperty({ enum: ['clean', 'dirty', 'damaged', 'incomplete'], example: 'damaged' })
  @IsString()
  condition!: 'clean' | 'dirty' | 'damaged' | 'incomplete';

  @ApiProperty({ example: '2026-05-04T19:30:00.000Z', required: false })
  @IsOptional()
  @IsISO8601()
  actualReturnDate?: string;

  @ApiProperty({ example: 150000, minimum: 0, required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  lateFee?: number;

  @ApiProperty({ example: 50000, minimum: 0, required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  dirtyFee?: number;

  @ApiProperty({ example: 25000, minimum: 0, required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  otherFee?: number;

  @ApiProperty({ example: 'Refund customer after deducting repair cost.', required: false })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({
    example: true,
    required: false,
    description: 'When true, remaining rental is allowed to be deducted from the held deposit during settlement.',
  })
  @IsOptional()
  @IsBoolean()
  applyRentalToDeposit?: boolean;

  @ApiProperty({ type: [ReturnProductInspectionDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReturnProductInspectionDto)
  items!: ReturnProductInspectionDto[];
}
