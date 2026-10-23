-- 0014 — vehicle eligibility, configurable customer-gender matching, and assignment offers.
-- Safe to run more than once. Depends on 0001-0013.
--
-- Decisions that belong to the business are settings, not code:
--   * the gender mapping is EMPTY and the policy is OFF. Nothing is assumed. An administrator
--     enters the mapping and records that the legal review for the region was done before it
--     can be switched on.
--   * automatic offers are OFF (settings auto_assign_mode = "off"), so the existing job feed and
--     claim flow keep working untouched until an administrator turns offers on.
--
-- Privacy of gender: stored only with an explicit consent timestamp, never selectable through
-- the profile table by anyone (column grants), never returned to PMs, customers or the admin
-- screens. Only the matching functions read it. Audit rows record the rule's OUTCOME, not the value.

-- 1. Settings --------------------------------------------------------------------------------------------------
insert into platform_settings (key, value, description) values
  ('auto_assign_mode',      '"off"', 'off = Personal Managers pick tasks from the job feed. offers = the system offers each task to the best eligible Personal Manager, one at a time.'),
  ('offer_max_attempts',    '5',     'Offers sent for one task before it goes to the Admin Queue'),
  ('rank_weight_fairness',  '3',     'Ranking weight for workload fairness (fewer active jobs, longer since last task)'),
  ('rank_weight_distance',  '2',     'Ranking weight for distance, used only when both sides have a map point'),
  ('rank_weight_rating',    '1',     'Ranking weight for customer rating, used only for a PM who has ratings'),
  ('max_active_jobs_per_pm','0',     'Most tasks a Personal Manager may hold at once. 0 means no limit.')
on conflict (key) do nothing;
-- offer_timeout_minutes already exists (0002) and is the offer expiry.

-- 2. Vehicles --------------------------------------------------------------------------------------------------------
alter table profiles add column if not exists vehicles text[];                      -- null = not stated; {} = none; else two_wheeler / four_wheeler
alter table profiles add column if not exists travel_available boolean;
do $$ begin
  alter table profiles add constraint profiles_vehicles_check check (vehicles is null or vehicles <@ array['two_wheeler', 'four_wheeler']);
exception when duplicate_object then null; end $$;

create table if not exists service_eligibility (
  service_id uuid primary key references catalogue_services (id) on delete cascade,
  vehicle_ok text[] not null default '{}' check (vehicle_ok <@ array['two_wheeler', 'four_wheeler']),   -- {} = no vehicle needed; both = either will do
  updated_by uuid references profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table tasks add column if not exists vehicle_ok text[] not null default '{}';

-- The requirement in force at booking time travels with the task.
create or replace function public.task_eligibility_snapshot()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.vehicle_ok := coalesce((select vehicle_ok from service_eligibility where service_id = new.service_id), '{}');
  return new;
end $$;
drop trigger if exists task_eligibility_snapshot on tasks;
create trigger task_eligibility_snapshot before insert on tasks for each row execute procedure public.task_eligibility_snapshot();

create or replace function public.set_service_vehicle(p_service uuid, p_vehicle_ok text[])
returns void language plpgsql security definer set search_path = public as $$
declare old text[];
begin
  if not is_super_admin() then raise exception 'Only a super admin can change service eligibility.'; end if;
  if not exists (select 1 from catalogue_services where id = p_service) then raise exception 'Service not found.'; end if;
  if not (coalesce(p_vehicle_ok, '{}') <@ array['two_wheeler', 'four_wheeler']) then raise exception 'Vehicle types are two_wheeler and four_wheeler.'; end if;
  select vehicle_ok into old from service_eligibility where service_id = p_service;
  insert into service_eligibility (service_id, vehicle_ok, updated_by) values (p_service, coalesce(p_vehicle_ok, '{}'), auth.uid())
  on conflict (service_id) do update set vehicle_ok = excluded.vehicle_ok, updated_by = auth.uid(), updated_at = now();
  perform log_action('service.vehicle_requirement', 'service', p_service, '{}', jsonb_build_object('vehicle_ok', old), jsonb_build_object('vehicle_ok', coalesce(p_vehicle_ok, '{}')));
end $$;

create or replace function public.set_pm_vehicles(p_worker uuid, p_vehicles text[], p_travel boolean)
returns void language plpgsql security definer set search_path = public as $$
declare w uuid := coalesce(p_worker, auth.uid());
begin
  if w is distinct from auth.uid() and not is_admin() then raise exception 'You can only change your own details.'; end if;
  if not exists (select 1 from profiles where id = w and role = 'worker') then raise exception 'That is not a Personal Manager.'; end if;
  if p_vehicles is not null and not (p_vehicles <@ array['two_wheeler', 'four_wheeler']) then raise exception 'Vehicle types are two_wheeler and four_wheeler.'; end if;
  update profiles set vehicles = p_vehicles, travel_available = p_travel where id = w;
  perform log_action('pm.vehicles_changed', 'profile', w, jsonb_build_object('vehicles', p_vehicles, 'travel', p_travel));
end $$;

create or replace function public.set_pm_regions(p_worker uuid, p_regions text[])
returns void language plpgsql security definer set search_path = public as $$
declare w uuid := coalesce(p_worker, auth.uid());
begin
  if w is distinct from auth.uid() and not is_admin() then raise exception 'You can only change your own details.'; end if;
  if not exists (select 1 from profiles where id = w and role = 'worker') then raise exception 'That is not a Personal Manager.'; end if;
  if exists (select 1 from unnest(coalesce(p_regions, '{}')) r where not exists (select 1 from regions where code = r)) then raise exception 'Unknown region.'; end if;
  update profiles set region_codes = coalesce(p_regions, '{}') where id = w;
end $$;

-- 3. Gender (for matching only) ----------------------------------------------------------------------------------
alter table profiles add column if not exists gender text;
alter table profiles add column if not exists gender_consent_at timestamptz;
do $$ begin
  alter table profiles add constraint profiles_gender_check check (gender is null or gender in ('female', 'male', 'non_binary', 'self_described', 'undisclosed'));
exception when duplicate_object then null; end $$;

-- Nobody can read gender through the profile table, not even admins. Matching functions read it.
create or replace function public.refresh_profile_grants()
returns void language plpgsql as $$
declare cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'profiles' and column_name not in ('phone', 'email', 'gender', 'gender_consent_at');
  execute 'revoke select on public.profiles from anon, authenticated';
  execute format('grant select (%s) on public.profiles to authenticated', cols);
end $$;
revoke execute on function public.refresh_profile_grants() from public, anon, authenticated;
select public.refresh_profile_grants();

create or replace function public.guard_profile_gender()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon')
     and (new.gender is distinct from old.gender or new.gender_consent_at is distinct from old.gender_consent_at)
     and coalesce(current_setting('mrtodo.gender_rpc', true), '') <> 'on' then
    raise exception 'Use the setting for this in your account, which explains how it is used.';
  end if;
  return new;
end $$;
drop trigger if exists guard_profile_gender on profiles;
create trigger guard_profile_gender before update on profiles for each row execute procedure public.guard_profile_gender();

-- p_gender null clears it. Any recorded value needs the person's consent to its use for matching.
create or replace function public.set_my_gender(p_gender text, p_consent boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if p_gender is not null and p_gender not in ('female', 'male', 'non_binary', 'self_described', 'undisclosed') then raise exception 'Choose one of the listed options.'; end if;
  if p_gender is not null and p_gender <> 'undisclosed' and p_consent is not true then
    raise exception 'Please confirm that we may use this to match you with a Personal Manager.';
  end if;
  perform set_config('mrtodo.gender_rpc', 'on', true);
  update profiles set gender = p_gender, gender_consent_at = case when p_gender is null then null else now() end where id = auth.uid();
  perform log_action('profile.gender_set', 'profile', auth.uid(), jsonb_build_object('recorded', p_gender is not null));
end $$;

create or replace function public.my_gender_status()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('gender', gender, 'consented', gender_consent_at is not null) from profiles where id = auth.uid();
$$;

-- An administrator may correct a Personal Manager's recorded value (never read it back).
create or replace function public.admin_set_pm_gender(p_worker uuid, p_gender text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only.'; end if;
  if not exists (select 1 from profiles where id = p_worker and role = 'worker') then raise exception 'That is not a Personal Manager.'; end if;
  if p_gender is not null and p_gender not in ('female', 'male', 'non_binary', 'self_described', 'undisclosed') then raise exception 'Choose one of the listed options.'; end if;
  perform set_config('mrtodo.gender_rpc', 'on', true);
  update profiles set gender = p_gender, gender_consent_at = case when p_gender is null then null else now() end where id = p_worker;
  perform log_action('profile.gender_set_by_admin', 'profile', p_worker, jsonb_build_object('recorded', p_gender is not null));
end $$;

-- The policy: which PM genders may serve which customer genders. Empty and off until an admin decides.
create table if not exists matching_policy (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  mapping jsonb not null default '{}',                    -- {"<customer gender>": ["<allowed PM gender>", ...]}
  fallback text not null default 'admin_queue' check (fallback in ('admin_queue', 'ignore_rule')),
  review_note text,                                       -- who reviewed the legal position, for which region, when
  updated_by uuid references profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into matching_policy (id) values (true) on conflict do nothing;

create or replace function public.save_matching_policy(p_enabled boolean, p_mapping jsonb, p_fallback text, p_review_note text)
returns void language plpgsql security definer set search_path = public as $$
declare old matching_policy; k text; v jsonb; g text; allowed text[] := array['female', 'male', 'non_binary', 'self_described'];
begin
  if not is_super_admin() then raise exception 'Only a super admin can change the matching policy.'; end if;
  if jsonb_typeof(coalesce(p_mapping, '{}')) <> 'object' then raise exception 'The mapping must list a customer gender and the Personal Manager genders allowed for it.'; end if;
  for k, v in select * from jsonb_each(coalesce(p_mapping, '{}')) loop
    if not (k = any (allowed)) then raise exception 'Unknown customer gender "%".', k; end if;
    if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) = 0 then raise exception 'Give at least one allowed Personal Manager gender for "%".', k; end if;
    for g in select jsonb_array_elements_text(v) loop
      if not (g = any (allowed)) then raise exception 'Unknown Personal Manager gender "%".', g; end if;
    end loop;
  end loop;
  if coalesce(p_fallback, 'admin_queue') not in ('admin_queue', 'ignore_rule') then raise exception 'Unknown fallback.'; end if;
  if p_enabled and (coalesce(p_mapping, '{}') = '{}' or char_length(trim(coalesce(p_review_note, ''))) < 20) then
    raise exception 'Before switching this on, enter the mapping and record the legal review (who reviewed it, for which region, and when).';
  end if;
  select * into old from matching_policy where id;
  update matching_policy set enabled = p_enabled, mapping = coalesce(p_mapping, '{}'), fallback = coalesce(p_fallback, 'admin_queue'),
    review_note = nullif(trim(p_review_note), ''), updated_by = auth.uid(), updated_at = now() where id;
  perform log_action('matching_policy.changed', 'matching_policy', null, '{}', to_jsonb(old) - 'updated_by', jsonb_build_object('enabled', p_enabled, 'mapping', p_mapping, 'fallback', p_fallback, 'review_note', p_review_note));
end $$;

create or replace function public.matching_policy_status()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only.'; end if;
  return (select to_jsonb(m) - 'id' from matching_policy m where id);
end $$;

-- 'not_applied' (rule off, or ignored by fallback) | 'allowed' | 'blocked' | 'queue' (cannot decide: an administrator must).
create or replace function public.gender_rule(p_customer uuid, p_for_other boolean, p_worker uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare pol matching_policy; cg text; pg text;
begin
  select * into pol from matching_policy where id;
  if not pol.enabled then return 'not_applied'; end if;
  if p_for_other then cg := null;                       -- the recipient's gender is not recorded, and we do not guess
  else select gender into cg from profiles where id = p_customer and gender_consent_at is not null; end if;
  if cg is null or cg = 'undisclosed' or not (pol.mapping ? cg) then
    return case pol.fallback when 'ignore_rule' then 'not_applied' else 'queue' end;
  end if;
  select gender into pg from profiles where id = p_worker and gender_consent_at is not null;
  if pg is not null and (pol.mapping -> cg) ? pg then return 'allowed'; end if;
  return 'blocked';
end $$;

-- 4. Offers ---------------------------------------------------------------------------------------------------------------
alter table tasks add column if not exists assignment_state text not null default 'none';
alter table tasks add column if not exists queue_reason text;
alter table tasks add column if not exists queue_at timestamptz;
alter table tasks add column if not exists queue_reset_at timestamptz;
alter table tasks drop constraint if exists tasks_assignment_state_check;
alter table tasks add constraint tasks_assignment_state_check check (assignment_state in ('none', 'offering', 'admin_queue', 'assigned', 'manual'));
create index if not exists tasks_assignment_idx on tasks (assignment_state) where assignment_state in ('offering', 'admin_queue');

create table if not exists assignment_offers (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks (id) on delete cascade,
  worker_id uuid not null references profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'expired', 'cancelled')),
  attempt int not null,
  rank_score numeric,
  rank_detail jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  responded_at timestamptz,
  response_note text check (response_note is null or char_length(response_note) <= 300),
  unique (task_id, worker_id)                          -- one offer per Personal Manager per task, ever: a retry cannot re-offer
);
create unique index if not exists assignment_offers_one_pending on assignment_offers (task_id) where status = 'pending';
create index if not exists assignment_offers_worker_idx on assignment_offers (worker_id, status);
create index if not exists assignment_offers_expiry_idx on assignment_offers (expires_at) where status = 'pending';

-- 5. Eligibility: every rule, evaluated in one place ---------------------------------------------------------------------
create or replace function public.pm_eligibility(p_task uuid, p_worker uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare t tasks; w profiles; fails text[] := '{}'; radius numeric := setting_num('broadcast_radius_km', 15); win record; prob text; checkable boolean; active_n int; cap int := setting_num('max_active_jobs_per_pm', 0)::int; g text;
begin
  select * into t from tasks where id = p_task;
  select * into w from profiles where id = p_worker;
  if t.id is null or w.id is null then return jsonb_build_object('eligible', false, 'failures', array['not_found']); end if;
  if w.role <> 'worker' or w.worker_status <> 'approved' then fails := fails || 'not_active'::text; end if;
  if coalesce(array_length(pm_missing_skills(p_worker, p_task), 1), 0) > 0 then fails := fails || 'qualifications'::text; end if;
  if t.price_status <> 'confirmed' then fails := fails || 'price_not_approved'::text; end if;
  if t.region_code is not null and not (t.region_code = any (w.region_codes)) then fails := fails || 'region'::text; end if;
  if coalesce(array_length(t.vehicle_ok, 1), 0) > 0 then
    if w.vehicles is null then fails := fails || 'vehicle_unknown'::text;
    elsif not (w.vehicles && t.vehicle_ok) then fails := fails || 'vehicle'::text; end if;
  end if;
  if w.base_lat is not null and t.lat is not null then
    if km_between(w.base_lat, w.base_lng, t.lat, t.lng) > radius then fails := fails || 'too_far'::text; end if;
  elsif coalesce(w.service_area, '') <> '' and t.location not ilike '%' || w.service_area || '%' then fails := fails || 'area'::text; end if;
  if exists (select 1 from task_declines d where d.task_id = t.id and d.worker_id = w.id) then fails := fails || 'declined'::text; end if;
  if cap > 0 then
    select count(*)::int into active_n from tasks a where a.assigned_worker_id = w.id and a.status in ('matched', 'assigned', 'in_progress') and a.id <> t.id;
    if active_n >= cap then fails := fails || 'at_capacity'::text; end if;
  end if;
  checkable := task_schedule_checkable(t);
  if not checkable then fails := fails || 'schedule_unverifiable'::text;
  else
    for win in select * from task_windows(t) loop
      if t.hours_exception_at is null then
        prob := within_platform_hours(t.region_code, win.w_start, win.w_end);
        if prob is not null then fails := fails || 'operating_hours'::text; exit; end if;
      end if;
    end loop;
    for win in select * from task_windows(t) loop
      prob := pm_free_problem(p_worker, t.region_code, win.w_start, win.w_end, t.id);
      if prob is not null then fails := fails || 'schedule'::text; exit; end if;
    end loop;
  end if;
  g := gender_rule(t.customer_id, t.for_whom = 'other', p_worker);
  if g in ('blocked', 'queue') then fails := fails || case g when 'blocked' then 'gender_rule' else 'gender_rule_undecidable' end; end if;
  return jsonb_build_object('eligible', coalesce(array_length(fails, 1), 0) = 0, 'failures', to_jsonb(fails), 'gender_rule', g);
end $$;

-- Explainable ranking: each part is stored with the offer.
create or replace function public.pm_rank(p_task uuid, p_worker uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare t tasks; w profiles; wf numeric := setting_num('rank_weight_fairness', 3); wd numeric := setting_num('rank_weight_distance', 2); wr numeric := setting_num('rank_weight_rating', 1);
        radius numeric := setting_num('broadcast_radius_km', 15); active_n int; fair numeric; rec numeric; dist numeric := 0; rat numeric := 0; km numeric;
begin
  select * into t from tasks where id = p_task; select * into w from profiles where id = p_worker;
  select count(*)::int into active_n from tasks a where a.assigned_worker_id = w.id and a.status in ('matched', 'assigned', 'in_progress');
  rec := case when w.last_assigned_at is null then 1 else least(extract(epoch from now() - w.last_assigned_at) / 3600 / 168, 1) end;
  fair := 0.5 * (1.0 / (1 + active_n)) + 0.5 * rec;
  if w.base_lat is not null and t.lat is not null then km := km_between(w.base_lat, w.base_lng, t.lat, t.lng); dist := greatest(0, 1 - km / radius); end if;
  if coalesce(w.rating_count, 0) >= 1 and w.rating is not null then rat := w.rating / 5.0; end if;
  return jsonb_build_object('score', round(wf * fair + wd * dist + wr * rat, 4),
    'fairness', round(fair, 4), 'distance', round(dist, 4), 'distance_km', round(km, 1), 'rating', round(rat, 4), 'active_jobs', active_n,
    'weights', jsonb_build_object('fairness', wf, 'distance', wd, 'rating', wr));
end $$;

-- 6. The offer workflow -------------------------------------------------------------------------------------------------------
create or replace function public.queue_task(p_task uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare t tasks;
begin
  select * into t from tasks where id = p_task;
  update tasks set assignment_state = 'admin_queue', queue_reason = left(p_reason, 500), queue_at = now(), routing_mode = 'admin' where id = p_task;
  update assignment_offers set status = 'cancelled', responded_at = now() where task_id = p_task and status = 'pending';
  perform log_action('task.sent_to_admin_queue', 'task', p_task, jsonb_build_object('reason', left(p_reason, 500)));
  perform notify_admins('task', 'A task needs manual assignment', coalesce(t.title, 'Task') || ' — ' || left(p_reason, 140), p_task);
  perform notify_user(t.customer_id, 'task', 'We are arranging your Personal Manager', t.title, p_task);
end $$;

create or replace function public.dispatch_offer(p_task uuid)
returns text language plpgsql security definer set search_path = public as $$
declare t tasks; cand record; n int; best uuid; best_score numeric; best_rank jsonb; rk jsonb; elig jsonb; oid uuid; counts jsonb := '{}'; f text; summary text; any_pm boolean;
        max_n int := setting_num('offer_max_attempts', 5)::int; exp int := setting_num('offer_timeout_minutes', 15)::int;
begin
  if setting_text('auto_assign_mode', 'off') <> 'offers' then return 'off'; end if;
  select * into t from tasks where id = p_task for update;
  if t.id is null or t.status <> 'requested' or t.assigned_worker_id is not null then return 'not_open'; end if;
  if t.assignment_state = 'admin_queue' then return 'queued'; end if;
  select id into oid from assignment_offers where task_id = t.id and status = 'pending';
  if oid is not null then return 'pending'; end if;
  if t.price_status <> 'confirmed' or t.review_state not in ('ready', 'none') then return 'not_ready'; end if;
  select count(*) into n from assignment_offers where task_id = t.id and created_at >= coalesce(t.queue_reset_at, t.created_at);
  if n >= max_n then perform queue_task(t.id, format('%s offers were sent and none was accepted.', n)); return 'queued'; end if;

  for cand in
    select p.id from profiles p where p.role = 'worker' and p.worker_status = 'approved'
       and not exists (select 1 from assignment_offers o where o.task_id = t.id and o.worker_id = p.id)
     order by p.id
  loop
    elig := pm_eligibility(t.id, cand.id);
    if (elig ->> 'eligible')::boolean then
      rk := pm_rank(t.id, cand.id);
      if best is null or (rk ->> 'score')::numeric > best_score then best := cand.id; best_score := (rk ->> 'score')::numeric; best_rank := rk; end if;   -- ties keep the lower id
    else
      for f in select jsonb_array_elements_text(elig -> 'failures') loop
        counts := jsonb_set(counts, array[f], to_jsonb(coalesce((counts ->> f)::int, 0) + 1));
      end loop;
    end if;
  end loop;

  if best is null then
    select exists (select 1 from profiles where role = 'worker' and worker_status = 'approved') into any_pm;
    if not any_pm then summary := 'There are no approved Personal Managers.';
    else
      select string_agg(format('%s PM%s: %s', v::int, case when v::int = 1 then '' else 's' end,
        case k when 'not_active' then 'not active' when 'qualifications' then 'missing a verified qualification' when 'price_not_approved' then 'price not approved'
               when 'region' then 'does not serve the region' when 'vehicle' then 'no suitable vehicle' when 'vehicle_unknown' then 'vehicle not stated' when 'too_far' then 'too far'
               when 'area' then 'outside their service area' when 'declined' then 'declined earlier' when 'at_capacity' then 'at capacity'
               when 'schedule_unverifiable' then 'task has no checkable time' when 'operating_hours' then 'outside operating hours' when 'schedule' then 'not free then'
               when 'gender_rule' then 'does not meet the matching policy' when 'gender_rule_undecidable' then 'matching policy cannot decide for this customer' else k end), '; ' order by v::int desc)
        into summary from jsonb_each_text(counts) e(k, v);
      summary := 'No eligible Personal Manager. ' || coalesce(summary, 'Every approved Personal Manager has already been offered this task.');
    end if;
    perform queue_task(t.id, summary);
    return 'queued';
  end if;

  insert into assignment_offers (task_id, worker_id, attempt, rank_score, rank_detail, expires_at)
  values (t.id, best, n + 1, best_score, best_rank, now() + make_interval(mins => exp))
  returning id into oid;
  update tasks set assignment_state = 'offering' where id = t.id;
  perform log_action('offer.created', 'task', t.id, jsonb_build_object('offer', oid, 'worker_id', best, 'attempt', n + 1, 'rank', best_rank,
    'gender_rule', gender_rule(t.customer_id, t.for_whom = 'other', best)));
  perform notify_user(best, 'task', 'A task is offered to you', t.title || ' — respond within ' || exp || ' minutes', t.id);
  return 'offered';
end $$;

create or replace function public.after_task_ready()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'requested' and new.assigned_worker_id is null and new.assignment_state = 'none'
     and new.price_status = 'confirmed' and new.review_state in ('ready', 'none') then
    perform dispatch_offer(new.id);
  end if;
  return null;
end $$;
drop trigger if exists after_task_ready on tasks;
create trigger after_task_ready after insert or update of price_status, review_state, status on tasks for each row execute procedure public.after_task_ready();

-- A task taken back returns to the start of the process.
create or replace function public.task_reopened_reset()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'requested' and old.status is distinct from 'requested' then
    new.assignment_state := 'none'; new.queue_reason := null; new.queue_at := null; new.queue_reset_at := now();
  end if;
  return new;
end $$;
drop trigger if exists task_reopened_reset on tasks;
create trigger task_reopened_reset before update of status on tasks for each row execute procedure public.task_reopened_reset();

create or replace function public.respond_offer(p_offer uuid, p_accept boolean, p_note text default null)
returns text language plpgsql security definer set search_path = public as $$
declare o assignment_offers; t tasks; elig jsonb; fl text;
begin
  select * into o from assignment_offers where id = p_offer for update;
  if o.id is null or o.worker_id is distinct from auth.uid() then raise exception 'That offer is not yours.'; end if;
  if o.status = 'accepted' and p_accept then return 'accepted'; end if;                       -- repeating an answer that already worked
  if o.status = 'rejected' and not p_accept then return 'rejected'; end if;
  if o.status <> 'pending' then return o.status; end if;                                       -- expired or cancelled: say so, change nothing
  select * into t from tasks where id = o.task_id for update;
  if o.expires_at <= now() then
    update assignment_offers set status = 'expired', responded_at = now() where id = o.id;
    perform log_action('offer.expired', 'task', t.id, jsonb_build_object('offer', o.id, 'worker_id', o.worker_id));
    perform dispatch_offer(t.id);
    return 'expired';
  end if;
  if not p_accept then
    update assignment_offers set status = 'rejected', responded_at = now(), response_note = left(p_note, 300) where id = o.id;
    insert into task_declines (task_id, worker_id, reason) values (t.id, o.worker_id, left(p_note, 300)) on conflict do nothing;
    perform log_action('offer.rejected', 'task', t.id, jsonb_build_object('offer', o.id, 'worker_id', o.worker_id));
    perform dispatch_offer(t.id);
    return 'rejected';
  end if;
  -- Accepting: serialise this PM's acceptances, then check everything again against the committed state.
  perform 1 from profiles where id = o.worker_id for update;
  if t.status <> 'requested' or t.assigned_worker_id is not null then
    update assignment_offers set status = 'cancelled', responded_at = now() where id = o.id;
    return 'cancelled';
  end if;
  elig := pm_eligibility(t.id, o.worker_id);
  if not (elig ->> 'eligible')::boolean then
    update assignment_offers set status = 'rejected', responded_at = now(), response_note = 'No longer eligible: ' || array_to_string(array(select jsonb_array_elements_text(elig -> 'failures')), ', ') where id = o.id;
    perform log_action('offer.failed_revalidation', 'task', t.id, jsonb_build_object('offer', o.id, 'worker_id', o.worker_id, 'failures', elig -> 'failures'));
    perform dispatch_offer(t.id);
    return 'ineligible';
  end if;
  update tasks set assigned_worker_id = o.worker_id, status = 'assigned', assigned_at = now(), accepted_at = now(), assignment_state = 'assigned' where id = t.id;
  update assignment_offers set status = 'accepted', responded_at = now() where id = o.id;
  update profiles set last_assigned_at = now() where id = o.worker_id;
  perform log_action('offer.accepted', 'task', t.id, jsonb_build_object('offer', o.id, 'worker_id', o.worker_id),
    jsonb_build_object('status', 'requested'), jsonb_build_object('status', 'assigned', 'assigned_worker_id', o.worker_id));
  perform notify_user(t.customer_id, 'task', 'A Personal Manager accepted your task', t.title, t.id);
  return 'accepted';
end $$;

-- Sweeper: run every minute by a scheduler (pg_cron or the Edge Function). Safe to run at any time, any number of times.
create or replace function public.process_offers()
returns jsonb language plpgsql security definer set search_path = public as $$
declare o record; ex int := 0; dsp int := 0; tk record;
begin
  if is_app_caller() and not is_admin() then raise exception 'Not allowed.'; end if;
  for o in select id, task_id, worker_id from assignment_offers where status = 'pending' and expires_at <= now() order by expires_at limit 200 for update skip locked loop
    update assignment_offers set status = 'expired', responded_at = now() where id = o.id and status = 'pending';
    perform log_action('offer.expired', 'task', o.task_id, jsonb_build_object('offer', o.id, 'worker_id', o.worker_id));
    perform notify_user(o.worker_id, 'task', 'An offer expired', 'You did not respond in time.', o.task_id);
    perform dispatch_offer(o.task_id); ex := ex + 1;
  end loop;
  if setting_text('auto_assign_mode', 'off') = 'offers' then
    for tk in select id from tasks where status = 'requested' and assigned_worker_id is null and assignment_state = 'none' and price_status = 'confirmed'
                 and review_state in ('ready', 'none') order by created_at limit 50 loop
      if dispatch_offer(tk.id) = 'offered' then dsp := dsp + 1; end if;
    end loop;
  end if;
  return jsonb_build_object('expired', ex, 'dispatched', dsp);
end $$;

-- 7. Existing flows honour offers --------------------------------------------------------------------------------------------------
-- The job feed and claim only handle tasks that are not being offered or queued.
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
   where t.status = 'requested' and t.routing_mode = 'broadcast' and t.price_status = 'confirmed' and t.assignment_state = 'none'
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
  if t.routing_mode <> 'broadcast' or t.price_status <> 'confirmed' or t.assignment_state <> 'none' then raise exception 'That task is not open for claiming.'; end if;
  if t.is_premium and me.tier <> 'gold' and now() < t.available_at + make_interval(secs => win) then
    raise exception 'That task is not available to you yet.';
  end if;
  if exists (select 1 from task_declines d where d.task_id = t.id and d.worker_id = me.id) then raise exception 'You declined this task earlier.'; end if;
  missing := pm_missing_skills(me.id, t.id);
  if array_length(missing, 1) > 0 then raise exception 'This task needs a verified qualification you do not have yet: %.', array_to_string(missing, ', '); end if;
  update tasks set assigned_worker_id = me.id, status = 'assigned', assigned_at = now(), accepted_at = now(), assignment_state = 'assigned' where id = t.id;
  update profiles set last_assigned_at = now() where id = me.id;
  perform log_action('task.claimed', 'task', t.id, jsonb_build_object('worker_id', me.id, 'premium', t.is_premium),
    jsonb_build_object('status', 'requested'), jsonb_build_object('status', 'assigned', 'assigned_worker_id', me.id));
  perform notify_user(t.customer_id, 'task', 'A Personal Manager accepted your task', t.title, t.id);
  perform log_ops('routing.claimed', 'info', jsonb_build_object('task', t.id, 'premium', t.is_premium));
  return 'ok';
end $$;

-- A manual assignment ends any offer in flight and is recorded as an override.
create or replace function public.assign_task(p_task uuid, p_worker uuid)
returns void language plpgsql security definer set search_path = public as $$
declare t tasks; w profiles; missing text[]; elig jsonb;
begin
  if not is_admin() then raise exception 'Admins only.'; end if;
  select * into t from tasks where id = p_task for update;
  if t.id is null then raise exception 'Task not found.'; end if;
  if t.status not in ('requested', 'matched') then
    raise exception 'Task is % and can no longer be reassigned.', t.status;
  end if;
  if t.status = 'matched' and t.assigned_worker_id = p_worker then return; end if;
  if t.price_status not in ('awaiting_confirmation', 'confirmed') or (t.est_cost is null and t.rate_per_day is null) then
    raise exception 'Approve a price for this task before assigning a Personal Manager.';
  end if;
  select * into w from profiles where id = p_worker;
  if w.id is null or w.role <> 'worker' or w.worker_status <> 'approved' then
    raise exception 'That Personal Manager is not approved.';
  end if;
  missing := pm_missing_skills(p_worker, p_task);
  if array_length(missing, 1) > 0 then
    raise exception 'That Personal Manager is not verified for: %.', array_to_string(missing, ', ');
  end if;
  elig := pm_eligibility(p_task, p_worker);
  update assignment_offers set status = 'cancelled', responded_at = now() where task_id = p_task and status = 'pending';
  update tasks set assigned_worker_id = p_worker, status = 'matched', assigned_at = now(), accepted_at = null, assignment_state = 'manual' where id = p_task;
  update profiles set last_assigned_at = now() where id = p_worker;
  perform log_action(case when t.assigned_worker_id is null then 'task.assigned' else 'task.reassigned' end,
    'task', p_task, jsonb_build_object('worker_id', p_worker, 'worker_name', w.full_name,
                                       'previous_worker_id', t.assigned_worker_id, 'title', t.title,
                                       'override_of', elig -> 'failures'),
    jsonb_build_object('assigned_worker_id', t.assigned_worker_id, 'status', t.status),
    jsonb_build_object('assigned_worker_id', p_worker, 'status', 'matched'));
end $$;

-- Put a queued task back through automatic matching (another round of attempts).
create or replace function public.requeue_task(p_task uuid)
returns text language plpgsql security definer set search_path = public as $$
declare t tasks;
begin
  if not is_admin() then raise exception 'Admins only.'; end if;
  select * into t from tasks where id = p_task for update;
  if t.id is null or t.status <> 'requested' then raise exception 'Only an open task can be re-queued.'; end if;
  update tasks set assignment_state = 'none', queue_reason = null, queue_at = null, queue_reset_at = now(), routing_mode = case when price_status = 'confirmed' then 'broadcast' else routing_mode end where id = p_task;
  perform log_action('task.requeued', 'task', p_task);
  return dispatch_offer(p_task);
end $$;

-- 8. What each person may see -----------------------------------------------------------------------------------------------------------
create or replace function public.my_offers()
returns table (
  offer_id uuid, task_id uuid, status text, expires_at timestamptz, created_at timestamptz, title text, description text, area text, scheduled_at timestamptz, scheduled_for text,
  est_minutes int, est_cost numeric, currency char(3), pricing_state text, schedule_kind text, quantity int, vehicle_ok text[]
) language sql stable security definer set search_path = public as $$
  select o.id, t.id, case when o.status = 'pending' and o.expires_at <= now() then 'expired' else o.status end, o.expires_at, o.created_at,
         t.title, t.description, area_of(t.location), t.scheduled_at, t.scheduled_for, coalesce(t.est_minutes, t.est_duration_minutes), t.est_cost, t.currency, t.pricing_state, t.schedule_kind, t.quantity, t.vehicle_ok
    from assignment_offers o join tasks t on t.id = o.task_id
   where o.worker_id = auth.uid() and (o.status = 'pending' or o.responded_at > now() - interval '7 days')
   order by (o.status = 'pending') desc, o.created_at desc limit 50;
$$;

create or replace function public.offers_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only.'; end if;
  return jsonb_build_object(
    'counts', (select coalesce(jsonb_object_agg(status, n), '{}') from (select status, count(*) n from assignment_offers group by 1) s),
    'queue', coalesce((select jsonb_agg(jsonb_build_object('task_id', id, 'title', title, 'reason', queue_reason, 'queued_at', queue_at) order by queue_at) from tasks where assignment_state = 'admin_queue' and status = 'requested'), '[]'),
    'recent', coalesce((select jsonb_agg(x) from (select jsonb_build_object('offer_id', o.id, 'task_id', o.task_id, 'title', t.title, 'worker', p.full_name, 'status', o.status, 'attempt', o.attempt, 'score', o.rank_score,
                          'created_at', o.created_at, 'expires_at', o.expires_at, 'responded_at', o.responded_at, 'note', o.response_note) x
                          from assignment_offers o join tasks t on t.id = o.task_id join profiles p on p.id = o.worker_id order by o.created_at desc limit 50) r), '[]'),
    'mode', setting_text('auto_assign_mode', 'off'));
end $$;

create or replace function public.task_assignment_report(p_task uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only.'; end if;
  return jsonb_build_object(
    'state', (select jsonb_build_object('assignment_state', assignment_state, 'queue_reason', queue_reason, 'hours_exception', hours_exception_at is not null) from tasks where id = p_task),
    'offers', coalesce((select jsonb_agg(jsonb_build_object('worker', p.full_name, 'status', o.status, 'attempt', o.attempt, 'score', o.rank_score, 'detail', o.rank_detail, 'created_at', o.created_at, 'responded_at', o.responded_at) order by o.created_at)
                          from assignment_offers o join profiles p on p.id = o.worker_id where o.task_id = p_task), '[]'),
    'candidates', coalesce((select jsonb_agg(jsonb_build_object('worker_id', p.id, 'name', p.full_name, 'eligibility', pm_eligibility(p_task, p.id), 'rank', pm_rank(p_task, p.id)))
                              from profiles p where p.role = 'worker' and p.worker_status = 'approved'), '[]'),
    'history', coalesce((select jsonb_agg(jsonb_build_object('action', a.action, 'at', a.created_at, 'details', a.details) order by a.created_at)
                           from audit_log a where a.entity = 'task' and a.entity_id = p_task and (a.action like 'offer.%' or a.action like 'task.%assign%' or a.action in ('task.sent_to_admin_queue', 'task.requeued', 'task.claimed', 'task.hours_exception', 'task.unassigned'))), '[]'));
end $$;

-- 9. Access --------------------------------------------------------------------------------------------------------------------------------------
alter table service_eligibility enable row level security;
alter table matching_policy enable row level security;
alter table assignment_offers enable row level security;
drop policy if exists "service eligibility: read" on service_eligibility;
create policy "service eligibility: read" on service_eligibility for select using (is_admin());
drop policy if exists "matching policy: admins read" on matching_policy;
create policy "matching policy: admins read" on matching_policy for select using (is_admin());
drop policy if exists "offers: the PM or an admin" on assignment_offers;
create policy "offers: the PM or an admin" on assignment_offers for select using (worker_id = auth.uid() or is_admin());
revoke insert, update, delete, truncate on service_eligibility, matching_policy, assignment_offers from anon, authenticated;
grant select on service_eligibility, matching_policy, assignment_offers to authenticated;

revoke execute on function public.set_service_vehicle(uuid, text[]), public.set_pm_vehicles(uuid, text[], boolean), public.set_pm_regions(uuid, text[]),
  public.set_my_gender(text, boolean), public.my_gender_status(), public.admin_set_pm_gender(uuid, text), public.save_matching_policy(boolean, jsonb, text, text),
  public.matching_policy_status(), public.gender_rule(uuid, boolean, uuid), public.pm_eligibility(uuid, uuid), public.pm_rank(uuid, uuid), public.queue_task(uuid, text),
  public.dispatch_offer(uuid), public.respond_offer(uuid, boolean, text), public.process_offers(), public.requeue_task(uuid), public.my_offers(), public.offers_overview(),
  public.task_assignment_report(uuid), public.pm_task_feed(int), public.claim_task(uuid), public.assign_task(uuid, uuid) from public, anon;
revoke execute on function public.gender_rule(uuid, boolean, uuid), public.pm_eligibility(uuid, uuid), public.pm_rank(uuid, uuid), public.queue_task(uuid, text),
  public.dispatch_offer(uuid) from authenticated;
grant execute on function public.set_service_vehicle(uuid, text[]), public.set_pm_vehicles(uuid, text[], boolean), public.set_pm_regions(uuid, text[]),
  public.set_my_gender(text, boolean), public.my_gender_status(), public.admin_set_pm_gender(uuid, text), public.save_matching_policy(boolean, jsonb, text, text),
  public.matching_policy_status(), public.respond_offer(uuid, boolean, text), public.process_offers(), public.requeue_task(uuid), public.my_offers(), public.offers_overview(),
  public.task_assignment_report(uuid), public.pm_task_feed(int), public.claim_task(uuid), public.assign_task(uuid, uuid) to authenticated;
-- The scheduler runs as the service role.
grant execute on function public.process_offers(), public.dispatch_offer(uuid) to service_role;
