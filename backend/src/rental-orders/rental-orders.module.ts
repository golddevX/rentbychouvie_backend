import { Module } from '@nestjs/common';
import { RentalOrdersController } from './rental-orders.controller';
import { RentalOrdersService } from './rental-orders.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditDisputesModule } from '../audit-disputes/audit-disputes.module';

@Module({
  imports: [PrismaModule, AuditDisputesModule],
  controllers: [RentalOrdersController],
  providers: [RentalOrdersService],
  exports: [RentalOrdersService],
})
export class RentalOrdersModule {}
