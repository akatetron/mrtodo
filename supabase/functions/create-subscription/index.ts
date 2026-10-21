// Called by the app with the customer's session after start_subscription().
// Creates the subscription at Razorpay and returns its hosted payment link.
// Secrets: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET. NOT verified against a live account.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

Deno.serve(async (req) => {
  const auth = req.headers.get('authorization') ?? '';
  const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { authorization: auth } } });
  const { data: u } = await asUser.auth.getUser();
  if (!u?.user) return new Response('Sign in first', { status: 401 });
  const { subscription_id } = await req.json().catch(() => ({}));
  // RLS: the customer can read only their own subscription.
  const { data: sub } = await asUser.from('subscriptions').select('id, plan_code, status, provider_subscription_id').eq('id', subscription_id).maybeSingle();
  if (!sub || sub.status !== 'pending') return new Response('Not found', { status: 404 });
  const { data: plan } = await asUser.from('subscription_plans').select('provider_plan_id').eq('code', sub.plan_code).maybeSingle();
  if (!plan?.provider_plan_id) return new Response('Plan not available', { status: 409 });
  const basic = btoa(`${Deno.env.get('RAZORPAY_KEY_ID')}:${Deno.env.get('RAZORPAY_KEY_SECRET')}`);
  const res = await fetch('https://api.razorpay.com/v1/subscriptions', {
    method: 'POST', headers: { authorization: `Basic ${basic}`, 'content-type': 'application/json' },
    body: JSON.stringify({ plan_id: plan.provider_plan_id, total_count: 120, customer_notify: 1, notes: { subscription_id: sub.id } }),
  });
  const body = await res.json();
  if (!res.ok) { console.error(JSON.stringify({ at: 'create-subscription', status: res.status })); return new Response('Payment provider error', { status: 502 }); }
  const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  await service.rpc('attach_provider_subscription', { p_subscription: sub.id, p_provider_subscription: body.id });
  return new Response(JSON.stringify({ payment_url: body.short_url }), { headers: { 'content-type': 'application/json' } });
});
