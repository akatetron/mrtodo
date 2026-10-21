-- Demo helper: verifies the demo Personal Manager (rakesh@example.com) for the
-- everyday, non-regulated skills, so the sample catalogue services can be
-- assigned to and accepted by them. Regulated skills (electrical, plumbing) are
-- left unverified on purpose. Needs migration 0007. Safe to run more than once.
do $$
declare w uuid;
begin
  if to_regclass('public.pm_qualifications') is null then
    raise notice 'Run the database update (schema.sql) first.'; return;
  end if;
  select id into w from profiles where email = 'rakesh@example.com';
  if w is null then raise notice 'The demo Personal Manager does not exist.'; return; end if;
  insert into pm_qualifications (worker_id, skill_key, source, status, level, verified_at, expires_at, note)
  select w, key, 'interview', 'verified', 2, now(), now() + interval '1 year', 'Demo account'
    from skills where not regulated
  on conflict (worker_id, skill_key) do update set status = 'verified', source = 'interview', expires_at = now() + interval '1 year';
end $$;
