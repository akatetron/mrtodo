-- 0010 — correct the sample catalogue so it promises only what Mr. Todo can do.
-- Safe to run more than once. Depends on 0006 and 0007.
--
-- Mr. Todo has not confirmed a network of external plumbers, electricians or
-- technicians, so nothing may be advertised as "we arrange" one. The specialist
-- machinery (specialists, quotes, regulated-work rules) stays in the database
-- for when that capability is real, but no customer-facing service uses it now.
-- "Help for family" is a way of booking (booking for someone else), not a
-- category, so it is no longer a family of its own.

alter table service_families add column if not exists icon_key text check (icon_key is null or icon_key ~ '^[a-z0-9-]{2,30}$');

-- Done once (a marker row), so re-running this file never re-archives something an admin later reinstates.
-- Archived, not deleted: bookings already made against them keep their history.
do $$ begin
  if not exists (select 1 from platform_settings where key = 'catalogue_correction_0010') then
    update catalogue_services set status = 'archived', updated_at = now()
     where key in ('plumbing-coordination', 'electrical-coordination', 'appliance-repair', 'parent-practical-help') and status <> 'archived';
    update service_families set status = 'paused', updated_at = now() where key in ('home-repairs', 'family-support') and status <> 'paused';
    insert into platform_settings (key, value, description) values ('catalogue_correction_0010', 'true', 'Marker: the sample catalogue was corrected to remove specialist promises (migration 0010)');
  end if;
end $$;

-- Icons are chosen from a fixed set the apps know how to draw (never emoji).
update service_families set icon_key = case key
  when 'everyday-tech' then 'smartphone'
  when 'assistance' then 'users'
  when 'errands' then 'shopping-bag'
  when 'setup-organise' then 'package'
  when 'home-repairs' then 'tool'
  when 'family-support' then 'heart'
  end
 where icon_key is null and key in ('everyday-tech', 'assistance', 'errands', 'setup-organise', 'home-repairs', 'family-support');

update service_families set name = 'Personal Assistance', description = 'Someone to go with you and help with practical things.' where key = 'assistance' and name = 'Personal Assistance and Companionship';
update service_families set name = 'Errands and Practical Tasks', description = 'Pick-ups, shopping and small jobs.' where key = 'errands' and name = 'Errands and Everyday Tasks';
update service_families set name = 'Setup and Organisation', description = 'Assemble, set up and tidy.' where key = 'setup-organise' and name = 'Setup, Installation and Organization';

-- The customer catalogue now also hands the apps the icon key.
create or replace function public.catalogue()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', f.id, 'key', f.key, 'name', f.name, 'description', f.description, 'icon_key', f.icon_key,
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
  where auth.uid() is not null and f.status = 'published' and f.available_for_booking
    and exists (select 1 from catalogue_services s where s.family_id = f.id and s.status = 'published' and s.current_version > 0);   -- no empty categories
$$;
revoke execute on function public.catalogue() from public, anon;
grant execute on function public.catalogue() to authenticated;
select public.refresh_profile_grants();
