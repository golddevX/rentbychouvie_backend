import { Module } from '@nestjs/common';
import { LeadsService } from './leads.service';
import { LeadsController } from './leads.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { PricingModule } from '../pricing/pricing.module';
import { AuditDisputesModule } from '../audit-disputes/audit-disputes.module';
import { LeadWorkflowService } from './lead-workflow.service';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [PrismaModule, PricingModule, AuditDisputesModule, PaymentsModule],
  controllers: [LeadsController],
  providers: [LeadsService, LeadWorkflowService],
  exports: [LeadsService, LeadWorkflowService],
})
export class LeadsModule {}
