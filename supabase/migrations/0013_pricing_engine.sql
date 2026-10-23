-- 0013 — the pricing engine: per-service, per-region rules with flat, per-minute and
-- progressive (marginal tier) duration pricing, quantity discounts, and travel charges.
-- Safe to run more than once. Depends on 0001-0012.
--
-- No rule is seeded and none is active until a super admin creates and activates it.
-- A service with no active rule keeps its existing pricing (fixed price or quote), so
-- nothing already booked or published changes. Every number comes from a rule row; the
-- examples in the documentation are illustrations, not values.
--
-- Two separate mechanisms, never merged by accident:
--   * duration pricing  — what one unit of the service costs for the minutes it takes.
--                         In progressive mode each rate applies only to the minutes inside
--                         its own tier (like taxi fare bands); earlier minutes are not repriced.
--   * quantity discount — a reduction in the per-unit price when several units are booked.
--                         It never looks at minutes. With per-minute or progressive pricing it
--                         can only be enabled if the rule says so explicitly
--                         (duration_qty_interaction = 'unit_total'); it then reduces each
--                         unit's computed total, and only one discount tier ever applies.

alter table regions add column if not exists minor_units smallint not null default 2 check (minor_units between 0 and 3);

-- 1. Rules -------------------------------------------------------------------------------------------------
create table if not exists pricing_rules (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references catalogue_services (id),
  region_code text not null references regions (code),
  version int not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'retired')),
  model text not null check (model in ('flat', 'ppm', 'progressive')),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  base_charge numeric(12,2) not null default 0 check (base_charge >= 0),
  included_minutes int not null default 0 check (included_minutes >= 0),   -- minutes the base charge already covers
  ppm numeric(12,4) check (ppm is null or ppm >= 0),                      -- model = ppm
  tiers jsonb not null default '[]',                                       -- model = progressive: [{"from":0,"to":60,"ppm":x},{"from":60,"to":null,"ppm":y}]
  min_minutes int not null default 0 check (min_minutes >= 0),
  increment_minutes int not null default 1 check (increment_minutes between 1 and 1440),
  rounding text not null default 'up' check (rounding in ('up', 'nearest', 'down')),
  max_minutes int check (max_minutes is null or max_minutes > 0),
  approval_threshold_minutes int check (approval_threshold_minutes is null or approval_threshold_minutes > 0),
  qty_enabled boolean not null default false,
  qty_unit text check (qty_unit is null or char_length(qty_unit) between 1 and 40),
  qty_min int not null default 1 check (qty_min >= 1),
  qty_max int check (qty_max is null or qty_max >= 1),
  qty_apply text not null default 'all_units' check (qty_apply in ('all_units', 'marginal')),
  qty_discount_type text check (qty_discount_type is null or qty_discount_type in ('percent', 'per_unit')),
  qty_tiers jsonb not null default '[]',                                   -- [{"from_qty":3,"discount":10}]
  duration_qty_interaction text not null default 'none' check (duration_qty_interaction in ('none', 'unit_total')),
  travel_method text not null default 'none' check (travel_method in ('none', 'fixed', 'per_km', 'per_minute')),
  travel_fixed numeric(12,2) check (travel_fixed is null or travel_fixed >= 0),
  travel_rate numeric(12,4) check (travel_rate is null or travel_rate >= 0),
  auto_price boolean not null default false,          -- false: always goes to a quote an administrator approves
  effective_from timestamptz,
  effective_to timestamptz,
  note text check (note is null or char_length(note) <= 500),
  created_by uuid references profiles (id) on delete set null,
  activated_by uuid references profiles (id) on delete set null,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (service_id, region_code, version)
);
create unique index if not exists pricing_rules_one_active on pricing_rules (service_id, region_code) where status = 'active';

-- An active or retired rule never changes (history). Only its status and end date may move.
create or replace function public.pricing_rule_frozen()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then raise exception 'A rule that has been active cannot be deleted. Retire it instead.'; end if;
    return old;
  end if;
  if old.status <> 'draft' then
    if (to_jsonb(new) - 'status' - 'effective_to' - 'updated_at') is distinct from (to_jsonb(old) - 'status' - 'effective_to' - 'updated_at') then
      raise exception 'An activated pricing rule cannot be edited. Duplicate it, change the copy, and activate that.';
    end if;
    if old.status = 'retired' and new.status <> 'retired' then raise exception 'A retired rule cannot be reactivated. Duplicate it instead.'; end if;
  end if;
  return new;
end $$;
drop trigger if exists pricing_rule_frozen on pricing_rules;
create trigger pricing_rule_frozen before update or delete on pricing_rules for each row execute procedure public.pricing_rule_frozen();

create or replace function public.region_has_rules(p_region text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from pricing_rules where region_code = p_region);
$$;

-- 2. Validation: everything an administrator must fix before a rule can go live -----------------------------------
create or replace function public.pricing_rule_problems(r pricing_rules)
returns text[] language plpgsql stable security definer set search_path = public as $$
declare probs text[] := '{}'; reg regions; t jsonb; prev_to numeric; i int := 0; prev_from int := 0; n int; last_to jsonb; d numeric;
begin
  select * into reg from regions where code = r.region_code;
  if reg.code is null then probs := probs || 'Choose a region.'::text; end if;
  if reg.code is not null and reg.currency <> r.currency then probs := probs || format('The currency must be %s, the region''s currency.', reg.currency); end if;
  if not exists (select 1 from catalogue_services where id = r.service_id) then probs := probs || 'Choose a service.'::text; end if;

  if r.model = 'ppm' and r.ppm is null then probs := probs || 'Enter the price per minute.'::text; end if;
  if r.model = 'progressive' then
    if jsonb_typeof(r.tiers) <> 'array' or jsonb_array_length(r.tiers) = 0 then
      probs := probs || 'Add at least one duration tier.'::text;
    else
      n := jsonb_array_length(r.tiers); prev_to := 0;
      for t in select * from jsonb_array_elements(r.tiers) loop
        i := i + 1;
        if (t ->> 'from') is null or (t ->> 'ppm') is null or (t ->> 'from') !~ '^[0-9]+$' or (t ->> 'ppm') !~ '^[0-9]+(\.[0-9]+)?$' then
          probs := probs || format('Tier %s needs a start minute and a rate per minute (zero or more).', i); continue;
        end if;
        if (t ->> 'from')::numeric <> prev_to then probs := probs || format('Tier %s must start at minute %s, where the previous tier ends.', i, prev_to); end if;
        if i < n then
          if (t ->> 'to') is null or (t ->> 'to') !~ '^[0-9]+$' then probs := probs || format('Tier %s needs an end minute (only the last tier may be open-ended).', i);
          elsif (t ->> 'to')::numeric <= (t ->> 'from')::numeric then probs := probs || format('Tier %s ends before it starts.', i);
          else prev_to := (t ->> 'to')::numeric; end if;
        elsif (t ->> 'to') is not null and (t ->> 'to') <> 'null' then probs := probs || 'The last tier must be open-ended so every duration is priced.'::text;
        end if;
      end loop;
    end if;
  end if;
  if r.min_minutes > 0 and r.max_minutes is not null and r.min_minutes > r.max_minutes then probs := probs || 'The minimum duration is above the maximum.'::text; end if;
  if r.max_minutes is not null and r.approval_threshold_minutes is not null and r.approval_threshold_minutes > r.max_minutes then probs := probs || 'The approval threshold is above the maximum duration.'::text; end if;

  if r.qty_enabled then
    if coalesce(r.qty_unit, '') = '' then probs := probs || 'Say what one unit is (for example "item").'::text; end if;
    if r.qty_discount_type is null then probs := probs || 'Choose a discount type: percent or per-unit amount.'::text; end if;
    if r.qty_max is not null and r.qty_max < r.qty_min then probs := probs || 'The maximum quantity is below the minimum.'::text; end if;
    if jsonb_typeof(r.qty_tiers) <> 'array' or jsonb_array_length(r.qty_tiers) = 0 then probs := probs || 'Add at least one quantity tier.'::text;
    else
      prev_from := 1; i := 0;
      for t in select * from jsonb_array_elements(r.qty_tiers) loop
        i := i + 1;
        if (t ->> 'from_qty') is null or (t ->> 'from_qty') !~ '^[0-9]+$' or (t ->> 'discount') is null or (t ->> 'discount') !~ '^[0-9]+(\.[0-9]+)?$' then
          probs := probs || format('Quantity tier %s needs a starting quantity and a discount.', i); continue;
        end if;
        if (t ->> 'from_qty')::int <= prev_from then probs := probs || format('Quantity tier %s must start above %s units (tiers must increase, with no duplicates).', i, prev_from); end if;
        prev_from := greatest(prev_from, (t ->> 'from_qty')::int);
        d := (t ->> 'discount')::numeric;
        if d <= 0 then probs := probs || format('Quantity tier %s needs a discount above zero.', i); end if;
        if r.qty_discount_type = 'percent' and d > 100 then probs := probs || format('Quantity tier %s is more than 100 percent.', i); end if;
        if r.qty_discount_type = 'per_unit' and r.model = 'flat' and d > r.base_charge then probs := probs || format('Quantity tier %s takes off more than the unit price.', i); end if;
      end loop;
    end if;
    if r.model in ('ppm', 'progressive') and r.duration_qty_interaction <> 'unit_total' then
      probs := probs || 'Duration pricing and quantity discounts only combine when you say so: set how they interact before activating.'::text;
    end if;
  end if;

  if r.travel_method = 'fixed' and r.travel_fixed is null then probs := probs || 'Enter the fixed travel charge, or choose no travel charge.'::text; end if;
  if r.travel_method in ('per_km', 'per_minute') and r.travel_rate is null then probs := probs || 'Enter the travel rate.'::text; end if;
  if r.effective_to is not null and r.effective_from is not null and r.effective_to <= r.effective_from then probs := probs || 'The end date is before the start date.'::text; end if;
  return probs;
end $$;

-- 3. The calculation ---------------------------------------------------------------------------------------
-- One function, used by the customer's live estimate, by the booking trigger and by final
-- charging, so the three can never disagree.
create or replace function public.pricing_calc(r pricing_rules, p_minutes int, p_qty int, p_distance_km numeric, p_travel_minutes int, p_minor smallint default 2)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  m int; mm int; lines jsonb := '[]'; unit_total numeric := 0; amt numeric; t jsonb; mins numeric; q int := coalesce(p_qty, 1);
  reasons text[] := '{}'; msgs text[] := '{}'; disc_unit numeric; disc_total numeric := 0; gross numeric; travel numeric := 0; total numeric;
  tier jsonb; u int; per numeric; unit_net numeric; inc int := r.increment_minutes; discl jsonb := '[]'; travel_line jsonb;
begin
  -- billable minutes
  if r.model = 'flat' then m := null; mm := null;
  else
    if p_minutes is null or p_minutes < 1 then
      return jsonb_build_object('available', false, 'status', 'unavailable', 'reason', 'duration_required', 'message', 'Tell us roughly how long the task will take to see an estimate.');
    end if;
    m := greatest(p_minutes, r.min_minutes);
    m := case r.rounding when 'up' then ceil(m::numeric / inc) * inc when 'down' then floor(m::numeric / inc) * inc else round(m::numeric / inc) * inc end;
    m := greatest(m, r.min_minutes);
    if m < 1 then m := inc; end if;
    mm := m;
  end if;

  -- duration pricing, per unit
  if r.base_charge > 0 or r.model = 'flat' then
    amt := round(r.base_charge, p_minor);
    lines := lines || jsonb_build_object('kind', 'base', 'label', case when r.model = 'flat' then 'Price' else 'Base charge' end, 'amount', amt);
    unit_total := unit_total + amt;
  end if;
  if r.model = 'ppm' then
    mins := greatest(mm - r.included_minutes, 0);
    amt := round(mins * r.ppm, p_minor);
    if mins > 0 then lines := lines || jsonb_build_object('kind', 'duration', 'label', 'Time', 'minutes', mins, 'rate', r.ppm, 'amount', amt); end if;
    unit_total := unit_total + amt;
  elsif r.model = 'progressive' then
    for t in select * from jsonb_array_elements(r.tiers) loop
      mins := greatest(0, least(mm, coalesce(nullif(t ->> 'to', 'null')::numeric, mm)) - greatest((t ->> 'from')::numeric, r.included_minutes));
      if mins > 0 then
        amt := round(mins * (t ->> 'ppm')::numeric, p_minor);
        lines := lines || jsonb_build_object('kind', 'tier', 'label', format('Minutes %s to %s', (t ->> 'from'), coalesce(nullif(t ->> 'to', 'null'), 'end')),
                                             'from', (t ->> 'from')::int, 'to', nullif(t ->> 'to', 'null'), 'minutes', mins, 'rate', (t ->> 'ppm')::numeric, 'amount', amt);
        unit_total := unit_total + amt;
      end if;
    end loop;
  end if;

  -- quantity
  if q < 1 then q := 1; end if;
  if not r.qty_enabled and q > 1 then reasons := reasons || 'quantity_not_supported'::text; msgs := msgs || 'This service is not priced by quantity, so a quote is needed for more than one.'::text; end if;
  if r.qty_enabled and (q < r.qty_min or (r.qty_max is not null and q > r.qty_max)) then
    reasons := reasons || 'quantity_out_of_range'::text; msgs := msgs || format('This service is priced for %s to %s %s.', r.qty_min, coalesce(r.qty_max::text, 'any number of'), coalesce(r.qty_unit, 'units')) ;
  end if;
  gross := round(unit_total * q, p_minor);

  if r.qty_enabled and q > 1 then
    if r.qty_apply = 'all_units' then
      select x into tier from jsonb_array_elements(r.qty_tiers) x where (x ->> 'from_qty')::int <= q order by (x ->> 'from_qty')::int desc limit 1;
      if tier is not null then
        per := (tier ->> 'discount')::numeric;
        disc_unit := case r.qty_discount_type when 'percent' then round(unit_total * per / 100, p_minor) else round(per, p_minor) end;
        disc_total := round(disc_unit * q, p_minor);
        discl := jsonb_build_array(jsonb_build_object('kind', 'quantity_discount', 'label', format('Quantity discount (%s %s or more)', tier ->> 'from_qty', coalesce(r.qty_unit, 'units')),
                   'quantity', q, 'from_qty', (tier ->> 'from_qty')::int, 'rate', disc_unit, 'amount', -disc_total));
      end if;
    else
      for u in 1..q loop
        select x into tier from jsonb_array_elements(r.qty_tiers) x where (x ->> 'from_qty')::int <= u order by (x ->> 'from_qty')::int desc limit 1;
        if tier is not null then
          per := (tier ->> 'discount')::numeric;
          disc_unit := case r.qty_discount_type when 'percent' then round(unit_total * per / 100, p_minor) else round(per, p_minor) end;
          disc_total := disc_total + disc_unit;
        end if;
      end loop;
      if disc_total > 0 then discl := jsonb_build_array(jsonb_build_object('kind', 'quantity_discount', 'label', 'Quantity discount', 'quantity', q, 'amount', -disc_total)); end if;
    end if;
    if disc_total > gross then reasons := reasons || 'discount_exceeds_price'::text; msgs := msgs || 'The discount is larger than the price, so a quote is needed.'::text; disc_total := 0; discl := '[]'; end if;
  end if;

  -- travel: a fixed charge is part of the estimate; a distance or time based one can only be
  -- priced once the distance is known (an administrator supplies it), otherwise a quote is needed.
  if r.travel_method = 'fixed' then travel := round(r.travel_fixed, p_minor); travel_line := jsonb_build_object('kind', 'travel', 'label', 'Travel', 'amount', travel);
  elsif r.travel_method = 'per_km' then
    if p_distance_km is null then reasons := reasons || 'travel_to_be_confirmed'::text; msgs := msgs || 'Travel is charged by distance and will be confirmed in your quote.'::text;
    else travel := round(p_distance_km * r.travel_rate, p_minor); travel_line := jsonb_build_object('kind', 'travel', 'label', format('Travel, %s km', p_distance_km), 'minutes', null, 'rate', r.travel_rate, 'amount', travel); end if;
  elsif r.travel_method = 'per_minute' then
    if p_travel_minutes is null then reasons := reasons || 'travel_to_be_confirmed'::text; msgs := msgs || 'Travel is charged by time and will be confirmed in your quote.'::text;
    else travel := round(p_travel_minutes * r.travel_rate, p_minor); travel_line := jsonb_build_object('kind', 'travel', 'label', format('Travel, %s min', p_travel_minutes), 'minutes', p_travel_minutes, 'rate', r.travel_rate, 'amount', travel); end if;
  end if;

  if r.max_minutes is not null and mm is not null and mm > r.max_minutes then reasons := reasons || 'duration_over_limit'::text; msgs := msgs || 'This is longer than we can price automatically, so a quote is needed.'::text; end if;
  if r.approval_threshold_minutes is not null and mm is not null and mm > r.approval_threshold_minutes then reasons := reasons || 'over_approval_threshold'::text; msgs := msgs || 'A longer task needs an approved quote.'::text; end if;
  if not r.auto_price then reasons := reasons || 'custom_quote'::text; msgs := msgs || 'This service is priced by quote. The figure below is a guide until it is approved.'::text; end if;

  total := gross - disc_total + travel;
  return jsonb_build_object(
    'available', true,
    'status', case when array_length(reasons, 1) is null then 'estimated' else 'quote_required' end,
    'currency', r.currency, 'minor_units', p_minor,
    'rule', jsonb_build_object('id', r.id, 'version', r.version, 'model', r.model),
    'minutes', jsonb_build_object('requested', p_minutes, 'billable', mm),
    'quantity', q, 'unit_total', unit_total,
    'lines', lines || discl || case when travel_line is null then '[]'::jsonb else jsonb_build_array(travel_line) end,
    'gross', gross, 'discount_total', -disc_total, 'travel_total', travel, 'total', total,
    'reasons', to_jsonb(reasons), 'messages', to_jsonb(msgs));
end $$;

-- The rule in force for a service and region at a moment.
create or replace function public.pricing_rule_at(p_service uuid, p_region text, p_at timestamptz default now())
returns pricing_rules language sql stable security definer set search_path = public as $$
  select * from pricing_rules
   where service_id = p_service and region_code = p_region and status in ('active', 'retired')
     and effective_from <= p_at and (effective_to is null or effective_to > p_at)
   order by version desc limit 1;
$$;

create or replace function public.compute_estimate(p_service uuid, p_region text, p_minutes int, p_qty int default 1,
                                                   p_distance_km numeric default null, p_travel_minutes int default null, p_at timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare reg regions; r pricing_rules; def_minutes int;
begin
  if p_region is null then
    return jsonb_build_object('available', false, 'status', 'unavailable', 'reason', 'no_region', 'message', 'Choose where the task is, so we can price it for your region.');
  end if;
  select * into reg from regions where code = p_region and status = 'active';
  if reg.code is null then
    return jsonb_build_object('available', false, 'status', 'unavailable', 'reason', 'unsupported_region', 'message', 'We do not take bookings in that region yet.');
  end if;
  r := pricing_rule_at(p_service, p_region, p_at);
  if r.id is null then
    return jsonb_build_object('available', false, 'status', 'unavailable', 'reason', 'no_rule', 'message', 'This service has no published rate for your region, so we will review your request and send a quote.');
  end if;
  if r.currency <> reg.currency then
    return jsonb_build_object('available', false, 'status', 'unavailable', 'reason', 'currency_mismatch', 'message', 'We cannot price this in your region right now.');
  end if;
  if p_minutes is null and r.model <> 'flat' then
    select nullif(definition ->> 'duration_minutes', '')::int into def_minutes
      from catalogue_service_versions v join catalogue_services s on s.id = v.service_id and s.current_version = v.version where s.id = p_service;
    p_minutes := def_minutes;
  end if;
  return pricing_calc(r, p_minutes, p_qty, p_distance_km, p_travel_minutes, reg.minor_units);
end $$;

-- What a customer app calls. It cannot pass a distance: travel by distance is never decided by a customer.
create or replace function public.price_estimate(p_service uuid, p_region text, p_minutes int default null, p_qty int default 1)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in to see an estimate.'; end if;
  if not exists (select 1 from catalogue_services where id = p_service and status = 'published') then
    return jsonb_build_object('available', false, 'status', 'unavailable', 'reason', 'no_service', 'message', 'That service is not available.');
  end if;
  return compute_estimate(p_service, p_region, p_minutes, p_qty, null, null, now());
end $$;

create or replace function public.admin_price_estimate(p_service uuid, p_region text, p_minutes int, p_qty int, p_distance_km numeric, p_travel_minutes int default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only.'; end if;
  return compute_estimate(p_service, p_region, p_minutes, p_qty, p_distance_km, p_travel_minutes, now());
end $$;

-- 4. What a task records ---------------------------------------------------------------------------------------
alter table tasks add column if not exists quantity int not null default 1 check (quantity between 1 and 1000);
alter table tasks add column if not exists pricing_rule_id uuid references pricing_rules (id);
alter table tasks add column if not exists pricing_rule_version int;
alter table tasks add column if not exists pricing_breakdown jsonb;
alter table tasks add column if not exists pricing_state text not null default 'none';
alter table tasks add column if not exists final_amount numeric(12,2) check (final_amount is null or final_amount >= 0);
alter table tasks add column if not exists final_minutes int;
alter table tasks add column if not exists final_breakdown jsonb;
alter table tasks drop constraint if exists tasks_pricing_state_check;
alter table tasks add constraint tasks_pricing_state_check check (pricing_state in ('none', 'estimated', 'quote_pending', 'approved', 'final'));
alter table tasks drop constraint if exists tasks_price_source_check;
alter table tasks add constraint tasks_price_source_check check (price_source in ('template', 'admin', 'legacy', 'service', 'rule'));
-- Every existing task keeps its price exactly as it was.

alter table task_quotes add column if not exists currency char(3);
create or replace function public.quote_currency() returns trigger language plpgsql set search_path = public as $$
begin if new.currency is null then select currency into new.currency from tasks where id = new.task_id; end if; return new; end $$;
drop trigger if exists quote_currency on task_quotes;
create trigger quote_currency before insert on task_quotes for each row execute procedure public.quote_currency();
update task_quotes q set currency = t.currency from tasks t where t.id = q.task_id and q.currency is null;

-- The booking trigger. It runs after the general guard (alphabetical order), so what it sets wins.
-- A customer states the region, an expected duration and a quantity; everything priced is ours.
create or replace function public.task_pricing_engine()
returns trigger language plpgsql security definer set search_path = public as $$
declare est jsonb; reg regions; r pricing_rules; has_rules boolean; spec boolean;
begin
  if is_app_caller() then
    new.pricing_rule_id := null; new.pricing_rule_version := null; new.pricing_breakdown := null; new.pricing_state := 'none';
    new.final_amount := null; new.final_minutes := null; new.final_breakdown := null;
    new.quantity := greatest(coalesce(new.quantity, 1), 1);
    if new.service_id is null then
      new.quantity := 1;
      return new;
    end if;
    select exists (select 1 from pricing_rules where service_id = new.service_id and status in ('active', 'retired')) into has_rules;
    if not has_rules then return new; end if;                      -- an unruled service keeps its published pricing
    spec := coalesce((new.service_snapshot ->> 'requires_specialist')::boolean, false);
    est := compute_estimate(new.service_id, new.region_code, new.est_minutes, new.quantity, null, null, now());
    new.pricing_breakdown := est;
    if (est ->> 'available')::boolean then
      new.pricing_rule_id := (est -> 'rule' ->> 'id')::uuid; new.pricing_rule_version := (est -> 'rule' ->> 'version')::int;
      new.currency := est ->> 'currency';
    else
      select currency into new.currency from regions where code = new.region_code;
      new.currency := coalesce(new.currency, 'INR');
    end if;
    if (est ->> 'available')::boolean and est ->> 'status' = 'estimated' then
      new.est_cost := (est ->> 'total')::numeric; new.rate_per_day := null;
      new.price_source := 'rule'; new.price_status := 'confirmed'; new.price_confirmed_at := now();
      new.routing_mode := 'broadcast'; new.review_state := case when spec then 'needs_review' else 'ready' end;
      new.pricing_state := 'estimated';
    else                                                              -- unknown region, no rate, or a quote is required: an administrator prices it
      new.est_cost := null; new.rate_per_day := null; new.price_source := null;
      new.price_status := 'awaiting_approval'; new.price_confirmed_at := null;
      new.routing_mode := 'admin'; new.review_state := 'needs_review';
      new.pricing_state := 'quote_pending';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists task_pricing_engine on tasks;
create trigger task_pricing_engine before insert on tasks for each row execute procedure public.task_pricing_engine();

-- When a quoted price is finally confirmed, the state says approved.
create or replace function public.task_pricing_state_sync()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.pricing_state = 'quote_pending' and new.price_status = 'confirmed' then new.pricing_state := 'approved'; end if;
  return new;
end $$;
drop trigger if exists task_pricing_state_sync on tasks;
create trigger task_pricing_state_sync before update of price_status on tasks for each row execute procedure public.task_pricing_state_sync();

-- A one-time task is worth its final amount once there is one.
create or replace function public.task_value(t tasks)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(case when t.task_type = 'ongoing'
                       then t.rate_per_day * (select count(*) from task_visits v where v.task_id = t.id and v.done)
                       else coalesce(t.final_amount, t.est_cost) end, 0);
$$;

-- The final charge: recomputed with the very rule the booking used (never today's rule), from the
-- minutes actually worked and the distance an administrator confirms.
create or replace function public.finalise_task_price(p_task uuid, p_actual_minutes int, p_distance_km numeric default null, p_travel_minutes int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t tasks; r pricing_rules; reg regions; res jsonb;
begin
  if not is_admin() then raise exception 'Admins only.'; end if;
  select * into t from tasks where id = p_task for update;
  if t.id is null then raise exception 'Task not found.'; end if;
  if t.pricing_rule_id is null then raise exception 'This task was not priced by a rule, so there is nothing to recalculate.'; end if;
  if t.pricing_state = 'final' then return t.final_breakdown; end if;
  select * into r from pricing_rules where id = t.pricing_rule_id;
  select * into reg from regions where code = r.region_code;
  res := pricing_calc(r, p_actual_minutes, t.quantity, p_distance_km, p_travel_minutes, reg.minor_units);
  if not (res ->> 'available')::boolean then raise exception '%', res ->> 'message'; end if;
  update tasks set final_amount = (res ->> 'total')::numeric, final_minutes = p_actual_minutes, final_breakdown = res, pricing_state = 'final' where id = p_task;
  perform log_action('task.price_finalised', 'task', p_task, jsonb_build_object('rule', r.id, 'rule_version', r.version, 'minutes', p_actual_minutes),
    jsonb_build_object('est_cost', t.est_cost), jsonb_build_object('final_amount', res ->> 'total'));
  return res;
end $$;

-- Bookings carry the region, the expected duration and the quantity for each task.
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
                       for_whom, recipient_name, recipient_relation, recipient_phone, answers, schedule_kind, schedule_plan,
                       region_code, est_minutes, quantity)
    values (auth.uid(), bid, nullif(it ->> 'service_id', '')::uuid, it ->> 'title', it ->> 'description',
            coalesce(it ->> 'category', 'general'), case when it ->> 'task_type' = 'ongoing' then 'ongoing' else 'one-time' end,
            coalesce(it ->> 'scheduled_for', p_shared ->> 'scheduled_for', 'Flexible'), sched,
            coalesce(it ->> 'location', p_shared ->> 'location'),
            nullif(coalesce(it ->> 'lat', p_shared ->> 'lat'), '')::numeric, nullif(coalesce(it ->> 'lng', p_shared ->> 'lng'), '')::numeric,
            case when other then 'other' else 'self' end, nullif(trim(p_shared ->> 'recipient_name'), ''),
            nullif(trim(p_shared ->> 'recipient_relation'), ''), nullif(trim(p_shared ->> 'recipient_phone'), ''),
            coalesce(it -> 'answers', '{}'), kind, coalesce(it -> 'schedule_plan', p_shared -> 'schedule_plan'),
            nullif(upper(coalesce(it ->> 'region_code', p_shared ->> 'region_code')), ''), nullif(it ->> 'est_minutes', '')::int, coalesce(nullif(it ->> 'quantity', '')::int, 1));
  end loop;
  return bid;
end $$;

-- 5. Administering rules ------------------------------------------------------------------------------------------
create or replace function public.save_pricing_rule(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare rid uuid := nullif(p ->> 'id', '')::uuid; old pricing_rules; v int; reg regions;
begin
  if not is_super_admin() then raise exception 'Only a super admin can change pricing.'; end if;
  select * into reg from regions where code = upper(p ->> 'region_code');
  if reg.code is null then raise exception 'Choose a region first.'; end if;
  if rid is not null then
    select * into old from pricing_rules where id = rid;
    if old.id is null then raise exception 'Rule not found.'; end if;
    if old.status <> 'draft' then raise exception 'Only a draft can be edited. Duplicate this rule to change it.'; end if;
    update pricing_rules set
      region_code = reg.code, currency = reg.currency, model = coalesce(p ->> 'model', model),
      base_charge = coalesce((p ->> 'base_charge')::numeric, 0), included_minutes = coalesce((p ->> 'included_minutes')::int, 0),
      ppm = nullif(p ->> 'ppm', '')::numeric, tiers = coalesce(p -> 'tiers', '[]'),
      min_minutes = coalesce((p ->> 'min_minutes')::int, 0), increment_minutes = coalesce((p ->> 'increment_minutes')::int, 1), rounding = coalesce(p ->> 'rounding', 'up'),
      max_minutes = nullif(p ->> 'max_minutes', '')::int, approval_threshold_minutes = nullif(p ->> 'approval_threshold_minutes', '')::int,
      qty_enabled = coalesce((p ->> 'qty_enabled')::boolean, false), qty_unit = nullif(p ->> 'qty_unit', ''), qty_min = coalesce((p ->> 'qty_min')::int, 1),
      qty_max = nullif(p ->> 'qty_max', '')::int, qty_apply = coalesce(p ->> 'qty_apply', 'all_units'), qty_discount_type = nullif(p ->> 'qty_discount_type', ''),
      qty_tiers = coalesce(p -> 'qty_tiers', '[]'), duration_qty_interaction = coalesce(p ->> 'duration_qty_interaction', 'none'),
      travel_method = coalesce(p ->> 'travel_method', 'none'), travel_fixed = nullif(p ->> 'travel_fixed', '')::numeric, travel_rate = nullif(p ->> 'travel_rate', '')::numeric,
      auto_price = coalesce((p ->> 'auto_price')::boolean, false), effective_from = nullif(p ->> 'effective_from', '')::timestamptz,
      effective_to = nullif(p ->> 'effective_to', '')::timestamptz, note = left(p ->> 'note', 500), updated_at = now()
     where id = rid;
    perform log_action('pricing_rule.edited', 'pricing_rule', rid, jsonb_build_object('service', old.service_id, 'region', reg.code), to_jsonb(old), p);
    return rid;
  end if;
  select coalesce(max(version), 0) + 1 into v from pricing_rules where service_id = (p ->> 'service_id')::uuid and region_code = reg.code;
  insert into pricing_rules (service_id, region_code, version, model, currency, base_charge, included_minutes, ppm, tiers, min_minutes, increment_minutes, rounding,
    max_minutes, approval_threshold_minutes, qty_enabled, qty_unit, qty_min, qty_max, qty_apply, qty_discount_type, qty_tiers, duration_qty_interaction,
    travel_method, travel_fixed, travel_rate, auto_price, effective_from, effective_to, note, created_by)
  values ((p ->> 'service_id')::uuid, reg.code, v, coalesce(p ->> 'model', 'flat'), reg.currency, coalesce((p ->> 'base_charge')::numeric, 0), coalesce((p ->> 'included_minutes')::int, 0),
    nullif(p ->> 'ppm', '')::numeric, coalesce(p -> 'tiers', '[]'), coalesce((p ->> 'min_minutes')::int, 0), coalesce((p ->> 'increment_minutes')::int, 1), coalesce(p ->> 'rounding', 'up'),
    nullif(p ->> 'max_minutes', '')::int, nullif(p ->> 'approval_threshold_minutes', '')::int, coalesce((p ->> 'qty_enabled')::boolean, false), nullif(p ->> 'qty_unit', ''),
    coalesce((p ->> 'qty_min')::int, 1), nullif(p ->> 'qty_max', '')::int, coalesce(p ->> 'qty_apply', 'all_units'), nullif(p ->> 'qty_discount_type', ''), coalesce(p -> 'qty_tiers', '[]'),
    coalesce(p ->> 'duration_qty_interaction', 'none'), coalesce(p ->> 'travel_method', 'none'), nullif(p ->> 'travel_fixed', '')::numeric, nullif(p ->> 'travel_rate', '')::numeric,
    coalesce((p ->> 'auto_price')::boolean, false), nullif(p ->> 'effective_from', '')::timestamptz, nullif(p ->> 'effective_to', '')::timestamptz, left(p ->> 'note', 500), auth.uid())
  returning id into rid;
  perform log_action('pricing_rule.created', 'pricing_rule', rid, jsonb_build_object('service', p ->> 'service_id', 'region', reg.code, 'version', v));
  return rid;
end $$;

create or replace function public.pricing_rule_readiness(p_id uuid)
returns text[] language plpgsql stable security definer set search_path = public as $$
declare r pricing_rules;
begin
  if not is_admin() then raise exception 'Admins only.'; end if;
  select * into r from pricing_rules where id = p_id;
  if r.id is null then raise exception 'Rule not found.'; end if;
  return pricing_rule_problems(r);
end $$;

create or replace function public.activate_pricing_rule(p_id uuid, p_effective_from timestamptz default null)
returns void language plpgsql security definer set search_path = public as $$
declare r pricing_rules; probs text[]; prev pricing_rules; at timestamptz := coalesce(p_effective_from, now());
begin
  if not is_super_admin() then raise exception 'Only a super admin can activate pricing.'; end if;
  select * into r from pricing_rules where id = p_id for update;
  if r.id is null then raise exception 'Rule not found.'; end if;
  if r.status <> 'draft' then raise exception 'Only a draft can be activated.'; end if;
  probs := pricing_rule_problems(r);
  if array_length(probs, 1) > 0 then raise exception 'Fix this before activating: %', array_to_string(probs, ' '); end if;
  select * into prev from pricing_rules where service_id = r.service_id and region_code = r.region_code and status = 'active' for update;
  if prev.id is not null then
    update pricing_rules set status = 'retired', effective_to = greatest(at, prev.effective_from + interval '1 microsecond') where id = prev.id;
    at := greatest(at, prev.effective_from + interval '1 microsecond');
  end if;
  update pricing_rules set status = 'active', effective_from = at, activated_by = auth.uid(), activated_at = now(), updated_at = now() where id = p_id;
  perform log_action('pricing_rule.activated', 'pricing_rule', p_id, jsonb_build_object('service', r.service_id, 'region', r.region_code, 'version', r.version, 'replaced', prev.id),
    case when prev.id is null then null else jsonb_build_object('version', prev.version, 'status', 'active') end, jsonb_build_object('version', r.version, 'status', 'active'));
end $$;

create or replace function public.retire_pricing_rule(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r pricing_rules;
begin
  if not is_super_admin() then raise exception 'Only a super admin can change pricing.'; end if;
  select * into r from pricing_rules where id = p_id for update;
  if r.id is null or r.status <> 'active' then raise exception 'Only an active rule can be retired.'; end if;
  update pricing_rules set status = 'retired', effective_to = now() where id = p_id;
  perform log_action('pricing_rule.retired', 'pricing_rule', p_id, jsonb_build_object('service', r.service_id, 'region', r.region_code, 'version', r.version));
end $$;

create or replace function public.duplicate_pricing_rule(p_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare r pricing_rules; nid uuid; v int;
begin
  if not is_super_admin() then raise exception 'Only a super admin can change pricing.'; end if;
  select * into r from pricing_rules where id = p_id;
  if r.id is null then raise exception 'Rule not found.'; end if;
  select max(version) + 1 into v from pricing_rules where service_id = r.service_id and region_code = r.region_code;
  insert into pricing_rules (service_id, region_code, version, model, currency, base_charge, included_minutes, ppm, tiers, min_minutes, increment_minutes, rounding, max_minutes,
    approval_threshold_minutes, qty_enabled, qty_unit, qty_min, qty_max, qty_apply, qty_discount_type, qty_tiers, duration_qty_interaction, travel_method, travel_fixed, travel_rate,
    auto_price, note, created_by)
  select service_id, region_code, v, model, currency, base_charge, included_minutes, ppm, tiers, min_minutes, increment_minutes, rounding, max_minutes, approval_threshold_minutes,
    qty_enabled, qty_unit, qty_min, qty_max, qty_apply, qty_discount_type, qty_tiers, duration_qty_interaction, travel_method, travel_fixed, travel_rate, auto_price, note, auth.uid()
    from pricing_rules where id = p_id returning id into nid;
  perform log_action('pricing_rule.duplicated', 'pricing_rule', nid, jsonb_build_object('from', p_id));
  return nid;
end $$;

-- 6. Access ---------------------------------------------------------------------------------------------------------
alter table pricing_rules enable row level security;
drop policy if exists "pricing rules: admins read" on pricing_rules;
create policy "pricing rules: admins read" on pricing_rules for select using (is_admin());
revoke insert, update, delete, truncate on pricing_rules from anon, authenticated;
grant select on pricing_rules to authenticated;

revoke execute on function public.region_has_rules(text), public.pricing_rule_problems(pricing_rules), public.pricing_calc(pricing_rules, int, int, numeric, int, smallint),
  public.pricing_rule_at(uuid, text, timestamptz), public.compute_estimate(uuid, text, int, int, numeric, int, timestamptz),
  public.price_estimate(uuid, text, int, int), public.admin_price_estimate(uuid, text, int, int, numeric, int), public.finalise_task_price(uuid, int, numeric, int),
  public.save_pricing_rule(jsonb), public.pricing_rule_readiness(uuid), public.activate_pricing_rule(uuid, timestamptz), public.retire_pricing_rule(uuid),
  public.duplicate_pricing_rule(uuid) from public, anon;
revoke execute on function public.region_has_rules(text), public.pricing_rule_problems(pricing_rules), public.pricing_calc(pricing_rules, int, int, numeric, int, smallint),
  public.pricing_rule_at(uuid, text, timestamptz), public.compute_estimate(uuid, text, int, int, numeric, int, timestamptz) from authenticated;
grant execute on function public.price_estimate(uuid, text, int, int), public.admin_price_estimate(uuid, text, int, int, numeric, int), public.finalise_task_price(uuid, int, numeric, int),
  public.save_pricing_rule(jsonb), public.pricing_rule_readiness(uuid), public.activate_pricing_rule(uuid, timestamptz), public.retire_pricing_rule(uuid),
  public.duplicate_pricing_rule(uuid) to authenticated;
