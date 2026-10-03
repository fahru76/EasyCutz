import type Stripe from "stripe";
import { serverEnv } from "@/lib/env";
import { settleCheckout } from "@/lib/server/data";
import { AppError } from "@/lib/server/errors";
import { getStripe } from "@/lib/server/stripe";

/**
 * POST /api/stripe/webhook
 * Subscribe in the Stripe dashboard to:
 *   checkout.session.completed, checkout.session.async_payment_succeeded,
 *   checkout.session.async_payment_failed, checkout.session.expired
 */
export async function POST(request: Request): Promise<Response> {
  const secret = serverEnv.stripeWebhookSecret;
  const signature = request.headers.get("stripe-signature");
  if (!secret || !signature) {
    return Response.json({ error: "webhook_not_configured" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    const payload = await request.text();
    event = getStripe().webhooks.constructEvent(payload, signature, secret);
  } catch (err) {
    console.warn("[easycutz] rejected Stripe webhook:", err instanceof Error ? err.message : err);
    return Response.json({ error: "invalid_signature" }, { status: 400 });
  }

  const intentId = (session: Stripe.Checkout.Session): string | null =>
    typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id ?? null);

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        // Delayed methods report "unpaid" here and settle via async_payment_* later.
        if (session.payment_status === "paid" || session.payment_status === "no_payment_required") {
          await settleCheckout(session.id, true, intentId(session));
        }
        break;
      }
      case "checkout.session.async_payment_succeeded":
        await settleCheckout(event.data.object.id, true, intentId(event.data.object));
        break;
      case "checkout.session.async_payment_failed":
      case "checkout.session.expired":
        await settleCheckout(event.data.object.id, false, intentId(event.data.object));
        break;
      default:
        break;
    }
  } catch (err) {
    if (err instanceof AppError && err.code === "not_found") {
      // Session wasn't created by this app (e.g. another product on the same account).
      return Response.json({ received: true, ignored: true });
    }
    console.error("[easycutz] webhook processing failed:", err);
    return Response.json({ error: "processing_failed" }, { status: 500 }); // Stripe will retry
  }

  return Response.json({ received: true });
}
