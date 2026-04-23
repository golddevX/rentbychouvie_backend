import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentGateway } from '@prisma/client';
import { createHmac, randomUUID } from 'crypto';
import { CheckoutInitInput, CheckoutInitOutput, PaymentProviderAdapter, VerifiedWebhook } from './payment-provider.interface';

@Injectable()
export class PayOSProvider implements PaymentProviderAdapter {
  gateway = PaymentGateway.PAYOS;

  constructor(private configService: ConfigService) {}

  private getSecret() {
    return this.configService.get<string>('PAYOS_WEBHOOK_SECRET') || 'dev-payos-secret';
  }

  async initializeCheckout(input: CheckoutInitInput): Promise<CheckoutInitOutput> {
    const providerTransactionId = `payos_${randomUUID().replace(/-/g, '').slice(0, 22)}`;
    const baseUrl = this.configService.get<string>('PAYOS_CHECKOUT_BASE_URL') || 'https://pay.payos.vn/checkout';
    const checkoutUrl = `${baseUrl}?tx=${encodeURIComponent(providerTransactionId)}&amount=${input.amount}&orderCode=${encodeURIComponent(input.orderCode)}`;

    return {
      provider: this.gateway,
      providerTransactionId,
      checkoutUrl,
      raw: {
        orderCode: input.orderCode,
        returnUrl: input.returnUrl,
        callbackUrl: input.callbackUrl,
      },
    };
  }

  async verifyWebhook(payload: Record<string, any>, signature?: string): Promise<VerifiedWebhook> {
    const providerEventId = String(payload.eventId || payload.id || randomUUID());
    const providerTransactionId = String(payload.transactionId || payload.orderCode || '');
    const amount = Number(payload.amount ?? 0);
    const normalizedStatus = String(payload.status || 'PENDING').toUpperCase();
    const status =
      normalizedStatus === 'PAID' || normalizedStatus === 'SUCCESS'
        ? 'SUCCESS'
        : normalizedStatus === 'FAILED'
          ? 'FAILED'
          : normalizedStatus === 'CANCELLED'
            ? 'CANCELLED'
            : normalizedStatus === 'PROCESSING'
              ? 'PROCESSING'
              : 'PENDING';

    const signingPayload = `${providerEventId}:${providerTransactionId}:${status}:${amount}`;
    const expectedSignature = createHmac('sha256', this.getSecret()).update(signingPayload).digest('hex');

    if (signature && signature !== expectedSignature) {
      throw new Error('Invalid webhook signature');
    }

    return {
      provider: this.gateway,
      providerEventId,
      providerTransactionId,
      status,
      amount,
      currency: String(payload.currency || 'VND'),
      metadata: payload.metadata || {},
      raw: payload,
    };
  }
}

