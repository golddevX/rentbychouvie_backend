import { ApiProperty } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsOptional, IsString } from 'class-validator';

export class PickupScanDto {
  @ApiProperty({
    example: 'QR-DRS-RED-M-0001',
    description: 'Physical QR scanned at pickup. Must match one item expected by the booking.',
  })
  @IsString()
  qrCode!: string;
}

export class ConfirmPickupDto {
  @ApiProperty({
    type: [String],
    example: ['QR-DRS-RED-M-0001', 'QR-BAG-0007'],
    description: 'All expected QR codes for the booking. Confirmation fails if any expected item is missing.',
  })
  @IsArray()
  @ArrayMinSize(1)
  qrCodes!: string[];

  @ApiProperty({ example: 'All items clean and handed to customer.', required: false })
  @IsOptional()
  @IsString()
  conditionNotes?: string;
}
