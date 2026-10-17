-- 0004 — completing a task, the customer's code, Gold Tier and commission.
-- Safe to run more than once. Depends on 0001–0003.
--
-- WHAT THE COMPLETION CODE DOES AND DOES NOT PROTECT
-- The code proves the customer was present and agreed the work is done: the PM
-- can only finish a job by being told the code in person. It is four digits, so
-- storing it hashed does not stop someone who steals a copy of the database
-- from working it out (there are only 10,000 possibilities). The real
-- protections are that nobody can read it back, it expires, wrong guesses lock
-- it, and a new one rotates the old one out.

-- 0. Columns the functions below read
alter table profiles add column if not exists tier text not null default 'standard';
alter table profiles add column if not exists tier_since timestamptz;
alter table profiles add column if not exists verified_jobs int not null default 0;
do $$ begin
  alter table profiles add constraint profiles_tier_check check (tier in ('standard', 'gold'));
exception when duplicate_object then null; end $$;

-- Tier, job counts and rating are results of the records, never something a
-- user can type. (Replaces the guard from 0001 with the new columns added.)
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
       or new.verified_jobs is distinct from old.verified_jobs
       or new.tier is distinct from old.tier
       or new.tier_since is distinct from old.tier_since
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

-- 1. Verified completions -----------------------------------------------------------------------------------
-- One row per finished task, written only by the completion functions. Gold Tier
-- and earnings are calculated from these, never from a number a client sent.
create table if not exists task_completions (
  task_id uuid primary key references tasks (id) on delete cascade,
  worker_id uuid not null references profiles (id),
  method text not null check (method in ('otp', 'admin', 'legacy')),
  completed_at timestamptz not null default now(),
  idempotency_key text,
  pm_share_bps int not null check (pm_share_bps between 0 and 10000),
  amount numeric(12,2) not null default 0,
  currency char(3) not null default 'INR'
);
create index if not exists task_completions_worker_idx on task_completions (worker_id);
alter table task_completions enable row level security;
drop policy if exists "completions: worker and admin read" on task_completions;
create policy "completions: worker and admin read" on task_completions
  for select using (worker_id = auth.uid() or is_admin());
revoke insert, update, delete, truncate on task_completions from anon, authenticated;

-- What a task is worth: its price, or for an ongoing task the day rate times the visits logged.
create or replace function public.task_value(t tasks)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(case when t.task_type = 'ongoing'
                       then t.rate_per_day * (select count(*) from task_visits v where v.task_id = t.id and v.done)
                       else t.est_cost end, 0);
$$;

-- 2. Commission ------------------------------------------------------------------------------------------------------
-- All rates are whole basis points (10000 = 100%). "A bump of 5% relative to
-- the standard rate" means multiplying, not adding: a 1500 rate becomes 1575
-- (15.75%), never 2000.
create or replace function public.relative_bump_bps(p_base int, p_bump int)
returns int language sql immutable as $$
  select round(p_base::numeric * (10000 + p_bump) / 10000)::int;
$$;

-- Mr. Todo's model: the platform keeps a share of each job and the Personal
-- Manager earns the rest (80%/20% by default). The Gold Tier "commission bump"
-- is applied to the rate the PM EARNS, because a perk for the PM has to raise
-- their take: 80% becomes 84%. The platform fee drops from 20% to 16%.
-- The percentages are settings (standard_pm_share_bps, gold_commission_bump_bps).
create or replace function public.pm_share_bps_for(p_worker uuid)
returns int language sql stable security definer set search_path = public as $$
  select case when (select tier from profiles where id = p_worker) = 'gold'
              then least(10000, relative_bump_bps(setting_num('standard_pm_share_bps', 8000)::int,
                                                  setting_num('gold_commission_bump_bps', 500)::int))
              else setting_num('standard_pm_share_bps', 8000)::int end;
$$;

-- 3. Gold Tier ----------------------------------------------------------------------------------------------------------

-- Recalculates one PM's job count, rating and tier from the records. Running it
-- twice gives the same answer, so it is safe to call from any trigger.
--   verified jobs = finished with the customer's code (or before codes existed)
--   rating        = the customers' own ratings on that PM's finished tasks
--   gold          = verified jobs strictly more than the setting AND average
--                   rating strictly above the setting
create or replace function public.recompute_pm_stats(p_worker uuid)
returns void language plpgsql security definer set search_path = public as $$
declare old profiles; jobs int; verified int; avg_rating numeric; rated int; new_tier text;
begin
  select * into old from profiles where id = p_worker for update;
  if old.id is null or old.role <> 'worker' then return; end if;

  select count(*)::int, count(*) filter (where method in ('otp', 'legacy'))::int
    into jobs, verified from task_completions where worker_id = p_worker;
  select avg(t.customer_rating_of_worker)::numeric, count(*)::int into avg_rating, rated
    from tasks t join task_completions c on c.task_id = t.id
   where c.worker_id = p_worker and t.customer_rating_of_worker is not null;

  new_tier := case when verified > setting_num('gold_min_verified_jobs', 50)
                    and rated >= setting_num('gold_min_rated_jobs', 1)
                    and avg_rating > setting_num('gold_min_avg_rating', 4.8)
                   then 'gold' else 'standard' end;

  update profiles set
    jobs_done = jobs, verified_jobs = verified,
    rating = case when rated > 0 then round(avg_rating, 1) end, rating_count = rated,
    tier = new_tier,
    tier_since = case when new_tier is distinct from old.tier then now() else old.tier_since end
   where id = p_worker;

  if new_tier is distinct from old.tier then
    perform log_action('pm.tier_changed', 'profile', p_worker,
      jsonb_build_object('name', old.full_name, 'verified_jobs', verified, 'rated_jobs', rated),
      jsonb_build_object('tier', old.tier), jsonb_build_object('tier', new_tier));
    perform notify_user(p_worker, 'info',
      case when new_tier = 'gold' then 'You reached Gold Tier' else 'Your Gold Tier status has ended' end,
      case when new_tier = 'gold' then 'Premium tasks reach you first, and your earnings rate goes up.'
           else 'It returns when your verified jobs and average rating qualify again.' end, null);
  end if;
end $$;
revoke execute on function public.recompute_pm_stats(uuid) from public, anon, authenticated;

create or replace function public.trg_completion_stats()
returns trigger language plpgsql security definer set search_path = public as $$
begin perform recompute_pm_stats(new.worker_id); return new; end $$;
drop trigger if exists completion_stats on task_completions;
create trigger completion_stats after insert or update on task_completions
  for each row execute procedure public.trg_completion_stats();

create or replace function public.trg_rating_stats()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.assigned_worker_id is not null then perform recompute_pm_stats(new.assigned_worker_id); end if;
  return new;
end $$;
drop trigger if exists rating_stats on tasks;
create trigger rating_stats after update of customer_rating_of_worker on tasks
  for each row when (old.customer_rating_of_worker is distinct from new.customer_rating_of_worker)
  execute procedure public.trg_rating_stats();

-- Tasks finished before this migration become "legacy" completions so nobody
-- loses their history. They were finished with the old code check, so they count
-- as verified.
insert into task_completions (task_id, worker_id, method, completed_at, pm_share_bps, amount, currency)
  select t.id, t.assigned_worker_id, 'legacy', coalesce(t.completed_at, t.created_at),
         setting_num('standard_pm_share_bps', 8000)::int, task_value(t), t.currency
    from tasks t
   where t.status = 'completed' and t.assigned_worker_id is not null
  on conflict (task_id) do nothing;
update tasks t set pm_share_bps = c.pm_share_bps from task_completions c where c.task_id = t.id and t.pm_share_bps is null;
do $$ declare w uuid; begin
  for w in select id from profiles where role = 'worker' loop perform recompute_pm_stats(w); end loop;
end $$;

-- A customer's rating can be removed or corrected by a super admin (for example
-- a review that broke the rules); tier and rating follow automatically.
create or replace function public.admin_remove_review(p_task uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare t tasks;
begin
  if not is_super_admin() then raise exception 'Only a super admin can remove a review.'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Say why the review is being removed.'; end if;
  select * into t from tasks where id = p_task for update;
  if t.id is null or t.customer_rating_of_worker is null then raise exception 'That task has no rating to remove.'; end if;
  update tasks set customer_rating_of_worker = null, customer_review = null where id = p_task;
  perform log_action('review.removed', 'task', p_task, jsonb_build_object('reason', trim(p_reason), 'title', t.title),
                     jsonb_build_object('rating', t.customer_rating_of_worker, 'review', t.customer_review), null);
end $$;

-- 4. The completion code ---------------------------------------------------------------------------------------------------
alter table task_otps add column if not exists code_hash text;
alter table task_otps add column if not exists salt text;
alter table task_otps add column if not exists issued_at timestamptz;
alter table task_otps add column if not exists expires_at timestamptz;
alter table task_otps add column if not exists consumed_at timestamptz;
alter table task_otps add column if not exists locked_at timestamptz;
alter table task_otps add column if not exists issue_count int not null default 0;

create or replace function public.random_code4()
returns text language plpgsql volatile as $$
declare n bigint;
begin
  -- Four bytes from the database's cryptographic generator; values above the
  -- largest whole multiple of 10000 are thrown away so every code is equally likely.
  loop
    n := ('x' || encode(substring(uuid_send(gen_random_uuid()) from 1 for 4), 'hex'))::bit(32)::bigint;
    exit when n < 4294960000;
  end loop;
  return lpad((n % 10000)::text, 4, '0');
end $$;
revoke execute on function public.random_code4() from public, anon, authenticated;

create or replace function public.otp_hash(p_task uuid, p_salt text, p_code text)
returns text language sql immutable as $$
  select encode(sha256(convert_to(p_salt || ':' || p_task::text || ':' || p_code, 'utf8')), 'hex');
$$;
revoke execute on function public.otp_hash(uuid, text, text) from public, anon, authenticated;

-- Codes issued under the old rules were stored in plain text and readable by the
-- customer's app. Hash them, let in-flight tasks finish, then remove the column.
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'task_otps' and column_name = 'code') then
    update task_otps set salt = replace(gen_random_uuid()::text, '-', '') where salt is null;
    execute $q$
      update task_otps o set
        code_hash = public.otp_hash(o.task_id, o.salt, o.code),
        issued_at = coalesce(o.issued_at, now()),
        expires_at = now() + make_interval(mins => public.setting_num('otp_ttl_minutes', 120)::int),
        consumed_at = case when exists (select 1 from tasks t where t.id = o.task_id and t.status = 'completed') then now() end,
        locked_at = case when o.failed_attempts >= 5 then now() end
      where o.code is not null and o.code_hash is null $q$;
    alter table task_otps drop column code;
  end if;
end $$;

-- Nobody reads this table. Not the customer, the PM or an admin: only the
-- functions below, which run with the database's own privileges.
drop policy if exists "otp: customer and admin" on task_otps;
revoke all on task_otps from anon, authenticated;

-- The customer asks for a code when the work is done. Asking again replaces the
-- old one (rotation) and clears any lockout, so a locked task is never stuck.
create or replace function public.issue_completion_code(p_task uuid)
returns table (completion_code text, valid_until timestamptz)
language plpgsql security definer set search_path = public as $$
declare t tasks; c text; s text; exp timestamptz;
begin
  select * into t from tasks where id = p_task for update;
  if t.id is null or t.customer_id is distinct from auth.uid() then raise exception 'Not your task.'; end if;
  if t.status not in ('assigned', 'in_progress') then
    raise exception 'A completion code is available once a Personal Manager has accepted the task.';
  end if;
  if not rate_limit_hit('otp_issue:' || p_task::text, setting_num('otp_issue_max_per_hour', 10)::int, 3600) then
    raise exception 'You have asked for a new code too many times. Please try again in a while.';
  end if;

  c := random_code4();
  s := replace(gen_random_uuid()::text, '-', '');
  exp := now() + make_interval(mins => setting_num('otp_ttl_minutes', 120)::int);

  insert into task_otps (task_id, salt, code_hash, issued_at, expires_at, failed_attempts, consumed_at, locked_at, issue_count)
  values (p_task, s, otp_hash(p_task, s, c), now(), exp, 0, null, null, 1)
  on conflict (task_id) do update set
    salt = excluded.salt, code_hash = excluded.code_hash, issued_at = excluded.issued_at, expires_at = excluded.expires_at,
    failed_attempts = 0, consumed_at = null, locked_at = null, issue_count = task_otps.issue_count + 1;

  perform log_action('task.code_issued', 'task', p_task, jsonb_build_object('title', t.title));   -- the code itself is never logged
  return query select c, exp;
end $$;

-- What the customer's screen needs to know without revealing anything.
create or replace function public.completion_code_state(p_task uuid)
returns table (active boolean, locked boolean, expired boolean, valid_until timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare t tasks; o task_otps;
begin
  select * into t from tasks where id = p_task;
  if t.id is null or t.customer_id is distinct from auth.uid() then raise exception 'Not your task.'; end if;
  select * into o from task_otps where task_id = p_task;
  return query select
    (o.task_id is not null and o.consumed_at is null and o.locked_at is null and o.expires_at > now()),
    (o.locked_at is not null), (o.task_id is not null and o.expires_at <= now()), o.expires_at;
end $$;

-- 5. Evidence rules -----------------------------------------------------------------------------------------------------------
-- A task never has two "Before" or two "After" photos: a retake replaces the
-- first (while the work is under way), so what an admin sees is what was kept.
update task_photos p set kind = 'other'
 where kind in ('before', 'after')
   and id <> (select q.id from task_photos q where q.task_id = p.task_id and q.kind = p.kind
               order by q.created_at desc, q.id desc limit 1);
alter table task_photos add column if not exists client_id uuid;        -- chosen by the phone, so a retried upload is recognised
alter table task_photos add column if not exists content_type text;
alter table task_photos add column if not exists size_bytes int;
create unique index if not exists task_photos_kind_unique on task_photos (task_id, kind) where kind in ('before', 'after');
create unique index if not exists task_photos_client_unique on task_photos (task_id, client_id) where client_id is not null;

create or replace function public.can_modify_task_evidence(p_task uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from tasks t where t.id = p_task and t.assigned_worker_id = auth.uid()
                  and t.status in ('assigned', 'in_progress'));
$$;

drop policy if exists "photos: assigned PM adds" on task_photos;
create policy "photos: assigned PM adds" on task_photos
  for insert with check (
    uploader_id = auth.uid()
    and can_modify_task_evidence(task_id)
    and storage_path like task_id::text || '/%'
    and content_type in ('image/jpeg', 'image/png', 'image/webp', 'image/heic')
    and size_bytes between 1 and 10485760
  );
drop policy if exists "photos: uploader removes while active" on task_photos;
create policy "photos: uploader removes while active" on task_photos
  for delete using (uploader_id = auth.uid() and can_modify_task_evidence(task_id));

-- Photos live in a private bucket with a size and type limit set on the bucket
-- itself, and a file name the database recognises.
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit') then
    update storage.buckets set file_size_limit = 10485760,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
     where id = 'task-photos';
    update storage.buckets set file_size_limit = 10485760,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
     where id = 'pm-documents';
  end if;
end $$;

drop policy if exists "task-photos: PM uploads" on storage.objects;
create policy "task-photos: PM uploads" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'task-photos'
              and name ~ '^[0-9a-f-]{36}/(before|after|other)-[0-9a-f-]{36}\.(jpg|jpeg|png|webp|heic)$'
              and public.can_modify_task_evidence(public.safe_uuid((storage.foldername(name))[1])));
drop policy if exists "task-photos: uploader deletes" on storage.objects;
create policy "task-photos: uploader deletes" on storage.objects
  for delete to authenticated
  using (bucket_id = 'task-photos' and public.can_modify_task_evidence(public.safe_uuid((storage.foldername(name))[1])));

-- 6. Completing ----------------------------------------------------------------------------------------------------------------------
-- Returns one of: ok, wrong, locked, expired, no_code, missing_evidence, rate_limited.
-- These are results, not errors, so that failed attempts are still recorded and
-- counted. p_idempotency_key lets a phone safely repeat the request after a
-- dropped connection: the repeat returns ok without completing twice.
drop function if exists public.complete_task(uuid, text);
create or replace function public.complete_task(p_task uuid, p_code text, p_idempotency_key text default null)
returns text language plpgsql security definer set search_path = public as $$
declare t tasks; o task_otps; done task_completions; max_attempts int; share int; amt numeric; attempts int;
begin
  select * into t from tasks where id = p_task for update;
  if t.id is null or t.assigned_worker_id is distinct from auth.uid() then raise exception 'Not your task.'; end if;

  if t.status = 'completed' then
    select * into done from task_completions where task_id = p_task;
    if done.worker_id = auth.uid() and p_idempotency_key is not null and done.idempotency_key = p_idempotency_key then
      return 'ok';
    end if;
    raise exception 'This task is already completed.';
  end if;
  if t.status <> 'in_progress' then raise exception 'Task is %; it cannot be completed now.', t.status; end if;

  if not rate_limit_hit('otp_verify:' || p_task::text, setting_num('otp_verify_max_per_10min', 12)::int, 600) then
    perform log_ops('completion.rate_limited', 'warn', jsonb_build_object('task_id', p_task));
    return 'rate_limited';
  end if;

  if setting_bool('require_proof_photos', true) and not (
       exists (select 1 from task_photos where task_id = p_task and kind = 'before')
       and exists (select 1 from task_photos where task_id = p_task and kind = 'after')) then
    return 'missing_evidence';
  end if;

  select * into o from task_otps where task_id = p_task for update;
  if o.task_id is null or o.code_hash is null or o.consumed_at is not null then return 'no_code'; end if;
  if o.locked_at is not null then return 'locked'; end if;
  if o.expires_at <= now() then return 'expired'; end if;

  max_attempts := setting_num('otp_max_attempts', 5)::int;
  if p_code is null or trim(p_code) !~ '^[0-9]{4}$' or otp_hash(p_task, o.salt, trim(p_code)) <> o.code_hash then
    attempts := o.failed_attempts + 1;
    update task_otps set failed_attempts = attempts, locked_at = case when attempts >= max_attempts then now() end
     where task_id = p_task;
    perform log_action('task.wrong_code', 'task', p_task, jsonb_build_object('attempt', attempts));
    perform log_ops('completion.wrong_code', 'warn', jsonb_build_object('task_id', p_task, 'attempt', attempts));
    return case when attempts >= max_attempts then 'locked' else 'wrong' end;
  end if;

  -- Correct code: use it up, finish the task and record who finished it, in one step.
  update task_otps set consumed_at = now() where task_id = p_task;
  share := pm_share_bps_for(auth.uid());
  amt := task_value(t);
  update tasks set status = 'completed', completed_at = now(), pm_share_bps = share where id = p_task;
  insert into task_completions (task_id, worker_id, method, idempotency_key, pm_share_bps, amount, currency)
  values (p_task, auth.uid(), 'otp', p_idempotency_key, share, amt, t.currency);
  perform log_action('task.completed', 'task', p_task, jsonb_build_object('title', t.title, 'method', 'otp'),
                     jsonb_build_object('status', t.status), jsonb_build_object('status', 'completed', 'pm_share_bps', share));
  return 'ok';
end $$;

create or replace function public.admin_complete_task(p_task uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare t tasks; share int;
begin
  if not is_admin() then raise exception 'Admins only.'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Add a note explaining why.'; end if;
  select * into t from tasks where id = p_task for update;
  if t.id is null then raise exception 'Task not found.'; end if;
  if t.status not in ('assigned', 'in_progress') or t.assigned_worker_id is null then
    raise exception 'Only an accepted task can be completed.';
  end if;
  share := pm_share_bps_for(t.assigned_worker_id);
  update task_otps set consumed_at = now() where task_id = p_task and consumed_at is null;
  update tasks set status = 'completed', completed_at = now(), pm_share_bps = share where id = p_task;
  insert into task_completions (task_id, worker_id, method, pm_share_bps, amount, currency)
  values (p_task, t.assigned_worker_id, 'admin', share, task_value(t), t.currency);
  perform log_action('task.completed_by_admin', 'task', p_task, jsonb_build_object('note', p_note, 'title', t.title),
                     jsonb_build_object('status', t.status), jsonb_build_object('status', 'completed'));
end $$;

-- 7. Rating -----------------------------------------------------------------------------------------------------------------------------
-- The customer's rating feeds the PM's stats through a trigger, so the number a
-- PM sees is always the one the records produce.
create or replace function public.rate_task(p_task uuid, p_rating int, p_review text default null)
returns void language plpgsql security definer set search_path = public as $$
declare t tasks; target uuid;
begin
  if p_rating is null or p_rating < 1 or p_rating > 5 then raise exception 'Rating must be 1–5.'; end if;
  if p_review is not null and char_length(p_review) > 2000 then raise exception 'The review is too long.'; end if;
  select * into t from tasks where id = p_task for update;
  if t.id is null then raise exception 'Task not found.'; end if;
  if t.status <> 'completed' then raise exception 'You can rate a task once it is completed.'; end if;

  if t.customer_id = auth.uid() then
    if t.customer_rating_of_worker is not null then raise exception 'You already rated this task.'; end if;
    update tasks set customer_rating_of_worker = p_rating, customer_review = nullif(trim(p_review), '') where id = p_task;
    target := t.assigned_worker_id;
  elsif t.assigned_worker_id = auth.uid() then
    if t.worker_rating_of_customer is not null then raise exception 'You already rated this task.'; end if;
    update tasks set worker_rating_of_customer = p_rating where id = p_task;
    target := t.customer_id;
    update profiles p set rating = s.avg_rating, rating_count = s.n
      from (select round(avg(worker_rating_of_customer), 1) avg_rating, count(*)::int n
              from tasks where customer_id = target and worker_rating_of_customer is not null) s
     where p.id = target;
  else
    raise exception 'Not your task.';
  end if;
  perform log_action('task.rated', 'task', p_task, jsonb_build_object('rating', p_rating, 'rated', target));
end $$;
