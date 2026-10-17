-- Mr. Todo — Supabase database schema
--
-- Run this in your Supabase project's SQL Editor (Project → SQL Editor → New
-- query → paste → Run). It is safe to run again at any time: it creates what is
-- missing and upgrades a database created from an earlier version of this file.
--
-- Security model in one paragraph: clients (the app and the admin dashboard)
-- may only READ rows they are allowed to see and INSERT a few things of their
-- own (a task, a visit, a document). Every state change on a task — assign,
-- accept, start, complete, cancel, rate — goes through the SECURITY DEFINER
-- functions in section 6, which check who is calling and whether the move is
-- allowed. Roles and PM approval can only be changed by an admin.

-- 1. Helpers -------------------------------------------------------------------

-- Task categories a PM can be verified for. Keep in sync with CATEGORIES in
-- app/src/data/store.js and admin/src/lib/constants.js.
create or replace function public.valid_categories()
returns text[] language sql immutable as $$
  select array['handyman', 'cleaning', 'moving', 'delivery', 'care'];
$$;

-- 2. Profiles --------------------------------------------------------------------
-- One row per signed-up user, linked to Supabase's built-in auth.users table.
-- role: 'customer' | 'worker' (Personal Manager) | 'admin'
create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  role text not null default 'customer' check (role in ('customer', 'worker', 'admin')),
  phone text,
  rating numeric(2,1),
  categories text[] default '{}',      -- for PMs: which task categories they're qualified for
  jobs_done int default 0,
  distance_km numeric(4,1),
  online boolean default true,
  created_at timestamptz default now()
);

alter table profiles add column if not exists email text;
alter table profiles add column if not exists rating_count int not null default 0;
alter table profiles add column if not exists bio text;
alter table profiles add column if not exists experience_years int;
alter table profiles add column if not exists service_area text;
-- PM verification lifecycle:
--   none      customers / admins (not applicable)
--   draft     signed up as a PM, application not submitted yet
--   pending   submitted, waiting for an admin
--   more_info admin asked for more information (see application_note)
--   approved  verified — can be assigned tasks
--   rejected  application turned down
--   suspended was approved, taken off the platform by an admin
alter table profiles add column if not exists worker_status text not null default 'none';
alter table profiles add column if not exists application_note text;  -- admin's message to the applicant
alter table profiles add column if not exists applied_at timestamptz;
alter table profiles add column if not exists reviewed_at timestamptz;
alter table profiles add column if not exists reviewed_by uuid references profiles (id);
alter table profiles add column if not exists last_assigned_at timestamptz;
alter table profiles alter column rating drop default;

do $$ begin
  alter table profiles add constraint profiles_worker_status_check
    check (worker_status in ('none', 'draft', 'pending', 'more_info', 'approved', 'rejected', 'suspended'));
exception when duplicate_object then null; end $$;

-- Admin levels: 'super' can do everything; 'support' can run day-to-day work
-- (assign, reassign, cancel, handle reports) but cannot approve or suspend
-- Personal Managers, see ID documents, handle money or send broadcasts.
-- Admins created before levels existed have no level and count as super.
alter table profiles add column if not exists admin_level text;
do $$ begin
  alter table profiles add constraint profiles_admin_level_check check (admin_level in ('super', 'support'));
exception when duplicate_object then null; end $$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles
                  where id = auth.uid() and role = 'admin' and coalesce(admin_level, 'super') = 'super');
$$;

-- Earlier versions let anyone who picked "Personal Manager" at signup work
-- immediately. Send those accounts through the application flow.
update profiles set worker_status = 'draft' where role = 'worker' and worker_status = 'none';

-- 3. Tasks ------------------------------------------------------------------------
-- status lifecycle:
--   requested   posted by the customer, waiting for an admin to match a PM
--   matched     admin offered it to a PM, waiting for the PM to accept
--   assigned    PM accepted
--   in_progress PM started work
--   completed   PM entered the customer's completion code
--   cancelled   customer or admin cancelled it
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles (id),
  assigned_worker_id uuid references profiles (id),
  title text not null,
  description text,
  category text not null,
  task_type text not null default 'one-time' check (task_type in ('one-time', 'ongoing')),
  status text not null default 'requested'
    check (status in ('requested', 'matched', 'assigned', 'in_progress', 'completed', 'cancelled')),
  scheduled_for text,
  location text not null,
  est_cost numeric(10,2),
  rate_per_day numeric(10,2),
  for_whom text default 'self' check (for_whom in ('self', 'other')),
  recipient_name text,
  recipient_relation text,
  recipient_phone text,
  customer_rating_of_worker numeric(2,1),  -- filled in after completion
  worker_rating_of_customer numeric(2,1),  -- filled in after completion
  created_at timestamptz default now()
);

alter table tasks add column if not exists customer_review text;
alter table tasks add column if not exists assigned_at timestamptz;
alter table tasks add column if not exists accepted_at timestamptz;
alter table tasks add column if not exists started_at timestamptz;
alter table tasks add column if not exists completed_at timestamptz;
alter table tasks add column if not exists cancelled_at timestamptz;
alter table tasks add column if not exists cancel_reason text;

create index if not exists tasks_customer_idx on tasks (customer_id);
create index if not exists tasks_worker_idx on tasks (assigned_worker_id);
create index if not exists tasks_status_idx on tasks (status);

-- Completion codes live in their own table so that only the customer (and
-- admins) can read them. Earlier versions kept the code on the task row, where
-- the PM could read it too and skip asking the customer.
create table if not exists task_otps (
  task_id uuid primary key references tasks (id) on delete cascade,
  code text not null,
  failed_attempts int not null default 0
);

do $$ begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'tasks' and column_name = 'otp') then
    insert into task_otps (task_id, code)
      select id, otp from tasks where otp is not null
      on conflict (task_id) do nothing;
    alter table tasks drop column otp;
  end if;
end $$;

-- PMs who declined a task, so the shortlist can push them down next time.
create table if not exists task_declines (
  task_id uuid references tasks (id) on delete cascade,
  worker_id uuid references profiles (id) on delete cascade,
  reason text,
  created_at timestamptz default now(),
  primary key (task_id, worker_id)
);

-- 4. Visits (for multi-day / ongoing tasks) -----------------------------------
create table if not exists task_visits (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks (id) on delete cascade,
  note text,
  done boolean default true,
  created_at timestamptz default now()
);

-- 5. PM documents + audit log -------------------------------------------------
create table if not exists pm_documents (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null default auth.uid() references profiles (id) on delete cascade,
  doc_type text not null check (doc_type in ('id', 'qualification', 'other')),
  label text,
  storage_path text not null,           -- path inside the private "pm-documents" bucket
  created_at timestamptz default now()
);

alter table pm_documents add column if not exists expires_on date;

create table if not exists audit_log (
  id bigserial primary key,
  actor_id uuid references profiles (id) on delete set null,
  action text not null,                 -- e.g. 'task.assigned', 'pm.approved'
  entity text not null,                 -- 'task' | 'profile'
  entity_id uuid,
  details jsonb default '{}',
  created_at timestamptz default now()
);
create index if not exists audit_log_created_idx on audit_log (created_at desc);

create or replace function public.log_action(p_action text, p_entity text, p_entity_id uuid, p_details jsonb default '{}')
returns void language sql security definer set search_path = public as $$
  insert into audit_log (actor_id, action, entity, entity_id, details)
  values (auth.uid(), p_action, p_entity, p_entity_id, coalesce(p_details, '{}'));
$$;
revoke execute on function public.log_action(text, text, uuid, jsonb) from public, anon, authenticated;

-- True when the caller and `other` are the customer and PM of the same task,
-- so each can see the other's name, phone and rating.
create or replace function public.shares_task(other uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from tasks t
    where (t.customer_id = auth.uid() and t.assigned_worker_id = other)
       or (t.assigned_worker_id = auth.uid() and t.customer_id = other)
  );
$$;

-- 6. Guards (triggers) ----------------------------------------------------------
-- A direct update from the app runs as the database role "authenticated".
-- The functions in section 7 run as the table owner, so they pass these guards.

create or replace function public.guard_profile_update()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') and new.admin_level is distinct from old.admin_level then
    raise exception 'Admin levels can only be changed by a super admin from the admin tools.';
  end if;
  if current_user in ('authenticated', 'anon') and not is_super_admin() then
    if new.id is distinct from old.id
       or new.role is distinct from old.role
       or new.worker_status is distinct from old.worker_status
       or new.rating is distinct from old.rating
       or new.rating_count is distinct from old.rating_count
       or new.jobs_done is distinct from old.jobs_done
       or new.email is distinct from old.email
       or new.application_note is distinct from old.application_note
       or new.applied_at is distinct from old.applied_at
       or new.reviewed_at is distinct from old.reviewed_at
       or new.reviewed_by is distinct from old.reviewed_by
       or new.last_assigned_at is distinct from old.last_assigned_at then
      raise exception 'You cannot change these profile fields yourself.';
    end if;
    -- Verified skills are locked while an application is under review or approved.
    if old.worker_status in ('pending', 'approved', 'suspended')
       and (new.categories is distinct from old.categories
            or new.experience_years is distinct from old.experience_years) then
      raise exception 'Contact support to change your verified skills.';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists guard_profile_update on profiles;
create trigger guard_profile_update before update on profiles
  for each row execute procedure public.guard_profile_update();

create or replace function public.guard_task_insert()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') then
    if not exists (select 1 from profiles where id = auth.uid() and role in ('customer', 'admin')) then
      raise exception 'Only customer accounts can post tasks.';
    end if;
    if not (new.category = any (valid_categories())) then
      raise exception 'Unknown category %', new.category;
    end if;
    new.customer_id := auth.uid();
    new.status := 'requested';
    new.assigned_worker_id := null;
    new.customer_rating_of_worker := null;
    new.worker_rating_of_customer := null;
    new.customer_review := null;
    new.assigned_at := null; new.accepted_at := null; new.started_at := null;
    new.completed_at := null; new.cancelled_at := null; new.cancel_reason := null;
    new.created_at := now();
  end if;
  return new;
end $$;

drop trigger if exists guard_task_insert on tasks;
create trigger guard_task_insert before insert on tasks
  for each row execute procedure public.guard_task_insert();

-- Every new task gets a 4-digit completion code the customer shares with the
-- PM when the work is done.
create or replace function public.after_task_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into task_otps (task_id, code)
  values (new.id, lpad((abs(('x' || substr(md5(gen_random_uuid()::text), 1, 8))::bit(32)::int) % 10000)::text, 4, '0'))
  on conflict (task_id) do nothing;
  perform log_action('task.created', 'task', new.id, jsonb_build_object('title', new.title, 'category', new.category));
  perform notify_admins('task', 'New task needs a Personal Manager', new.title, new.id);
  return new;
end $$;

drop trigger if exists after_task_insert on tasks;
create trigger after_task_insert after insert on tasks
  for each row execute procedure public.after_task_insert();

-- Auto-create a profile row whenever someone signs up. Reads "full_name",
-- "role" and "phone" from signUp()'s options.data. Only 'customer' or 'worker'
-- can be chosen at signup — admins are promoted by hand (see SETUP_BACKEND.md).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role text := case when new.raw_user_meta_data->>'role' = 'worker' then 'worker' else 'customer' end;
begin
  insert into profiles (id, full_name, role, email, phone, worker_status)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), 'New user'),
    v_role,
    new.email,
    nullif(trim(new.raw_user_meta_data->>'phone'), ''),
    case when v_role = 'worker' then 'draft' else 'none' end
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 7. Actions (RPC functions the app and admin dashboard call) --------------------

-- PM submits (or re-submits after "more info") their application.
create or replace function public.submit_pm_application(
  p_full_name text, p_phone text, p_bio text, p_categories text[],
  p_experience_years int, p_service_area text
) returns void language plpgsql security definer set search_path = public as $$
declare me profiles;
begin
  select * into me from profiles where id = auth.uid() for update;
  if me.id is null or me.role <> 'worker' then
    raise exception 'Only Personal Manager accounts can apply.';
  end if;
  if me.worker_status not in ('draft', 'more_info') then
    raise exception 'Your application is already %.', me.worker_status;
  end if;
  if coalesce(trim(p_full_name), '') = '' or coalesce(trim(p_phone), '') = '' or coalesce(trim(p_service_area), '') = '' then
    raise exception 'Name, phone and service area are required.';
  end if;
  if coalesce(array_length(p_categories, 1), 0) = 0 or not (p_categories <@ valid_categories()) then
    raise exception 'Pick at least one valid skill category.';
  end if;
  if not exists (select 1 from pm_documents where worker_id = me.id and doc_type = 'id') then
    raise exception 'Upload a government ID before submitting.';
  end if;

  update profiles set
    full_name = trim(p_full_name), phone = trim(p_phone), bio = nullif(trim(p_bio), ''),
    categories = p_categories, experience_years = greatest(coalesce(p_experience_years, 0), 0),
    service_area = trim(p_service_area), worker_status = 'pending', applied_at = now()
  where id = me.id;

  perform log_action('pm.applied', 'profile', me.id, jsonb_build_object('categories', p_categories));
  perform notify_admins('application', 'New Personal Manager application', trim(p_full_name) || ' applied', null);
end $$;

-- Admin decides on an application, or suspends / reinstates a PM.
create or replace function public.review_pm_application(p_worker uuid, p_decision text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare w profiles;
begin
  if not is_super_admin() then raise exception 'Only a super admin can review applications.'; end if;
  if p_decision not in ('approved', 'rejected', 'more_info', 'suspended') then
    raise exception 'Unknown decision %', p_decision;
  end if;
  select * into w from profiles where id = p_worker for update;
  if w.id is null or w.role <> 'worker' then raise exception 'Not a Personal Manager account.'; end if;
  if p_decision = 'more_info' and coalesce(trim(p_note), '') = '' then
    raise exception 'Tell the applicant what information is missing.';
  end if;

  update profiles set worker_status = p_decision, application_note = nullif(trim(p_note), ''),
    reviewed_at = now(), reviewed_by = auth.uid()
  where id = p_worker;

  perform log_action('pm.' || p_decision, 'profile', p_worker,
    jsonb_build_object('from', w.worker_status, 'note', p_note, 'name', w.full_name));
  perform notify_user(p_worker, 'application',
    case p_decision
      when 'approved' then 'You are approved — welcome to Mr. Todo'
      when 'rejected' then 'Your application was not approved'
      when 'more_info' then 'We need a little more information'
      else 'Your account has been paused' end,
    nullif(trim(p_note), ''), null);
end $$;

-- Ranked list of approved PMs for a task, best first. Admins only.
create or replace function public.shortlist_workers(p_task uuid)
returns table (
  id uuid, full_name text, rating numeric, rating_count int, jobs_done int,
  categories text[], service_area text, online boolean,
  category_match boolean, area_match boolean, declined boolean,
  active_jobs int, last_assigned_at timestamptz
) language plpgsql stable security definer set search_path = public as $$
declare t tasks;
begin
  if not is_admin() then raise exception 'Admins only.'; end if;
  select * into t from tasks where tasks.id = p_task;
  if t.id is null then raise exception 'Task not found.'; end if;

  return query
  select p.id, p.full_name, p.rating, p.rating_count, p.jobs_done, p.categories, p.service_area, p.online,
    t.category = any (coalesce(p.categories, '{}')) as category_match,
    (p.service_area is not null and t.location ilike '%' || p.service_area || '%') as area_match,
    exists (select 1 from task_declines d where d.task_id = t.id and d.worker_id = p.id) as declined,
    (select count(*)::int from tasks a where a.assigned_worker_id = p.id and a.status in ('matched', 'assigned', 'in_progress')) as active_jobs,
    p.last_assigned_at
  from profiles p
  where p.role = 'worker' and p.worker_status = 'approved'
  -- by position: category match, not declined, online, area match, rating, workload, longest idle
  order by 9 desc, 11 asc, 8 desc, 10 desc, 3 desc nulls last, 12 asc, 13 asc nulls first;
end $$;

-- Admin offers a task to a PM.
create or replace function public.assign_task(p_task uuid, p_worker uuid)
returns void language plpgsql security definer set search_path = public as $$
declare t tasks; w profiles;
begin
  if not is_admin() then raise exception 'Admins only.'; end if;
  select * into t from tasks where id = p_task for update;
  if t.id is null then raise exception 'Task not found.'; end if;
  if t.status not in ('requested', 'matched') then
    raise exception 'Task is % and can no longer be reassigned.', t.status;
  end if;
  select * into w from profiles where id = p_worker;
  if w.id is null or w.role <> 'worker' or w.worker_status <> 'approved' then
    raise exception 'That Personal Manager is not approved.';
  end if;

  update tasks set assigned_worker_id = p_worker, status = 'matched', assigned_at = now(), accepted_at = null
  where id = p_task;
  update profiles set last_assigned_at = now() where id = p_worker;

  perform log_action(case when t.assigned_worker_id is null then 'task.assigned' else 'task.reassigned' end,
    'task', p_task, jsonb_build_object('worker_id', p_worker, 'worker_name', w.full_name,
                                       'previous_worker_id', t.assigned_worker_id, 'title', t.title));
end $$;

-- PM accepts an offered task.
create or replace function public.accept_task(p_task uuid)
returns void language plpgsql security definer set search_path = public as $$
declare t tasks;
begin
  select * into t from tasks where id = p_task for update;
  if t.id is null or t.assigned_worker_id is distinct from auth.uid() then raise exception 'Not your task.'; end if;
  if t.status <> 'matched' then raise exception 'Task is %; nothing to accept.', t.status; end if;
  update tasks set status = 'assigned', accepted_at = now() where id = p_task;
  perform log_action('task.accepted', 'task', p_task, jsonb_build_object('title', t.title));
end $$;

-- PM declines an offered task; it goes back to the admin queue.
create or replace function public.decline_task(p_task uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare t tasks;
begin
  select * into t from tasks where id = p_task for update;
  if t.id is null or t.assigned_worker_id is distinct from auth.uid() then raise exception 'Not your task.'; end if;
  if t.status not in ('matched', 'assigned') then raise exception 'Task is % and cannot be declined.', t.status; end if;
  insert into task_declines (task_id, worker_id, reason) values (p_task, auth.uid(), p_reason)
    on conflict (task_id, worker_id) do update set reason = excluded.reason, created_at = now();
  update tasks set status = 'requested', assigned_worker_id = null, assigned_at = null, accepted_at = null
  where id = p_task;
  perform log_action('task.declined', 'task', p_task, jsonb_build_object('reason', p_reason, 'title', t.title));
end $$;

-- PM starts work on site.
create or replace function public.start_task(p_task uuid)
returns void language plpgsql security definer set search_path = public as $$
declare t tasks;
begin
  select * into t from tasks where id = p_task for update;
  if t.id is null or t.assigned_worker_id is distinct from auth.uid() then raise exception 'Not your task.'; end if;
  if t.status <> 'assigned' then raise exception 'Accept the task before starting it.'; end if;
  update tasks set status = 'in_progress', started_at = now() where id = p_task;
  perform log_action('task.started', 'task', p_task, jsonb_build_object('title', t.title));
end $$;

-- PM logs a visit on an ongoing task.
create or replace function public.log_visit(p_task uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare t tasks;
begin
  select * into t from tasks where id = p_task;
  if t.id is null or t.assigned_worker_id is distinct from auth.uid() then raise exception 'Not your task.'; end if;
  if t.status <> 'in_progress' then raise exception 'Start the task before logging visits.'; end if;
  insert into task_visits (task_id, note, done) values (p_task, coalesce(nullif(trim(p_note), ''), 'Visit logged.'), true);
  perform log_action('task.visit_logged', 'task', p_task, jsonb_build_object('note', p_note));
end $$;

-- PM enters the customer's completion code. Returns 'ok', 'wrong' or 'locked'
-- (after 5 wrong codes — an admin can then complete the task).
create or replace function public.complete_task(p_task uuid, p_code text)
returns text language plpgsql security definer set search_path = public as $$
declare t tasks; o task_otps;
begin
  select * into t from tasks where id = p_task for update;
  if t.id is null or t.assigned_worker_id is distinct from auth.uid() then raise exception 'Not your task.'; end if;
  if t.status <> 'in_progress' then raise exception 'Task is %; it cannot be completed now.', t.status; end if;
  select * into o from task_otps where task_id = p_task for update;
  if o.task_id is null then raise exception 'This task has no completion code. Contact support.'; end if;
  if o.failed_attempts >= 5 then return 'locked'; end if;
  if trim(coalesce(p_code, '')) <> o.code then
    update task_otps set failed_attempts = failed_attempts + 1 where task_id = p_task;
    perform log_action('task.wrong_code', 'task', p_task, jsonb_build_object('attempt', o.failed_attempts + 1));
    return case when o.failed_attempts + 1 >= 5 then 'locked' else 'wrong' end;
  end if;
  update tasks set status = 'completed', completed_at = now() where id = p_task;
  update profiles set jobs_done = coalesce(jobs_done, 0) + 1 where id = t.assigned_worker_id;
  perform log_action('task.completed', 'task', p_task, jsonb_build_object('title', t.title));
  return 'ok';
end $$;

-- Admin override: close a task without the code (e.g. customer confirmed by phone).
create or replace function public.admin_complete_task(p_task uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare t tasks;
begin
  if not is_admin() then raise exception 'Admins only.'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Add a note explaining why.'; end if;
  select * into t from tasks where id = p_task for update;
  if t.id is null then raise exception 'Task not found.'; end if;
  if t.status not in ('assigned', 'in_progress') or t.assigned_worker_id is null then
    raise exception 'Only an accepted task can be completed.';
  end if;
  update tasks set status = 'completed', completed_at = now() where id = p_task;
  update profiles set jobs_done = coalesce(jobs_done, 0) + 1 where id = t.assigned_worker_id;
  perform log_action('task.completed_by_admin', 'task', p_task, jsonb_build_object('note', p_note, 'title', t.title));
end $$;

-- Customer (their own task, before work starts) or admin cancels a task.
create or replace function public.cancel_task(p_task uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare t tasks;
begin
  select * into t from tasks where id = p_task for update;
  if t.id is null or not (t.customer_id = auth.uid() or is_admin()) then raise exception 'Not your task.'; end if;
  if t.status in ('completed', 'cancelled') then raise exception 'Task is already %.', t.status; end if;
  if t.status = 'in_progress' and not is_admin() then
    raise exception 'Work has started — contact support to cancel.';
  end if;
  update tasks set status = 'cancelled', cancelled_at = now(), cancel_reason = nullif(trim(p_reason), '')
  where id = p_task;
  perform log_action('task.cancelled', 'task', p_task, jsonb_build_object('reason', p_reason, 'title', t.title));
end $$;

-- After completion, the customer rates the PM and the PM rates the customer.
create or replace function public.rate_task(p_task uuid, p_rating int, p_review text default null)
returns void language plpgsql security definer set search_path = public as $$
declare t tasks; target uuid;
begin
  if p_rating is null or p_rating < 1 or p_rating > 5 then raise exception 'Rating must be 1–5.'; end if;
  select * into t from tasks where id = p_task for update;
  if t.id is null then raise exception 'Task not found.'; end if;
  if t.status <> 'completed' then raise exception 'You can rate a task once it is completed.'; end if;

  if t.customer_id = auth.uid() then
    if t.customer_rating_of_worker is not null then raise exception 'You already rated this task.'; end if;
    update tasks set customer_rating_of_worker = p_rating, customer_review = nullif(trim(p_review), '') where id = p_task;
    target := t.assigned_worker_id;
    update profiles p set
      rating = s.avg_rating, rating_count = s.n
    from (select round(avg(customer_rating_of_worker), 1) avg_rating, count(*)::int n
          from tasks where assigned_worker_id = target and customer_rating_of_worker is not null) s
    where p.id = target;
  elsif t.assigned_worker_id = auth.uid() then
    if t.worker_rating_of_customer is not null then raise exception 'You already rated this task.'; end if;
    update tasks set worker_rating_of_customer = p_rating where id = p_task;
    target := t.customer_id;
    update profiles p set
      rating = s.avg_rating, rating_count = s.n
    from (select round(avg(worker_rating_of_customer), 1) avg_rating, count(*)::int n
          from tasks where customer_id = target and worker_rating_of_customer is not null) s
    where p.id = target;
  else
    raise exception 'Not your task.';
  end if;
  perform log_action('task.rated', 'task', p_task, jsonb_build_object('rating', p_rating, 'rated', target));
end $$;

-- Nobody but these functions (and the SQL editor) touches the internals.
revoke execute on function public.after_task_insert() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- 8. Row Level Security ---------------------------------------------------------
alter table profiles enable row level security;
alter table tasks enable row level security;
alter table task_visits enable row level security;
alter table task_otps enable row level security;
alter table task_declines enable row level security;
alter table pm_documents enable row level security;
alter table audit_log enable row level security;

-- Policies from earlier versions of this file.
drop policy if exists "profiles are readable by any signed-in user" on profiles;
drop policy if exists "users can insert their own profile" on profiles;
drop policy if exists "customers see their own tasks" on tasks;
drop policy if exists "customer, assigned worker, or admin can update a task" on tasks;
drop policy if exists "assigned worker or admin can log a visit" on task_visits;

-- Profiles: you see yourself, the person on the other side of your tasks, and
-- admins see everyone. You can edit your own profile (the guard trigger stops
-- you changing role, verification status or ratings).
drop policy if exists "profiles: self, task partner, admin" on profiles;
create policy "profiles: self, task partner, admin" on profiles
  for select using (id = auth.uid() or is_admin() or shares_task(id));
drop policy if exists "users can update their own profile" on profiles;
create policy "users can update their own profile" on profiles
  for update using (id = auth.uid() or is_admin()) with check (id = auth.uid() or is_admin());

-- Tasks: customer, assigned PM or admin can read. Customers insert their own
-- (the guard trigger fixes up status etc.). No direct updates — use the functions.
drop policy if exists "tasks: customer, assigned PM, admin" on tasks;
create policy "tasks: customer, assigned PM, admin" on tasks
  for select using (customer_id = auth.uid() or assigned_worker_id = auth.uid() or is_admin());
drop policy if exists "customers create their own tasks" on tasks;
create policy "customers create their own tasks" on tasks
  for insert with check (customer_id = auth.uid());

-- Completion codes: only the task's customer and admins.
drop policy if exists "otp: customer and admin" on task_otps;
create policy "otp: customer and admin" on task_otps
  for select using (
    is_admin() or exists (select 1 from tasks t where t.id = task_otps.task_id and t.customer_id = auth.uid())
  );

drop policy if exists "declines: own and admin" on task_declines;
create policy "declines: own and admin" on task_declines
  for select using (worker_id = auth.uid() or is_admin());

-- Visits: visible to whoever can see the parent task. Logged via log_visit().
drop policy if exists "visits follow task visibility" on task_visits;
create policy "visits follow task visibility" on task_visits
  for select using (
    exists (select 1 from tasks t where t.id = task_visits.task_id
            and (t.customer_id = auth.uid() or t.assigned_worker_id = auth.uid() or is_admin()))
  );

-- PM documents: the PM and admins read; the PM adds/removes while the
-- application is still editable.
drop policy if exists "pm docs: owner and admin read" on pm_documents;
create policy "pm docs: owner and admin read" on pm_documents
  for select using (worker_id = auth.uid() or is_super_admin());
drop policy if exists "pm docs: owner adds while editable" on pm_documents;
create policy "pm docs: owner adds while editable" on pm_documents
  for insert with check (
    worker_id = auth.uid()
    and storage_path like auth.uid()::text || '/%'
    and exists (
      select 1 from profiles
       where id = auth.uid() and role = 'worker'
         and (worker_status in ('draft', 'more_info')
              -- an approved PM may add or renew a certificate, never a new ID
              or (worker_status = 'approved' and pm_documents.doc_type <> 'id'))
    )
  );
drop policy if exists "pm docs: owner removes while editable" on pm_documents;
create policy "pm docs: owner removes while editable" on pm_documents
  for delete using (
    worker_id = auth.uid()
    and exists (select 1 from profiles where id = auth.uid() and worker_status in ('draft', 'more_info'))
  );

drop policy if exists "audit: admins read" on audit_log;
create policy "audit: admins read" on audit_log for select using (is_admin());

-- 9. File storage for PM documents ------------------------------------------------
-- Private bucket; files live under "<user id>/<file name>".
insert into storage.buckets (id, name, public)
values ('pm-documents', 'pm-documents', false)
on conflict (id) do nothing;

drop policy if exists "pm-documents: owner uploads" on storage.objects;
create policy "pm-documents: owner uploads" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'pm-documents' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "pm-documents: owner or admin reads" on storage.objects;
create policy "pm-documents: owner or admin reads" on storage.objects
  for select to authenticated
  using (bucket_id = 'pm-documents' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_super_admin()));
drop policy if exists "pm-documents: owner deletes" on storage.objects;
create policy "pm-documents: owner deletes" on storage.objects
  for delete to authenticated
  using (bucket_id = 'pm-documents' and (storage.foldername(name))[1] = auth.uid()::text);

-- 10. Realtime -------------------------------------------------------------------
-- Live updates: a customer's screen changes the moment a PM accepts, an
-- applicant sees approval instantly, the admin queue refreshes itself.
do $$
declare tbl text;
begin
  foreach tbl in array array['tasks', 'task_visits', 'profiles', 'audit_log'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = tbl) then
      execute format('alter publication supabase_realtime add table public.%I', tbl);
    end if;
  end loop;
end $$;

-- 11. Notifications ---------------------------------------------------------------
-- In-app inbox for everyone: a PM's new offer, a customer's "your PM accepted",
-- an admin's "new application". Written by the database itself when things
-- happen (see notify_task_change below), read live by the app.
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  kind text not null default 'info',     -- 'task' | 'application' | 'report' | 'payout' | 'announcement' | 'info'
  title text not null,
  body text,
  task_id uuid references tasks (id) on delete cascade,
  read_at timestamptz,
  created_at timestamptz default now()
);
create index if not exists notifications_user_idx on notifications (user_id, created_at desc);

create or replace function public.notify_user(p_user uuid, p_kind text, p_title text, p_body text, p_task uuid)
returns void language sql security definer set search_path = public as $$
  insert into notifications (user_id, kind, title, body, task_id)
  select p_user, p_kind, p_title, p_body, p_task
   where p_user is not null and exists (select 1 from profiles where id = p_user);
$$;

create or replace function public.notify_admins(p_kind text, p_title text, p_body text, p_task uuid)
returns void language sql security definer set search_path = public as $$
  insert into notifications (user_id, kind, title, body, task_id)
  select id, p_kind, p_title, p_body, p_task from profiles where role = 'admin';
$$;

revoke execute on function public.notify_user(uuid, text, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.notify_admins(text, text, text, uuid) from public, anon, authenticated;

create or replace function public.notify_task_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare actor uuid := auth.uid();
begin
  if new.status = 'matched' and new.assigned_worker_id is not null
     and (old.status is distinct from 'matched' or old.assigned_worker_id is distinct from new.assigned_worker_id) then
    perform notify_user(new.assigned_worker_id, 'task', 'New task offered to you', new.title, new.id);
  elsif new.status = 'assigned' and old.status = 'matched' then
    perform notify_user(new.customer_id, 'task', 'Your Personal Manager accepted', new.title, new.id);
  elsif new.status = 'in_progress' and old.status is distinct from 'in_progress' then
    perform notify_user(new.customer_id, 'task', 'Work has started', new.title, new.id);
  elsif new.status = 'completed' and old.status is distinct from 'completed' then
    perform notify_user(new.customer_id, 'task', 'Task completed — please rate your Personal Manager', new.title, new.id);
    perform notify_user(new.assigned_worker_id, 'task', 'Task completed', new.title, new.id);
  elsif new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    perform notify_user(old.assigned_worker_id, 'task', 'A task you were on was cancelled', new.title, new.id);
    if actor is distinct from new.customer_id then
      perform notify_user(new.customer_id, 'task', 'Your task was cancelled', coalesce(new.cancel_reason, new.title), new.id);
    end if;
  elsif new.status = 'requested' and old.status in ('matched', 'assigned') then
    perform notify_admins('task', 'A task needs reassigning', new.title, new.id);
  end if;
  return new;
end $$;

drop trigger if exists notify_task_change on tasks;
create trigger notify_task_change after update of status, assigned_worker_id on tasks
  for each row execute procedure public.notify_task_change();

create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns void language sql security definer set search_path = public as $$
  update notifications set read_at = now()
   where user_id = auth.uid() and read_at is null and (p_ids is null or id = any (p_ids));
$$;

-- 12. Offer time-out ----------------------------------------------------------------
-- A PM who doesn't answer an offer shouldn't block the task. After p_minutes
-- the offer lapses, the task goes back to the queue and the admins are told.
-- expire_stale_offers_internal is for the scheduler (below); admins call
-- expire_stale_offers from the app.
create or replace function public.expire_stale_offers_internal(p_minutes int default 15)
returns int language plpgsql security definer set search_path = public as $$
declare t tasks; n int := 0;
begin
  for t in select * from tasks
            where status = 'matched' and assigned_at < now() - make_interval(mins => greatest(p_minutes, 1))
            for update skip locked loop
    insert into task_declines (task_id, worker_id, reason) values (t.id, t.assigned_worker_id, 'No response')
      on conflict (task_id, worker_id) do update set reason = 'No response', created_at = now();
    update tasks set status = 'requested', assigned_worker_id = null, assigned_at = null, accepted_at = null where id = t.id;
    perform log_action('task.offer_expired', 'task', t.id,
      jsonb_build_object('worker_id', t.assigned_worker_id, 'title', t.title, 'minutes', p_minutes));
    perform notify_user(t.assigned_worker_id, 'task', 'An offer lapsed', t.title || ' went back to the queue because it wasn''t answered in time.', t.id);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.expire_stale_offers_internal(int) from public, anon, authenticated;

create or replace function public.expire_stale_offers(p_minutes int default 15)
returns int language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only.'; end if;
  return expire_stale_offers_internal(p_minutes);
end $$;

-- Run it every 5 minutes if this project has the pg_cron extension. If not,
-- nothing breaks: the admin tools run the same check whenever an admin opens
-- the task queue.
do $$ begin
  create extension if not exists pg_cron;
  perform cron.schedule('mrtodo-expire-offers', '*/5 * * * *', 'select public.expire_stale_offers_internal(15)');
exception when others then
  raise notice 'pg_cron not available (%): offers will be expired when an admin opens the queue.', sqlerrm;
end $$;

-- 13. Reports (disputes) ---------------------------------------------------------------
create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks (id) on delete cascade,
  reporter_id uuid not null references profiles (id) on delete cascade,
  reason text not null check (reason in ('no_show', 'late', 'quality', 'behaviour', 'safety', 'payment', 'other')),
  details text,
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolution_note text,
  resolved_by uuid references profiles (id),
  created_at timestamptz default now(),
  resolved_at timestamptz
);
create index if not exists reports_status_idx on reports (status, created_at desc);

create or replace function public.report_task(p_task uuid, p_reason text, p_details text default null)
returns void language plpgsql security definer set search_path = public as $$
declare t tasks; r uuid;
begin
  select * into t from tasks where id = p_task;
  if t.id is null or not (t.customer_id = auth.uid() or t.assigned_worker_id = auth.uid()) then
    raise exception 'You can only report a problem on your own task.';
  end if;
  if exists (select 1 from reports where task_id = p_task and reporter_id = auth.uid() and status = 'open') then
    raise exception 'You already have an open report on this task. Our team will be in touch.';
  end if;
  insert into reports (task_id, reporter_id, reason, details)
  values (p_task, auth.uid(), p_reason, nullif(trim(p_details), '')) returning id into r;
  perform log_action('task.reported', 'task', p_task, jsonb_build_object('reason', p_reason, 'report_id', r, 'title', t.title));
  perform notify_admins('report', 'Problem reported', t.title || ' — ' || replace(p_reason, '_', ' '), p_task);
end $$;

create or replace function public.resolve_report(p_report uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare r reports; t tasks;
begin
  if not is_admin() then raise exception 'Admins only.'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Write a short note on how this was resolved.'; end if;
  select * into r from reports where id = p_report for update;
  if r.id is null then raise exception 'Report not found.'; end if;
  if r.status = 'resolved' then raise exception 'Already resolved.'; end if;
  update reports set status = 'resolved', resolution_note = trim(p_note), resolved_by = auth.uid(), resolved_at = now()
   where id = p_report;
  select * into t from tasks where id = r.task_id;
  perform log_action('report.resolved', 'task', r.task_id, jsonb_build_object('note', p_note, 'title', t.title));
  perform notify_user(r.reporter_id, 'report', 'Your report was resolved', trim(p_note), r.task_id);
end $$;

-- 14. Proof-of-work photos ------------------------------------------------------------------
create table if not exists task_photos (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks (id) on delete cascade,
  uploader_id uuid not null default auth.uid() references profiles (id) on delete cascade,
  kind text not null default 'other' check (kind in ('before', 'after', 'other')),
  storage_path text not null,           -- "<task id>/<file>" in the private "task-photos" bucket
  created_at timestamptz default now()
);
create index if not exists task_photos_task_idx on task_photos (task_id);

-- Folder names come from storage paths; a malformed one must read as "no
-- match" instead of raising an error inside a storage policy.
create or replace function public.safe_uuid(p text)
returns uuid language plpgsql immutable as $$
begin
  return p::uuid;
exception when others then
  return null;
end $$;

create or replace function public.can_access_task(p_task uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from tasks t
                  where t.id = p_task
                    and (t.customer_id = auth.uid() or t.assigned_worker_id = auth.uid() or is_admin()));
$$;

create or replace function public.is_task_worker(p_task uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from tasks t where t.id = p_task and t.assigned_worker_id = auth.uid());
$$;

insert into storage.buckets (id, name, public)
values ('task-photos', 'task-photos', false)
on conflict (id) do nothing;

-- 15. Payouts ---------------------------------------------------------------------------------
-- A record of money paid to a Personal Manager. "Owed" = earned from completed
-- tasks minus what has been paid out. No money moves through the app yet.
create table if not exists payouts (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references profiles (id) on delete cascade,
  amount numeric(10,2) not null check (amount > 0),
  note text,
  paid_by uuid references profiles (id),
  paid_at timestamptz default now()
);
create index if not exists payouts_worker_idx on payouts (worker_id, paid_at desc);

create or replace function public.record_payout(p_worker uuid, p_amount numeric, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare w profiles;
begin
  if not is_super_admin() then raise exception 'Only a super admin can record payouts.'; end if;
  select * into w from profiles where id = p_worker;
  if w.id is null or w.role <> 'worker' then raise exception 'Not a Personal Manager account.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter an amount above zero.'; end if;
  insert into payouts (worker_id, amount, note, paid_by) values (p_worker, p_amount, nullif(trim(p_note), ''), auth.uid());
  perform log_action('payout.recorded', 'profile', p_worker, jsonb_build_object('amount', p_amount, 'note', p_note, 'name', w.full_name));
  perform notify_user(p_worker, 'payout', 'Payout recorded: ₹' || trim_scale(p_amount)::text, nullif(trim(p_note), ''), null);
end $$;

-- 16. Broadcast messages --------------------------------------------------------------------------
create or replace function public.send_announcement(p_audience text, p_title text, p_body text default null)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not is_super_admin() then raise exception 'Only a super admin can send announcements.'; end if;
  if p_audience not in ('workers', 'customers', 'all') then raise exception 'Choose who to send it to.'; end if;
  if coalesce(trim(p_title), '') = '' then raise exception 'Add a title.'; end if;
  insert into notifications (user_id, kind, title, body)
  select id, 'announcement', trim(p_title), nullif(trim(p_body), '')
    from profiles
   where (p_audience in ('workers', 'all') and role = 'worker' and worker_status = 'approved')
      or (p_audience in ('customers', 'all') and role = 'customer');
  get diagnostics n = row_count;
  perform log_action('announcement.sent', 'announcement', null, jsonb_build_object('audience', p_audience, 'title', p_title, 'recipients', n));
  return n;
end $$;

-- 17. Admin levels + Personal Manager reliability -----------------------------------------------
create or replace function public.set_admin_level(p_user uuid, p_level text)
returns void language plpgsql security definer set search_path = public as $$
declare u profiles;
begin
  if not is_super_admin() then raise exception 'Only a super admin can change admin levels.'; end if;
  if p_level not in ('super', 'support') then raise exception 'Level must be super or support.'; end if;
  select * into u from profiles where id = p_user for update;
  if u.id is null or u.role <> 'admin' then raise exception 'That account is not an admin.'; end if;
  if p_level = 'support' and coalesce(u.admin_level, 'super') = 'super'
     and (select count(*) from profiles where role = 'admin' and coalesce(admin_level, 'super') = 'super') <= 1 then
    raise exception 'There must always be at least one super admin.';
  end if;
  update profiles set admin_level = p_level where id = p_user;
  perform log_action('admin.level_changed', 'profile', p_user, jsonb_build_object('level', p_level, 'name', u.full_name));
end $$;

-- How dependable each approved PM is, from what the audit log recorded.
create or replace function public.pm_reliability()
returns table (worker_id uuid, offers int, accepted int, declined int, expired int, completed int, avg_accept_minutes numeric)
language sql stable security definer set search_path = public as $$
  select p.id,
    (select count(*)::int from audit_log a where a.action in ('task.assigned', 'task.reassigned') and a.details->>'worker_id' = p.id::text),
    (select count(*)::int from audit_log a where a.action = 'task.accepted' and a.actor_id = p.id),
    (select count(*)::int from audit_log a where a.action = 'task.declined' and a.actor_id = p.id),
    (select count(*)::int from audit_log a where a.action = 'task.offer_expired' and a.details->>'worker_id' = p.id::text),
    (select count(*)::int from tasks t where t.assigned_worker_id = p.id and t.status = 'completed'),
    (select round((avg(extract(epoch from (t.accepted_at - t.assigned_at)) / 60))::numeric, 0)
       from tasks t where t.assigned_worker_id = p.id and t.accepted_at is not null and t.assigned_at is not null)
  from profiles p
  where p.role = 'worker' and is_admin();
$$;

-- 18. Row Level Security for the new tables ---------------------------------------------------------
alter table notifications enable row level security;
alter table reports enable row level security;
alter table task_photos enable row level security;
alter table payouts enable row level security;

drop policy if exists "notifications: own" on notifications;
create policy "notifications: own" on notifications for select using (user_id = auth.uid());

drop policy if exists "reports: reporter and admin" on reports;
create policy "reports: reporter and admin" on reports
  for select using (reporter_id = auth.uid() or is_admin());

-- Photos: anyone on the task can see them; only the assigned PM adds them,
-- while the work is going on, and can take back their own until it is done.
drop policy if exists "photos: task members read" on task_photos;
create policy "photos: task members read" on task_photos
  for select using (can_access_task(task_id));
drop policy if exists "photos: assigned PM adds" on task_photos;
create policy "photos: assigned PM adds" on task_photos
  for insert with check (
    uploader_id = auth.uid()
    and is_task_worker(task_id)
    and storage_path like task_id::text || '/%'
    and exists (select 1 from tasks t where t.id = task_id and t.status in ('assigned', 'in_progress'))
  );
drop policy if exists "photos: uploader removes while active" on task_photos;
create policy "photos: uploader removes while active" on task_photos
  for delete using (
    uploader_id = auth.uid()
    and exists (select 1 from tasks t where t.id = task_id and t.status in ('assigned', 'in_progress'))
  );

drop policy if exists "payouts: PM and super admin read" on payouts;
create policy "payouts: PM and super admin read" on payouts
  for select using (worker_id = auth.uid() or is_super_admin());

drop policy if exists "task-photos: PM uploads" on storage.objects;
create policy "task-photos: PM uploads" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'task-photos' and public.is_task_worker(public.safe_uuid((storage.foldername(name))[1])));
drop policy if exists "task-photos: task members read" on storage.objects;
create policy "task-photos: task members read" on storage.objects
  for select to authenticated
  using (bucket_id = 'task-photos' and public.can_access_task(public.safe_uuid((storage.foldername(name))[1])));
drop policy if exists "task-photos: uploader deletes" on storage.objects;
create policy "task-photos: uploader deletes" on storage.objects
  for delete to authenticated
  using (bucket_id = 'task-photos' and public.is_task_worker(public.safe_uuid((storage.foldername(name))[1])));

-- Live updates for the new tables.
do $$
declare tbl text;
begin
  foreach tbl in array array['notifications', 'reports', 'task_photos', 'payouts'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = tbl) then
      execute format('alter publication supabase_realtime add table public.%I', tbl);
    end if;
  end loop;
end $$;
