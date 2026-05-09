import { Module } from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { BookingsController } from './bookings.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { PricingModule } from '../pricing/pricing.module';
import { AuditDisputesModule } from '../audit-disputes/audit-disputes.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [PrismaModule, PricingModule, AuditDisputesModule, PaymentsModule],
  controllers: [BookingsController],
  providers: [BookingsService],
  exports: [BookingsService],
})
export class BookingsModule {}
