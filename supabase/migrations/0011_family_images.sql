-- 0011 — an optional photograph for each service family.
-- Safe to run more than once. Depends on 0006 and 0010.
--
-- The apps ship with a deliberate fallback artwork for every family, and can also
-- bundle photographs inside the app (see docs/PHOTOS.md). A family can additionally
-- point at an https image link set by a super admin; if the link is empty or fails to
-- load, the app shows the fallback instead of a broken picture.

alter table service_families add column if not exists image_url text
  check (image_url is null or (image_url ~ '^https://[^ ]+$' and char_length(image_url) <= 500));
alter table service_families add column if not exists image_alt text
  check (image_alt is null or char_length(image_alt) <= 200);

create or replace function public.set_family_image(p_family uuid, p_url text, p_alt text default null)
returns void language plpgsql security definer set search_path = public as $$
declare f service_families;
begin
  if not is_super_admin() then raise exception 'Only a super admin can manage the catalogue.'; end if;
  select * into f from service_families where id = p_family for update;
  if f.id is null then raise exception 'Unknown family.'; end if;
  if nullif(trim(p_url), '') is not null and trim(p_url) !~ '^https://[^ ]+$' then raise exception 'The image link must start with https://'; end if;
  update service_families set image_url = nullif(trim(p_url), ''), image_alt = nullif(trim(p_alt), ''), updated_at = now() where id = f.id;
  perform log_action('catalogue.family_image', 'service_family', f.id, jsonb_build_object('key', f.key),
    jsonb_build_object('image_url', f.image_url), jsonb_build_object('image_url', nullif(trim(p_url), '')));
end $$;
revoke execute on function public.set_family_image(uuid, text, text) from public, anon;
grant execute on function public.set_family_image(uuid, text, text) to authenticated;

create or replace function public.catalogue()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', f.id, 'key', f.key, 'name', f.name, 'description', f.description, 'icon_key', f.icon_key,
    'image_url', f.image_url, 'image_alt', f.image_alt,
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
    and exists (select 1 from catalogue_services s where s.family_id = f.id and s.status = 'published' and s.current_version > 0);
$$;
revoke execute on function public.catalogue() from public, anon;
grant execute on function public.catalogue() to authenticated;
select public.refresh_profile_grants();
