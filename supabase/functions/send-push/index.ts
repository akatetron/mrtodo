// Delivery worker for the outbox. Run on a schedule (every minute) with the
// service-role key. Uses Expo's push service. NOT verified against live devices.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

Deno.serve(async (req) => {
  if (req.headers.get('authorization') !== `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`) return new Response('Forbidden', { status: 403 });
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: jobs, error } = await db.rpc('claim_outbox', { p_batch: 50 });
  if (error) return new Response('Error', { status: 500 });
  let sent = 0, failed = 0;
  for (const job of jobs ?? []) {
    try {
      if (!job.tokens.length) { await db.rpc('finish_outbox', { p_id: job.id, p_ok: true }); continue; }
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(job.tokens.map((to: string) => ({ to, title: job.payload.title, body: job.payload.body, data: { task_id: job.payload.task_id } }))),
      });
      if (!res.ok) throw new Error(`Expo ${res.status}`);
      await db.rpc('finish_outbox', { p_id: job.id, p_ok: true }); sent++;
    } catch (e) {
      await db.rpc('finish_outbox', { p_id: job.id, p_ok: false, p_error: String((e as Error).message) }); failed++;
    }
  }
  return new Response(JSON.stringify({ sent, failed }), { headers: { 'content-type': 'application/json' } });
});
