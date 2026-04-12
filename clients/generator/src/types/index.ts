export interface Event {
  id: string;
  eventTime: string;
  eventType: 'order_created' | 'payment_initiated' | 'payment_success' | 'payment_failed' | 'order_cancelled';
  orderId: string;
  userId: string;
  amount: number;
  currency: string;
  status: 'success' | 'failed' | 'pending';
  metadata: {
    device: 'mobile' | 'desktop' | 'tablet';
    ip?: string;
    sessionId?: string;
  };
}

export interface Distribution {
  order_created: number;
  payment_initiated: number;
  payment_success: number;
  payment_failed: number;
  order_cancelled: number;
}

export interface Config {
  distribution: Distribution;
  defaultCount: number;
  ratePerSec: number;
  amountRules?: Record<string, string>;
}

export interface EmitRequest {
  eventType?: string;
  status?: string;
  amount?: number;
  orderId?: string;
  userId?: string;
  lateMinutes?: number;
}
