-- 0015 — small functions the apps need. Safe to run more than once. Depends on 0001-0014.

-- Time off is typed in the Personal Manager's local time ("2026-11-09 14:00"), and the database
-- turns it into an instant using the time zone of the region they serve (or the default zone).
create or replace function public.add_pm_block_local(p_worker uuid, p_start text, p_end text, p_kind text default 'time_off', p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare w uuid := coalesce(p_worker, auth.uid()); tz text; s timestamptz; e timestamptz;
begin
  if w is distinct from auth.uid() and not is_admin() then raise exception 'You can only change your own schedule.'; end if;
  if not exists (select 1 from profiles where id = w and role = 'worker') then raise exception 'That is not a Personal Manager.'; end if;
  if p_start !~ '^\d{4}-\d{2}-\d{2} ([01]\d|2[0-3]):[0-5]\d$' or p_end !~ '^\d{4}-\d{2}-\d{2} ([01]\d|2[0-3]):[0-5]\d$' then
    raise exception 'Enter dates and times like 2026-11-09 14:00.';
  end if;
  select region_tz((region_codes)[1]) into tz from profiles where id = w;
  tz := coalesce(tz, setting_text('default_timezone', 'UTC'));
  s := p_start::timestamp at time zone tz; e := p_end::timestamp at time zone tz;
  if e <= s then raise exception 'The end must be after the start.'; end if;
  return add_pm_block(w, s, e, p_kind, p_note);
end $$;

-- Whether customers and PMs are asked to share a gender for matching. False until an administrator turns the policy on.
create or replace function public.gender_matching_active()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select enabled from matching_policy where id), false) and auth.uid() is not null;
$$;

revoke execute on function public.add_pm_block_local(uuid, text, text, text, text), public.gender_matching_active() from public, anon;
grant execute on function public.add_pm_block_local(uuid, text, text, text, text), public.gender_matching_active() to authenticated;
