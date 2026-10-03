import "server-only";

import Stripe from "stripe";
import { serverEnv } from "@/lib/env";
import type { BookingKind } from "@/lib/types/domain";
import { AppError } from "./errors";

let stripe: Stripe | null = null;

export function getStripe(): Stripe {
  const key = serverEnv.stripeSecretKey;
  if (!key || !serverEnv.paymentsEnabled) {
    throw new AppError(
      "payments_unavailable",
      503,
      "Online payment isn't available right now — please choose Pay at the shop.",
    );
  }
  if (!stripe) {
    stripe = new Stripe(key, { appInfo: { name: "EasyCutz" } });
  }
  return stripe;
}

/** Stripe requires Checkout Sessions to stay open for at least 30 minutes. */
const MIN_SESSION_MINUTES = 30;

export interface CheckoutRequest {
  kind: BookingKind;
  bookingId: string;
  accessToken: string;
  amountCents: number;
  currency: string;
  title: string;
  description: string;
  customerEmail: string | null;
  origin: string;
  holdMinutes: number;
}

export async function createCheckoutSession(req: CheckoutRequest): Promise<Stripe.Checkout.Session> {
  const client = getStripe();
  const currency = req.currency.toLowerCase();
  // FPX (Malaysian online banking) only works with MYR.
  const paymentMethodTypes: Stripe.Checkout.SessionCreateParams.AllowedPaymentMethodType[] =
    currency === "myr" ? ["card", "fpx"] : ["card"];
  const minutes = Math.max(MIN_SESSION_MINUTES, req.holdMinutes);

  return client.checkout.sessions.create(
    {
      mode: "payment",
      allowed_payment_method_types: paymentMethodTypes,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency,
            unit_amount: req.amountCents,
            product_data: { name: req.title, description: req.description.slice(0, 500) },
          },
        },
      ],
      customer_email: req.customerEmail ?? undefined,
      client_reference_id: req.bookingId,
      metadata: { booking_kind: req.kind, booking_id: req.bookingId },
      payment_intent_data: { metadata: { booking_kind: req.kind, booking_id: req.bookingId } },
      success_url: `${req.origin}/pass/${req.accessToken}?payment=success`,
      cancel_url: `${req.origin}/pass/${req.accessToken}?payment=cancelled`,
      expires_at: Math.floor(Date.now() / 1000) + minutes * 60,
    },
    { idempotencyKey: `checkout:${req.kind}:${req.bookingId}:${Math.floor(Date.now() / 60000)}` },
  );
}
