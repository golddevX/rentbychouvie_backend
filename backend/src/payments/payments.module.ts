import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { PaymentsWebhookController } from './payments-webhook.controller';
import { PayOSProvider } from './providers/payos.provider';
import { PaymentGatewayService } from './providers/payment-gateway.service';
import { AuditDisputesModule } from '../audit-disputes/audit-disputes.module';

@Module({
  imports: [PrismaModule, ConfigModule, AuditDisputesModule],
  controllers: [PaymentsController, PaymentsWebhookController],
  providers: [PaymentsService, PayOSProvider, PaymentGatewayService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
