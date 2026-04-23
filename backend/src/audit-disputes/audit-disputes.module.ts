import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditDisputesController } from './audit-disputes.controller';
import { AuditDisputesService } from './audit-disputes.service';

@Module({
  imports: [PrismaModule],
  controllers: [AuditDisputesController],
  providers: [AuditDisputesService],
  exports: [AuditDisputesService],
})
export class AuditDisputesModule {}
