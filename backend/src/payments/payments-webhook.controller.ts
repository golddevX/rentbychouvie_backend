import { Body, Controller, Headers, Post } from '@nestjs/common';
import { PaymentsService } from './payments.service';

@Controller('payments/webhooks')
export class PaymentsWebhookController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('payos')
  async handlePayOSWebhook(
    @Body() payload: Record<string, any>,
    @Headers('x-payos-signature') signature?: string,
  ) {
    return this.paymentsService.handleProviderWebhook('PAYOS', payload, signature);
  }
}

