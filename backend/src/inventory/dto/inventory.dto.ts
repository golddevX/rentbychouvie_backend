import { ApiProperty } from '@nestjs/swagger';
import { InventoryItemStatus } from '@prisma/client';
import { IsArray, IsEnum, IsISO8601, IsOptional, IsString } from 'class-validator';

export class CreateInventoryItemDto {
  @ApiProperty({ example: 'clu7prd0000008l43a9d6qk2' })
  @IsString()
  productId!: string;

  @ApiProperty({ example: 'clu7var0000008l4czg5as9f', required: false })
  @IsOptional()
  @IsString()
  variantId?: string;

  @ApiProperty({ example: 'excellent', required: false })
  @IsOptional()
  @IsString()
  condition?: string;

  @ApiProperty({ type: [String], example: ['https://cdn.example.com/items/1.jpg'], required: false })
  @IsOptional()
  @IsArray()
  imageUrls?: string[];
}

export class UpdateInventoryStatusDto {
  @ApiProperty({ enum: InventoryItemStatus, example: InventoryItemStatus.MAINTENANCE })
  @IsEnum(InventoryItemStatus)
  status!: InventoryItemStatus;

  @ApiProperty({ example: 'Loose button sent to tailor.', required: false })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class CalendarBlockDto {
  @ApiProperty({ example: 'clu7inv0000008l4xj3g6fdj' })
  @IsString()
  inventoryItemId!: string;

  @ApiProperty({ example: '2026-05-08T00:00:00.000Z' })
  @IsISO8601()
  startDate!: string;

  @ApiProperty({ example: '2026-05-10T23:59:59.000Z' })
  @IsISO8601()
  endDate!: string;

  @ApiProperty({ example: 'maintenance' })
  @IsString()
  reason!: string;
}
