import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PricingModule } from '../pricing/pricing.module';
import { ReturnsController } from './returns.controller';
import { ReturnsService } from './returns.service';
import { AuditDisputesModule } from '../audit-disputes/audit-disputes.module';

@Module({
  imports: [PrismaModule, PricingModule, AuditDisputesModule],
  controllers: [ReturnsController],
  providers: [ReturnsService],
})
export class ReturnsModule {}
