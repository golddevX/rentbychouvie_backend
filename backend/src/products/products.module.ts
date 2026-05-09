import { Module } from '@nestjs/common';
import { AuditDisputesModule } from '../audit-disputes/audit-disputes.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ProductsController } from './products.controller';
import { ProductAvailabilityService } from './product-availability.service';
import { ProductsService } from './products.service';

@Module({
  imports: [PrismaModule, AuditDisputesModule],
  controllers: [ProductsController],
  providers: [ProductsService, ProductAvailabilityService],
  exports: [ProductsService, ProductAvailabilityService],
})
export class ProductsModule {}
