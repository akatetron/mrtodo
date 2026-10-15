-- Mr. Todo — remove the demo accounts created by seed_demo.sql
--
-- Run this in your Supabase project's SQL Editor before real users arrive.
-- Those passwords are published in a public repository, so leaving the
-- accounts in place lets anyone who finds them sign in — including as an
-- admin, who can read every task and every uploaded ID document.
--
-- This removes the three demo sign-ins, their profiles (via cascade) and the
-- sample tasks that belong to them. Nothing else is touched.

do $$
declare
  v_emails text[] := array['priya@example.com', 'rakesh@example.com', 'admin@example.com'];
  v_removed int;
begin
  delete from tasks
   where customer_id in (select id from profiles where email = any (v_emails))
      or assigned_worker_id in (select id from profiles where email = any (v_emails));

  delete from auth.users where email = any (v_emails);
  get diagnostics v_removed = row_count;

  raise notice 'Removed % demo account(s).', v_removed;
end $$;

-- Should come back empty.
select email, role from profiles where email in
  ('priya@example.com', 'rakesh@example.com', 'admin@example.com');
