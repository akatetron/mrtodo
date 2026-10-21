// Razorpay -> Mr. Todo. Verifies the signature, then hands the event to the
// database, which applies it once (a repeat is recognised and ignored).
// Secrets (set with `supabase secrets set`): RAZORPAY_WEBHOOK_SECRET.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase to Edge Functions.
// The service-role key lives only here, never in an app.
// NOT verified against a live Razorpay account: see docs/DEPLOYMENT.md.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { verifySignature, parseEvent } from '../_shared/razorpay.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const raw = await req.text();                                   // the signature covers the exact bytes
  if (!verifySignature(raw, req.headers.get('x-razorpay-signature'), Deno.env.get('RAZORPAY_WEBHOOK_SECRET') ?? '')) {
    return new Response('Invalid signature', { status: 401 });
  }
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return new Response('Bad request', { status: 400 }); }
  const ev = parseEvent(req.headers.get('x-razorpay-event-id'), body);
  if (!ev) return new Response('Ignored', { status: 200 });
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data, error } = await db.rpc('apply_subscription_event', {
    p_provider: 'razorpay', p_event_id: ev.eventId, p_type: ev.type, p_provider_subscription: ev.providerSubscription,
    p_period_start: ev.periodStart, p_period_end: ev.periodEnd,
  });
  if (error) {
    console.error(JSON.stringify({ at: 'razorpay-webhook', error: error.message, type: ev.type }));   // no payload, no payer details
    return new Response('Retry', { status: 500 });                // Razorpay retries on a non-2xx
  }
  return new Response(JSON.stringify({ outcome: data }), { status: 200, headers: { 'content-type': 'application/json' } });
});
