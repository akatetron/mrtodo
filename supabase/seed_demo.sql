-- Mr. Todo — demo accounts for testing
--
--   Customer          priya@example.com    demo1234
--   Personal Manager  rakesh@example.com   demo1234   (already approved)
--   Admin             admin@example.com    demo1234
--
-- Run this AFTER schema.sql, in your Supabase project's SQL Editor
-- (Project → SQL Editor → New query → paste → Run). It is safe to run again:
-- it clears these three accounts and their sample tasks first, so you always
-- get the same clean starting point.
--
-- It also posts two sample tasks so nothing is empty on first look: one
-- waiting for a Personal Manager (practise assigning it in the admin
-- dashboard) and one already offered to Rakesh (he can accept it in the app).
--
-- ⚠ DELETE THESE BEFORE REAL USERS ARRIVE. These passwords are published in a
-- public repository, so anyone who finds them can sign in — and the admin
-- account can read every task and every uploaded ID document. Run
-- seed_demo_remove.sql to get rid of them.

do $$
declare
  v_customer uuid;
  v_worker   uuid;
  v_admin    uuid;
  v_has_provider_id boolean;
  v_emails text[] := array['priya@example.com', 'rakesh@example.com', 'admin@example.com'];
begin
  -- pgcrypto (crypt/gen_salt) lives in the "extensions" schema on Supabase and
  -- in "public" on a plain Postgres; this makes it resolve on both.
  perform set_config('search_path', 'public, extensions', true);

  -- 1. Clear out any previous run ---------------------------------------------
  -- Tasks reference profiles without ON DELETE CASCADE, so they go first.
  -- Deleting the auth user then cascades to the profile.
  delete from tasks
   where customer_id in (select id from profiles where email = any (v_emails))
      or assigned_worker_id in (select id from profiles where email = any (v_emails));
  delete from auth.users where email = any (v_emails);

  -- 2. Create the three sign-ins ----------------------------------------------
  -- email_confirmed_at is set so you can log in without a confirmation email.
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  )
  values
    ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
     'priya@example.com', crypt('demo1234', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}',
     '{"full_name":"Priya Sharma","role":"customer","phone":"98200 11111"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
     'rakesh@example.com', crypt('demo1234', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}',
     '{"full_name":"Rakesh Kumar","role":"worker","phone":"98200 22222"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
     'admin@example.com', crypt('demo1234', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}',
     '{"full_name":"Mr. Todo Admin","role":"customer","phone":"98200 00000"}', now(), now());

  select id into v_customer from auth.users where email = 'priya@example.com';
  select id into v_worker   from auth.users where email = 'rakesh@example.com';
  select id into v_admin    from auth.users where email = 'admin@example.com';

  -- 3. Identity rows -----------------------------------------------------------
  -- Supabase wants one per sign-in method. Older projects have no provider_id
  -- column, so check before writing.
  select exists (
    select 1 from information_schema.columns
     where table_schema = 'auth' and table_name = 'identities' and column_name = 'provider_id'
  ) into v_has_provider_id;

  if v_has_provider_id then
    insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
    select u.id::text, u.id,
           jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
           'email', now(), now()
      from auth.users u
     where u.email = any (v_emails);
  else
    insert into auth.identities (user_id, identity_data, provider, created_at, updated_at)
    select u.id,
           jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
           'email', now(), now()
      from auth.users u
     where u.email = any (v_emails);
  end if;

  -- 4. Fill in the profiles -----------------------------------------------------
  -- schema.sql's signup trigger already created a row for each. It refuses to
  -- make anyone an admin, and new Personal Managers start unapproved, so set
  -- those here the way a real admin would.
  update profiles set rating = 4.8, rating_count = 3
   where id = v_customer;

  update profiles set
      role = 'worker', worker_status = 'approved',
      categories = array['handyman', 'moving'],
      service_area = 'Kandivali', experience_years = 6,
      bio = 'Plumbing and general repairs. Carries his own tools.',
      rating = 4.9, rating_count = 12, jobs_done = 214, online = true,
      applied_at = now() - interval '9 days', reviewed_at = now() - interval '8 days'
   where id = v_worker;

  update profiles set role = 'admin' where id = v_admin;

  -- 5. Two sample tasks ----------------------------------------------------------
  -- One still sitting in the admin queue.
  insert into tasks (customer_id, title, description, category, task_type, status,
                     scheduled_for, location, est_cost, for_whom, created_at)
  values (v_customer, 'Fix leaking kitchen tap',
          'Tap has been dripping for 2 days, water pooling under the sink. Might need a new washer.',
          'handyman', 'one-time', 'requested', 'Sat 26 Aug, 11:00 AM',
          'Flat 4B, Kandivali West', 650, 'self', now() - interval '20 minutes');

  -- One already offered to Rakesh, so he has something to accept.
  insert into tasks (customer_id, title, description, category, task_type, status,
                     scheduled_for, location, rate_per_day, for_whom,
                     recipient_name, recipient_relation, recipient_phone,
                     assigned_worker_id, assigned_at, created_at)
  values (v_customer, 'Accompany my mother to the bank',
          'Someone to take her for paperwork and wait with her. Likely a few visits.',
          'care', 'ongoing', 'matched', 'Weekday mornings',
          'Malad West', 400, 'other', 'Kamala Bai', 'Mother', '98200 33333',
          v_worker, now() - interval '5 minutes', now() - interval '2 hours');

  update profiles set last_assigned_at = now() - interval '5 minutes' where id = v_worker;

  raise notice 'Demo accounts ready. All three use the password: demo1234';
end $$;

-- What you should see now. The completion code is the one Priya reads out to
-- Rakesh when a job is done.
select p.email,
       p.role,
       case when p.role = 'worker' then p.worker_status else '—' end as verification,
       'demo1234' as password
  from profiles p
 where p.email in ('priya@example.com', 'rakesh@example.com', 'admin@example.com')
 order by p.role, p.email;

select t.title, t.status, o.code as completion_code
  from tasks t
  join profiles p on p.id = t.customer_id
  left join task_otps o on o.task_id = t.id
 where p.email = 'priya@example.com'
 order by t.created_at;
