import { ApiProperty } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsBoolean, IsISO8601, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class InspectReturnDto {
  @ApiProperty({
    enum: ['clean', 'dirty', 'damaged', 'incomplete'],
    example: 'damaged',
    description: 'Observed return condition used by the pricing engine to suggest fees.',
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
}

export class SettleReturnDto {
  @ApiProperty({
    type: [String],
    example: ['QR-DRS-RED-M-0001', 'QR-BAG-0007'],
    description: 'Returned QR codes. Settlement fails if scanned items do not match the booking.',
  })
  @IsArray()
  @ArrayMinSize(1)
  qrCodes!: string[];

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
  damageFee?: number;

  @ApiProperty({ type: [Number], example: [50000], required: false })
  @IsOptional()
  @IsArray()
  accessoryLostValues?: number[];

  @ApiProperty({ example: true, required: false })
  @IsOptional()
  @IsBoolean()
  affectsNextBooking?: boolean;

  @ApiProperty({ example: 'Refund customer after deducting repair cost.', required: false })
  @IsOptional()
  @IsString()
  notes?: string;
}
