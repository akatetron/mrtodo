-- 0012 — operating regions and currencies, platform operating hours, PM working schedules,
-- and slot validation. Safe to run more than once. Depends on 0001-0011.
--
-- Nothing here invents business data: there are no seeded regions, rates or schedules.
-- A task with no region behaves exactly as before. The only default is the platform
-- window of 06:00-20:00 local time, which an administrator can change in settings or
-- override per region and per weekday.
--
-- Local time: every instant is stored as timestamptz. "Local" always means the time
-- zone of the task's region (regions.timezone), converted with AT TIME ZONE, so daylight
-- saving changes are handled by the database's tz data, never by app code.

-- 1. Settings used by this migration -----------------------------------------------------------------
insert into platform_settings (key, value, description) values
  ('operating_start',        '"06:00"', 'Default platform opening time (local service time). A region can override it per weekday.'),
  ('operating_end',          '"20:00"', 'Default platform closing time (local service time). A region can override it per weekday.'),
  ('default_timezone',       '"UTC"',   'Time zone used for a task that has no region. Set it to your main service zone, for example Asia/Kolkata.'),
  ('default_task_minutes',   '60',      'Length assumed for scheduling when a task has no stated duration'),
  ('schedule_buffer_minutes','0',       'Minutes kept free before and after a Personal Manager''s other tasks (a PM can have their own value)')
on conflict (key) do nothing;

-- True when the statement runs as an app user (the roles PostgREST sets), false for the owner,
-- migrations and the service role. Used by trigger functions that run as definer, where
-- current_user would always be the owner.
create or replace function public.is_app_caller()
returns boolean language sql stable as $$ select coalesce(current_setting('role', true), '') in ('authenticated', 'anon') $$;

create or replace function public.setting_text(p_key text, p_default text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select value #>> '{}' from platform_settings where key = p_key), p_default);
$$;

-- 2. Regions: one currency and one time zone each ------------------------------------------------------
create table if not exists regions (
  code text primary key check (code ~ '^[A-Z0-9][A-Z0-9-]{1,11}$'),
  name text not null check (char_length(name) between 2 and 80),
  country char(2) check (country is null or country ~ '^[A-Z]{2}$'),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),       -- ISO 4217
  timezone text not null,                                          -- IANA name, checked on save
  status text not null default 'draft' check (status in ('draft', 'active', 'paused')),
  -- Whether our payment provider takes this currency is a fact about our account, so it
  -- starts false and is switched on by an administrator only after checking.
  payments_enabled boolean not null default false,
  -- May a customer send a request outside operating hours, for a service inside them?
  allow_outside_hours_requests boolean not null default true,
  updated_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists region_hours (        -- a weekday that differs from the default window
  region_code text not null references regions (code) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),        -- 0 = Sunday
  closed boolean not null default false,
  open_time time,
  close_time time,
  primary key (region_code, weekday),
  check (closed or (open_time is not null and close_time is not null and open_time < close_time))
);

create table if not exists region_exceptions (   -- a closure or special hours on one date
  id uuid primary key default gen_random_uuid(),
  region_code text references regions (code) on delete cascade,     -- null = every region
  on_date date not null,
  closed boolean not null default true,
  open_time time,
  close_time time,
  reason text check (reason is null or char_length(reason) <= 200),
  created_at timestamptz not null default now(),
  check (closed or (open_time is not null and close_time is not null and open_time < close_time))
);
create unique index if not exists region_exceptions_one_per_day on region_exceptions (coalesce(region_code, ''), on_date);

-- 3. Personal Manager schedules ----------------------------------------------------------------------------
-- Working hours are windows per weekday, in the PM's region time zone. A break is simply a
-- gap between two windows (09:00-13:00 and 14:00-18:00). A PM with no windows has not told
-- us when they work, so they are never offered a timed task.
create table if not exists pm_working_hours (
  worker_id uuid not null references profiles (id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  primary key (worker_id, weekday, start_time),
  check (start_time < end_time)
);
create table if not exists pm_blocks (           -- time off or other one-off blocked time
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references profiles (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  kind text not null default 'time_off' check (kind in ('time_off', 'blocked', 'break')),
  note text check (note is null or char_length(note) <= 200),
  created_at timestamptz not null default now(),
  check (starts_at < ends_at)
);
create index if not exists pm_blocks_worker_idx on pm_blocks (worker_id, starts_at);
alter table profiles add column if not exists schedule_buffer_minutes int check (schedule_buffer_minutes is null or schedule_buffer_minutes between 0 and 240);
alter table profiles add column if not exists region_codes text[] not null default '{}';     -- regions this PM serves; empty = not stated
select public.refresh_profile_grants();

-- 4. What a task asks of the calendar ---------------------------------------------------------------------------
alter table tasks add column if not exists region_code text references regions (code);
alter table tasks add column if not exists est_minutes int check (est_minutes is null or est_minutes between 1 and 14400);   -- the customer's expected duration
alter table tasks add column if not exists hours_exception_by uuid references profiles (id) on delete set null;
alter table tasks add column if not exists hours_exception_at timestamptz;
alter table tasks add column if not exists hours_exception_note text;

create or replace function public.region_tz(p_region text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select timezone from regions where code = p_region), setting_text('default_timezone', 'UTC'));
$$;

-- The opening window for one local date; no row means closed.
create or replace function public.hours_for(p_region text, p_date date)
returns table (open_time time, close_time time) language plpgsql stable security definer set search_path = public as $$
declare ex region_exceptions; rh region_hours;
begin
  select * into ex from region_exceptions e
   where e.on_date = p_date and (e.region_code = p_region or e.region_code is null)
   order by e.region_code nulls last limit 1;
  if found then
    if ex.closed then return; end if;
    return query select ex.open_time, ex.close_time; return;
  end if;
  select * into rh from region_hours h where h.region_code = p_region and h.weekday = extract(dow from p_date)::int;
  if found then
    if rh.closed then return; end if;
    return query select rh.open_time, rh.close_time; return;
  end if;
  return query select setting_text('operating_start', '06:00')::time, setting_text('operating_end', '20:00')::time;
end $$;

-- Null when [p_start, p_end] sits inside the platform's hours for its local day.
create or replace function public.within_platform_hours(p_region text, p_start timestamptz, p_end timestamptz)
returns text language plpgsql stable security definer set search_path = public as $$
declare tz text := region_tz(p_region); ls timestamp := p_start at time zone region_tz(p_region); le timestamp := p_end at time zone region_tz(p_region); h record;
begin
  if ls::date <> le::date then return 'A visit has to start and finish on the same day, inside our operating hours.'; end if;
  select * into h from hours_for(p_region, ls::date);
  if not found then return 'We are closed on that day. Please choose another day.'; end if;
  if ls::time < h.open_time or le::time > h.close_time then
    return format('We take tasks between %s and %s on that day. Please choose a time that finishes by %s.', to_char(h.open_time, 'HH24:MI'), to_char(h.close_time, 'HH24:MI'), to_char(h.close_time, 'HH24:MI'));
  end if;
  return null;
end $$;

-- The time ranges a task occupies. A multi-day plan counts only when its visits are
-- structured ({"date":"2026-11-02","start":"10:00","minutes":90}); free-text visits give
-- no dates the database can check, so such a task has no windows and is never auto-offered.
create or replace function public.task_windows(t tasks)
returns table (w_start timestamptz, w_end timestamptz) language plpgsql stable security definer set search_path = public as $$
declare tz text := region_tz(t.region_code); v jsonb; mins int; n int := 0;
begin
  mins := coalesce(t.est_minutes, t.est_duration_minutes, setting_num('default_task_minutes', 60)::int);
  if t.schedule_kind = 'multi_day' then
    for v in select * from jsonb_array_elements(coalesce(t.schedule_plan, '[]')) loop
      if (v ->> 'date') ~ '^\d{4}-\d{2}-\d{2}$' and (v ->> 'start') ~ '^([01]\d|2[0-3]):[0-5]\d$' then
        w_start := ((v ->> 'date') || ' ' || (v ->> 'start'))::timestamp at time zone tz;
        w_end := w_start + make_interval(mins => coalesce(nullif(v ->> 'minutes', '')::int, mins));
        n := n + 1; return next;
      end if;
    end loop;
    return;
  end if;
  if t.scheduled_at is not null then
    w_start := t.scheduled_at; w_end := t.scheduled_at + make_interval(mins => mins); return next;
  end if;
end $$;

-- True when a task's visit times are all structured, so the database can check them.
create or replace function public.task_schedule_checkable(t tasks)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare total int; ok int;
begin
  if t.schedule_kind = 'multi_day' then
    total := jsonb_array_length(coalesce(t.schedule_plan, '[]'));
    select count(*) into ok from task_windows(t);
    return total > 0 and ok = total;
  end if;
  return t.scheduled_at is not null;
end $$;

-- Null when this PM can take [p_start, p_end]; otherwise the reason.
create or replace function public.pm_free_problem(p_worker uuid, p_region text, p_start timestamptz, p_end timestamptz, p_exclude_task uuid default null)
returns text language plpgsql stable security definer set search_path = public as $$
declare tz text := region_tz(p_region); ls timestamp := p_start at time zone region_tz(p_region); le timestamp := p_end at time zone region_tz(p_region);
        buf int; has_any boolean; fits boolean;
begin
  select coalesce(schedule_buffer_minutes, setting_num('schedule_buffer_minutes', 0)::int) into buf from profiles where id = p_worker;
  select exists (select 1 from pm_working_hours where worker_id = p_worker) into has_any;
  if not has_any then return 'No working hours have been set.'; end if;
  if ls::date <> le::date then return 'The visit runs past midnight.'; end if;
  select exists (select 1 from pm_working_hours h where h.worker_id = p_worker and h.weekday = extract(dow from ls::date)::int
                    and h.start_time <= ls::time and h.end_time >= le::time) into fits;
  if not fits then return 'Outside this Personal Manager''s working hours.'; end if;
  if exists (select 1 from pm_blocks b where b.worker_id = p_worker and b.starts_at < p_end and b.ends_at > p_start) then
    return 'The Personal Manager has time off or a break then.';
  end if;
  if exists (
    select 1 from tasks a, lateral task_windows(a) w
     where a.assigned_worker_id = p_worker and a.status in ('matched', 'assigned', 'in_progress')
       and a.id is distinct from p_exclude_task
       and w.w_start < p_end + make_interval(mins => buf) and w.w_end + make_interval(mins => buf) > p_start) then
    return 'The Personal Manager already has a task then.';
  end if;
  return null;
end $$;

-- 5. Customer-facing slot checks (the backend decides; the app only displays) -----------------------------------------
create or replace function public.slot_problem(p_region text, p_start timestamptz, p_minutes int default null)
returns text language plpgsql stable security definer set search_path = public as $$
declare mins int := coalesce(p_minutes, setting_num('default_task_minutes', 60)::int); r regions;
begin
  if p_region is not null then
    select * into r from regions where code = p_region;
    if r.code is null or r.status <> 'active' then return 'Please choose a supported service region.'; end if;
  end if;
  if p_start < now() - interval '5 minutes' then return 'That time has already passed.'; end if;
  return within_platform_hours(p_region, p_start, p_start + make_interval(mins => mins));
end $$;

create or replace function public.available_slots(p_region text, p_date date, p_minutes int default null, p_step int default 30)
returns table (slot_start timestamptz, local_time text) language plpgsql stable security definer set search_path = public as $$
declare tz text := region_tz(p_region); h record; mins int := coalesce(p_minutes, setting_num('default_task_minutes', 60)::int); cur timestamp; lastpossible timestamp;
begin
  if p_step not between 5 and 240 then raise exception 'Choose a step between 5 and 240 minutes.'; end if;
  if p_region is not null and not exists (select 1 from regions where code = p_region and status = 'active') then return; end if;
  select * into h from hours_for(p_region, p_date);
  if not found then return; end if;
  cur := p_date + h.open_time; lastpossible := p_date + h.close_time - make_interval(mins => mins);
  while cur <= lastpossible loop
    slot_start := cur at time zone tz;
    if slot_start >= now() then local_time := to_char(cur, 'HH24:MI'); return next; end if;
    cur := cur + make_interval(mins => p_step);
  end loop;
end $$;

-- A customer may submit a request outside operating hours only if the region allows it.
create or replace function public.guard_task_region()
returns trigger language plpgsql security definer set search_path = public as $$
declare r regions; prob text; w record; ln timestamp; h record; ex boolean;
begin
  if is_app_caller() then
    new.hours_exception_by := null; new.hours_exception_at := null; new.hours_exception_note := null;
    if new.region_code is not null then
      select * into r from regions where code = new.region_code;
      if r.code is null or r.status <> 'active' then raise exception 'Please choose a supported service region.'; end if;
      if not r.allow_outside_hours_requests then
        ln := now() at time zone r.timezone;
        select * into h from hours_for(r.code, ln::date);
        if not found or ln::time < h.open_time or ln::time > h.close_time then
          raise exception 'Requests for this region are taken during operating hours only. Please try again then.';
        end if;
      end if;
      for w in select * from task_windows(new) loop
        prob := within_platform_hours(new.region_code, w.w_start, w.w_end);
        if prob is not null then raise exception '%', prob; end if;
      end loop;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists task_region_rules on tasks;
create trigger task_region_rules before insert on tasks for each row execute procedure public.guard_task_region();

-- 6. Administrators ---------------------------------------------------------------------------------------------
create or replace function public.save_region(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare c text := upper(trim(p ->> 'code')); old regions; cur char(3) := upper(trim(p ->> 'currency')); tz text := trim(p ->> 'timezone');
begin
  if not is_super_admin() then raise exception 'Only a super admin can change regions.'; end if;
  if c is null or c !~ '^[A-Z0-9][A-Z0-9-]{1,11}$' then raise exception 'Give the region a short code, for example IN-MH.'; end if;
  if cur is null or cur !~ '^[A-Z]{3}$' then raise exception 'Use a three-letter ISO 4217 currency code.'; end if;
  if not exists (select 1 from pg_timezone_names where name = tz) then raise exception 'That time zone is not recognised. Use an IANA name such as Asia/Kolkata.'; end if;
  if coalesce(p ->> 'status', 'draft') not in ('draft', 'active', 'paused') then raise exception 'Unknown status.'; end if;
  select * into old from regions where code = c;
  if old.code is not null and old.currency <> cur and region_has_rules(c) then
    raise exception 'This region has pricing rules in %. Create a new region for a different currency instead of changing it.', old.currency;
  end if;
  insert into regions (code, name, country, currency, timezone, status, payments_enabled, allow_outside_hours_requests, updated_by)
  values (c, trim(p ->> 'name'), nullif(upper(trim(p ->> 'country')), ''), cur, tz, coalesce(p ->> 'status', 'draft'),
          coalesce((p ->> 'payments_enabled')::boolean, false), coalesce((p ->> 'allow_outside_hours_requests')::boolean, true), auth.uid())
  on conflict (code) do update set name = excluded.name, country = excluded.country, currency = excluded.currency, timezone = excluded.timezone,
    status = excluded.status, payments_enabled = excluded.payments_enabled, allow_outside_hours_requests = excluded.allow_outside_hours_requests,
    updated_by = auth.uid(), updated_at = now();
  perform log_action(case when old.code is null then 'region.created' else 'region.updated' end, 'region', null,
    jsonb_build_object('code', c), to_jsonb(old), p);
  return c;
end $$;
-- placeholder replaced in 0013 once pricing rules exist; until then no region has any
create or replace function public.region_has_rules(p_region text)
returns boolean language sql stable as $$ select false $$;

create or replace function public.save_region_hours(p_region text, p_rows jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  if not is_super_admin() then raise exception 'Only a super admin can change operating hours.'; end if;
  if not exists (select 1 from regions where code = p_region) then raise exception 'Unknown region.'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'Hours must be a list.'; end if;
  delete from region_hours where region_code = p_region;
  for r in select * from jsonb_array_elements(p_rows) loop
    insert into region_hours (region_code, weekday, closed, open_time, close_time)
    values (p_region, (r ->> 'weekday')::smallint, coalesce((r ->> 'closed')::boolean, false), nullif(r ->> 'open', '')::time, nullif(r ->> 'close', '')::time);
  end loop;
  perform log_action('region.hours_changed', 'region', null, jsonb_build_object('code', p_region, 'rows', p_rows));
end $$;

create or replace function public.save_hours_exception(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare rid uuid; reg text := nullif(upper(trim(p ->> 'region_code')), '');
begin
  if not is_super_admin() then raise exception 'Only a super admin can change closures.'; end if;
  if reg is not null and not exists (select 1 from regions where code = reg) then raise exception 'Unknown region.'; end if;
  insert into region_exceptions (region_code, on_date, closed, open_time, close_time, reason)
  values (reg, (p ->> 'on_date')::date, coalesce((p ->> 'closed')::boolean, true), nullif(p ->> 'open', '')::time, nullif(p ->> 'close', '')::time, left(p ->> 'reason', 200))
  on conflict (coalesce(region_code, ''), on_date) do update set closed = excluded.closed, open_time = excluded.open_time, close_time = excluded.close_time, reason = excluded.reason
  returning id into rid;
  perform log_action('region.exception_saved', 'region_exception', rid, p);
  return rid;
end $$;

create or replace function public.delete_hours_exception(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_super_admin() then raise exception 'Only a super admin can change closures.'; end if;
  delete from region_exceptions where id = p_id;
  perform log_action('region.exception_deleted', 'region_exception', p_id);
end $$;

-- An approved exception lets one task be assigned outside the platform's hours.
create or replace function public.approve_hours_exception(p_task uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only.'; end if;
  if char_length(trim(coalesce(p_note, ''))) < 10 then raise exception 'Record why this exception is approved (at least 10 characters).'; end if;
  update tasks set hours_exception_by = auth.uid(), hours_exception_at = now(), hours_exception_note = trim(p_note) where id = p_task and status in ('requested', 'matched');
  if not found then raise exception 'That task cannot take an exception now.'; end if;
  perform log_action('task.hours_exception', 'task', p_task, jsonb_build_object('note', trim(p_note)));
end $$;

-- 7. A Personal Manager's own schedule ----------------------------------------------------------------------------------------
create or replace function public.set_working_hours(p_worker uuid, p_rows jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare w uuid := coalesce(p_worker, auth.uid()); r jsonb;
begin
  if w is distinct from auth.uid() and not is_admin() then raise exception 'You can only change your own working hours.'; end if;
  if not exists (select 1 from profiles where id = w and role = 'worker') then raise exception 'That is not a Personal Manager.'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 28 then raise exception 'Send a list of at most 28 working windows.'; end if;
  delete from pm_working_hours where worker_id = w;
  for r in select * from jsonb_array_elements(p_rows) loop
    insert into pm_working_hours (worker_id, weekday, start_time, end_time)
    values (w, (r ->> 'weekday')::smallint, (r ->> 'start')::time, (r ->> 'end')::time);
  end loop;
  if exists (select 1 from pm_working_hours a join pm_working_hours b on a.worker_id = b.worker_id and a.weekday = b.weekday and a.start_time < b.start_time and a.end_time > b.start_time where a.worker_id = w) then
    raise exception 'Two working windows on the same day overlap.';
  end if;
  perform log_action('pm.hours_changed', 'profile', w, jsonb_build_object('windows', jsonb_array_length(p_rows)));
end $$;

create or replace function public.add_pm_block(p_worker uuid, p_start timestamptz, p_end timestamptz, p_kind text default 'time_off', p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare w uuid := coalesce(p_worker, auth.uid()); bid uuid;
begin
  if w is distinct from auth.uid() and not is_admin() then raise exception 'You can only change your own schedule.'; end if;
  if not exists (select 1 from profiles where id = w and role = 'worker') then raise exception 'That is not a Personal Manager.'; end if;
  if p_end <= p_start then raise exception 'The end must be after the start.'; end if;
  insert into pm_blocks (worker_id, starts_at, ends_at, kind, note) values (w, p_start, p_end, coalesce(p_kind, 'time_off'), left(p_note, 200)) returning id into bid;
  return bid;
end $$;

create or replace function public.remove_pm_block(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from pm_blocks where id = p_id and (worker_id = auth.uid() or is_admin());
end $$;

create or replace function public.my_schedule(p_worker uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare w uuid := coalesce(p_worker, auth.uid());
begin
  if w is distinct from auth.uid() and not is_admin() then raise exception 'Not allowed.'; end if;
  return jsonb_build_object(
    'hours', coalesce((select jsonb_agg(jsonb_build_object('weekday', weekday, 'start', to_char(start_time, 'HH24:MI'), 'end', to_char(end_time, 'HH24:MI')) order by weekday, start_time) from pm_working_hours where worker_id = w), '[]'),
    'blocks', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'starts_at', starts_at, 'ends_at', ends_at, 'kind', kind, 'note', note) order by starts_at) from pm_blocks where worker_id = w and ends_at > now()), '[]'),
    'buffer_minutes', (select schedule_buffer_minutes from profiles where id = w));
end $$;

-- 8. Access --------------------------------------------------------------------------------------------------------------------------
alter table regions enable row level security;
alter table region_hours enable row level security;
alter table region_exceptions enable row level security;
alter table pm_working_hours enable row level security;
alter table pm_blocks enable row level security;
drop policy if exists "regions: read" on regions;
create policy "regions: read" on regions for select using (status = 'active' or is_admin());
drop policy if exists "region hours: read" on region_hours;
create policy "region hours: read" on region_hours for select using (true);
drop policy if exists "region exceptions: read" on region_exceptions;
create policy "region exceptions: read" on region_exceptions for select using (true);
drop policy if exists "pm hours: owner or admin" on pm_working_hours;
create policy "pm hours: owner or admin" on pm_working_hours for select using (worker_id = auth.uid() or is_admin());
drop policy if exists "pm blocks: owner or admin" on pm_blocks;
create policy "pm blocks: owner or admin" on pm_blocks for select using (worker_id = auth.uid() or is_admin());
revoke insert, update, delete, truncate on regions, region_hours, region_exceptions, pm_working_hours, pm_blocks from anon, authenticated;
grant select on regions, region_hours, region_exceptions, pm_working_hours, pm_blocks to authenticated;

revoke execute on function public.setting_text(text, text), public.region_tz(text), public.hours_for(text, date), public.within_platform_hours(text, timestamptz, timestamptz),
  public.task_windows(tasks), public.task_schedule_checkable(tasks), public.pm_free_problem(uuid, text, timestamptz, timestamptz, uuid),
  public.slot_problem(text, timestamptz, int), public.available_slots(text, date, int, int),
  public.save_region(jsonb), public.save_region_hours(text, jsonb), public.save_hours_exception(jsonb), public.delete_hours_exception(uuid),
  public.approve_hours_exception(uuid, text), public.set_working_hours(uuid, jsonb), public.add_pm_block(uuid, timestamptz, timestamptz, text, text),
  public.remove_pm_block(uuid), public.my_schedule(uuid) from public, anon;
-- Internal helpers are not callable by apps; the functions below are the surface.
revoke execute on function public.setting_text(text, text), public.task_windows(tasks), public.task_schedule_checkable(tasks),
  public.pm_free_problem(uuid, text, timestamptz, timestamptz, uuid) from authenticated;
grant execute on function public.region_tz(text), public.hours_for(text, date), public.within_platform_hours(text, timestamptz, timestamptz),
  public.slot_problem(text, timestamptz, int), public.available_slots(text, date, int, int),
  public.save_region(jsonb), public.save_region_hours(text, jsonb), public.save_hours_exception(jsonb), public.delete_hours_exception(uuid),
  public.approve_hours_exception(uuid, text), public.set_working_hours(uuid, jsonb), public.add_pm_block(uuid, timestamptz, timestamptz, text, text),
  public.remove_pm_block(uuid), public.my_schedule(uuid) to authenticated;
