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
    example: [
      'https://cdn.example.com/handover/front.jpg',
      'https://cdn.example.com/handover/back.jpg',
      'https://cdn.example.com/handover/accessories.jpg',
      'https://cdn.example.com/handover/overview.jpg',
    ],
    description: 'Exactly 4 handover evidence images are required before the rental can be handed over.',
  })
  @IsArray()
  @ArrayMinSize(4)
  images!: string[];

  @ApiProperty({ example: 'All items clean and handed to customer.', required: false })
  @IsOptional()
  @IsString()
  conditionNotes?: string;
}
