-- 0008 — PM job feed, Gold priority window, atomic claim, lateness escalation,
-- Todo+ subscriptions (Razorpay webhook), notification outbox, retention.
-- Safe to run more than once. Depends on 0001-0007.
--
-- Distance: plain latitude/longitude and a great-circle formula, so no database
-- extension is needed. Not verified against a real Supabase project.

-- 1. Where things are, and when ---------------------------------------------------------------------------------------
alter table tasks add column if not exists scheduled_at timestamptz;      -- the appointment as a real timestamp (scheduled_for stays the customer's words)
alter table tasks add column if not exists lat numeric(9,6);
alter table tasks add column if not exists lng numeric(9,6);
alter table tasks add column if not exists arrived_at timestamptz;        -- set by the server when the PM says they have arrived
alter table tasks add column if not exists escalated_at timestamptz;
do $$ begin
  alter table tasks add constraint tasks_point_check check ((lat is null) = (lng is null) and (lat is null or (lat between -90 and 90 and lng between -180 and 180)));
exception when duplicate_object then null; end $$;
create index if not exists tasks_feed_idx on tasks (available_at) where status = 'requested' and routing_mode = 'broadcast';
alter table profiles add column if not exists base_lat numeric(9,6);
alter table profiles add column if not exists base_lng numeric(9,6);
do $$ begin
  alter table profiles add constraint profiles_point_check check ((base_lat is null) = (base_lng is null) and (base_lat is null or (base_lat between -90 and 90 and base_lng between -180 and 180)));
exception when duplicate_object then null; end $$;
select public.refresh_profile_grants();

-- The customer may state the appointment time and a map point for their own task; the rest is the platform's.
create or replace function public.guard_task_schedule()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.scheduled_at is not null and (new.scheduled_at < now() - interval '5 minutes' or new.scheduled_at > now() + interval '1 year') then
      raise exception 'Choose a date and time between now and the next twelve months.';
    end if;
    new.arrived_at := null; new.escalated_at := null;
  end if;
  return new;
end $$;
drop trigger if exists guard_task_schedule on tasks;
create trigger guard_task_schedule before insert on tasks for each row execute procedure public.guard_task_schedule();

create or replace function public.km_between(a_lat numeric, a_lng numeric, b_lat numeric, b_lng numeric)
returns numeric language sql immutable as $$
  select (6371 * 2 * asin(sqrt(
    power(sin(radians(b_lat - a_lat) / 2), 2) + cos(radians(a_lat)) * cos(radians(b_lat)) * power(sin(radians(b_lng - a_lng) / 2), 2))))::numeric;
$$;

-- 2. The feed: only what this PM may see, nothing else about the customer --------------------------------------------------
-- Rules, all decided here and never in an app:
--   * the PM is approved, and verified for every skill the task needs
--   * the task is open, broadcast, and has a confirmed price
--   * a premium task is hidden from non-Gold PMs until premium_window_seconds after it opened
--   * distance: when both sides have a map point it must be within broadcast_radius_km;
--     otherwise the PM's service area text must appear in the address (or they gave no area)
--   * the PM has not declined it
create or replace function public.pm_task_feed(p_limit int default 20)
returns table (
  id uuid, title text, description text, category text, area text, scheduled_at timestamptz, scheduled_for text,
  est_cost numeric, rate_per_day numeric, currency char(3), est_duration_minutes int, is_premium boolean,
  premium_window_ends_at timestamptz, earn_share_bps int, distance_km numeric, available_at timestamptz, schedule_kind text
) language plpgsql stable security definer set search_path = public as $$
declare me profiles; win int := setting_num('premium_window_seconds', 180)::int; radius numeric := setting_num('broadcast_radius_km', 15);
begin
  select * into me from profiles where profiles.id = auth.uid() and role = 'worker' and worker_status = 'approved';
  if me.id is null then return; end if;
  return query
  select t.id, t.title, t.description, t.category, area_of(t.location), t.scheduled_at, t.scheduled_for,
         t.est_cost, t.rate_per_day, t.currency, t.est_duration_minutes, t.is_premium,
         case when t.is_premium and now() < t.available_at + make_interval(secs => win) then t.available_at + make_interval(secs => win) end,
         pm_share_bps_for(me.id),
         case when me.base_lat is not null and t.lat is not null then round(km_between(me.base_lat, me.base_lng, t.lat, t.lng), 1) end,
         t.available_at, t.schedule_kind
    from tasks t
   where t.status = 'requested' and t.routing_mode = 'broadcast' and t.price_status = 'confirmed'
     and t.review_state in ('ready', 'none')
     and (not t.is_premium or me.tier = 'gold' or now() >= t.available_at + make_interval(secs => win))
     and not exists (select 1 from task_declines d where d.task_id = t.id and d.worker_id = me.id)
     and coalesce(array_length(pm_missing_skills(me.id, t.id), 1), 0) = 0
     and (case
            when me.base_lat is not null and t.lat is not null then km_between(me.base_lat, me.base_lng, t.lat, t.lng) <= radius
            else coalesce(me.service_area, '') = '' or t.location ilike '%' || me.service_area || '%'
          end)
   order by (t.is_premium and now() < t.available_at + make_interval(secs => win)) desc, t.available_at asc
   limit least(greatest(p_limit, 1), 50);
end $$;

-- The one way a broadcast task becomes someone's. The row is locked, so of any
-- number of simultaneous claims exactly one wins and the rest are told so.
create or replace function public.claim_task(p_task uuid)
returns text language plpgsql security definer set search_path = public as $$
declare t tasks; me profiles; missing text[]; win int := setting_num('premium_window_seconds', 180)::int;
begin
  select * into me from profiles where id = auth.uid() and role = 'worker' and worker_status = 'approved';
  if me.id is null then raise exception 'Only approved Personal Managers can take tasks.'; end if;
  if not rate_limit_self('claim_task', 30, 3600) then raise exception 'Too many tries. Please wait a little.'; end if;
  select * into t from tasks where id = p_task for update;
  if t.id is null then raise exception 'That task is no longer available.'; end if;
  if t.assigned_worker_id = me.id and t.status in ('assigned', 'in_progress') then return 'ok'; end if;      -- a repeat of a claim that already worked
  if t.status <> 'requested' or t.assigned_worker_id is not null then
    perform log_ops('routing.claim_lost', 'info', jsonb_build_object('task', t.id));
    raise exception 'This task was just taken by someone else.';
  end if;
  if t.routing_mode <> 'broadcast' or t.price_status <> 'confirmed' then raise exception 'That task is not open for claiming.'; end if;
  if t.is_premium and me.tier <> 'gold' and now() < t.available_at + make_interval(secs => win) then
    raise exception 'That task is not available to you yet.';
  end if;
  if exists (select 1 from task_declines d where d.task_id = t.id and d.worker_id = me.id) then raise exception 'You declined this task earlier.'; end if;
  missing := pm_missing_skills(me.id, t.id);
  if array_length(missing, 1) > 0 then raise exception 'This task needs a verified qualification you do not have yet: %.', array_to_string(missing, ', '); end if;
  update tasks set assigned_worker_id = me.id, status = 'assigned', assigned_at = now(), accepted_at = now() where id = t.id;
  update profiles set last_assigned_at = now() where id = me.id;
  perform log_action('task.claimed', 'task', t.id, jsonb_build_object('worker_id', me.id, 'premium', t.is_premium),
    jsonb_build_object('status', 'requested'), jsonb_build_object('status', 'assigned', 'assigned_worker_id', me.id));
  perform notify_user(t.customer_id, 'task', 'A Personal Manager accepted your task', t.title, t.id);
  perform log_ops('routing.claimed', 'info', jsonb_build_object('task', t.id, 'premium', t.is_premium));
  return 'ok';
end $$;

create or replace function public.decline_feed_task(p_task uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and role = 'worker' and worker_status = 'approved') then raise exception 'Not allowed.'; end if;
  insert into task_declines (task_id, worker_id, reason) select p_task, auth.uid(), left(p_reason, 300)
   where exists (select 1 from tasks where id = p_task and status = 'requested') on conflict do nothing;
end $$;

-- 3. Arrival and escalation ---------------------------------------------------------------------------------------------------
create or replace function public.mark_arrived(p_task uuid)
returns void language plpgsql security definer set search_path = public as $$
declare t tasks;
begin
  select * into t from tasks where id = p_task for update;
  if t.id is null or t.assigned_worker_id is distinct from auth.uid() then raise exception 'This is not your task.'; end if;
  if t.status not in ('assigned', 'in_progress') then raise exception 'The task is not under way.'; end if;
  if t.arrived_at is not null then return; end if;
  update tasks set arrived_at = now() where id = t.id;      -- the server's clock, not the phone's
  perform log_action('task.arrived', 'task', t.id, '{}');
end $$;

create table if not exists escalations (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks (id) on delete cascade,
  customer_id uuid not null references profiles (id),
  reason text check (reason is null or char_length(reason) <= 1000),
  minutes_late int not null,
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolution text check (resolution is null or char_length(resolution) <= 1000),
  resolved_by uuid references profiles (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists escalations_one_open on escalations (task_id) where status = 'open';
alter table escalations enable row level security;
drop policy if exists "escalations: customer and admin" on escalations;
create policy "escalations: customer and admin" on escalations for select using (customer_id = auth.uid() or is_admin());
revoke insert, update, delete, truncate on escalations from anon, authenticated;
do $$ begin alter publication supabase_realtime add table escalations; exception when others then null; end $$;

-- Minutes late (null = the button must stay hidden), judged by the server clock.
create or replace function public.minutes_late(p_task uuid)
returns int language sql stable security definer set search_path = public as $$
  select case when t.status = 'assigned' and t.scheduled_at is not null and t.arrived_at is null and t.escalated_at is null
                   and t.customer_id = auth.uid()
                   and now() > t.scheduled_at + make_interval(mins => setting_num('escalation_grace_minutes', 15)::int)
              then floor(extract(epoch from now() - t.scheduled_at) / 60)::int end
    from tasks t where t.id = p_task;
$$;

create or replace function public.escalate_task(p_task uuid, p_reason text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare t tasks; late int; eid uuid;
begin
  select * into t from tasks where id = p_task for update;
  if t.id is null or t.customer_id is distinct from auth.uid() then raise exception 'This is not your task.'; end if;
  if t.escalated_at is not null then
    select id into eid from escalations where task_id = t.id and status = 'open' order by created_at desc limit 1;
    if eid is not null then return eid; end if;       -- the same request twice changes nothing
  end if;
  late := minutes_late(p_task);
  if late is null then
    perform log_ops('escalation.refused', 'info', jsonb_build_object('task', t.id));
    raise exception 'You can ask for help once your Personal Manager is more than % minutes late and has not arrived.', setting_num('escalation_grace_minutes', 15)::int;
  end if;
  if not rate_limit_self('escalate', 5, 3600) then raise exception 'Too many requests. Please wait a little.'; end if;
  insert into escalations (task_id, customer_id, reason, minutes_late) values (t.id, t.customer_id, left(trim(p_reason), 1000), late) returning id into eid;
  update tasks set escalated_at = now() where id = t.id;
  perform log_action('task.escalated', 'task', t.id, jsonb_build_object('minutes_late', late, 'worker_id', t.assigned_worker_id));
  perform notify_admins('task', 'ESCALATION: customer says the Personal Manager is late', t.title || ' (' || late || ' min late)', t.id);
  return eid;
end $$;

-- Admin: take the PM off an accepted task that has not started, so it can be re-offered.
create or replace function public.unassign_task(p_task uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare t tasks;
begin
  if not is_admin() then raise exception 'Admins only.'; end if;
  select * into t from tasks where id = p_task for update;
  if t.id is null then raise exception 'Task not found.'; end if;
  if t.status <> 'assigned' then raise exception 'Only an accepted task that has not started can be taken back.'; end if;
  if char_length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'Say why.'; end if;
  update tasks set status = 'requested', assigned_worker_id = null, assigned_at = null, accepted_at = null, arrived_at = null where id = t.id;
  perform log_action('task.unassigned', 'task', t.id, jsonb_build_object('worker_id', t.assigned_worker_id, 'reason', left(p_reason, 500)),
    jsonb_build_object('status', 'assigned', 'assigned_worker_id', t.assigned_worker_id), jsonb_build_object('status', 'requested'));
  perform notify_user(t.assigned_worker_id, 'task', 'A task was taken back by our team', t.title, null);
end $$;

create or replace function public.resolve_escalation(p_escalation uuid, p_resolution text)
returns void language plpgsql security definer set search_path = public as $$
declare e escalations;
begin
  if not is_admin() then raise exception 'Admins only.'; end if;
  select * into e from escalations where id = p_escalation for update;
  if e.id is null then raise exception 'Unknown escalation.'; end if;
  if e.status = 'resolved' then return; end if;
  if char_length(trim(coalesce(p_resolution, ''))) < 5 then raise exception 'Record what was done.'; end if;
  update escalations set status = 'resolved', resolution = left(trim(p_resolution), 1000), resolved_by = auth.uid(), resolved_at = now() where id = e.id;
  perform log_action('escalation.resolved', 'task', e.task_id, jsonb_build_object('resolution', left(p_resolution, 500)));
  perform notify_user(e.customer_id, 'task', 'We looked into your escalation', left(trim(p_resolution), 300), e.task_id);
end $$;

-- 4. Todo+ subscriptions -------------------------------------------------------------------------------------------------------------
-- The price, visits and eligible services are an admin's decision. The seeded plan
-- is switched off and has no price.
create table if not exists subscription_plans (
  code text primary key check (code ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  name text not null,
  price_amount numeric(10,2) check (price_amount is null or price_amount >= 0),
  currency char(3) not null default 'INR',
  included_visits int not null default 1 check (included_visits >= 0),
  eligible_categories text[] not null default '{}',     -- empty = any
  description text,
  terms text,
  provider_plan_id text,                                 -- the plan id created at the payment provider
  active boolean not null default false check (not active or (price_amount is not null and provider_plan_id is not null)),
  updated_at timestamptz not null default now()
);
insert into subscription_plans (code, name, included_visits, description, terms) values
  ('todo-plus-monthly', 'Todo+ Monthly Maintenance', 1,
   'A monthly maintenance plan: regular help around the home.',
   'Billed monthly until you cancel. Cancelling stops the next renewal; the current month stays active. A subscription does not book an appointment: you request each visit and we confirm availability.')
on conflict (code) do nothing;
alter table subscription_plans enable row level security;
drop policy if exists "plans: everyone signed in" on subscription_plans;
create policy "plans: everyone signed in" on subscription_plans for select using (auth.uid() is not null and (active or is_admin()));
revoke insert, update, delete, truncate on subscription_plans from anon, authenticated;

create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles (id),
  plan_code text not null references subscription_plans (code),
  provider text not null default 'razorpay',
  provider_subscription_id text unique,
  status text not null default 'pending' check (status in ('pending', 'active', 'past_due', 'cancelled', 'expired')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  visits_remaining int not null default 0,
  consent_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists subscriptions_one_live on subscriptions (customer_id, plan_code) where status in ('pending', 'active', 'past_due');
alter table subscriptions enable row level security;
drop policy if exists "subscriptions: owner and admin" on subscriptions;
create policy "subscriptions: owner and admin" on subscriptions for select using (customer_id = auth.uid() or is_admin());
revoke insert, update, delete, truncate on subscriptions from anon, authenticated;

create table if not exists subscription_visits (
  task_id uuid primary key references tasks (id) on delete cascade,
  subscription_id uuid not null references subscriptions (id),
  created_at timestamptz not null default now()
);
alter table subscription_visits enable row level security;
drop policy if exists "sub visits: owner and admin" on subscription_visits;
create policy "sub visits: owner and admin" on subscription_visits for select using (is_admin() or exists (select 1 from subscriptions s where s.id = subscription_id and s.customer_id = auth.uid()));
revoke insert, update, delete, truncate on subscription_visits from anon, authenticated;

-- Webhook events are written once; a repeat is recognised and ignored.
create table if not exists webhook_events (
  provider text not null,
  event_id text not null,
  event_type text not null,
  outcome text not null,
  received_at timestamptz not null default now(),
  primary key (provider, event_id)
);
alter table webhook_events enable row level security;
revoke all on webhook_events from anon, authenticated;

create or replace function public.save_plan(p_code text, p_name text, p_price numeric, p_visits int, p_categories text[], p_description text, p_terms text, p_provider_plan text, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_super_admin() then raise exception 'Only a super admin can manage plans.'; end if;
  if p_active and (p_price is null or nullif(trim(p_provider_plan), '') is null) then raise exception 'To switch a plan on, set its price and the plan id from the payment provider.'; end if;
  insert into subscription_plans (code, name, price_amount, included_visits, eligible_categories, description, terms, provider_plan_id, active)
  values (p_code, p_name, p_price, coalesce(p_visits, 1), coalesce(p_categories, '{}'), p_description, p_terms, nullif(trim(p_provider_plan), ''), coalesce(p_active, false))
  on conflict (code) do update set name = excluded.name, price_amount = excluded.price_amount, included_visits = excluded.included_visits,
    eligible_categories = excluded.eligible_categories, description = excluded.description, terms = excluded.terms,
    provider_plan_id = excluded.provider_plan_id, active = excluded.active, updated_at = now();
  perform log_action('plan.saved', 'plan', null, jsonb_build_object('code', p_code, 'price', p_price, 'active', coalesce(p_active, false)));
end $$;

-- The customer asks to subscribe and consents to recurring billing. Nothing is
-- active until the payment provider says so through the signed webhook.
create or replace function public.start_subscription(p_plan text, p_consent boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare pl subscription_plans; sid uuid;
begin
  if auth.uid() is null or not exists (select 1 from profiles where id = auth.uid() and role = 'customer') then raise exception 'Customers only.'; end if;
  if p_consent is not true then raise exception 'Please agree to the recurring billing terms.'; end if;
  select * into pl from subscription_plans where code = p_plan and active;
  if pl.code is null then raise exception 'That plan is not available yet.'; end if;
  if not rate_limit_self('subscription', 10, 3600) then raise exception 'Too many tries. Please wait a little.'; end if;
  select id into sid from subscriptions where customer_id = auth.uid() and plan_code = p_plan and status in ('pending', 'active', 'past_due');
  if sid is not null then return sid; end if;
  insert into subscriptions (customer_id, plan_code, consent_at) values (auth.uid(), p_plan, now()) returning id into sid;
  perform log_action('subscription.requested', 'subscription', sid, jsonb_build_object('plan', p_plan));
  return sid;
end $$;

create or replace function public.request_cancel_subscription(p_subscription uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s subscriptions;
begin
  select * into s from subscriptions where id = p_subscription for update;
  if s.id is null or s.customer_id is distinct from auth.uid() then raise exception 'This is not your subscription.'; end if;
  if s.status not in ('pending', 'active', 'past_due') then return; end if;
  update subscriptions set cancel_at_period_end = true, updated_at = now() where id = s.id;
  perform log_action('subscription.cancel_requested', 'subscription', s.id, '{}');
  perform notify_admins('payout', 'A customer asked to cancel Todo+', s.plan_code, null);   -- the provider-side cancel is finished by the cancel-subscription function
end $$;

-- A visit comes out of the plan once per task, and only while the plan is live.
create or replace function public.book_subscription_visit(p_subscription uuid, p_task uuid)
returns int language plpgsql security definer set search_path = public as $$
declare s subscriptions; pl subscription_plans; t tasks; left_ int;
begin
  select * into s from subscriptions where id = p_subscription for update;
  if s.id is null or s.customer_id is distinct from auth.uid() then raise exception 'This is not your subscription.'; end if;
  select * into t from tasks where id = p_task for update;
  if t.id is null or t.customer_id is distinct from auth.uid() then raise exception 'This is not your task.'; end if;
  if exists (select 1 from subscription_visits where task_id = p_task) then return s.visits_remaining; end if;   -- already counted
  if s.status <> 'active' or (s.current_period_end is not null and s.current_period_end < now()) then raise exception 'Your plan is not active.'; end if;
  if s.visits_remaining <= 0 then raise exception 'No visits left this month.'; end if;
  select * into pl from subscription_plans where code = s.plan_code;
  if coalesce(array_length(pl.eligible_categories, 1), 0) > 0 and not (t.category = any (pl.eligible_categories)) then raise exception 'This plan does not cover that kind of task.'; end if;
  update subscriptions set visits_remaining = visits_remaining - 1, updated_at = now() where id = s.id returning visits_remaining into left_;
  insert into subscription_visits (task_id, subscription_id) values (p_task, s.id);
  perform log_action('subscription.visit_used', 'subscription', s.id, jsonb_build_object('task', p_task));
  return left_;
end $$;

-- Called only by the webhook Edge Function (service role), after it has verified the
-- provider's signature. Repeating an event changes nothing.
create or replace function public.apply_subscription_event(p_provider text, p_event_id text, p_type text, p_provider_subscription text, p_period_start timestamptz, p_period_end timestamptz)
returns text language plpgsql security definer set search_path = public as $$
declare s subscriptions; pl subscription_plans; result text := 'ignored'; new_status text;
begin
  insert into webhook_events (provider, event_id, event_type, outcome) values (p_provider, p_event_id, p_type, 'processing') on conflict do nothing;
  if not found then return 'duplicate'; end if;
  select * into s from subscriptions where provider = p_provider and provider_subscription_id = p_provider_subscription for update;
  if s.id is null then
    update webhook_events set outcome = 'unknown_subscription' where provider = p_provider and event_id = p_event_id;
    perform log_ops('subscription.unknown', 'warn', jsonb_build_object('type', p_type));
    return 'unknown_subscription';
  end if;
  select * into pl from subscription_plans where code = s.plan_code;
  new_status := case p_type
    when 'subscription.activated' then 'active' when 'subscription.charged' then 'active' when 'subscription.resumed' then 'active'
    when 'subscription.pending' then 'past_due' when 'subscription.halted' then 'past_due' when 'payment.failed' then 'past_due'
    when 'subscription.cancelled' then 'cancelled'
    when 'subscription.completed' then 'expired' when 'subscription.expired' then 'expired' end;
  if new_status is not null then
    update subscriptions set status = new_status,
      current_period_start = coalesce(p_period_start, current_period_start), current_period_end = coalesce(p_period_end, current_period_end),
      -- a new paid period renews the included visits, once per period
      visits_remaining = case when new_status = 'active' and p_period_start is not null and p_period_start is distinct from current_period_start then pl.included_visits else visits_remaining end,
      updated_at = now()
     where id = s.id;
    result := new_status;
    perform log_action('subscription.' || new_status, 'subscription', s.id, jsonb_build_object('event', p_type, 'event_id', p_event_id));
    if new_status in ('past_due', 'cancelled', 'expired') then
      perform notify_user(s.customer_id, 'payout', case new_status when 'past_due' then 'Your Todo+ payment did not go through' when 'cancelled' then 'Your Todo+ subscription was cancelled' else 'Your Todo+ subscription ended' end, null, null);
    end if;
  end if;
  update webhook_events set outcome = result where provider = p_provider and event_id = p_event_id;
  return result;
end $$;

-- Called by the create-subscription Edge Function after the provider created the subscription.
create or replace function public.attach_provider_subscription(p_subscription uuid, p_provider_subscription text)
returns void language sql security definer set search_path = public as $$
  update subscriptions set provider_subscription_id = p_provider_subscription, updated_at = now() where id = p_subscription and provider_subscription_id is null;
$$;

-- 5. Outbox: notifications that must not be lost -----------------------------------------------------------------------------------
create table if not exists push_tokens (
  token text primary key,
  user_id uuid not null references profiles (id) on delete cascade,
  platform text not null check (platform in ('ios', 'android', 'web')),
  updated_at timestamptz not null default now()
);
alter table push_tokens enable row level security;
drop policy if exists "push tokens: own" on push_tokens;
create policy "push tokens: own" on push_tokens for select using (user_id = auth.uid());
revoke insert, update, delete, truncate on push_tokens from anon, authenticated;
create or replace function public.register_push_token(p_token text, p_platform text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if char_length(p_token) not between 10 and 300 then raise exception 'That does not look like a push token.'; end if;
  insert into push_tokens (token, user_id, platform) values (p_token, auth.uid(), p_platform)
  on conflict (token) do update set user_id = auth.uid(), platform = excluded.platform, updated_at = now();
end $$;

create table if not exists outbox (
  id bigserial primary key,
  user_id uuid not null,
  kind text not null default 'push',
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'dead')),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists outbox_due_idx on outbox (next_attempt_at) where status in ('pending', 'failed');
alter table outbox enable row level security;
drop policy if exists "outbox: admins" on outbox;
create policy "outbox: admins" on outbox for select using (is_admin());
revoke insert, update, delete, truncate on outbox from anon, authenticated;

-- Written in the same transaction as the notification itself: if the notification
-- exists, so does the job to deliver it.
create or replace function public.enqueue_push()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from push_tokens where user_id = new.user_id) then
    insert into outbox (user_id, payload) values (new.user_id, jsonb_build_object('title', new.title, 'body', left(coalesce(new.body, ''), 200), 'task_id', new.task_id, 'notification_id', new.id));
  end if;
  return new;
end $$;
drop trigger if exists enqueue_push on notifications;
create trigger enqueue_push after insert on notifications for each row execute procedure public.enqueue_push();

-- For the delivery worker (service role): take a batch without two workers taking the same row.
create or replace function public.claim_outbox(p_batch int default 20)
returns table (id bigint, tokens text[], payload jsonb, attempts int) language plpgsql security definer set search_path = public as $$
begin
  return query
  with due as (
    select o.id from outbox o where o.status in ('pending', 'failed') and o.next_attempt_at <= now()
     order by o.id limit least(p_batch, 100) for update skip locked)
  update outbox o set attempts = o.attempts + 1, next_attempt_at = now() + interval '5 minutes'      -- reserved: a crashed worker's rows come back later
    from due where o.id = due.id
  returning o.id, array(select token from push_tokens p where p.user_id = o.user_id), o.payload, o.attempts;
end $$;

create or replace function public.finish_outbox(p_id bigint, p_ok boolean, p_error text default null)
returns void language plpgsql security definer set search_path = public as $$
declare o outbox;
begin
  select * into o from outbox where id = p_id for update;
  if o.id is null or o.status in ('sent', 'dead') then return; end if;
  if p_ok then update outbox set status = 'sent', sent_at = now(), last_error = null where id = p_id;
  elsif o.attempts >= 6 then
    update outbox set status = 'dead', last_error = left(p_error, 500) where id = p_id;
    perform log_ops('outbox.dead', 'error', jsonb_build_object('outbox', p_id));
  else update outbox set status = 'failed', last_error = left(p_error, 500), next_attempt_at = now() + make_interval(mins => power(2, o.attempts)::int) where id = p_id;
  end if;
end $$;

-- 6. Operations and retention --------------------------------------------------------------------------------------------------------------
create or replace function public.ops_summary()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only.'; end if;
  return jsonb_build_object(
    'events_24h', coalesce((select jsonb_object_agg(event, n) from (select event, count(*) n from ops_events where created_at > now() - interval '24 hours' group by event) x), '{}'),
    'outbox', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from outbox group by status) x), '{}'),
    'open_escalations', (select count(*) from escalations where status = 'open'),
    'unassigned_over_sla', (select count(*) from tasks where status = 'requested' and created_at < now() - make_interval(mins => setting_num('sla_unassigned_minutes', 15)::int)),
    'webhooks_24h', coalesce((select jsonb_object_agg(outcome, n) from (select outcome, count(*) n from webhook_events where received_at > now() - interval '24 hours' group by outcome) x), '{}'));
end $$;

create or replace function public.gold_overview()
returns table (id uuid, full_name text, verified_jobs int, rating numeric, rating_count int, tier_since timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only.'; end if;
  return query select p.id, p.full_name, p.verified_jobs, p.rating, p.rating_count, p.tier_since
                 from profiles p where p.role = 'worker' and p.tier = 'gold' order by p.verified_jobs desc;
end $$;

-- What is kept, and for how long, is written down in docs/RETENTION.md. Photos,
-- audit events, subscriptions and quotes are NOT deleted here: they may be needed
-- in a dispute or for billing.
create or replace function public.retention_cleanup()
returns jsonb language plpgsql security definer set search_path = public as $$
declare a int; b int; c int; d int; e int; f int;
begin
  -- A definer function always runs as its owner, so the caller's role is read from the session setting.
  if not (is_super_admin() or current_setting('role') in ('none', 'postgres', 'service_role')) then raise exception 'Not allowed.'; end if;
  delete from rate_limits where window_start < now() - interval '2 days'; get diagnostics a = row_count;
  delete from outbox where status in ('sent', 'dead') and created_at < now() - interval '30 days'; get diagnostics b = row_count;
  delete from ops_events where created_at < now() - interval '90 days'; get diagnostics c = row_count;
  delete from webhook_events where received_at < now() - interval '180 days'; get diagnostics d = row_count;
  delete from task_otps o using tasks t where t.id = o.task_id and (o.consumed_at is not null or t.status in ('completed', 'cancelled')) and coalesce(t.completed_at, t.cancelled_at, t.created_at) < now() - interval '30 days'; get diagnostics e = row_count;
  update tasks set lat = null, lng = null where lat is not null and status in ('completed', 'cancelled') and coalesce(completed_at, cancelled_at) < now() - interval '90 days'; get diagnostics f = row_count;
  return jsonb_build_object('rate_limits', a, 'outbox', b, 'ops_events', c, 'webhook_events', d, 'completion_codes', e, 'task_locations_cleared', f);
end $$;
do $$ begin
  perform cron.schedule('mrtodo-retention', '17 3 * * *', 'select public.retention_cleanup()');
exception when others then raise notice 'pg_cron not available: run select retention_cleanup() daily from the admin tools.'; end $$;

-- 6b. create_booking, now carrying the appointment time and an optional map point -------------------------------------
create or replace function public.create_booking(p_items jsonb, p_shared jsonb, p_request_key uuid default null)
returns uuid language plpgsql security invoker set search_path = public as $$
declare bid uuid; it jsonb; i int := 0; other boolean; kind text; n int; sched timestamptz;
begin
  if auth.uid() is null then raise exception 'Sign in to book.'; end if;
  if p_request_key is not null then
    select id into bid from bookings where customer_id = auth.uid() and client_request_id = p_request_key;
    if bid is not null then return bid; end if;
  end if;
  if jsonb_typeof(p_items) <> 'array' then raise exception 'Add at least one task.'; end if;
  n := jsonb_array_length(p_items);
  if n not between 1 and 10 then raise exception 'A booking holds between 1 and 10 tasks.'; end if;
  other := coalesce(p_shared ->> 'for_whom', 'self') = 'other';
  if other and coalesce((p_shared ->> 'recipient_consent')::boolean, false) is not true then
    raise exception 'Please confirm that the person you are booking for knows and agrees.';
  end if;
  if other and coalesce(trim(p_shared ->> 'recipient_name'), '') = '' then
    raise exception 'Add the name of the person you are booking for.';
  end if;
  insert into bookings (customer_id, for_whom, recipient_name, recipient_relation, recipient_consent_at, share_updates,
                        authorized_contact_name, payer, location, client_request_id)
  values (auth.uid(), case when other then 'other' else 'self' end, nullif(trim(p_shared ->> 'recipient_name'), ''),
          nullif(trim(p_shared ->> 'recipient_relation'), ''), case when other then now() end,
          coalesce((p_shared ->> 'share_updates')::boolean, false), nullif(trim(p_shared ->> 'authorized_contact_name'), ''),
          coalesce(nullif(p_shared ->> 'payer', ''), 'self'), nullif(trim(p_shared ->> 'location'), ''), p_request_key)
  returning id into bid;
  for it in select * from jsonb_array_elements(p_items) loop
    i := i + 1;
    kind := coalesce(it ->> 'schedule_kind', p_shared ->> 'schedule_kind', 'single_day');
    sched := nullif(coalesce(it ->> 'scheduled_at', p_shared ->> 'scheduled_at'), '')::timestamptz;
    insert into tasks (customer_id, booking_id, service_id, title, description, category, task_type, scheduled_for, scheduled_at, location, lat, lng,
                       for_whom, recipient_name, recipient_relation, recipient_phone, answers, schedule_kind, schedule_plan)
    values (auth.uid(), bid, nullif(it ->> 'service_id', '')::uuid, it ->> 'title', it ->> 'description',
            coalesce(it ->> 'category', 'general'), case when it ->> 'task_type' = 'ongoing' then 'ongoing' else 'one-time' end,
            coalesce(it ->> 'scheduled_for', p_shared ->> 'scheduled_for', 'Flexible'), sched,
            coalesce(it ->> 'location', p_shared ->> 'location'),
            nullif(coalesce(it ->> 'lat', p_shared ->> 'lat'), '')::numeric, nullif(coalesce(it ->> 'lng', p_shared ->> 'lng'), '')::numeric,
            case when other then 'other' else 'self' end, nullif(trim(p_shared ->> 'recipient_name'), ''),
            nullif(trim(p_shared ->> 'recipient_relation'), ''), nullif(trim(p_shared ->> 'recipient_phone'), ''),
            coalesce(it -> 'answers', '{}'), kind, coalesce(it -> 'schedule_plan', p_shared -> 'schedule_plan'));
  end loop;
  return bid;
end $$;

-- 7. Who may call what ----------------------------------------------------------------------------------------------------------------------------
select public.refresh_profile_grants();
revoke execute on function public.pm_task_feed(int), public.claim_task(uuid), public.decline_feed_task(uuid, text), public.mark_arrived(uuid),
  public.minutes_late(uuid), public.escalate_task(uuid, text), public.unassign_task(uuid, text), public.resolve_escalation(uuid, text),
  public.save_plan(text, text, numeric, int, text[], text, text, text, boolean), public.start_subscription(text, boolean),
  public.request_cancel_subscription(uuid), public.book_subscription_visit(uuid, uuid), public.register_push_token(text, text),
  public.ops_summary(), public.gold_overview(), public.retention_cleanup(),
  public.apply_subscription_event(text, text, text, text, timestamptz, timestamptz), public.attach_provider_subscription(uuid, text),
  public.claim_outbox(int), public.finish_outbox(bigint, boolean, text) from public, anon;
grant execute on function public.pm_task_feed(int), public.claim_task(uuid), public.decline_feed_task(uuid, text), public.mark_arrived(uuid),
  public.minutes_late(uuid), public.escalate_task(uuid, text), public.unassign_task(uuid, text), public.resolve_escalation(uuid, text),
  public.save_plan(text, text, numeric, int, text[], text, text, text, boolean), public.start_subscription(text, boolean),
  public.request_cancel_subscription(uuid), public.book_subscription_visit(uuid, uuid), public.register_push_token(text, text),
  public.ops_summary(), public.gold_overview(), public.retention_cleanup() to authenticated;
-- Webhook, delivery worker and provider callbacks: the service role only.
revoke execute on function public.apply_subscription_event(text, text, text, text, timestamptz, timestamptz), public.attach_provider_subscription(uuid, text),
  public.claim_outbox(int), public.finish_outbox(bigint, boolean, text) from authenticated;
grant execute on function public.apply_subscription_event(text, text, text, text, timestamptz, timestamptz), public.attach_provider_subscription(uuid, text),
  public.claim_outbox(int), public.finish_outbox(bigint, boolean, text), public.retention_cleanup() to service_role;
