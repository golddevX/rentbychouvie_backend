import { PaymentGateway } from '@prisma/client';

export type CheckoutInitInput = {
  amount: number;
  currency: string;
  orderCode: string;
  description?: string;
  returnUrl?: string;
  callbackUrl?: string;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
};

export type CheckoutInitOutput = {
  provider: PaymentGateway;
  providerTransactionId: string;
  checkoutUrl: string;
  raw?: unknown;
};

export type VerifiedWebhook = {
  provider: PaymentGateway;
  providerEventId: string;
  providerTransactionId: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'PROCESSING';
  amount?: number;
  currency?: string;
  metadata?: Record<string, unknown>;
  raw?: unknown;
};

export interface PaymentProviderAdapter {
  gateway: PaymentGateway;
  initializeCheckout(input: CheckoutInitInput): Promise<CheckoutInitOutput>;
  verifyWebhook(payload: Record<string, any>, signature?: string): Promise<VerifiedWebhook>;
}

