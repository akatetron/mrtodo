// Pure helpers for the Razorpay webhook, kept free of Deno-only APIs so they are
// unit-tested with plain Node (see supabase/functions/tests/razorpay.test.mjs).
import { createHmac, timingSafeEqual } from 'node:crypto';

// Razorpay signs the raw request body with HMAC-SHA256 and the webhook secret,
// and sends the hex digest in X-Razorpay-Signature.
export function verifySignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature.trim(), 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface SubscriptionEvent {
  eventId: string;
  type: string;
  providerSubscription: string | null;
  periodStart: string | null;
  periodEnd: string | null;
}

const iso = (s?: number | null) => (typeof s === 'number' ? new Date(s * 1000).toISOString() : null);

// Pulls out only what the database function needs. No card or payer details are read.
export function parseEvent(eventIdHeader: string | null, body: any): SubscriptionEvent | null {
  const type = body?.event;
  if (typeof type !== 'string') return null;
  const sub = body?.payload?.subscription?.entity;
  const payment = body?.payload?.payment?.entity;
  const providerSubscription = sub?.id ?? payment?.subscription_id ?? null;
  const eventId = eventIdHeader || body?.id || null;      // Razorpay sends X-Razorpay-Event-Id
  if (!eventId) return null;
  return { eventId, type, providerSubscription, periodStart: iso(sub?.current_start), periodEnd: iso(sub?.current_end) };
}
