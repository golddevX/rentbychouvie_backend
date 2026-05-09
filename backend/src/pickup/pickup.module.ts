import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PickupController } from './pickup.controller';
import { PickupService } from './pickup.service';
import { AuditDisputesModule } from '../audit-disputes/audit-disputes.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [PrismaModule, AuditDisputesModule, PaymentsModule],
  controllers: [PickupController],
  providers: [PickupService],
})
export class PickupModule {}
