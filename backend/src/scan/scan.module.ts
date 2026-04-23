import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { ScanController } from './scan.controller';

@Module({
  imports: [InventoryModule],
  controllers: [ScanController],
})
export class ScanModule {}
