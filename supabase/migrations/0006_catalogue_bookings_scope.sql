-- 0006 — service catalogue, general requests, multi-task bookings, multi-day change approval.
-- Safe to run more than once. Depends on 0001-0005.
--
-- What is deliberately NOT here yet: PM interviews/assessments, specialist and
-- vendor records, quote revisions, PM public profiles. Those need their own
-- migration; nothing in this one pretends they exist.

-- 1. A "general" category so an unmatched request is never forced into a wrong one -------------------
create or replace function public.valid_categories()
returns text[] language sql immutable as $$
  select array['handyman', 'cleaning', 'moving', 'delivery', 'care', 'general'];
$$;

-- 2. Catalogue: families, services, immutable published versions ----------------------------------------
create table if not exists service_families (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z0-9][a-z0-9-]{1,60}$'),
  name text not null check (char_length(name) between 2 and 80),
  description text check (description is null or char_length(description) <= 500),
  icon text check (icon is null or char_length(icon) <= 16),
  sort_order int not null default 100,
  status text not null default 'draft' check (status in ('draft', 'published', 'paused', 'archived')),
  available_for_booking boolean not null default true,
  parent_id uuid references service_families (id) on delete set null,
  regions text[] not null default '{}',                 -- empty = everywhere
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists catalogue_services (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z0-9][a-z0-9-]{1,60}$'),
  family_id uuid not null references service_families (id),
  category text not null default 'general' check (category = any (public.valid_categories())),
  status text not null default 'draft' check (status in ('draft', 'published', 'paused', 'archived')),
  sort_order int not null default 100,
  current_version int not null default 0,               -- 0 = never published
  draft jsonb not null default '{}',                    -- what the admin is editing; customers never see it
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists catalogue_services_family_idx on catalogue_services (family_id, sort_order);

-- A published version never changes. A task records which version it was booked
-- against, so editing a service cannot rewrite an existing agreement.
create table if not exists catalogue_service_versions (
  service_id uuid not null references catalogue_services (id),
  version int not null,
  definition jsonb not null,
  published_by uuid references profiles (id) on delete set null,
  published_at timestamptz not null default now(),
  primary key (service_id, version)
);

create or replace function public.versions_immutable() returns trigger language plpgsql as $$
begin raise exception 'A published service version cannot be changed. Publish a new version instead.'; end $$;
drop trigger if exists versions_immutable on catalogue_service_versions;
create trigger versions_immutable before update or delete on catalogue_service_versions
  for each row execute procedure public.versions_immutable();

alter table service_families enable row level security;
alter table catalogue_services enable row level security;
alter table catalogue_service_versions enable row level security;
drop policy if exists "families: admins" on service_families;
create policy "families: admins" on service_families for select using (is_admin());
drop policy if exists "services: admins" on catalogue_services;
create policy "services: admins" on catalogue_services for select using (is_admin());
drop policy if exists "versions: admins" on catalogue_service_versions;
create policy "versions: admins" on catalogue_service_versions for select using (is_admin());
revoke insert, update, delete, truncate on service_families, catalogue_services, catalogue_service_versions from anon, authenticated;

-- Families only: no services and no prices are invented here.
insert into service_families (key, name, description, icon, sort_order, status) values
  ('everyday-tech',   'Everyday Tech Help',               'Phones, Wi-Fi, printers and other gadgets.',          '📱', 10, 'published'),
  ('home-repairs',    'Home Repairs and Maintenance',     'Plumbing, electrical, appliances and fixes.',         '🔧', 20, 'published'),
  ('assistance',      'Personal Assistance and Companionship', 'Someone to accompany and help.',                '🤝', 30, 'published'),
  ('family-support',  'Help for Family and Loved Ones',   'Arrange practical help for a parent or relative.',    '💙', 40, 'published'),
  ('errands',         'Errands and Everyday Tasks',       'Pick-ups, shopping and small jobs.',                  '🛍️', 50, 'published'),
  ('setup-organise',  'Setup, Installation and Organization', 'Assemble, install and tidy.',                    '📦', 60, 'published')
on conflict (key) do nothing;

-- 3. The declarative definition: validated by the database, never executed -----------------------------
-- definition = { title, description, instructions, examples, expected_outcome,
--   questions: [ {id, type, label, required, options, show_if:{question, equals}} ],
--   pricing: { approach, price, currency, min, max, explanation, components:[{label, amount, kind}] },
--   requires_specialist, required_skills[], safety_notes, duration_minutes,
--   cancellation_policy, evidence: { before_after, otp } }
create or replace function public.service_problems(def jsonb)
returns text[] language plpgsql immutable as $$
declare probs text[] := '{}'; q jsonb; ids text[] := '{}'; ap text; pr jsonb; qid text; i int := 0; so jsonb;
begin
  if def is null or jsonb_typeof(def) <> 'object' then return array['The service has no details yet.']; end if;
  if char_length(coalesce(def ->> 'title', '')) not between 3 and 120 then probs := array_append(probs, ('Give the service a customer-facing title (3 to 120 characters).')::text); end if;
  if char_length(coalesce(def ->> 'description', '')) < 10 then probs := array_append(probs, ('Add a description customers will understand (at least 10 characters).')::text); end if;
  if def ? 'questions' and jsonb_typeof(def -> 'questions') <> 'array' then
    probs := array_append(probs, ('Questions must be a list.')::text);
  else
    if jsonb_array_length(coalesce(def -> 'questions', '[]')) > 30 then probs := array_append(probs, ('No more than 30 questions.')::text); end if;
    for q in select * from jsonb_array_elements(coalesce(def -> 'questions', '[]')) loop
      i := i + 1;
      qid := q ->> 'id';
      if qid is null or qid !~ '^[a-z][a-z0-9_]{0,40}$' then probs := array_append(probs, (format('Question %s needs an id of lowercase letters, digits and underscores.', i))::text); continue; end if;
      if qid = any (ids) then probs := array_append(probs, (format('Question id "%s" is used twice.', qid))::text); end if;
      if coalesce(q ->> 'type', '') not in ('short_text', 'long_text', 'single_choice', 'multiple_choice', 'datetime', 'address') then
        probs := array_append(probs, (format('Question "%s" has an unsupported type (photo questions are not supported yet).', qid))::text);
      end if;
      if char_length(coalesce(q ->> 'label', '')) not between 1 and 200 then probs := array_append(probs, (format('Question "%s" needs a label.', qid))::text); end if;
      if q ->> 'type' in ('single_choice', 'multiple_choice') and
         (jsonb_typeof(q -> 'options') is distinct from 'array' or jsonb_array_length(q -> 'options') < 2) then
        probs := array_append(probs, (format('Question "%s" needs at least two options.', qid))::text);
      end if;
      if q ? 'show_if' then
        if not ((q -> 'show_if' ->> 'question') = any (ids)) then
          probs := array_append(probs, (format('Question "%s" depends on a question that does not come before it.', qid))::text);
        end if;
        if not (q -> 'show_if' ? 'equals') then probs := array_append(probs, (format('Question "%s" needs a value in its condition.', qid))::text); end if;
      end if;
      ids := ids || qid;
    end loop;
  end if;

  pr := def -> 'pricing';
  if pr is null or jsonb_typeof(pr) <> 'object' then
    probs := array_append(probs, ('Choose how this service is priced.')::text);
  else
    ap := pr ->> 'approach';
    if ap is null or ap not in ('fixed', 'manual_quote', 'estimate_approval') then
      probs := array_append(probs, ('That pricing approach is not supported yet. Use fixed price, manual quote or estimate requiring approval.')::text);
    end if;
    if ap = 'fixed' then
      if (pr ->> 'price') is null or (pr ->> 'price') !~ '^[0-9]+(\.[0-9]{1,2})?$' then probs := array_append(probs, ('A fixed price needs an amount of zero or more.')::text); end if;
    end if;
    if coalesce(pr ->> 'currency', 'INR') !~ '^[A-Z]{3}$' then probs := array_append(probs, ('Currency must be a three-letter code such as INR.')::text); end if;
    if (pr ->> 'min') ~ '^[0-9.]+$' and (pr ->> 'max') ~ '^[0-9.]+$' and (pr ->> 'min')::numeric > (pr ->> 'max')::numeric then
      probs := array_append(probs, ('The minimum price is higher than the maximum.')::text);
    end if;
  end if;
  if def ? 'required_skills' and jsonb_typeof(def -> 'required_skills') <> 'array' then probs := array_append(probs, ('Required skills must be a list.')::text); end if;
  if (def ->> 'duration_minutes') is not null and (def ->> 'duration_minutes') !~ '^[1-9][0-9]*$' then probs := array_append(probs, ('Duration must be a whole number of minutes.')::text); end if;
  return probs;
end $$;

-- Checks a customer's answers against a published definition. Returns null when fine.
create or replace function public.answers_problem(def jsonb, answers jsonb)
returns text language plpgsql immutable as $$
declare q jsonb; qid text; v jsonb; shown boolean; dep jsonb;
begin
  if answers is null or jsonb_typeof(answers) <> 'object' then return 'The answers are missing.'; end if;
  if octet_length(answers::text) > 20000 then return 'The answers are too long.'; end if;
  for q in select * from jsonb_array_elements(coalesce(def -> 'questions', '[]')) loop
    qid := q ->> 'id'; v := answers -> qid; shown := true;
    if q ? 'show_if' then
      dep := answers -> (q -> 'show_if' ->> 'question');
      shown := dep is not null and (dep = (q -> 'show_if' -> 'equals')
               or (jsonb_typeof(dep) = 'array' and dep @> jsonb_build_array(q -> 'show_if' -> 'equals')));
    end if;
    if not shown then continue; end if;
    if coalesce((q ->> 'required')::boolean, false) and (v is null or v = '""'::jsonb or v = '[]'::jsonb or v = 'null'::jsonb) then
      return format('Please answer: %s', q ->> 'label');
    end if;
    if v is null or v = 'null'::jsonb then continue; end if;
    case q ->> 'type'
      when 'short_text' then if jsonb_typeof(v) <> 'string' or char_length(v #>> '{}') > 300 then return format('"%s" is too long.', q ->> 'label'); end if;
      when 'long_text' then if jsonb_typeof(v) <> 'string' or char_length(v #>> '{}') > 4000 then return format('"%s" is too long.', q ->> 'label'); end if;
      when 'address' then if jsonb_typeof(v) <> 'string' or char_length(v #>> '{}') > 500 then return format('"%s" is too long.', q ->> 'label'); end if;
      when 'datetime' then if jsonb_typeof(v) <> 'string' or char_length(v #>> '{}') > 60 then return format('"%s" is not a valid date and time.', q ->> 'label'); end if;
      when 'single_choice' then if not ((q -> 'options') @> jsonb_build_array(v)) then return format('Pick one of the offered options for "%s".', q ->> 'label'); end if;
      when 'multiple_choice' then
        if jsonb_typeof(v) <> 'array' or exists (select 1 from jsonb_array_elements(v) e where not ((q -> 'options') @> jsonb_build_array(e))) then
          return format('Pick from the offered options for "%s".', q ->> 'label');
        end if;
      else null;
    end case;
  end loop;
  return null;
end $$;

-- 4. Admin tools for the catalogue (super admin; every change is audited) -----------------------------------
create or replace function public.save_family(
  p_key text, p_name text, p_description text, p_icon text, p_sort int, p_status text,
  p_available boolean default true, p_parent uuid default null, p_regions text[] default '{}'
) returns uuid language plpgsql security definer set search_path = public as $$
declare old service_families; rid uuid;
begin
  if not is_super_admin() then raise exception 'Only a super admin can manage the catalogue.'; end if;
  select * into old from service_families where key = p_key for update;
  if old.id is null then
    insert into service_families (key, name, description, icon, sort_order, status, available_for_booking, parent_id, regions)
    values (p_key, trim(p_name), nullif(trim(p_description), ''), p_icon, coalesce(p_sort, 100), coalesce(p_status, 'draft'),
            coalesce(p_available, true), p_parent, coalesce(p_regions, '{}')) returning id into rid;
    perform log_action('catalogue.family_created', 'service_family', rid, jsonb_build_object('key', p_key));
  else
    if p_parent = old.id then raise exception 'A family cannot be its own parent.'; end if;
    update service_families set name = trim(p_name), description = nullif(trim(p_description), ''), icon = p_icon,
      sort_order = coalesce(p_sort, sort_order), status = coalesce(p_status, status),
      available_for_booking = coalesce(p_available, available_for_booking), parent_id = p_parent,
      regions = coalesce(p_regions, regions), updated_at = now() where id = old.id;
    rid := old.id;
    perform log_action('catalogue.family_changed', 'service_family', rid, jsonb_build_object('key', p_key),
      jsonb_build_object('name', old.name, 'status', old.status, 'available', old.available_for_booking),
      jsonb_build_object('name', trim(p_name), 'status', coalesce(p_status, old.status), 'available', coalesce(p_available, old.available_for_booking)));
  end if;
  return rid;
end $$;

create or replace function public.save_service_draft(
  p_key text, p_family uuid, p_category text, p_definition jsonb, p_sort int default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  if not is_super_admin() then raise exception 'Only a super admin can manage the catalogue.'; end if;
  if not exists (select 1 from service_families where id = p_family) then raise exception 'Choose a service family.'; end if;
  if not (p_category = any (valid_categories())) then raise exception 'Unknown category %.', p_category; end if;
  if p_definition is null or jsonb_typeof(p_definition) <> 'object' or octet_length(p_definition::text) > 100000 then
    raise exception 'The service details are missing or too large.';
  end if;
  insert into catalogue_services (key, family_id, category, draft, sort_order)
  values (p_key, p_family, p_category, p_definition, coalesce(p_sort, 100))
  on conflict (key) do update set family_id = excluded.family_id, category = excluded.category, draft = excluded.draft,
    sort_order = coalesce(p_sort, catalogue_services.sort_order), updated_at = now()
  returning id into rid;
  perform log_action('catalogue.service_draft_saved', 'service', rid, jsonb_build_object('key', p_key));
  return rid;
end $$;

-- What would stop this service being published? Empty list = ready.
create or replace function public.service_readiness(p_service uuid)
returns text[] language plpgsql stable security definer set search_path = public as $$
declare s catalogue_services; fam service_families; probs text[];
begin
  if not is_admin() then raise exception 'Admins only.'; end if;
  select * into s from catalogue_services where id = p_service;
  if s.id is null then raise exception 'Unknown service.'; end if;
  probs := service_problems(s.draft);
  select * into fam from service_families where id = s.family_id;
  if fam.status <> 'published' then probs := array_append(probs, ('Its family is not published, so customers would not see it.')::text); end if;
  return probs;
end $$;

create or replace function public.publish_service(p_service uuid)
returns int language plpgsql security definer set search_path = public as $$
declare s catalogue_services; probs text[]; v int;
begin
  if not is_super_admin() then raise exception 'Only a super admin can publish services.'; end if;
  select * into s from catalogue_services where id = p_service for update;
  if s.id is null then raise exception 'Unknown service.'; end if;
  probs := service_problems(s.draft);
  if array_length(probs, 1) > 0 then raise exception 'Not ready to publish: %', array_to_string(probs, ' '); end if;
  v := s.current_version + 1;
  insert into catalogue_service_versions (service_id, version, definition, published_by) values (s.id, v, s.draft, auth.uid());
  update catalogue_services set current_version = v, status = 'published', updated_at = now() where id = s.id;
  perform log_action('catalogue.service_published', 'service', s.id, jsonb_build_object('key', s.key, 'version', v),
    jsonb_build_object('version', s.current_version, 'pricing', (select definition -> 'pricing' from catalogue_service_versions where service_id = s.id and version = s.current_version)),
    jsonb_build_object('version', v, 'pricing', s.draft -> 'pricing'));
  return v;
end $$;

create or replace function public.set_service_status(p_service uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare s catalogue_services;
begin
  if not is_super_admin() then raise exception 'Only a super admin can manage the catalogue.'; end if;
  if p_status not in ('draft', 'published', 'paused', 'archived') then raise exception 'Unknown status.'; end if;
  select * into s from catalogue_services where id = p_service for update;
  if s.id is null then raise exception 'Unknown service.'; end if;
  if p_status = 'published' and s.current_version = 0 then raise exception 'Publish the service first.'; end if;
  update catalogue_services set status = p_status, updated_at = now() where id = s.id;
  perform log_action('catalogue.service_status', 'service', s.id, jsonb_build_object('key', s.key),
    jsonb_build_object('status', s.status), jsonb_build_object('status', p_status));
end $$;

create or replace function public.duplicate_service(p_service uuid, p_new_key text)
returns uuid language plpgsql security definer set search_path = public as $$
declare s catalogue_services; rid uuid;
begin
  if not is_super_admin() then raise exception 'Only a super admin can manage the catalogue.'; end if;
  select * into s from catalogue_services where id = p_service;
  if s.id is null then raise exception 'Unknown service.'; end if;
  insert into catalogue_services (key, family_id, category, draft, sort_order)
  values (p_new_key, s.family_id, s.category, s.draft, s.sort_order + 1) returning id into rid;
  perform log_action('catalogue.service_duplicated', 'service', rid, jsonb_build_object('from', s.key, 'key', p_new_key));
  return rid;
end $$;

create or replace function public.reorder_services(p_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_super_admin() then raise exception 'Only a super admin can manage the catalogue.'; end if;
  update catalogue_services s set sort_order = o.n * 10 from unnest(p_ids) with ordinality o(id, n) where s.id = o.id;
  perform log_action('catalogue.reordered', 'service', null, jsonb_build_object('count', coalesce(array_length(p_ids, 1), 0)));
end $$;

-- 5. What customers see: published families and the published version of each service ----------------
create or replace function public.catalogue()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', f.id, 'key', f.key, 'name', f.name, 'description', f.description, 'icon', f.icon,
    'available', f.available_for_booking, 'regions', f.regions, 'parent_id', f.parent_id,
    'services', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'key', s.key, 'category', s.category, 'version', s.current_version, 'definition', v.definition - 'internal_notes')
        order by s.sort_order, s.key)
      from catalogue_services s
      join catalogue_service_versions v on v.service_id = s.id and v.version = s.current_version
      where s.family_id = f.id and s.status = 'published'), '[]')
  ) order by f.sort_order, f.key), '[]')
  from service_families f
  where auth.uid() is not null and f.status = 'published';
$$;
revoke execute on function public.catalogue() from public, anon;
grant execute on function public.catalogue() to authenticated;

-- 6. Booking columns on tasks -----------------------------------------------------------------------------------
create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles (id),
  for_whom text not null default 'self' check (for_whom in ('self', 'other')),
  recipient_name text,
  recipient_relation text,
  recipient_consent_at timestamptz,            -- set only when the customer confirms the recipient agreed
  share_updates boolean not null default false,
  authorized_contact_name text,
  payer text not null default 'self' check (payer in ('self', 'recipient', 'other')),
  location text,
  client_request_id uuid,
  created_at timestamptz not null default now()
);
create unique index if not exists bookings_request_idx on bookings (customer_id, client_request_id) where client_request_id is not null;
alter table bookings enable row level security;
drop policy if exists "bookings: owner and admin read" on bookings;
create policy "bookings: owner and admin read" on bookings for select using (customer_id = auth.uid() or is_admin());
drop policy if exists "bookings: customers create their own" on bookings;
create policy "bookings: customers create their own" on bookings for insert with check (customer_id = auth.uid());
revoke update, delete, truncate on bookings from anon, authenticated;

alter table tasks add column if not exists booking_id uuid references bookings (id);
alter table tasks add column if not exists service_id uuid references catalogue_services (id);
alter table tasks add column if not exists service_version int;
alter table tasks add column if not exists service_snapshot jsonb;          -- title and pricing as they were when booked
alter table tasks add column if not exists answers jsonb not null default '{}';
alter table tasks add column if not exists review_state text not null default 'none';
alter table tasks add column if not exists schedule_kind text not null default 'single_day';
alter table tasks add column if not exists schedule_plan jsonb;
alter table tasks add column if not exists scope_version int not null default 1;
alter table tasks add column if not exists extra_amount numeric(10,2) not null default 0;   -- only ever set by a doubly-approved scope change
do $$ begin
  alter table tasks add constraint tasks_review_state_check check (review_state in ('none', 'needs_review', 'clarification_needed', 'ready'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table tasks add constraint tasks_schedule_kind_check check (schedule_kind in ('single_day', 'multi_day'));
exception when duplicate_object then null; end $$;
create index if not exists tasks_booking_idx on tasks (booking_id) where booking_id is not null;
create index if not exists tasks_review_idx on tasks (review_state) where review_state in ('needs_review', 'clarification_needed');

-- Used by guard_task_insert: a published service in a published, bookable family, or null.
create or replace function public.booking_service(p_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', s.id, 'key', s.key, 'category', s.category, 'version', s.current_version, 'definition', v.definition)
    from catalogue_services s
    join service_families f on f.id = s.family_id and f.status = 'published' and f.available_for_booking
    join catalogue_service_versions v on v.service_id = s.id and v.version = s.current_version
   where s.id = p_id and s.status = 'published';
$$;
revoke execute on function public.booking_service(uuid) from public, anon;
grant execute on function public.booking_service(uuid) to authenticated;

-- A price can now also come from a published catalogue service.
alter table tasks drop constraint if exists tasks_price_source_check;
alter table tasks add constraint tasks_price_source_check check (price_source in ('template', 'admin', 'legacy', 'service'));

-- The guard from 0003, extended. Everything it did before still happens.
create or replace function public.guard_task_insert()
returns trigger language plpgsql set search_path = public as $$
declare tpl task_templates; phone text; svc catalogue_services; ver jsonb; prob text; pr jsonb; bk bookings; lookup jsonb;
begin
  if current_user in ('authenticated', 'anon') then
    if auth.uid() is null then raise exception 'Sign in to post a task.'; end if;
    if not exists (select 1 from profiles where id = auth.uid() and role in ('customer', 'admin')) then
      raise exception 'Only customer accounts can post tasks.';
    end if;
    if new.customer_id is distinct from auth.uid() then
      raise exception 'You can only post tasks for yourself.';
    end if;
    if not (new.category = any (valid_categories())) then raise exception 'Unknown category %', new.category; end if;

    new.title := trim(coalesce(new.title, ''));
    new.location := trim(coalesce(new.location, ''));
    if char_length(new.title) not between 2 and 200 then raise exception 'Give the task a short title (2 to 200 characters).'; end if;
    if char_length(new.location) not between 3 and 500 then raise exception 'Add the address where the task is to be done.'; end if;
    if new.description is not null and char_length(new.description) > 4000 then raise exception 'The description is too long.'; end if;
    if new.for_whom = 'other' and coalesce(trim(new.recipient_name), '') = '' then
      raise exception 'Add the name of the person you are booking for.';
    end if;

    if not rate_limit_self('task_create', setting_num('max_tasks_per_hour', 10)::int, 3600) then
      raise exception 'You are posting tasks too quickly. Please wait a little and try again.';
    end if;

    if new.booking_id is not null then
      select * into bk from bookings where id = new.booking_id and customer_id = auth.uid();
      if bk.id is null then raise exception 'That booking is not yours.'; end if;
    end if;
    if new.template_id is not null and new.service_id is not null then
      raise exception 'Choose either a standard template or a catalogue service, not both.';
    end if;
    if new.schedule_kind not in ('single_day', 'multi_day') then new.schedule_kind := 'single_day'; end if;
    if new.schedule_kind = 'single_day' then new.schedule_plan := null; end if;
    if new.schedule_plan is not null and (jsonb_typeof(new.schedule_plan) <> 'array' or octet_length(new.schedule_plan::text) > 5000) then
      raise exception 'The schedule is not valid.';
    end if;
    new.service_snapshot := null; new.service_version := null; new.review_state := 'needs_review';
    new.scope_version := 1; new.extra_amount := 0;
    if new.answers is null or jsonb_typeof(new.answers) <> 'object' or octet_length(new.answers::text) > 20000 then
      new.answers := '{}';
    end if;

    -- The price. A template or a published catalogue service with a fixed price
    -- is the only way to get one without an admin.
    if new.template_id is not null then
      select * into tpl from task_templates where id = new.template_id and is_active;
      if tpl.id is null then raise exception 'That template is not available.'; end if;
      if tpl.category <> new.category then raise exception 'That template belongs to a different category.'; end if;
      new.task_type := case tpl.pricing_mode when 'recurring' then 'ongoing' else 'one-time' end;
      new.est_cost := case when tpl.pricing_mode = 'one-time' then tpl.price end;
      new.rate_per_day := case when tpl.pricing_mode = 'recurring' then tpl.price end;
      new.currency := tpl.currency;
      new.price_source := 'template';
      new.template_version := tpl.version;
      new.price_status := 'confirmed';
      new.price_confirmed_at := now();
      new.est_duration_minutes := tpl.est_duration_minutes;
      new.is_premium := tpl.is_premium;
      new.routing_mode := 'broadcast';
      new.review_state := 'ready';
    elsif new.service_id is not null then
      -- Customers cannot read the catalogue tables, so the lookup is a function that
      -- returns only a published, bookable service and its published version.
      lookup := booking_service(new.service_id);
      if lookup is null then raise exception 'That service is not available.'; end if;
      svc.id := (lookup ->> 'id')::uuid; svc.key := lookup ->> 'key'; svc.category := lookup ->> 'category';
      svc.current_version := (lookup ->> 'version')::int;
      ver := lookup -> 'definition';
      prob := answers_problem(ver, new.answers);
      if prob is not null then raise exception '%', prob; end if;
      pr := ver -> 'pricing';
      new.category := svc.category;
      new.service_version := svc.current_version;
      new.service_snapshot := jsonb_build_object('key', svc.key, 'title', ver ->> 'title', 'pricing', pr, 'required_skills', ver -> 'required_skills',
                                                 'requires_specialist', coalesce((ver ->> 'requires_specialist')::boolean, false));
      new.est_duration_minutes := nullif(ver ->> 'duration_minutes', '')::int;
      new.currency := coalesce(pr ->> 'currency', 'INR');
      if pr ->> 'approach' = 'fixed' then
        new.est_cost := (pr ->> 'price')::numeric;
        new.rate_per_day := null;
        new.price_source := 'service';
        new.price_status := 'confirmed';
        new.price_confirmed_at := now();
        new.routing_mode := 'broadcast';
        new.review_state := case when coalesce((ver ->> 'requires_specialist')::boolean, false) then 'needs_review' else 'ready' end;
      else   -- manual quote or estimate: an admin sets the price and the customer confirms it
        new.est_cost := null; new.rate_per_day := null; new.price_source := null;
        new.price_status := 'awaiting_approval'; new.price_confirmed_at := null; new.routing_mode := 'admin';
        new.review_state := 'needs_review';
      end if;
      new.template_id := null; new.template_version := null; new.is_premium := false;
    else
      new.est_cost := null;
      new.rate_per_day := null;
      new.currency := 'INR';
      new.price_source := null;
      new.template_version := null;
      new.price_status := 'awaiting_approval';
      new.price_confirmed_at := null;
      new.est_duration_minutes := null;
      new.is_premium := false;
      new.routing_mode := 'admin';
    end if;

    -- Everything else that belongs to the platform.
    new.price_approved_by := null; new.price_approved_at := null;
    new.status := 'requested';
    new.assigned_worker_id := null;
    new.pm_share_bps := null;
    new.customer_rating_of_worker := null;
    new.worker_rating_of_customer := null;
    new.customer_review := null;
    new.assigned_at := null; new.accepted_at := null; new.started_at := null;
    new.completed_at := null; new.cancelled_at := null; new.cancel_reason := null;
    new.created_at := now();
    new.available_at := now();

    phone := nullif(trim(coalesce(new.recipient_phone, '')), '');
    new.recipient_phone := null;
    if phone is not null then
      perform set_config('mrtodo.rp_' || replace(new.id::text, '-', '_'), phone, true);
    end if;
  end if;
  return new;
end $$;

-- Admin: move a request between review states (e.g. ask the customer a question).
create or replace function public.set_review_state(p_task uuid, p_state text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare t tasks;
begin
  if not is_admin() then raise exception 'Admins only.'; end if;
  if p_state not in ('needs_review', 'clarification_needed', 'ready') then raise exception 'Unknown review state.'; end if;
  select * into t from tasks where id = p_task for update;
  if t.id is null then raise exception 'Unknown task.'; end if;
  if t.status not in ('requested', 'matched') then raise exception 'Only open requests can be reviewed.'; end if;
  update tasks set review_state = p_state where id = t.id;
  perform log_action('task.review_state', 'task', t.id, jsonb_build_object('note', left(p_note, 500)),
    jsonb_build_object('review_state', t.review_state), jsonb_build_object('review_state', p_state));
  if p_state = 'clarification_needed' then
    perform notify_user(t.customer_id, 'task', 'We need a little more information', left(coalesce(p_note, t.title), 300), t.id);
  end if;
end $$;

-- 7. Booking several tasks together ------------------------------------------------------------------------------
-- Runs as the signed-in customer on purpose, so every rule in guard_task_insert
-- applies to each task exactly as if it had been posted on its own.
create or replace function public.create_booking(p_items jsonb, p_shared jsonb, p_request_key uuid default null)
returns uuid language plpgsql security invoker set search_path = public as $$
declare bid uuid; it jsonb; i int := 0; other boolean; kind text; n int;
begin
  if auth.uid() is null then raise exception 'Sign in to book.'; end if;
  if p_request_key is not null then
    select id into bid from bookings where customer_id = auth.uid() and client_request_id = p_request_key;
    if bid is not null then return bid; end if;     -- a retry returns the same booking
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
    insert into tasks (customer_id, booking_id, service_id, title, description, category, task_type, scheduled_for, location,
                       for_whom, recipient_name, recipient_relation, recipient_phone, answers, schedule_kind, schedule_plan)
    values (auth.uid(), bid, nullif(it ->> 'service_id', '')::uuid, it ->> 'title', it ->> 'description',
            coalesce(it ->> 'category', 'general'), case when it ->> 'task_type' = 'ongoing' then 'ongoing' else 'one-time' end, coalesce(it ->> 'scheduled_for', p_shared ->> 'scheduled_for', 'Flexible'),
            coalesce(it ->> 'location', p_shared ->> 'location'),
            case when other then 'other' else 'self' end, nullif(trim(p_shared ->> 'recipient_name'), ''),
            nullif(trim(p_shared ->> 'recipient_relation'), ''), nullif(trim(p_shared ->> 'recipient_phone'), ''),
            coalesce(it -> 'answers', '{}'), kind, coalesce(it -> 'schedule_plan', p_shared -> 'schedule_plan'));
  end loop;
  return bid;
end $$;
grant execute on function public.create_booking(jsonb, jsonb, uuid) to authenticated;

-- One booking, its tasks, and an honest total: only confirmed amounts are summed;
-- anything still waiting for a price is counted, never guessed.
create or replace function public.booking_summary(p_booking uuid)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare b bookings; result jsonb;
begin
  select * into b from bookings where id = p_booking;
  if b.id is null then raise exception 'Booking not found.'; end if;
  select jsonb_build_object(
    'booking', to_jsonb(b) - 'client_request_id',
    'tasks', coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id, 'title', t.title, 'status', t.status, 'price_status', t.price_status, 'review_state', t.review_state,
      'amount', coalesce(t.est_cost, t.rate_per_day), 'extra_amount', t.extra_amount, 'currency', t.currency,
      'schedule_kind', t.schedule_kind, 'service_version', t.service_version) order by t.created_at), '[]'),
    'confirmed_total', coalesce(sum(coalesce(t.est_cost, t.rate_per_day) + t.extra_amount) filter (where t.price_status = 'confirmed'), 0),
    'awaiting_price', count(*) filter (where t.price_status <> 'confirmed'),
    'completed', count(*) filter (where t.status = 'completed'),
    'total', count(*))
  into result from tasks t where t.booking_id = b.id;
  return result;
end $$;
grant execute on function public.booking_summary(uuid) to authenticated;

-- 8. Single-day -> multi-day: needs the admin AND the customer ----------------------------------------------------
create table if not exists task_scope_changes (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks (id) on delete cascade,
  requested_by uuid not null references profiles (id),
  reason text not null check (char_length(reason) between 10 and 2000),
  proposed_visits jsonb not null default '[]',
  revised_duration_minutes int check (revised_duration_minutes is null or revised_duration_minutes > 0),
  price_impact numeric(10,2) check (price_impact is null or price_impact >= 0),
  base_scope_version int not null,
  status text not null default 'pending' check (status in ('pending', 'approved_by_admin', 'rejected', 'applied', 'withdrawn')),
  admin_by uuid references profiles (id) on delete set null,
  admin_decision text check (admin_decision in ('approved', 'rejected')),
  admin_note text,
  admin_at timestamptz,
  approved_price_impact numeric(10,2) check (approved_price_impact is null or approved_price_impact >= 0),
  customer_decision text check (customer_decision in ('approved', 'rejected')),
  customer_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists scope_change_one_open on task_scope_changes (task_id) where status in ('pending', 'approved_by_admin');
alter table task_scope_changes enable row level security;
drop policy if exists "scope: people involved" on task_scope_changes;
create policy "scope: people involved" on task_scope_changes for select using (
  is_admin()
  or exists (select 1 from tasks t where t.id = task_id
             and (t.assigned_worker_id = auth.uid() or (t.customer_id = auth.uid() and task_scope_changes.status <> 'pending')))
);
revoke insert, update, delete, truncate on task_scope_changes from anon, authenticated;

create or replace function public.request_multiday_change(
  p_task uuid, p_reason text, p_visits jsonb, p_duration_minutes int default null, p_price_impact numeric default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare t tasks; cid uuid;
begin
  select * into t from tasks where id = p_task for update;
  if t.id is null or t.assigned_worker_id is distinct from auth.uid() then raise exception 'This is not your task.'; end if;
  if t.status not in ('assigned', 'in_progress') then raise exception 'A change can only be requested while the task is under way.'; end if;
  if t.schedule_kind = 'multi_day' then raise exception 'This task already runs over several days.'; end if;
  if jsonb_typeof(p_visits) <> 'array' or jsonb_array_length(p_visits) not between 1 and 30 or octet_length(p_visits::text) > 5000 then
    raise exception 'Add the proposed visits (between 1 and 30).';
  end if;
  if char_length(trim(coalesce(p_reason, ''))) < 10 then raise exception 'Explain why more days are needed (at least 10 characters).'; end if;
  if not rate_limit_self('scope_change', 5, 3600) then raise exception 'Too many requests. Please wait a little.'; end if;
  begin
    insert into task_scope_changes (task_id, requested_by, reason, proposed_visits, revised_duration_minutes, price_impact, base_scope_version)
    values (t.id, auth.uid(), trim(p_reason), p_visits, p_duration_minutes, p_price_impact, t.scope_version) returning id into cid;
  exception when unique_violation then
    raise exception 'A change request for this task is already waiting for a decision.';
  end;
  perform log_action('task.scope_change_requested', 'task', t.id, jsonb_build_object('change', cid, 'visits', jsonb_array_length(p_visits)),
    jsonb_build_object('schedule_kind', 'single_day'), jsonb_build_object('schedule_kind', 'multi_day', 'price_impact', p_price_impact));
  perform notify_admins('task', 'Request to extend a task over several days', t.title, t.id);
  return cid;
end $$;

create or replace function public.withdraw_scope_change(p_change uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c task_scope_changes;
begin
  select * into c from task_scope_changes where id = p_change for update;
  if c.id is null or c.requested_by is distinct from auth.uid() then raise exception 'This is not your request.'; end if;
  if c.status = 'withdrawn' then return; end if;
  if c.status not in ('pending', 'approved_by_admin') then raise exception 'This request has already been decided.'; end if;
  update task_scope_changes set status = 'withdrawn' where id = c.id;
  perform log_action('task.scope_change_withdrawn', 'task', c.task_id, jsonb_build_object('change', c.id));
end $$;

create or replace function public.decide_scope_change_admin(p_change uuid, p_approve boolean, p_note text default null, p_price_impact numeric default null)
returns void language plpgsql security definer set search_path = public as $$
declare c task_scope_changes; t tasks;
begin
  if not is_admin() then raise exception 'Admins only.'; end if;
  select * into c from task_scope_changes where id = p_change for update;
  if c.id is null then raise exception 'Unknown request.'; end if;
  if (p_approve and c.status = 'approved_by_admin') or (not p_approve and c.status = 'rejected') then return; end if;   -- repeating changes nothing
  if c.status <> 'pending' then raise exception 'This request has already been decided.'; end if;
  select * into t from tasks where id = c.task_id for update;
  if t.scope_version <> c.base_scope_version or t.status not in ('assigned', 'in_progress') then
    update task_scope_changes set status = 'withdrawn' where id = c.id;
    raise exception 'The task has changed since this was requested, so the request was closed.';
  end if;
  if p_price_impact is not null and p_price_impact < 0 then raise exception 'The price change cannot be negative.'; end if;
  update task_scope_changes set
    status = case when p_approve then 'approved_by_admin' else 'rejected' end,
    admin_decision = case when p_approve then 'approved' else 'rejected' end,
    admin_by = auth.uid(), admin_at = now(), admin_note = left(p_note, 1000),
    approved_price_impact = case when p_approve then coalesce(p_price_impact, c.price_impact, 0) end
  where id = c.id;
  perform log_action('task.scope_change_admin_decision', 'task', t.id, jsonb_build_object('change', c.id, 'note', left(p_note, 500)),
    jsonb_build_object('status', c.status), jsonb_build_object('status', case when p_approve then 'approved_by_admin' else 'rejected' end));
  if p_approve then
    perform notify_user(t.customer_id, 'task', 'Please review a change to your task', t.title || ' — your Personal Manager asks to continue over several days. Nothing changes until you agree.', t.id);
  else
    perform notify_user(c.requested_by, 'task', 'Multi-day request not approved', t.title, t.id);
  end if;
end $$;

create or replace function public.decide_scope_change_customer(p_change uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = public as $$
declare c task_scope_changes; t tasks;
begin
  select * into c from task_scope_changes where id = p_change for update;
  if c.id is null then raise exception 'Unknown request.'; end if;
  select * into t from tasks where id = c.task_id for update;
  if t.customer_id is distinct from auth.uid() then raise exception 'This is not your task.'; end if;
  if c.status = 'applied' and p_approve then return; end if;
  if c.status = 'rejected' and not p_approve then return; end if;
  if c.status <> 'approved_by_admin' then raise exception 'This change is not waiting for your decision.'; end if;
  if t.scope_version <> c.base_scope_version or t.status not in ('assigned', 'in_progress') then
    update task_scope_changes set status = 'withdrawn' where id = c.id;
    raise exception 'The task has changed since this was proposed, so the request was closed.';
  end if;
  if not p_approve then
    update task_scope_changes set status = 'rejected', customer_decision = 'rejected', customer_at = now() where id = c.id;
    perform log_action('task.scope_change_customer_decision', 'task', t.id, jsonb_build_object('change', c.id), null, jsonb_build_object('decision', 'rejected'));
    perform notify_user(c.requested_by, 'task', 'The customer did not agree to a multi-day plan', t.title, t.id);
    perform notify_admins('task', 'Customer declined a multi-day change', t.title, t.id);
    return;
  end if;
  -- Both approvals are now on record: apply the change in this one transaction.
  update tasks set schedule_kind = 'multi_day', schedule_plan = c.proposed_visits, scope_version = scope_version + 1,
                   extra_amount = extra_amount + coalesce(c.approved_price_impact, 0),
                   est_duration_minutes = coalesce(c.revised_duration_minutes, est_duration_minutes)
   where id = t.id;
  update task_scope_changes set status = 'applied', customer_decision = 'approved', customer_at = now() where id = c.id;
  perform log_action('task.scope_change_applied', 'task', t.id, jsonb_build_object('change', c.id, 'approved_by', c.admin_by),
    jsonb_build_object('schedule_kind', t.schedule_kind, 'scope_version', t.scope_version, 'extra_amount', t.extra_amount),
    jsonb_build_object('schedule_kind', 'multi_day', 'scope_version', t.scope_version + 1,
                       'extra_amount', t.extra_amount + coalesce(c.approved_price_impact, 0)));
  perform notify_user(c.requested_by, 'task', 'Multi-day plan approved', t.title, t.id);
  perform notify_admins('task', 'Multi-day plan approved by the customer', t.title, t.id);
end $$;

-- Who may call what.
revoke execute on function public.save_family(text, text, text, text, int, text, boolean, uuid, text[]) from public, anon;
revoke execute on function public.save_service_draft(text, uuid, text, jsonb, int) from public, anon;
revoke execute on function public.service_readiness(uuid) from public, anon;
revoke execute on function public.publish_service(uuid) from public, anon;
revoke execute on function public.set_service_status(uuid, text) from public, anon;
revoke execute on function public.duplicate_service(uuid, text) from public, anon;
revoke execute on function public.reorder_services(uuid[]) from public, anon;
revoke execute on function public.set_review_state(uuid, text, text) from public, anon;
revoke execute on function public.request_multiday_change(uuid, text, jsonb, int, numeric) from public, anon;
revoke execute on function public.withdraw_scope_change(uuid) from public, anon;
revoke execute on function public.decide_scope_change_admin(uuid, boolean, text, numeric) from public, anon;
revoke execute on function public.decide_scope_change_customer(uuid, boolean) from public, anon;
revoke execute on function public.create_booking(jsonb, jsonb, uuid) from anon;
revoke execute on function public.booking_summary(uuid) from anon;
grant execute on function public.save_family(text, text, text, text, int, text, boolean, uuid, text[]) to authenticated;
grant execute on function public.save_service_draft(text, uuid, text, jsonb, int) to authenticated;
grant execute on function public.service_readiness(uuid) to authenticated;
grant execute on function public.publish_service(uuid) to authenticated;
grant execute on function public.set_service_status(uuid, text) to authenticated;
grant execute on function public.duplicate_service(uuid, text) to authenticated;
grant execute on function public.reorder_services(uuid[]) to authenticated;
grant execute on function public.set_review_state(uuid, text, text) to authenticated;
grant execute on function public.request_multiday_change(uuid, text, jsonb, int, numeric) to authenticated;
grant execute on function public.withdraw_scope_change(uuid) to authenticated;
grant execute on function public.decide_scope_change_admin(uuid, boolean, text, numeric) to authenticated;
grant execute on function public.decide_scope_change_customer(uuid, boolean) to authenticated;
