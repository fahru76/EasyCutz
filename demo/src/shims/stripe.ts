// The demo has no Stripe keys: payments are disabled, so checkout is never started.
export interface CheckoutRequest {
  [key: string]: unknown;
}

export async function createCheckoutSession(): Promise<{ id: string; url: string | null }> {
  throw new Error("Online payment is not available in the demo.");
}

export function getStripe(): never {
  throw new Error("Stripe is not available in the demo.");
}
