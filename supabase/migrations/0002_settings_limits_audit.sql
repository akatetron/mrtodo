-- 0002 — platform settings, rate limiting, operations log, tamper-proof audit trail.
-- Safe to run more than once. Depends on 0001.

-- 1. Settings --------------------------------------------------------------------------
-- Business rules that change without a code change. Only a super admin can edit
-- them (set_setting), and every edit is audited. Values are read inside the
-- database functions that enforce the rules, never trusted from an app.
create table if not exists platform_settings (
  key text primary key,
  value jsonb not null,
  description text,
  updated_at timestamptz default now(),
  updated_by uuid references profiles (id) on delete set null
);

insert into platform_settings (key, value, description) values
  ('otp_ttl_minutes',                 '120',   'How long a completion code stays valid after the customer shows it'),
  ('otp_max_attempts',                '5',     'Wrong codes allowed before the code is locked and the customer must show a new one'),
  ('otp_issue_max_per_hour',          '10',    'How many times a customer can ask for a fresh code per task per hour'),
  ('otp_verify_max_per_10min',        '12',    'Completion-code attempts a task accepts in any 10 minutes'),
  ('standard_pm_share_bps',           '8000',  'Personal Manager share of an approved job price, in basis points (8000 = 80%); the platform keeps the rest'),
  ('gold_commission_bump_bps',        '500',   'Relative increase to the PM share for Gold Tier, in basis points (500 = a 5% relative increase: 80% becomes 84%)'),
  ('gold_min_verified_jobs',          '50',    'Gold Tier needs strictly MORE than this many verified completed jobs'),
  ('gold_min_avg_rating',             '4.8',   'Gold Tier needs an average customer rating strictly ABOVE this'),
  ('gold_min_rated_jobs',             '1',     'Minimum number of rated jobs before an average counts (guards against one lucky review)'),
  ('premium_window_seconds',          '180',   'How long Gold Tier PMs have first look at a premium task'),
  ('escalation_grace_minutes',        '15',    'Minutes after the scheduled time before a customer may escalate a late PM'),
  ('sla_unassigned_minutes',          '15',    'Minutes a task may wait unassigned before the queue shows an SLA warning'),
  ('require_proof_photos',            'true',  'Completion needs a Before and an After photo'),
  ('require_customer_price_confirmation', 'true', 'The customer must confirm an admin-set price before work can start'),
  ('max_tasks_per_hour',              '10',    'Tasks one customer may post per hour'),
  ('broadcast_radius_km',             '15',    'How far from a task a Personal Manager is offered it, when both have a map location'),
  ('offer_timeout_minutes',           '15',    'Minutes an offer waits for an answer before it lapses')
on conflict (key) do nothing;

alter table platform_settings enable row level security;
drop policy if exists "settings: admins read" on platform_settings;
create policy "settings: admins read" on platform_settings for select using (is_admin());

create or replace function public.setting_num(p_key text, p_default numeric)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select (value #>> '{}')::numeric from platform_settings where key = p_key), p_default);
$$;

create or replace function public.setting_bool(p_key text, p_default boolean)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select (value #>> '{}')::boolean from platform_settings where key = p_key), p_default);
$$;

-- 2. Audit trail: before/after values, and it cannot be changed --------------------------------
alter table audit_log add column if not exists before_value jsonb;
alter table audit_log add column if not exists after_value jsonb;

-- The earlier 4-argument version is replaced by one with optional before/after
-- arguments. Existing calls keep working unchanged.
drop function if exists public.log_action(text, text, uuid, jsonb);
create or replace function public.log_action(
  p_action text, p_entity text, p_entity_id uuid, p_details jsonb default '{}',
  p_before jsonb default null, p_after jsonb default null
) returns void language sql security definer set search_path = public as $$
  insert into audit_log (actor_id, action, entity, entity_id, details, before_value, after_value)
  values (auth.uid(), p_action, p_entity, p_entity_id, coalesce(p_details, '{}'), p_before, p_after);
$$;
revoke execute on function public.log_action(text, text, uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;

-- Nobody edits or deletes history, including the table owner and the service role.
-- The one allowed change is the database nulling actor_id when that person's
-- account is deleted.
create or replace function public.audit_log_immutable()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'The audit log cannot be changed.';
  elsif tg_op = 'UPDATE' then
    if old.actor_id is not null and new.actor_id is null
       and (to_jsonb(new) - 'actor_id') = (to_jsonb(old) - 'actor_id') then
      return new;
    end if;
    raise exception 'The audit log cannot be changed.';
  end if;
  return null;
end $$;

drop trigger if exists audit_log_immutable on audit_log;
create trigger audit_log_immutable before update or delete on audit_log
  for each row execute procedure public.audit_log_immutable();

create or replace function public.audit_log_no_truncate()
returns trigger language plpgsql as $$
begin raise exception 'The audit log cannot be changed.'; end $$;
drop trigger if exists audit_log_no_truncate on audit_log;
create trigger audit_log_no_truncate before truncate on audit_log
  for each statement execute procedure public.audit_log_no_truncate();

revoke insert, update, delete, truncate on audit_log from anon, authenticated;

-- set_setting is defined here (after log_action) so it can record before/after.
create or replace function public.set_setting(p_key text, p_value jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare cur platform_settings; num numeric;
begin
  if not is_super_admin() then raise exception 'Only a super admin can change settings.'; end if;
  select * into cur from platform_settings where key = p_key for update;
  if cur.key is null then raise exception 'Unknown setting %.', p_key; end if;
  if jsonb_typeof(p_value) is distinct from jsonb_typeof(cur.value) then
    raise exception 'Setting % must be a %.', p_key, jsonb_typeof(cur.value);
  end if;
  if jsonb_typeof(p_value) = 'number' then
    num := (p_value #>> '{}')::numeric;
    if num < 0 then raise exception 'Setting % cannot be negative.', p_key; end if;
    if p_key like '%\_bps' escape '\' and num > 10000 then raise exception 'Basis points cannot exceed 10000.'; end if;
    if p_key = 'gold_min_avg_rating' and num > 5 then raise exception 'A rating cannot exceed 5.'; end if;
  end if;
  update platform_settings set value = p_value, updated_at = now(), updated_by = auth.uid() where key = p_key;
  perform log_action('setting.changed', 'setting', null, jsonb_build_object('key', p_key),
                     jsonb_build_object('value', cur.value), jsonb_build_object('value', p_value));
  -- A change to a Gold Tier rule applies to everyone straight away, not at their next job.
  if p_key like 'gold\_%' escape '\' then
    perform recompute_pm_stats(w.id) from (select id from profiles where role = 'worker') w;
  end if;
end $$;

-- 3. Rate limiting ----------------------------------------------------------------------------------
-- Fixed windows. rate_limit_hit is for the database's own functions; the _self
-- variant is for triggers that run as the signed-in user and can only ever
-- spend that user's own allowance.
create table if not exists rate_limits (
  key text not null,
  window_start timestamptz not null,
  hits int not null default 0,
  primary key (key, window_start)
);
alter table rate_limits enable row level security;
revoke all on rate_limits from anon, authenticated;

create or replace function public.rate_limit_hit(p_key text, p_max int, p_window_seconds int)
returns boolean language plpgsql security definer set search_path = public as $$
declare ws timestamptz; h int;
begin
  ws := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into rate_limits (key, window_start, hits) values (p_key, ws, 1)
    on conflict (key, window_start) do update set hits = rate_limits.hits + 1
    returning hits into h;
  return h <= p_max;
end $$;
revoke execute on function public.rate_limit_hit(text, int, int) from public, anon, authenticated;

create or replace function public.rate_limit_self(p_action text, p_max int, p_window_seconds int)
returns boolean language sql security definer set search_path = public as $$
  select public.rate_limit_hit(p_action || ':' || coalesce(auth.uid()::text, 'anon'), p_max, p_window_seconds);
$$;
revoke execute on function public.rate_limit_self(text, int, int) from public, anon;
grant execute on function public.rate_limit_self(text, int, int) to authenticated;

-- 4. Operations log ----------------------------------------------------------------------------------
-- Structured events for things operators watch: conflicts, rejected attempts,
-- routing decisions. Written by the database's own functions; never contains
-- completion codes, payment details or contact information.
create table if not exists ops_events (
  id bigserial primary key,
  level text not null default 'info' check (level in ('info', 'warn', 'error')),
  event text not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists ops_events_event_idx on ops_events (event, created_at desc);
create index if not exists ops_events_created_idx on ops_events (created_at desc);
alter table ops_events enable row level security;
drop policy if exists "ops: admins read" on ops_events;
create policy "ops: admins read" on ops_events for select using (is_admin());
revoke insert, update, delete, truncate on ops_events from anon, authenticated;

create or replace function public.log_ops(p_event text, p_level text default 'info', p_details jsonb default '{}')
returns void language sql security definer set search_path = public as $$
  insert into ops_events (level, event, details) values (p_level, p_event, coalesce(p_details, '{}'));
$$;
revoke execute on function public.log_ops(text, text, jsonb) from public, anon, authenticated;

-- Tables that only the database's own functions may write.
revoke insert, update, delete, truncate on platform_settings from anon, authenticated;
