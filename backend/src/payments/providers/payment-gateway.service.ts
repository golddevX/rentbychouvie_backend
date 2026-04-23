import { Injectable } from '@nestjs/common';
import { PaymentGateway } from '@prisma/client';
import { PayOSProvider } from './payos.provider';
import { PaymentProviderAdapter } from './payment-provider.interface';

@Injectable()
export class PaymentGatewayService {
  private readonly adapters: Record<PaymentGateway, PaymentProviderAdapter>;

  constructor(private payOSProvider: PayOSProvider) {
    this.adapters = {
      PAYOS: this.payOSProvider,
      STRIPE: this.payOSProvider,
      VNPAY: this.payOSProvider,
      MOMO: this.payOSProvider,
      MANUAL: this.payOSProvider,
    };
  }

  getAdapter(gateway: PaymentGateway) {
    return this.adapters[gateway] ?? this.payOSProvider;
  }

  getWebhookAdapter(provider: string) {
    const gateway = (provider || 'PAYOS').toUpperCase() as PaymentGateway;
    return this.getAdapter(gateway);
  }
}

