import { Module } from '@nestjs/common';
import { ProductsModule } from '../products/products.module';
import { ScanController } from './scan.controller';

@Module({
  imports: [ProductsModule],
  controllers: [ScanController],
})
export class ScanModule {}
