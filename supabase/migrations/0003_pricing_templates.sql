-- 0003 — prices are set by the platform, never by the customer.
--
-- Three separate ideas that earlier versions blurred together:
--   * a TEMPLATE price: approved in advance by a super admin for a predictable
--     service ("Fix a leaking tap"), applied automatically when a customer picks
--     that template;
--   * an ADMIN price: approved by an admin for one non-standard task, which the
--     customer then confirms;
--   * the customer's own idea of a price: no longer stored or trusted.
-- est_cost (one-time tasks) and rate_per_day (ongoing tasks) keep their names
-- so every existing screen keeps working, but only the functions below can set
-- them now.
-- Safe to run more than once. Depends on 0001 and 0002.

-- 1. Approved Standard Templates -------------------------------------------------------------------
create table if not exists task_templates (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z0-9][a-z0-9-]{1,60}$'),   -- stable identifier, never fuzzy-matched
  name text not null check (char_length(name) between 2 and 120),
  category text not null check (category = any (public.valid_categories())),
  description text check (description is null or char_length(description) <= 2000),
  pricing_mode text not null default 'one-time' check (pricing_mode in ('one-time', 'recurring')),
  price numeric(10,2) check (price is null or price >= 0),
  currency char(3) not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  est_duration_minutes int check (est_duration_minutes is null or est_duration_minutes > 0),
  is_premium boolean not null default false,
  is_active boolean not null default false,
  version int not null default 1,
  approved_by uuid references profiles (id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Only a template with an approved price may price tasks automatically.
  constraint template_active_needs_approved_price check (not is_active or (price is not null and approved_at is not null))
);

alter table task_templates enable row level security;
drop policy if exists "templates: active for all, everything for admins" on task_templates;
create policy "templates: active for all, everything for admins" on task_templates
  for select using (is_active or is_admin());
revoke insert, update, delete, truncate on task_templates from anon, authenticated;

-- The starter set mirrors the quick-picks in the app. Only "Fix a leaking tap"
-- has a price, taken from the Task Journey document (₹650). The others stay
-- inactive until a super admin sets and approves a price: nothing here invents
-- a number on the business's behalf.
insert into task_templates (key, name, category, description, pricing_mode, price, est_duration_minutes, is_active, approved_at)
values ('fix-leaking-tap', 'Fix a leaking tap', 'handyman',
        'A tap is dripping and needs a look — replace washer/seal if needed.', 'one-time', 650, 60, true, now())
on conflict (key) do nothing;

insert into task_templates (key, name, category, description, pricing_mode) values
  ('deep-clean-home', 'Deep clean my home', 'cleaning', 'Full clean of kitchen, bathrooms and all rooms.', 'one-time'),
  ('help-me-move', 'Help me move', 'moving', 'Help moving items to a new address, may need a small vehicle.', 'one-time'),
  ('pickup-and-drop', 'Pick up / drop something', 'delivery', 'Collect an item from one address and deliver it to another.', 'one-time'),
  ('elderly-parent-errands', 'Help an elderly parent with errands', 'care', 'Someone to accompany an elderly family member for paperwork, bank visits, or errands — may take more than one visit.', 'recurring'),
  ('medicine-grocery-run', 'Medicine or grocery run', 'care', 'A short, one-time errand to collect medicines or groceries.', 'one-time')
on conflict (key) do nothing;

-- Super admins create and change templates here. A change to what the
-- template covers or costs bumps its version, so every task records exactly
-- which version priced it.
create or replace function public.save_template(
  p_key text, p_name text, p_category text, p_description text, p_pricing_mode text,
  p_price numeric, p_currency text, p_est_duration_minutes int, p_is_premium boolean, p_is_active boolean
) returns uuid language plpgsql security definer set search_path = public as $$
declare old task_templates; new_row task_templates; changed boolean;
begin
  if not is_super_admin() then raise exception 'Only a super admin can manage templates.'; end if;
  if p_is_active and (p_price is null or p_price < 0) then
    raise exception 'Set an approved price before switching a template on.';
  end if;
  select * into old from task_templates where key = p_key for update;

  if old.id is null then
    insert into task_templates (key, name, category, description, pricing_mode, price, currency,
                                est_duration_minutes, is_premium, is_active, approved_by, approved_at)
    values (p_key, trim(p_name), p_category, nullif(trim(p_description), ''), p_pricing_mode, p_price,
            upper(coalesce(p_currency, 'INR')), p_est_duration_minutes, coalesce(p_is_premium, false), p_is_active,
            case when p_price is not null then auth.uid() end, case when p_price is not null then now() end)
    returning * into new_row;
    perform log_action('template.created', 'template', new_row.id, jsonb_build_object('key', p_key), null, to_jsonb(new_row));
    return new_row.id;
  end if;

  changed := old.category is distinct from p_category
          or old.pricing_mode is distinct from p_pricing_mode
          or old.price is distinct from p_price
          or old.currency is distinct from upper(coalesce(p_currency, old.currency))
          or old.description is distinct from nullif(trim(p_description), '')
          or old.is_premium is distinct from coalesce(p_is_premium, false);

  update task_templates set
    name = trim(p_name), category = p_category, description = nullif(trim(p_description), ''),
    pricing_mode = p_pricing_mode, price = p_price, currency = upper(coalesce(p_currency, currency)),
    est_duration_minutes = p_est_duration_minutes, is_premium = coalesce(p_is_premium, false), is_active = p_is_active,
    version = case when changed then version + 1 else version end,
    approved_by = case when old.price is distinct from p_price and p_price is not null then auth.uid() else approved_by end,
    approved_at = case when old.price is distinct from p_price and p_price is not null then now() else approved_at end,
    updated_at = now()
   where id = old.id returning * into new_row;

  perform log_action('template.updated', 'template', new_row.id, jsonb_build_object('key', p_key, 'version', new_row.version),
                     to_jsonb(old), to_jsonb(new_row));
  return new_row.id;
end $$;

-- 2. Price, routing and idempotency columns on tasks -------------------------------------------------------
alter table tasks add column if not exists currency char(3) not null default 'INR';
alter table tasks add column if not exists price_status text not null default 'awaiting_approval';
alter table tasks add column if not exists price_source text;
alter table tasks add column if not exists template_id uuid references task_templates (id);
alter table tasks add column if not exists template_version int;
alter table tasks add column if not exists price_approved_by uuid references profiles (id) on delete set null;
alter table tasks add column if not exists price_approved_at timestamptz;
alter table tasks add column if not exists price_confirmed_at timestamptz;
alter table tasks add column if not exists est_duration_minutes int;
alter table tasks add column if not exists routing_mode text not null default 'admin';
alter table tasks add column if not exists is_premium boolean not null default false;
alter table tasks add column if not exists available_at timestamptz;
alter table tasks add column if not exists pm_share_bps int;               -- snapshot at completion, see 0004
alter table tasks add column if not exists client_request_id uuid;         -- makes a retried "post task" harmless

do $$ begin
  alter table tasks add constraint tasks_price_status_check
    check (price_status in ('awaiting_approval', 'awaiting_confirmation', 'confirmed'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table tasks add constraint tasks_price_source_check check (price_source in ('template', 'admin', 'legacy'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table tasks add constraint tasks_routing_mode_check check (routing_mode in ('admin', 'broadcast'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table tasks add constraint tasks_prices_not_negative check (
    (est_cost is null or est_cost >= 0) and (rate_per_day is null or rate_per_day >= 0));
exception when duplicate_object then null; end $$;

-- Tasks that already carry a price were priced under the old rules. They keep
-- working as they are, but are marked "legacy" so reports can tell them apart.
update tasks set price_source = 'legacy', price_status = 'confirmed', price_confirmed_at = coalesce(price_confirmed_at, created_at)
 where price_source is null and (est_cost is not null or rate_per_day is not null);
update tasks set available_at = created_at where available_at is null;
alter table tasks alter column available_at set default now();

create unique index if not exists tasks_client_request_idx on tasks (customer_id, client_request_id)
  where client_request_id is not null;
create index if not exists tasks_template_idx on tasks (template_id) where template_id is not null;
create index if not exists tasks_queue_idx on tasks (status, routing_mode, available_at);

-- 3. Contact details live outside the task row -------------------------------------------------------------------
-- A phone number typed for "someone else" is kept here, readable only by admins
-- (through admin_task_contact). It never travels in task rows, Realtime or API
-- responses seen by customers or Personal Managers.
create table if not exists task_contacts (
  task_id uuid primary key references tasks (id) on delete cascade,
  recipient_phone text
);
alter table task_contacts enable row level security;
revoke all on task_contacts from anon, authenticated;

-- Existing rows: move the number, then blank it on the task.
insert into task_contacts (task_id, recipient_phone)
  select id, recipient_phone from tasks where recipient_phone is not null
  on conflict (task_id) do nothing;
update tasks set recipient_phone = null where recipient_phone is not null;

-- 4. The task insert guard --------------------------------------------------------------------------------------------
-- Everything a customer sends is treated as a request, and everything that
-- decides price, routing, assignment or lifecycle is set here, not by them.
create or replace function public.guard_task_insert()
returns trigger language plpgsql set search_path = public as $$
declare tpl task_templates; phone text;
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

    -- The price. A template is the only way to get one without an admin.
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

    -- A phone number for "someone else" is kept apart from the task row. It is
    -- handed to after_task_insert (which runs with the database's own
    -- privileges) for this transaction only.
    phone := nullif(trim(coalesce(new.recipient_phone, '')), '');
    new.recipient_phone := null;
    if phone is not null then
      perform set_config('mrtodo.rp_' || replace(new.id::text, '-', '_'), phone, true);
    end if;
  end if;
  return new;
end $$;

-- 5. After a task is created ---------------------------------------------------------------------------------------------
-- Earlier versions made the completion code here. Codes are now issued by the
-- customer when the work is done (0004), so nothing is created.
create or replace function public.after_task_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare phone text := nullif(current_setting('mrtodo.rp_' || replace(new.id::text, '-', '_'), true), '');
begin
  if phone is not null then
    insert into task_contacts (task_id, recipient_phone) values (new.id, phone) on conflict (task_id) do nothing;
  end if;
  perform log_action('task.created', 'task', new.id,
    jsonb_build_object('title', new.title, 'category', new.category, 'price_source', new.price_source,
                       'template_id', new.template_id, 'routing_mode', new.routing_mode),
    null, jsonb_build_object('price_status', new.price_status, 'est_cost', new.est_cost, 'rate_per_day', new.rate_per_day));
  perform notify_admins('task',
    case when new.price_status = 'awaiting_approval' then 'New task needs a price' else 'New task needs a Personal Manager' end,
    new.title, new.id);
  return new;
end $$;

-- 6. Approving and confirming prices ----------------------------------------------------------------------------------------
create or replace function public.approve_task_price(p_task uuid, p_amount numeric, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare t tasks; amt numeric(10,2); before_state jsonb; needs_confirmation boolean;
begin
  if not is_admin() then raise exception 'Admins only.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter a price above zero.'; end if;
  if p_amount > 1000000 then raise exception 'That price looks too high. Check it and try again.'; end if;
  amt := round(p_amount, 2);

  select * into t from tasks where id = p_task for update;
  if t.id is null then raise exception 'Task not found.'; end if;
  if t.price_source = 'template' then
    raise exception 'This task uses a standard template price. Change the template instead.';
  end if;
  if t.status <> 'requested' then
    raise exception 'The price can only be set while the task is waiting for a Personal Manager.';
  end if;

  needs_confirmation := setting_bool('require_customer_price_confirmation', true);
  before_state := jsonb_build_object('est_cost', t.est_cost, 'rate_per_day', t.rate_per_day, 'price_status', t.price_status);

  update tasks set
    est_cost = case when t.task_type = 'one-time' then amt end,
    rate_per_day = case when t.task_type = 'ongoing' then amt end,
    price_source = 'admin',
    price_status = case when needs_confirmation then 'awaiting_confirmation' else 'confirmed' end,
    price_approved_by = auth.uid(), price_approved_at = now(), price_confirmed_at = null
   where id = p_task;

  perform log_action('task.price_approved', 'task', p_task,
    jsonb_build_object('note', nullif(trim(p_note), ''), 'title', t.title, 'currency', t.currency),
    before_state,
    jsonb_build_object('amount', amt, 'per_day', t.task_type = 'ongoing',
                       'price_status', case when needs_confirmation then 'awaiting_confirmation' else 'confirmed' end));

  if needs_confirmation then
    perform notify_user(t.customer_id, 'task', 'Please confirm your price',
      t.title || ' — ' || t.currency || ' ' || trim_scale(amt)::text || case when t.task_type = 'ongoing' then ' per day' else '' end, p_task);
  end if;
end $$;

create or replace function public.confirm_task_price(p_task uuid)
returns void language plpgsql security definer set search_path = public as $$
declare t tasks;
begin
  select * into t from tasks where id = p_task for update;
  if t.id is null or t.customer_id is distinct from auth.uid() then raise exception 'Not your task.'; end if;
  if t.status in ('completed', 'cancelled') then raise exception 'This task is already %.', t.status; end if;
  if t.price_status = 'confirmed' then return; end if;      -- repeating the request changes nothing
  if t.price_status <> 'awaiting_confirmation' then
    raise exception 'There is no price to confirm yet. We will tell you when it is ready.';
  end if;
  update tasks set price_status = 'confirmed', price_confirmed_at = now() where id = p_task;
  perform log_action('task.price_confirmed', 'task', p_task, jsonb_build_object('title', t.title), null,
                     jsonb_build_object('est_cost', t.est_cost, 'rate_per_day', t.rate_per_day));
  perform notify_admins('task', 'Price confirmed by the customer', t.title, p_task);
end $$;

-- 7. Assigning and starting now respect the price -----------------------------------------------------------------------------------
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
  if t.status = 'matched' and t.assigned_worker_id = p_worker then return; end if;   -- already offered to them: nothing to do
  if t.price_status not in ('awaiting_confirmation', 'confirmed') or (t.est_cost is null and t.rate_per_day is null) then
    raise exception 'Approve a price for this task before assigning a Personal Manager.';
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
                                       'previous_worker_id', t.assigned_worker_id, 'title', t.title),
    jsonb_build_object('assigned_worker_id', t.assigned_worker_id, 'status', t.status),
    jsonb_build_object('assigned_worker_id', p_worker, 'status', 'matched'));
end $$;

create or replace function public.start_task(p_task uuid)
returns void language plpgsql security definer set search_path = public as $$
declare t tasks;
begin
  select * into t from tasks where id = p_task for update;
  if t.id is null or t.assigned_worker_id is distinct from auth.uid() then raise exception 'Not your task.'; end if;
  if t.status = 'in_progress' then return; end if;          -- repeating the request changes nothing
  if t.status <> 'assigned' then raise exception 'Accept the task before starting it.'; end if;
  if setting_bool('require_customer_price_confirmation', true) and t.price_status <> 'confirmed' then
    raise exception 'The customer has not confirmed the price yet.';
  end if;
  update tasks set status = 'in_progress', started_at = now() where id = p_task;
  perform log_action('task.started', 'task', p_task, jsonb_build_object('title', t.title));
end $$;

-- Contact details for the admin tools, one task at a time, and recorded.
create or replace function public.admin_task_contact(p_task uuid)
returns table (recipient_phone text) language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only.'; end if;
  perform log_action('task.contact_viewed', 'task', p_task, '{}');
  return query select c.recipient_phone from task_contacts c where c.task_id = p_task;
end $$;
