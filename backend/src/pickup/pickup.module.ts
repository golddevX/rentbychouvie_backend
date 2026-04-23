import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PickupController } from './pickup.controller';
import { PickupService } from './pickup.service';
import { AuditDisputesModule } from '../audit-disputes/audit-disputes.module';

@Module({
  imports: [PrismaModule, AuditDisputesModule],
  controllers: [PickupController],
  providers: [PickupService],
})
export class PickupModule {}
