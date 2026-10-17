-- 0005 — privacy: contact details never travel to the other side of a task.
-- Safe to run more than once. Depends on 0001–0004.
--
-- Before this, a customer's phone and email were part of the profile row, and the
-- Personal Manager on that task was allowed to read the whole row (and the
-- other way round). Row-level security cannot hide one column of a visible
-- row, so the contact columns are taken out of what the apps may read at all.
-- Your own number comes back through my_contact(); admins get numbers through
-- admin_contacts(), which is recorded.

-- 1. Profiles: everything except phone and email stays readable --------------------------------------------
-- Run again at the end of any migration that adds a profile column, so the new
-- column is readable (tests/privacy.sql fails if one is forgotten).
create or replace function public.refresh_profile_grants()
returns void language plpgsql as $$
declare cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'profiles' and column_name not in ('phone', 'email');
  execute 'revoke select on public.profiles from anon, authenticated';
  execute format('grant select (%s) on public.profiles to authenticated', cols);
end $$;
revoke execute on function public.refresh_profile_grants() from public, anon, authenticated;
select public.refresh_profile_grants();

-- 2. Your own details, and admins' view of others ---------------------------------------------------------------
create or replace function public.my_contact()
returns table (phone text, email text) language sql stable security definer set search_path = public as $$
  select p.phone, p.email from profiles p where p.id = auth.uid();
$$;

create or replace function public.admin_contacts(p_ids uuid[])
returns table (id uuid, phone text, email text) language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only.'; end if;
  if coalesce(array_length(p_ids, 1), 0) > 200 then raise exception 'Ask for fewer people at a time.'; end if;
  perform log_action('contacts.viewed', 'profile', null, jsonb_build_object('count', coalesce(array_length(p_ids, 1), 0)));
  return query select p.id, p.phone, p.email from profiles p where p.id = any (p_ids);
end $$;

-- 3. A PM sees the area, not the address, until they accept --------------------------------------------------------
-- "Kandivali West" is the last comma-separated part of "Flat 4B, Kandivali West".
create or replace function public.area_of(p_location text)
returns text language sql immutable as $$
  select coalesce(nullif(trim((regexp_split_to_array(coalesce(p_location, ''), ','))[array_length(regexp_split_to_array(coalesce(p_location, ''), ','), 1)]), ''), 'Unknown');
$$;

-- Offers the PM has not yet accepted come through here, with the street address
-- and the customer's identity left out. Once accepted, the full task is readable
-- as before.
create or replace function public.pm_offers()
returns table (
  id uuid, title text, description text, category text, task_type text, status text, scheduled_for text,
  area text, est_cost numeric, rate_per_day numeric, currency char(3), est_duration_minutes int,
  assigned_at timestamptz, price_status text, is_premium boolean, earn_share_bps int, created_at timestamptz
) language sql stable security definer set search_path = public as $$
  select t.id, t.title, t.description, t.category, t.task_type, t.status, t.scheduled_for,
         area_of(t.location), t.est_cost, t.rate_per_day, t.currency, t.est_duration_minutes,
         t.assigned_at, t.price_status, t.is_premium, pm_share_bps_for(auth.uid()), t.created_at
    from tasks t
   where t.assigned_worker_id = auth.uid() and t.status = 'matched'
   order by t.assigned_at desc;
$$;

drop policy if exists "tasks: customer, assigned PM, admin" on tasks;
create policy "tasks: customer, assigned PM, admin" on tasks
  for select using (
    customer_id = auth.uid()
    or is_admin()
    or (assigned_worker_id = auth.uid()
        and (status in ('assigned', 'in_progress', 'completed') or (status = 'cancelled' and accepted_at is not null)))
  );

-- Visits and photos follow the same rule: nothing about a task reaches a PM before they accept it.
drop policy if exists "visits follow task visibility" on task_visits;
create policy "visits follow task visibility" on task_visits
  for select using (exists (select 1 from tasks t where t.id = task_visits.task_id));

create or replace function public.can_access_task(p_task uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from tasks t
                  where t.id = p_task
                    and (t.customer_id = auth.uid() or is_admin()
                         or (t.assigned_worker_id = auth.uid() and t.status in ('assigned', 'in_progress', 'completed'))));
$$;

-- 4. The profile a partner may see ----------------------------------------------------------------------------------------
-- Name, rating and similar stay visible to the other side of a task (the apps
-- need them); contact details do not (section 1).
select public.refresh_profile_grants();
