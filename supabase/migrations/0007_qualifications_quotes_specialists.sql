-- 0007 — sample catalogue, PM qualifications and assessments, specialists, quote revisions, PM profile for customers.
-- Safe to run more than once. Depends on 0001-0006.

-- 1. Skills and what each Personal Manager has been verified for ------------------------------------------------------
create table if not exists skills (
  key text primary key check (key ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  name text not null,
  regulated boolean not null default false,     -- safety-critical: only an admin-verified qualification counts
  active boolean not null default true
);
insert into skills (key, name, regulated) values
  ('tech-support', 'Everyday tech support', false),
  ('companionship', 'Companionship and accompaniment', false),
  ('errands', 'Errands and shopping', false),
  ('assembly', 'Assembly and installation', false),
  ('organising', 'Home organisation', false),
  ('home-repair-coordination', 'Home repair coordination', false),
  ('regulated-electrical', 'Electrical work (regulated)', true),
  ('regulated-plumbing', 'Plumbing work (regulated)', true)
on conflict (key) do nothing;
alter table skills enable row level security;
drop policy if exists "skills: everyone signed in" on skills;
create policy "skills: everyone signed in" on skills for select using (auth.uid() is not null);
revoke insert, update, delete, truncate on skills from anon, authenticated;

create table if not exists pm_qualifications (
  worker_id uuid not null references profiles (id) on delete cascade,
  skill_key text not null references skills (key),
  source text not null default 'self_reported' check (source in ('self_reported', 'interview', 'assessment', 'document')),
  status text not null default 'claimed' check (status in ('claimed', 'verified', 'revoked')),
  level int not null default 1 check (level between 1 and 5),
  verified_by uuid references profiles (id) on delete set null,
  verified_at timestamptz,
  expires_at timestamptz,
  note text check (note is null or char_length(note) <= 500),
  primary key (worker_id, skill_key)
);
alter table pm_qualifications enable row level security;
drop policy if exists "qualifications: own and admin" on pm_qualifications;
create policy "qualifications: own and admin" on pm_qualifications for select using (worker_id = auth.uid() or is_admin());
revoke insert, update, delete, truncate on pm_qualifications from anon, authenticated;

-- Is this PM verified (and unexpired) for a skill? A regulated skill needs an admin or assessment, never a self-report.
create or replace function public.pm_has_skill(p_worker uuid, p_skill text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from pm_qualifications q join skills s on s.key = q.skill_key
     where q.worker_id = p_worker and q.skill_key = p_skill and q.status = 'verified'
       and (q.expires_at is null or q.expires_at > now())
       and (not s.regulated or q.source in ('interview', 'assessment', 'document')));
$$;
revoke execute on function public.pm_has_skill(uuid, text) from public, anon, authenticated;

-- Skills a task needs that this PM lacks. Empty = eligible.
create or replace function public.pm_missing_skills(p_worker uuid, p_task uuid)
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(s.key order by s.key), '{}')
    from tasks t, jsonb_array_elements_text(case when jsonb_typeof(t.service_snapshot -> 'required_skills') = 'array' then t.service_snapshot -> 'required_skills' else '[]'::jsonb end) s(key)
   where t.id = p_task and not pm_has_skill(p_worker, s.key);
$$;
revoke execute on function public.pm_missing_skills(uuid, uuid) from public, anon, authenticated;

-- PMs may claim a skill about themselves (shown as "self-reported"); only admins verify.
create or replace function public.claim_skill(p_skill text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and role = 'worker') then raise exception 'Personal Managers only.'; end if;
  if not exists (select 1 from skills where key = p_skill and active) then raise exception 'Unknown skill.'; end if;
  insert into pm_qualifications (worker_id, skill_key, source, status, note) values (auth.uid(), p_skill, 'self_reported', 'claimed', left(p_note, 500))
  on conflict (worker_id, skill_key) do update set note = excluded.note
   where pm_qualifications.status = 'claimed';
end $$;

create or replace function public.set_pm_qualification(p_worker uuid, p_skill text, p_status text, p_level int default 1,
  p_source text default 'interview', p_expires_at timestamptz default null, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare old pm_qualifications;
begin
  if not is_super_admin() then raise exception 'Only a super admin can verify qualifications.'; end if;
  if p_status not in ('claimed', 'verified', 'revoked') then raise exception 'Unknown status.'; end if;
  if p_source not in ('self_reported', 'interview', 'assessment', 'document') then raise exception 'Unknown source.'; end if;
  if not exists (select 1 from profiles where id = p_worker and role = 'worker') then raise exception 'Not a Personal Manager.'; end if;
  if not exists (select 1 from skills where key = p_skill) then raise exception 'Unknown skill.'; end if;
  select * into old from pm_qualifications where worker_id = p_worker and skill_key = p_skill;
  insert into pm_qualifications (worker_id, skill_key, source, status, level, verified_by, verified_at, expires_at, note)
  values (p_worker, p_skill, p_source, p_status, p_level, case when p_status = 'verified' then auth.uid() end,
          case when p_status = 'verified' then now() end, p_expires_at, left(p_note, 500))
  on conflict (worker_id, skill_key) do update set source = excluded.source, status = excluded.status, level = excluded.level,
    verified_by = excluded.verified_by, verified_at = excluded.verified_at, expires_at = excluded.expires_at, note = excluded.note;
  perform log_action('pm.qualification', 'profile', p_worker, jsonb_build_object('skill', p_skill),
    case when old.worker_id is not null then jsonb_build_object('status', old.status, 'source', old.source) end,
    jsonb_build_object('status', p_status, 'source', p_source, 'level', p_level, 'expires_at', p_expires_at));
  perform notify_user(p_worker, 'application', 'Your qualifications were updated', p_skill || ': ' || p_status, null);
end $$;

-- 2. Interviews and in-app assessments ---------------------------------------------------------------------------------
create table if not exists pm_interviews (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references profiles (id) on delete cascade,
  outcome text not null check (outcome in ('scheduled', 'passed', 'failed', 'no_show')),
  notes text check (notes is null or char_length(notes) <= 2000),
  recorded_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table pm_interviews enable row level security;
drop policy if exists "interviews: admins" on pm_interviews;
create policy "interviews: admins" on pm_interviews for select using (is_admin());
revoke insert, update, delete, truncate on pm_interviews from anon, authenticated;

create or replace function public.record_interview(p_worker uuid, p_outcome text, p_notes text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_super_admin() then raise exception 'Only a super admin can record interviews.'; end if;
  if not exists (select 1 from profiles where id = p_worker and role = 'worker') then raise exception 'Not a Personal Manager.'; end if;
  insert into pm_interviews (worker_id, outcome, notes, recorded_by) values (p_worker, p_outcome, left(p_notes, 2000), auth.uid());
  perform log_action('pm.interview', 'profile', p_worker, jsonb_build_object('outcome', p_outcome));
end $$;

-- Assessment definitions hold the answer key, so only admins read the table.
-- fee_enabled is forced off: no payment integration exists for assessments.
create table if not exists assessments (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z0-9][a-z0-9-]{1,60}$'),
  name text not null,
  skill_key text not null references skills (key),
  level int not null default 1 check (level between 1 and 5),
  questions jsonb not null,                      -- [{id, text, options:[...], correct: <index>}]
  pass_percent int not null default 80 check (pass_percent between 1 and 100),
  validity_days int check (validity_days is null or validity_days > 0),
  max_attempts_per_day int not null default 3,
  fee_amount numeric(10,2) check (fee_amount is null or fee_amount >= 0),
  fee_enabled boolean not null default false check (not fee_enabled),
  active boolean not null default false,
  created_at timestamptz not null default now()
);
alter table assessments enable row level security;
drop policy if exists "assessments: admins" on assessments;
create policy "assessments: admins" on assessments for select using (is_admin());
revoke insert, update, delete, truncate on assessments from anon, authenticated;

create table if not exists assessment_attempts (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references assessments (id),
  worker_id uuid not null references profiles (id) on delete cascade,
  score_percent int not null,
  passed boolean not null,
  taken_at timestamptz not null default now()
);
alter table assessment_attempts enable row level security;
drop policy if exists "attempts: own and admin" on assessment_attempts;
create policy "attempts: own and admin" on assessment_attempts for select using (worker_id = auth.uid() or is_admin());
revoke insert, update, delete, truncate on assessment_attempts from anon, authenticated;

create or replace function public.assessment_problems(q jsonb)
returns text[] language plpgsql immutable as $$
declare e jsonb; n int := 0; probs text[] := '{}';
begin
  if q is null or jsonb_typeof(q) <> 'array' or jsonb_array_length(q) not between 1 and 50 then return array['Add between 1 and 50 questions.']; end if;
  for e in select * from jsonb_array_elements(q) loop
    n := n + 1;
    if char_length(coalesce(e ->> 'text', '')) < 3 then probs := array_append(probs, format('Question %s needs text.', n)); end if;
    if jsonb_typeof(e -> 'options') is distinct from 'array' or jsonb_array_length(e -> 'options') < 2 then
      probs := array_append(probs, format('Question %s needs at least two options.', n));
    elsif (e ->> 'correct') !~ '^[0-9]+$' or (e ->> 'correct')::int >= jsonb_array_length(e -> 'options') then
      probs := array_append(probs, format('Question %s needs a correct answer.', n));
    end if;
  end loop;
  return probs;
end $$;

create or replace function public.save_assessment(p_key text, p_name text, p_skill text, p_level int, p_questions jsonb,
  p_pass_percent int default 80, p_validity_days int default null, p_active boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare rid uuid; probs text[];
begin
  if not is_super_admin() then raise exception 'Only a super admin can manage assessments.'; end if;
  probs := assessment_problems(p_questions);
  if array_length(probs, 1) > 0 then raise exception '%', array_to_string(probs, ' '); end if;
  insert into assessments (key, name, skill_key, level, questions, pass_percent, validity_days, active)
  values (p_key, trim(p_name), p_skill, coalesce(p_level, 1), p_questions, coalesce(p_pass_percent, 80), p_validity_days, coalesce(p_active, false))
  on conflict (key) do update set name = excluded.name, skill_key = excluded.skill_key, level = excluded.level, questions = excluded.questions,
    pass_percent = excluded.pass_percent, validity_days = excluded.validity_days, active = excluded.active
  returning id into rid;
  perform log_action('assessment.saved', 'assessment', rid, jsonb_build_object('key', p_key, 'active', p_active));
  return rid;
end $$;

-- What a Personal Manager is shown: the questions, never the answers.
create or replace function public.available_assessments()
returns table (id uuid, key text, name text, skill_key text, level int, pass_percent int, questions jsonb, passed boolean)
language sql stable security definer set search_path = public as $$
  select a.id, a.key, a.name, a.skill_key, a.level, a.pass_percent,
         (select jsonb_agg(jsonb_build_object('id', ord, 'text', e ->> 'text', 'options', e -> 'options') order by ord)
            from jsonb_array_elements(a.questions) with ordinality t(e, ord)),
         exists (select 1 from assessment_attempts x where x.assessment_id = a.id and x.worker_id = auth.uid() and x.passed)
    from assessments a
   where a.active and exists (select 1 from profiles where id = auth.uid() and role = 'worker');
$$;

-- Grades on the server. A pass records a verified qualification for that skill only.
create or replace function public.submit_assessment(p_assessment uuid, p_answers jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a assessments; total int; right_ int := 0; e jsonb; ord int; pct int; ok boolean; skill skills;
begin
  if not exists (select 1 from profiles where id = auth.uid() and role = 'worker') then raise exception 'Personal Managers only.'; end if;
  select * into a from assessments where id = p_assessment and active;
  if a.id is null then raise exception 'That assessment is not available.'; end if;
  if jsonb_typeof(p_answers) <> 'array' then raise exception 'Answer every question.'; end if;
  if (select count(*) from assessment_attempts where assessment_id = a.id and worker_id = auth.uid() and taken_at > now() - interval '1 day') >= a.max_attempts_per_day then
    raise exception 'You have used today''s attempts. Try again tomorrow.';
  end if;
  total := jsonb_array_length(a.questions);
  if jsonb_array_length(p_answers) <> total then raise exception 'Answer every question.'; end if;
  for e, ord in select q, o::int from jsonb_array_elements(a.questions) with ordinality t(q, o) loop
    if (p_answers ->> (ord - 1)) = (e ->> 'correct') then right_ := right_ + 1; end if;
  end loop;
  pct := (right_ * 100) / total;
  ok := pct >= a.pass_percent;
  insert into assessment_attempts (assessment_id, worker_id, score_percent, passed) values (a.id, auth.uid(), pct, ok);
  if ok then
    select * into skill from skills where key = a.skill_key;
    insert into pm_qualifications (worker_id, skill_key, source, status, level, verified_at, expires_at, note)
    values (auth.uid(), a.skill_key, 'assessment', 'verified', a.level, now(),
            case when a.validity_days is not null then now() + make_interval(days => a.validity_days) end, 'Passed: ' || a.name)
    on conflict (worker_id, skill_key) do update set source = 'assessment', status = 'verified', level = greatest(pm_qualifications.level, excluded.level),
      verified_at = now(), expires_at = excluded.expires_at, note = excluded.note
     where pm_qualifications.status <> 'revoked';          -- an admin's revocation is not undone by a test
    perform log_action('pm.assessment_passed', 'profile', auth.uid(), jsonb_build_object('assessment', a.key, 'score', pct));
  end if;
  return jsonb_build_object('passed', ok, 'score_percent', pct, 'pass_percent', a.pass_percent);
end $$;

-- 3. Eligibility is enforced where PMs are chosen and where they accept ---------------------------------------------------
drop function if exists public.shortlist_workers(uuid);
create or replace function public.shortlist_workers(p_task uuid)
returns table (
  id uuid, full_name text, rating numeric, rating_count int, jobs_done int,
  categories text[], service_area text, online boolean,
  category_match boolean, area_match boolean, declined boolean,
  active_jobs int, last_assigned_at timestamptz, eligible boolean, missing_skills text[], tier text
) language plpgsql stable security definer set search_path = public as $$
declare t tasks;
begin
  if not is_admin() then raise exception 'Admins only.'; end if;
  select * into t from tasks where tasks.id = p_task;
  if t.id is null then raise exception 'Task not found.'; end if;
  return query
  select p.id, p.full_name, p.rating, p.rating_count, p.jobs_done, p.categories, p.service_area, p.online,
    t.category = any (coalesce(p.categories, '{}')) as category_match,
    (p.service_area is not null and t.location ilike '%' || p.service_area || '%') as area_match,
    exists (select 1 from task_declines d where d.task_id = t.id and d.worker_id = p.id) as declined,
    (select count(*)::int from tasks a where a.assigned_worker_id = p.id and a.status in ('matched', 'assigned', 'in_progress')) as active_jobs,
    p.last_assigned_at,
    coalesce(array_length(pm_missing_skills(p.id, t.id), 1), 0) = 0 as eligible,
    pm_missing_skills(p.id, t.id) as missing_skills,
    p.tier
  from profiles p
  where p.role = 'worker' and p.worker_status = 'approved'
  order by 14 desc, 9 desc, 11 asc, 8 desc, 10 desc, 3 desc nulls last, 12 asc, 13 asc nulls first;
end $$;
revoke execute on function public.shortlist_workers(uuid) from public, anon;
grant execute on function public.shortlist_workers(uuid) to authenticated;

create or replace function public.assign_task(p_task uuid, p_worker uuid)
returns void language plpgsql security definer set search_path = public as $$
declare t tasks; w profiles; missing text[];
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

  update tasks set assigned_worker_id = p_worker, status = 'matched', assigned_at = now(), accepted_at = null where id = p_task;
  update profiles set last_assigned_at = now() where id = p_worker;
  perform log_action(case when t.assigned_worker_id is null then 'task.assigned' else 'task.reassigned' end,
    'task', p_task, jsonb_build_object('worker_id', p_worker, 'worker_name', w.full_name,
                                       'previous_worker_id', t.assigned_worker_id, 'title', t.title),
    jsonb_build_object('assigned_worker_id', t.assigned_worker_id, 'status', t.status),
    jsonb_build_object('assigned_worker_id', p_worker, 'status', 'matched'));
end $$;

create or replace function public.accept_task(p_task uuid)
returns void language plpgsql security definer set search_path = public as $$
declare t tasks; missing text[];
begin
  select * into t from tasks where id = p_task for update;
  if t.id is null or t.assigned_worker_id is distinct from auth.uid() then raise exception 'Not your task.'; end if;
  if t.status <> 'matched' then raise exception 'Task is %; nothing to accept.', t.status; end if;
  missing := pm_missing_skills(auth.uid(), p_task);
  if array_length(missing, 1) > 0 then
    raise exception 'This task needs a verified qualification you do not have yet: %.', array_to_string(missing, ', ');
  end if;
  update tasks set status = 'assigned', accepted_at = now() where id = p_task;
  perform log_action('task.accepted', 'task', p_task, jsonb_build_object('title', t.title));
end $$;

-- A service can only require skills that exist.
create or replace function public.service_readiness(p_service uuid)
returns text[] language plpgsql stable security definer set search_path = public as $$
declare s catalogue_services; fam service_families; probs text[]; sk text;
begin
  if not is_admin() then raise exception 'Admins only.'; end if;
  select * into s from catalogue_services where id = p_service;
  if s.id is null then raise exception 'Unknown service.'; end if;
  probs := service_problems(s.draft);
  for sk in select jsonb_array_elements_text(case when jsonb_typeof(s.draft -> 'required_skills') = 'array' then s.draft -> 'required_skills' else '[]'::jsonb end) loop
    if not exists (select 1 from skills where key = sk and active) then probs := array_append(probs, format('Unknown skill "%s".', sk)); end if;
  end loop;
  select * into fam from service_families where id = s.family_id;
  if fam.status <> 'published' then probs := array_append(probs, 'Its family is not published, so customers would not see it.'); end if;
  return probs;
end $$;

create or replace function public.publish_service(p_service uuid)
returns int language plpgsql security definer set search_path = public as $$
declare s catalogue_services; probs text[]; v int;
begin
  if not is_super_admin() then raise exception 'Only a super admin can publish services.'; end if;
  select * into s from catalogue_services where id = p_service for update;
  if s.id is null then raise exception 'Unknown service.'; end if;
  probs := service_readiness(p_service);
  probs := array(select p from unnest(probs) p where p not like 'Its family is not published%');
  if array_length(probs, 1) > 0 then raise exception 'Not ready to publish: %', array_to_string(probs, ' '); end if;
  v := s.current_version + 1;
  insert into catalogue_service_versions (service_id, version, definition, published_by) values (s.id, v, s.draft, auth.uid());
  update catalogue_services set current_version = v, status = 'published', updated_at = now() where id = s.id;
  perform log_action('catalogue.service_published', 'service', s.id, jsonb_build_object('key', s.key, 'version', v),
    jsonb_build_object('version', s.current_version, 'pricing', (select definition -> 'pricing' from catalogue_service_versions where service_id = s.id and version = s.current_version)),
    jsonb_build_object('version', v, 'pricing', s.draft -> 'pricing'));
  return v;
end $$;

-- 4. Specialists: the people a Personal Manager coordinates --------------------------------------------------------------
create table if not exists specialists (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  skill_key text not null references skills (key),
  verified boolean not null default false,       -- licence / credentials checked by an admin
  verification_note text check (verification_note is null or char_length(verification_note) <= 500),
  regions text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists specialist_contacts (   -- private to admins
  specialist_id uuid primary key references specialists (id) on delete cascade,
  phone text
);
alter table specialists enable row level security;
alter table specialist_contacts enable row level security;
drop policy if exists "specialists: admins" on specialists;
create policy "specialists: admins" on specialists for select using (is_admin());
drop policy if exists "specialist contacts: super admins" on specialist_contacts;
create policy "specialist contacts: super admins" on specialist_contacts for select using (is_super_admin());
revoke insert, update, delete, truncate on specialists, specialist_contacts from anon, authenticated;

create or replace function public.save_specialist(p_id uuid, p_name text, p_skill text, p_verified boolean, p_note text, p_phone text, p_active boolean default true)
returns uuid language plpgsql security definer set search_path = public as $$
declare rid uuid := p_id;
begin
  if not is_super_admin() then raise exception 'Only a super admin can manage specialists.'; end if;
  if rid is null then
    insert into specialists (name, skill_key, verified, verification_note, active) values (trim(p_name), p_skill, coalesce(p_verified, false), left(p_note, 500), coalesce(p_active, true)) returning id into rid;
  else
    update specialists set name = trim(p_name), skill_key = p_skill, verified = coalesce(p_verified, false), verification_note = left(p_note, 500), active = coalesce(p_active, true) where id = rid;
  end if;
  insert into specialist_contacts (specialist_id, phone) values (rid, nullif(trim(p_phone), '')) on conflict (specialist_id) do update set phone = excluded.phone;
  perform log_action('specialist.saved', 'specialist', rid, jsonb_build_object('skill', p_skill, 'verified', coalesce(p_verified, false)));
  return rid;
end $$;

create table if not exists task_specialist_jobs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks (id) on delete cascade,
  specialist_id uuid not null references specialists (id),
  status text not null default 'requested' check (status in ('requested', 'quoted', 'scheduled', 'visited', 'completed', 'failed')),
  scheduled_at timestamptz,
  note text check (note is null or char_length(note) <= 1000),
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table task_specialist_jobs enable row level security;
drop policy if exists "specialist jobs: involved" on task_specialist_jobs;
create policy "specialist jobs: involved" on task_specialist_jobs for select using (
  is_admin() or exists (select 1 from tasks t where t.id = task_id and (t.assigned_worker_id = auth.uid() or t.customer_id = auth.uid())));
revoke insert, update, delete, truncate on task_specialist_jobs from anon, authenticated;

-- Regulated work (a specialist skill marked regulated) only goes to a verified specialist.
create or replace function public.assign_specialist(p_task uuid, p_specialist uuid, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare t tasks; sp specialists; sk skills; jid uuid;
begin
  select * into t from tasks where id = p_task for update;
  if t.id is null then raise exception 'Task not found.'; end if;
  if not (is_admin() or t.assigned_worker_id = auth.uid()) then raise exception 'Not allowed.'; end if;
  if t.status not in ('assigned', 'in_progress') then raise exception 'A specialist can be arranged once the task is accepted.'; end if;
  select * into sp from specialists where id = p_specialist and active;
  if sp.id is null then raise exception 'That specialist is not available.'; end if;
  select * into sk from skills where key = sp.skill_key;
  if sk.regulated and not sp.verified then raise exception 'This is regulated work. Only a verified specialist can be used.'; end if;
  insert into task_specialist_jobs (task_id, specialist_id, note, created_by) values (t.id, sp.id, left(p_note, 1000), auth.uid()) returning id into jid;
  perform log_action('task.specialist_assigned', 'task', t.id, jsonb_build_object('specialist', sp.id, 'skill', sp.skill_key));
  return jid;
end $$;

create or replace function public.set_specialist_job(p_job uuid, p_status text, p_scheduled_at timestamptz default null, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare j task_specialist_jobs; t tasks;
begin
  select * into j from task_specialist_jobs where id = p_job for update;
  if j.id is null then raise exception 'Unknown job.'; end if;
  select * into t from tasks where id = j.task_id;
  if not (is_admin() or t.assigned_worker_id = auth.uid()) then raise exception 'Not allowed.'; end if;
  if p_status not in ('requested', 'quoted', 'scheduled', 'visited', 'completed', 'failed') then raise exception 'Unknown status.'; end if;
  update task_specialist_jobs set status = p_status, scheduled_at = coalesce(p_scheduled_at, scheduled_at), note = coalesce(left(p_note, 1000), note), updated_at = now() where id = j.id;
  perform log_action('task.specialist_job', 'task', t.id, jsonb_build_object('job', j.id), jsonb_build_object('status', j.status), jsonb_build_object('status', p_status));
  -- A specialist finishing a visit never completes the customer's task: only complete_task does that.
end $$;

-- 5. Quote revisions: the price changes only with the right approvals, and history stays --------------------------------
insert into platform_settings (key, value, description) values
  ('quote_requires_admin', 'true', 'A revised quote needs an admin approval before the customer is asked')
on conflict (key) do nothing;

create table if not exists task_quotes (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks (id) on delete cascade,
  version int not null,
  components jsonb not null,                      -- [{label, amount, kind: management_fee|specialist|extra_work|tax|discount}]
  total numeric(10,2) not null check (total >= 0),
  base_total numeric(10,2),                       -- the price in force when this was proposed
  reason text not null check (char_length(reason) between 10 and 2000),
  status text not null default 'proposed' check (status in ('proposed', 'admin_approved', 'customer_approved', 'rejected', 'superseded', 'withdrawn')),
  proposed_by uuid not null references profiles (id),
  admin_by uuid references profiles (id) on delete set null,
  admin_at timestamptz,
  admin_note text,
  customer_at timestamptz,
  created_at timestamptz not null default now(),
  unique (task_id, version)
);
alter table task_quotes enable row level security;
drop policy if exists "quotes: involved" on task_quotes;
create policy "quotes: involved" on task_quotes for select using (
  is_admin() or exists (select 1 from tasks t where t.id = task_id and
    (t.assigned_worker_id = auth.uid() or (t.customer_id = auth.uid() and task_quotes.status in ('admin_approved', 'customer_approved', 'rejected', 'superseded')
       and (task_quotes.admin_at is not null or not setting_bool('quote_requires_admin', true))))));
revoke insert, update, delete, truncate on task_quotes from anon, authenticated;

create or replace function public.quote_problem(c jsonb)
returns text language plpgsql immutable as $$
declare e jsonb; sum_ numeric := 0;
begin
  if jsonb_typeof(c) <> 'array' or jsonb_array_length(c) not between 1 and 20 then return 'Add between 1 and 20 price lines.'; end if;
  for e in select * from jsonb_array_elements(c) loop
    if coalesce(e ->> 'kind', '') not in ('management_fee', 'specialist', 'extra_work', 'tax', 'discount') then return 'Each line needs a valid type.'; end if;
    if char_length(coalesce(e ->> 'label', '')) not between 1 and 120 then return 'Each line needs a label.'; end if;
    if (e ->> 'amount') !~ '^-?[0-9]+(\.[0-9]{1,2})?$' then return 'Each line needs an amount.'; end if;
    if (e ->> 'kind') = 'discount' and (e ->> 'amount')::numeric > 0 then return 'A discount must be a negative amount.'; end if;
    if (e ->> 'kind') <> 'discount' and (e ->> 'amount')::numeric < 0 then return 'Only discounts can be negative.'; end if;
    sum_ := sum_ + (e ->> 'amount')::numeric;
  end loop;
  if sum_ < 0 then return 'The total cannot be negative.'; end if;
  return null;
end $$;

create or replace function public.propose_quote(p_task uuid, p_components jsonb, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare t tasks; prob text; v int; qid uuid; tot numeric;
begin
  select * into t from tasks where id = p_task for update;
  if t.id is null then raise exception 'Task not found.'; end if;
  if not (is_admin() or t.assigned_worker_id = auth.uid()) then raise exception 'Not allowed.'; end if;
  if t.status not in ('assigned', 'in_progress') then raise exception 'A revised quote can be proposed while the task is under way.'; end if;
  prob := quote_problem(p_components);
  if prob is not null then raise exception '%', prob; end if;
  if not rate_limit_self('propose_quote', 10, 3600) then raise exception 'Too many quotes. Please wait a little.'; end if;
  select coalesce(sum((e ->> 'amount')::numeric), 0) into tot from jsonb_array_elements(p_components) e;
  select coalesce(max(version), 0) + 1 into v from task_quotes where task_id = t.id;
  update task_quotes set status = 'superseded' where task_id = t.id and status in ('proposed', 'admin_approved');
  insert into task_quotes (task_id, version, components, total, base_total, reason, proposed_by)
  values (t.id, v, p_components, tot, coalesce(t.est_cost, t.rate_per_day), trim(p_reason), auth.uid()) returning id into qid;
  perform log_action('task.quote_proposed', 'task', t.id, jsonb_build_object('quote', qid, 'version', v),
    jsonb_build_object('price', coalesce(t.est_cost, t.rate_per_day)), jsonb_build_object('proposed_total', tot));
  perform notify_admins('task', 'A revised quote needs review', t.title, t.id);
  return qid;
end $$;

create or replace function public.decide_quote_admin(p_quote uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare q task_quotes; t tasks;
begin
  if not is_admin() then raise exception 'Admins only.'; end if;
  select * into q from task_quotes where id = p_quote for update;
  if q.id is null then raise exception 'Unknown quote.'; end if;
  if (p_approve and q.status = 'admin_approved') or (not p_approve and q.status = 'rejected') then return; end if;
  if q.status <> 'proposed' then raise exception 'This quote has already been decided or replaced.'; end if;
  select * into t from tasks where id = q.task_id;
  update task_quotes set status = case when p_approve then 'admin_approved' else 'rejected' end, admin_by = auth.uid(), admin_at = now(), admin_note = left(p_note, 1000) where id = q.id;
  perform log_action('task.quote_admin_decision', 'task', t.id, jsonb_build_object('quote', q.id, 'note', left(p_note, 500)),
    jsonb_build_object('status', q.status), jsonb_build_object('status', case when p_approve then 'admin_approved' else 'rejected' end));
  if p_approve then
    perform notify_user(t.customer_id, 'task', 'Please review a revised price', t.title || ' — nothing changes until you agree.', t.id);
  else
    perform notify_user(q.proposed_by, 'task', 'Revised quote not approved', t.title, t.id);
  end if;
end $$;

create or replace function public.decide_quote_customer(p_quote uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = public as $$
declare q task_quotes; t tasks;
begin
  select * into q from task_quotes where id = p_quote for update;
  if q.id is null then raise exception 'Unknown quote.'; end if;
  select * into t from tasks where id = q.task_id for update;
  if t.customer_id is distinct from auth.uid() then raise exception 'This is not your task.'; end if;
  if (p_approve and q.status = 'customer_approved') or (not p_approve and q.status = 'rejected') then return; end if;
  if q.status = 'proposed' and not setting_bool('quote_requires_admin', true) then null;
  elsif q.status <> 'admin_approved' then raise exception 'This quote is not waiting for your decision.'; end if;
  if t.status not in ('assigned', 'in_progress') then raise exception 'The task is no longer open for a price change.'; end if;
  if not p_approve then
    update task_quotes set status = 'rejected', customer_at = now() where id = q.id;
    perform log_action('task.quote_customer_decision', 'task', t.id, jsonb_build_object('quote', q.id), null, jsonb_build_object('decision', 'rejected'));
    perform notify_user(q.proposed_by, 'task', 'The customer did not accept the revised price', t.title, t.id);
    perform notify_admins('task', 'Customer declined a revised quote', t.title, t.id);
    return;
  end if;
  -- Both approvals are on record: the price changes, the old quote stays in the history.
  update tasks set est_cost = case when t.task_type = 'one-time' then q.total else est_cost end,
                   rate_per_day = case when t.task_type = 'ongoing' then q.total else rate_per_day end,
                   price_status = 'confirmed', price_confirmed_at = now()
   where id = t.id;
  update task_quotes set status = 'customer_approved', customer_at = now() where id = q.id;
  perform log_action('task.quote_applied', 'task', t.id, jsonb_build_object('quote', q.id, 'version', q.version),
    jsonb_build_object('price', coalesce(t.est_cost, t.rate_per_day)), jsonb_build_object('price', q.total));
  perform notify_user(q.proposed_by, 'task', 'Revised price approved', t.title, t.id);
  perform notify_admins('task', 'Customer approved a revised quote', t.title, t.id);
end $$;

-- 6. What a customer may know about their Personal Manager -----------------------------------------------------------------
alter table profiles add column if not exists languages text[] not null default '{}';

create or replace function public.pm_public_profile(p_worker uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p profiles; result jsonb;
begin
  -- Only a customer with a task assigned to this PM (or an admin) may look.
  if not (is_admin() or exists (select 1 from tasks t where t.customer_id = auth.uid() and t.assigned_worker_id = p_worker
                                   and t.status in ('assigned', 'in_progress', 'completed'))) then
    raise exception 'You can see a Personal Manager''s profile once they have accepted your task.';
  end if;
  select * into p from profiles where id = p_worker and role = 'worker';
  if p.id is null then raise exception 'Not found.'; end if;
  select jsonb_build_object(
    'name', p.full_name, 'bio', p.bio, 'service_area', p.service_area, 'languages', p.languages, 'tier', p.tier,
    'experience_years_self_reported', p.experience_years,
    'completed_jobs', p.verified_jobs, 'rating', p.rating, 'rating_count', p.rating_count,
    'verified_skills', coalesce((select jsonb_agg(jsonb_build_object('skill', s.name, 'level', q.level, 'basis', q.source) order by s.name)
        from pm_qualifications q join skills s on s.key = q.skill_key
       where q.worker_id = p.id and q.status = 'verified' and (q.expires_at is null or q.expires_at > now())), '[]'),
    'claimed_skills', coalesce((select jsonb_agg(s.name order by s.name) from pm_qualifications q join skills s on s.key = q.skill_key
       where q.worker_id = p.id and q.status = 'claimed'), '[]'),
    'reviews', coalesce((select jsonb_agg(r order by r ->> 'date' desc) from (
        select jsonb_build_object('rating', t.customer_rating_of_worker, 'text', t.customer_review, 'date', t.completed_at,
                                  'by', split_part(c.full_name, ' ', 1)) r
          from tasks t join profiles c on c.id = t.customer_id
         where t.assigned_worker_id = p.id and t.status = 'completed' and t.customer_rating_of_worker is not null and t.customer_review is not null
         order by t.completed_at desc limit 10) x), '[]'))
  into result;
  return result;
end $$;

-- New profile columns must be readable by the apps (phone and email stay hidden).
select public.refresh_profile_grants();

-- 7. Who may call what -----------------------------------------------------------------------------------------------------------
revoke execute on function public.claim_skill(text, text) from public, anon;
revoke execute on function public.set_pm_qualification(uuid, text, text, int, text, timestamptz, text) from public, anon;
revoke execute on function public.record_interview(uuid, text, text) from public, anon;
revoke execute on function public.save_assessment(text, text, text, int, jsonb, int, int, boolean) from public, anon;
revoke execute on function public.available_assessments() from public, anon;
revoke execute on function public.submit_assessment(uuid, jsonb) from public, anon;
revoke execute on function public.save_specialist(uuid, text, text, boolean, text, text, boolean) from public, anon;
revoke execute on function public.assign_specialist(uuid, uuid, text) from public, anon;
revoke execute on function public.set_specialist_job(uuid, text, timestamptz, text) from public, anon;
revoke execute on function public.propose_quote(uuid, jsonb, text) from public, anon;
revoke execute on function public.decide_quote_admin(uuid, boolean, text) from public, anon;
revoke execute on function public.decide_quote_customer(uuid, boolean) from public, anon;
revoke execute on function public.pm_public_profile(uuid) from public, anon;
grant execute on function public.claim_skill(text, text) to authenticated;
grant execute on function public.set_pm_qualification(uuid, text, text, int, text, timestamptz, text) to authenticated;
grant execute on function public.record_interview(uuid, text, text) to authenticated;
grant execute on function public.save_assessment(text, text, text, int, jsonb, int, int, boolean) to authenticated;
grant execute on function public.available_assessments() to authenticated;
grant execute on function public.submit_assessment(uuid, jsonb) to authenticated;
grant execute on function public.save_specialist(uuid, text, text, boolean, text, text, boolean) to authenticated;
grant execute on function public.assign_specialist(uuid, uuid, text) to authenticated;
grant execute on function public.set_specialist_job(uuid, text, timestamptz, text) to authenticated;
grant execute on function public.propose_quote(uuid, jsonb, text) to authenticated;
grant execute on function public.decide_quote_admin(uuid, boolean, text) to authenticated;
grant execute on function public.decide_quote_customer(uuid, boolean) to authenticated;
grant execute on function public.pm_public_profile(uuid) to authenticated;

-- 8. SAMPLE catalogue ------------------------------------------------------------------------------------------------------------
-- Prices below are SAMPLES so there is something to try. They are not business
-- decisions: edit or unpublish any of them in More > Service catalogue. Each one
-- says so in the price note customers see. Inserted only once (by key), so
-- re-running this file never overwrites an edit.
do $$
declare
  rec record; sid uuid; fid uuid;
begin
  for rec in select * from (values
    ('everyday-tech', 'phone-setup', 'general', 'Phone setup', 'Set up a new phone: accounts, apps, contacts and settings.', 60, 'fixed', 499, '{tech-support}'::text[], false,
       '[{"id":"phone","type":"single_choice","label":"What kind of phone?","required":true,"options":["iPhone","Android"]},{"id":"transfer","type":"single_choice","label":"Move data from an old phone?","options":["Yes","No"]}]'::jsonb),
    ('everyday-tech', 'wifi-troubleshooting', 'general', 'Wi-Fi troubleshooting', 'Get your Wi-Fi working again or set up a new router.', 60, 'manual_quote', null, '{tech-support}', false,
       '[{"id":"router","type":"single_choice","label":"Do you have a router?","required":true,"options":["Yes","No"]},{"id":"router_model","type":"short_text","label":"Which router?","show_if":{"question":"router","equals":"Yes"}},{"id":"problem","type":"long_text","label":"What is happening?"}]'::jsonb),
    ('everyday-tech', 'printer-setup', 'general', 'Printer setup', 'Connect a printer to your phone and computer.', 45, 'fixed', 399, '{tech-support}', false,
       '[{"id":"printer","type":"short_text","label":"Printer make and model"}]'::jsonb),
    ('errands', 'parcel-collection', 'delivery', 'Parcel pick-up or drop', 'Collect or drop off a parcel or document.', 60, 'fixed', 249, '{errands}', false,
       '[{"id":"from","type":"address","label":"Pick up from","required":true},{"id":"to","type":"address","label":"Deliver to","required":true}]'::jsonb),
    ('errands', 'shopping-assistance', 'care', 'Shopping assistance', 'Groceries, medicines or other shopping from a list.', 90, 'fixed', 299, '{errands}', false,
       '[{"id":"list","type":"long_text","label":"Your list","required":true}]'::jsonb),
    ('assistance', 'accompany-appointment', 'care', 'Accompany to an appointment', 'Someone to go with you or a relative to an appointment and help with practical tasks. Not medical care.', 120, 'fixed', 599, '{companionship}', false,
       '[{"id":"where","type":"address","label":"Where is the appointment?","required":true},{"id":"mobility","type":"single_choice","label":"Any mobility needs?","options":["None","Walking stick","Wheelchair"]}]'::jsonb),
    ('setup-organise', 'furniture-assembly', 'handyman', 'Furniture assembly', 'Put together flat-pack furniture.', 90, 'fixed', 599, '{assembly}', false,
       '[{"id":"items","type":"long_text","label":"What needs assembling?","required":true}]'::jsonb),
    ('setup-organise', 'home-organisation', 'general', 'Home organisation', 'Sort and organise a room or cupboard.', 120, 'manual_quote', null, '{organising}', false,
       '[{"id":"area","type":"short_text","label":"Which room or area?","required":true}]'::jsonb)
  ) as v(fam, skey, cat, title, descr, mins, approach, price, skills, specialist, questions)
  loop
    continue when exists (select 1 from catalogue_services where key = rec.skey);
    select id into fid from service_families where key = rec.fam;
    continue when fid is null;
    insert into catalogue_services (key, family_id, category, status, current_version, draft)
    values (rec.skey, fid, rec.cat, 'published', 1, jsonb_build_object(
      'title', rec.title, 'description', rec.descr, 'duration_minutes', rec.mins, 'required_skills', to_jsonb(rec.skills),
      'requires_specialist', rec.specialist, 'questions', rec.questions,
      'pricing', jsonb_strip_nulls(jsonb_build_object('approach', rec.approach, 'price', rec.price, 'currency', 'INR',
        'explanation', case when rec.approach = 'fixed' then 'Sample price. An admin can change it.' else 'Our team prices this after reviewing your request. You confirm the price before any work starts.' end))))
    returning id into sid;
    insert into catalogue_service_versions (service_id, version, definition) select id, 1, draft from catalogue_services where id = sid;
  end loop;
end $$;
