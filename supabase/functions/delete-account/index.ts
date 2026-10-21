// Finishes an account deletion: the customer's own session calls the database to
// erase their details, then this function (with the service-role key, which never
// leaves the server) removes their uploaded documents and disables the sign-in.
// The sign-in is disabled rather than deleted so that records the business must
// keep (tasks, quotes, audit events) are not broken. NOT verified against a live project.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

Deno.serve(async (req) => {
  const auth = req.headers.get('authorization') ?? '';
  const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { authorization: auth } } });
  const { data: u } = await asUser.auth.getUser();
  if (!u?.user) return new Response('Sign in first', { status: 401 });
  const { data: paths, error } = await asUser.rpc('request_account_deletion');   // refuses if open tasks or a live subscription
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 409, headers: { 'content-type': 'application/json' } });
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  if (paths?.length) await admin.storage.from('pm-documents').remove(paths);
  await admin.auth.admin.updateUserById(u.user.id, {
    email: `deleted-${u.user.id}@deleted.invalid`, phone: '', user_metadata: {}, ban_duration: '876000h',
  });
  return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } });
});
