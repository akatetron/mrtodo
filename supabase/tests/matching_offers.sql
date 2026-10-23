-- Vehicle eligibility, customer-gender matching policy, and automatic assignment offers.
-- Gender mappings and every number here are test fixtures; the product ships with the policy OFF and EMPTY.
\i helpers.sql
select seed_people();
update platform_settings set value = '500' where key = 'max_tasks_per_hour';
create function public.local_ts(d date, t time, tz text) returns timestamptz language sql immutable as $$ select (d + t) at time zone tz $$;
create function public.offered_to(ttl text) returns uuid language sql security definer as $$
  select o.worker_id from assignment_offers o join tasks t on t.id = o.task_id where t.title = ttl and o.status = 'pending' $$;
create function public.task_of(ttl text) returns uuid language sql security definer as $$ select id from tasks where title = ttl $$;
create function public.offer_of(ttl text, w uuid) returns uuid language sql security definer as $$
  select o.id from assignment_offers o join tasks t on t.id = o.task_id where t.title = ttl and o.worker_id = w $$;
create function public.mk(ttl text, d date, t time, mins int default 60, loc text default 'Flat 1, Kandivali West') returns void language plpgsql as $$
begin
  insert into tasks (customer_id, title, category, location, template_id, region_code, scheduled_at, est_minutes)
  values (auth.uid(), ttl, 'handyman', loc, (select id from task_templates where key = 'fix-leaking-tap'), 'IN-T', local_ts(d, t, 'Asia/Kolkata'), mins);
end $$;
select ((current_date + 20) - extract(dow from current_date + 20)::int + 1) as monday \gset

:as_AD;
select save_region('{"code":"IN-T","name":"Test India","currency":"INR","timezone":"Asia/Kolkata","status":"active"}');
:as_P;
select set_working_hours(null, (select jsonb_agg(jsonb_build_object('weekday', d, 'start', '06:00', 'end', '23:30')) from generate_series(1, 5) d));
select set_pm_regions(null, array['IN-T']);
select set_pm_vehicles(null, array['two_wheeler'], true);
:as_Q;
select set_working_hours(null, (select jsonb_agg(jsonb_build_object('weekday', d, 'start', '06:00', 'end', '20:00')) from generate_series(1, 5) d));
select set_pm_regions(null, array['IN-T']);
select set_pm_vehicles(null, array[]::text[], false);

-- ============================================================ the default is the existing behaviour: no offers
:as_C;
select mk('Off mode', :'monday', '10:00');
:as_db;
select chk((select assignment_state = 'none' from tasks where title = 'Off mode') and (select count(*) = 0 from assignment_offers), 'automatic offers are off by default: nothing is offered');
:as_P;
select chk((select count(*) = 1 from pm_task_feed() where title = 'Off mode'), 'and the job feed works exactly as before');
:as_AD;
select expect_error($$select set_setting('auto_assign_mode', '1')$$, 'the mode must be a text value');
:as_SU;
select expect_error($$select set_setting('auto_assign_mode', '"offers"')$$, 'a support admin cannot switch automatic offers on');
:as_AD;
select set_setting('auto_assign_mode', '"offers"');
:as_db;
update profiles set last_assigned_at = now() where id = :'U_P';          -- so Q ranks first on fairness

-- ============================================================ an offer, not an assignment
:as_C;
select mk('Offer 1', :'monday', '10:00');
:as_db;
select chk((select assignment_state = 'offering' and status = 'requested' and assigned_worker_id is null from tasks where title = 'Offer 1'), 'the system offers the task: it is not assigned');
select chk(offered_to('Offer 1') = :'U_Q', 'the offer goes to the highest-ranked eligible PM (Q: fewer recent tasks)');
select chk((select attempt = 1 and rank_score is not null and rank_detail ? 'fairness' and rank_detail ? 'weights' from assignment_offers where task_id = task_of('Offer 1')), 'the ranking is explainable and stored with the offer');
select chk((select expires_at > now() + interval '10 minutes' and expires_at < now() + interval '20 minutes' from assignment_offers where task_id = task_of('Offer 1')), 'the offer expires after the configured time (15 minutes)');
select chk((select count(*) = 1 from notifications where user_id = :'U_Q' and title = 'A task is offered to you'), 'the PM is told about the offer');
select chk((select count(*) = 0 from notifications where user_id = :'U_C' and title = 'A Personal Manager accepted your task'), 'the customer is not told a PM is assigned while the offer is pending');
:as_C;
select chk((select assigned_worker_id is null and status = 'requested' from tasks where title = 'Offer 1'), 'the customer sees no assigned PM while the offer is pending');
select chk((select count(*) = 0 from assignment_offers), 'customers cannot read offers');
:as_P;
select chk((select count(*) = 0 from assignment_offers) and (select count(*) = 0 from my_offers()), 'a PM who was not offered the task sees nothing of it');
:as_Q;
select chk((select count(*) = 1 from my_offers() where title = 'Offer 1' and area = 'Kandivali West'), 'the offered PM sees the task, with the area');
select chk(not exists (select 1 from my_offers() o where to_jsonb(o)::text ~* 'Flat 1|Priya'), 'but not the street address or the customer');
select chk((select est_cost is not null and currency = 'INR' and expires_at is not null and scheduled_at is not null from my_offers() where title = 'Offer 1'), 'the offer shows price, currency, schedule and deadline');

-- ============================================================ rejection and retry
select respond_offer(offer_of('Offer 1', :'U_Q'), false, 'Not available') = 'rejected' as r1 \gset
select chk(:'r1', 'a PM can decline an offer');
select chk(respond_offer(offer_of('Offer 1', :'U_Q'), false) = 'rejected', 'declining twice is harmless (idempotent)');
:as_db;
select chk(offered_to('Offer 1') = :'U_P', 'a declined offer moves to the next eligible PM');
select chk((select count(*) = 2 from assignment_offers where task_id = task_of('Offer 1')) and (select max(attempt) = 2 from assignment_offers where task_id = task_of('Offer 1')), 'attempts are counted');
:as_P;
select respond_offer(offer_of('Offer 1', :'U_P'), false, 'Too far');
:as_db;
select chk((select assignment_state = 'admin_queue' and queue_reason like 'No eligible Personal Manager%' and routing_mode = 'admin' from tasks where title = 'Offer 1'), 'when every eligible PM has declined, the task goes to the Admin Queue with a reason');
select chk((select count(*) >= 1 from notifications where user_id = :'U_AD' and title = 'A task needs manual assignment'), 'the administrator is notified');
select chk((select assigned_worker_id is null from tasks where title = 'Offer 1'), 'and nobody is assigned');
select chk((select count(*) = 0 from assignment_offers where task_id = task_of('Offer 1') and status = 'pending'), 'no offer is left pending');
:as_AD;
select chk(requeue_task(task_of('Offer 1')) = 'queued', 'requeueing does not re-offer to a PM who already answered (one offer per PM per task)');
select assign_task(task_of('Offer 1'), :'U_P');
:as_db;
select chk((select status = 'matched' and assigned_worker_id = :'U_P' and assignment_state = 'manual' from tasks where title = 'Offer 1'), 'an administrator can assign manually from the queue');
select chk((select count(*) >= 1 from audit_log where action = 'task.sent_to_admin_queue' and entity_id = task_of('Offer 1')) and (select count(*) >= 1 from audit_log where action = 'task.assigned' and entity_id = task_of('Offer 1')), 'the queue and the manual assignment are in the audit trail');
select chk((select count(*) >= 3 from audit_log where action like 'offer.%' and entity_id = task_of('Offer 1')), 'offers and answers are recorded');

-- ============================================================ expiry and the sweeper
:as_C;
select mk('Offer expiry', (:'monday'::date + 1), '10:00');
:as_db;
select offered_to('Offer expiry') as first_pm \gset
update assignment_offers set expires_at = now() - interval '1 minute' where task_id = task_of('Offer expiry') and status = 'pending';
select (process_offers() ->> 'expired')::int = 1 as swept \gset
select chk(:'swept', 'the sweeper expires an offer nobody answered');
select chk((select count(*) = 1 from assignment_offers where task_id = task_of('Offer expiry') and status = 'expired' and worker_id = :'first_pm'), 'it is marked expired');
select chk(offered_to('Offer expiry') is not null and offered_to('Offer expiry') <> :'first_pm', 'and the next eligible PM is offered the task');
select chk((process_offers() ->> 'expired')::int = 0, 'running the sweeper again changes nothing (idempotent)');
select chk((select count(*) = 2 from assignment_offers where task_id = task_of('Offer expiry')), 'no duplicate offers appear');
:as_db;
select set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', :'first_pm'), false);
set role authenticated;
select chk(respond_offer(offer_of('Offer expiry', :'first_pm'), true) = 'expired', 'answering an expired offer reports it expired and assigns nothing');
reset role;
select chk((select assigned_worker_id is null from tasks where title = 'Offer expiry'), 'nobody is assigned by a late answer');

-- ============================================================ acceptance
:as_C;
select mk('Offer accept', (:'monday'::date + 2), '10:00');
:as_db;
select offered_to('Offer accept') as acc_pm \gset
select set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', :'acc_pm'), false);
set role authenticated;
select respond_offer(offer_of('Offer accept', :'acc_pm'), true) as acc \gset
reset role;
select chk(:'acc' = 'accepted', 'accepting an offer assigns the task');
select chk((select status = 'assigned' and assigned_worker_id = :'acc_pm' and assignment_state = 'assigned' and accepted_at is not null from tasks where title = 'Offer accept'), 'only now is the task assigned to the PM');
select chk((select count(*) = 1 from notifications where user_id = :'U_C' and title = 'A Personal Manager accepted your task' and task_id = task_of('Offer accept')), 'now the customer is told');
select chk((select status = 'accepted' from assignment_offers where task_id = task_of('Offer accept') and worker_id = :'acc_pm'), 'the offer is marked accepted');
select set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', :'acc_pm'), false);
set role authenticated;
select chk(respond_offer(offer_of('Offer accept', :'acc_pm'), true) = 'accepted', 'accepting twice is harmless (idempotent)');
reset role;
select chk((select count(*) = 1 from notifications where user_id = :'U_C' and title = 'A Personal Manager accepted your task' and task_id = task_of('Offer accept')), 'and sends no second notification');
:as_C;
select chk((select assigned_worker_id = :'acc_pm' from tasks where title = 'Offer accept'), 'the customer now sees the assigned PM');
:as_db;
select chk((select count(*) >= 1 from audit_log where action = 'offer.accepted' and entity_id = task_of('Offer accept')), 'acceptance is audited');
select chk((select last_assigned_at > now() - interval '1 minute' from profiles where id = :'acc_pm'), 'acceptance feeds workload fairness');
:as_P;
select expect_error(format($$select respond_offer('%s', true)$$, offer_of('Offer accept', :'acc_pm')) , 'a PM cannot answer someone else''s offer') where :'acc_pm' <> :'U_P';
:as_Q;
select expect_error(format($$select respond_offer('%s', true)$$, offer_of('Offer accept', :'acc_pm')) , 'a PM cannot answer someone else''s offer') where :'acc_pm' <> :'U_Q';

-- ============================================================ no double booking, and a fresh check when the PM accepts
-- Only P serves the region from here on, so both overlapping tasks are offered to P.
:as_AD;
select set_pm_regions(:'U_Q', array[]::text[]);
:as_C;
select mk('Overlap A', :'monday', '13:00');
select mk('Overlap B', (:'monday'::date + 3), '13:00');
select mk('Overlap B2', (:'monday'::date + 3), '13:30');
:as_db;
select chk(offered_to('Overlap A') = :'U_P' and offered_to('Overlap B') = :'U_P' and offered_to('Overlap B2') = :'U_P', 'with one eligible PM, each task is offered to that PM');
select set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', :'U_P'), false);
set role authenticated;
select respond_offer(offer_of('Overlap B', :'U_P'), true) = 'accepted' as ok_b \gset
select respond_offer(offer_of('Overlap B2', :'U_P'), true) as late_b2 \gset
reset role;
select chk(:'ok_b', 'the first acceptance succeeds');
select chk(:'late_b2' = 'ineligible', 'the overlapping task fails the fresh check at acceptance: no double booking');
select chk((select count(*) = 1 from tasks where assigned_worker_id = :'U_P' and scheduled_at = local_ts((:'monday'::date + 3), '13:00', 'Asia/Kolkata') and status = 'assigned'), 'the PM holds only one task in that slot');
select chk((select assignment_state = 'admin_queue' and queue_reason like 'No eligible Personal Manager%does not serve the region%' from tasks where title = 'Overlap B2'), 'the rejected task goes to the queue with the reason (the only other PM does not serve the region)');
select chk((select response_note like 'No longer eligible%' from assignment_offers where task_id = task_of('Overlap B2') and worker_id = :'U_P'), 'the failed acceptance records why');
-- schedule changes between offer and acceptance
select set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', :'U_P'), false);
set role authenticated;
select add_pm_block(null, local_ts(:'monday', '12:00', 'Asia/Kolkata'), local_ts(:'monday', '16:00', 'Asia/Kolkata'), 'time_off', 'Sudden appointment') as blk2 \gset
select respond_offer(offer_of('Overlap A', :'U_P'), true) as late_a \gset
reset role;
select chk(:'late_a' = 'ineligible', 'time off added after the offer stops the acceptance (availability is re-checked)');
:as_db;
select chk((select assigned_worker_id is null from tasks where title = 'Overlap A'), 'and nothing is assigned');

-- ============================================================ vehicles
:as_AD;
select save_service_draft('errand-svc', (select id from service_families where key = 'everyday-tech'), 'general', jsonb_build_object('title', 'Errand service', 'description', 'Collect and deliver a parcel.', 'pricing', jsonb_build_object('approach', 'fixed', 'price', 300, 'currency', 'INR'))) as s_err \gset
select publish_service(:'s_err');
select set_service_vehicle(:'s_err', array['two_wheeler']);
:as_C;
select expect_error(format($$select set_service_vehicle('%s', array['two_wheeler'])$$, :'s_err'), 'a customer cannot set vehicle requirements');
:as_SU;
select expect_error(format($$select set_service_vehicle('%s', array['four_wheeler'])$$, :'s_err'), 'a support admin cannot set vehicle requirements');
:as_AD;
select expect_error(format($$select set_service_vehicle('%s', array['spaceship'])$$, :'s_err'), 'unknown vehicle types are refused');
:as_C;
insert into tasks (customer_id, title, category, location, service_id, region_code, scheduled_at, est_minutes)
  values (auth.uid(), 'Vehicle probe', 'general', 'Flat 5, Kandivali West', :'s_err', 'IN-T', local_ts((:'monday'::date + 4), '10:00', 'Asia/Kolkata'), 60);
:as_db;
select chk((select vehicle_ok = array['two_wheeler'] from tasks where title = 'Vehicle probe'), 'the requirement in force at booking time is stored with the task');
-- stop automatic dispatch interfering with direct eligibility checks
update tasks set assignment_state = 'manual' where title = 'Vehicle probe';
create function public.fails(ttl text, w uuid) returns jsonb language sql security definer as $$ select pm_eligibility(task_of(ttl), w) -> 'failures' $$;
select chk(not (fails('Vehicle probe', :'U_P') ? 'vehicle') and not (fails('Vehicle probe', :'U_P') ? 'vehicle_unknown'), 'a two-wheeler task: a PM with a two-wheeler qualifies on this check');
select chk(fails('Vehicle probe', :'U_Q') ? 'vehicle', 'a two-wheeler task: a PM who declared no vehicle is excluded');
update profiles set vehicles = null where id = :'U_Q';
select chk(fails('Vehicle probe', :'U_Q') ? 'vehicle_unknown', 'a PM whose vehicle details are missing is not assumed to have one');
update profiles set vehicles = array['four_wheeler'] where id = :'U_Q';
select chk(fails('Vehicle probe', :'U_Q') ? 'vehicle', 'a two-wheeler task: a four-wheeler alone does not qualify');
update tasks set vehicle_ok = array['four_wheeler'] where title = 'Vehicle probe';
select chk(not (fails('Vehicle probe', :'U_Q') ? 'vehicle') and fails('Vehicle probe', :'U_P') ? 'vehicle', 'a four-wheeler task: only a PM with a four-wheeler qualifies');
update tasks set vehicle_ok = array['two_wheeler', 'four_wheeler'] where title = 'Vehicle probe';
select chk(not (fails('Vehicle probe', :'U_Q') ? 'vehicle') and not (fails('Vehicle probe', :'U_P') ? 'vehicle'), 'an either-vehicle task accepts both kinds');
update profiles set vehicles = array[]::text[] where id = :'U_Q';
select chk(fails('Vehicle probe', :'U_Q') ? 'vehicle', 'either-vehicle still needs some vehicle');
update tasks set vehicle_ok = '{}' where title = 'Vehicle probe';
select chk(not (fails('Vehicle probe', :'U_Q') ? 'vehicle') and not (fails('Vehicle probe', :'U_Q') ? 'vehicle_unknown'), 'a task needing no vehicle does not exclude a PM without one');
update profiles set vehicles = null where id = :'U_Q';
select chk(not (fails('Vehicle probe', :'U_Q') ? 'vehicle_unknown'), 'and missing vehicle data is irrelevant to it');
select chk(fails('Vehicle probe', :'U_Q') ? 'qualifications' = false, 'having (or lacking) a vehicle says nothing about qualifications');
:as_Q;
select set_pm_vehicles(null, array['four_wheeler'], true);
select expect_error($$select set_pm_vehicles(null, array['tank'], true)$$, 'a PM cannot declare an unknown vehicle');
select expect_error(format($$select set_pm_vehicles('%s', array['two_wheeler'], true)$$, :'U_P'), 'a PM cannot change another PM''s vehicle details');
:as_db;
select chk((select count(*) >= 1 from audit_log where action = 'service.vehicle_requirement' and after_value ->> 'vehicle_ok' is not null), 'vehicle requirement changes are audited');

-- ============================================================ customer-gender matching policy (fixtures only)
:as_AD;
select set_pm_regions(:'U_Q', array['IN-T']);
select chk((matching_policy_status() ->> 'enabled')::boolean = false and matching_policy_status() -> 'mapping' = '{}'::jsonb, 'the policy ships OFF with an EMPTY mapping: no mapping is assumed');
select expect_error($$select save_matching_policy(true, '{}', 'admin_queue', 'Reviewed by counsel for the test region on 1 Jan.')$$, 'it cannot be switched on without a mapping');
select expect_error($$select save_matching_policy(true, '{"female":["female"]}', 'admin_queue', 'ok')$$, 'it cannot be switched on without a recorded legal review');
select expect_error($$select save_matching_policy(false, '{"robot":["female"]}', 'admin_queue', null)$$, 'an unknown customer gender in the mapping is refused');
select expect_error($$select save_matching_policy(false, '{"female":["robot"]}', 'admin_queue', null)$$, 'an unknown Personal Manager gender in the mapping is refused');
select expect_error($$select save_matching_policy(false, '{"female":[]}', 'admin_queue', null)$$, 'a mapping entry needs at least one allowed gender');
select expect_error($$select save_matching_policy(false, '{}', 'guess', null)$$, 'an unknown fallback is refused');
:as_SU;
select expect_error($$select save_matching_policy(false, '{}', 'admin_queue', null)$$, 'a support admin cannot change the matching policy');
:as_P;
select expect_error($$select matching_policy_status()$$, 'a PM cannot read the policy');
:as_C;
select expect_error($$select matching_policy_status()$$, 'a customer cannot read the policy');
select set_my_gender('female', true);
select expect_error($$select set_my_gender('female', false)$$, 'a recorded value needs the person''s consent for matching');
select expect_error($$select set_my_gender('robot', true)$$, 'only listed options are accepted');
select expect_error($$update profiles set gender = 'male' where id = auth.uid()$$, 'gender cannot be changed except through the explained setting');
select expect_error($$select gender from profiles$$, 'a customer cannot read gender through the profile table');
select chk((select count(*) >= 1 from profiles where id = auth.uid()), 'other profile columns still read normally');
select chk((my_gender_status() ->> 'gender') = 'female' and (my_gender_status() ->> 'consented')::boolean, 'a person can see their own recorded value');
:as_P;
select expect_error($$select gender from profiles$$, 'a PM cannot read anyone''s gender');
:as_AD;
select expect_error($$select gender from profiles$$, 'an administrator cannot read gender through the profile table either');
select admin_set_pm_gender(:'U_P', 'female');
select admin_set_pm_gender(:'U_Q', 'male');
:as_C2;
select set_my_gender('undisclosed', false);
:as_db;
create function public.gr(ttl text, w uuid) returns text language sql security definer as $$ select pm_eligibility(task_of(ttl), w) ->> 'gender_rule' $$;
:as_C;
select mk('Gender probe', (:'monday'::date + 7), '10:00');
:as_C2;
select mk('Gender probe C2', (:'monday'::date + 7), '10:00');
:as_db;
select chk(gr('Gender probe', :'U_P') = 'not_applied', 'with the policy off, gender plays no part');
:as_AD;
select save_matching_policy(true, '{"female":["female"]}', 'admin_queue', 'Fixture only: legal review recorded for the test region, 1 Jan.');
:as_db;
select chk(gr('Gender probe', :'U_P') = 'allowed', 'mapping applies: a female customer and a female PM are allowed');
select chk(gr('Gender probe', :'U_Q') = 'blocked', 'mapping applies: the other PM is not eligible');
select chk(gr('Gender probe C2', :'U_P') = 'queue', 'an undisclosed customer gender is not guessed: the fallback applies');
update profiles set gender = null, gender_consent_at = null where id = :'U_C2';
select chk(gr('Gender probe C2', :'U_P') = 'queue', 'a missing customer gender is not guessed either');
update profiles set gender = 'male', gender_consent_at = now() where id = :'U_C2';
select chk(gr('Gender probe C2', :'U_P') = 'queue', 'a gender the mapping does not cover is not guessed');
update profiles set gender = null, gender_consent_at = null where id = :'U_P';
select chk(gr('Gender probe', :'U_P') = 'blocked', 'a PM with no recorded gender cannot satisfy a mapping');
update profiles set gender = 'female', gender_consent_at = now() where id = :'U_P';
update profiles set gender = 'female', gender_consent_at = null where id = :'U_C2';                       -- recorded without consent
select chk(gr('Gender probe C2', :'U_P') = 'queue', 'a value recorded without consent is not used');
:as_AD;
select save_matching_policy(true, '{"female":["female"]}', 'ignore_rule', 'Fixture only: legal review recorded for the test region, 1 Jan.');
:as_db;
select chk(gr('Gender probe C2', :'U_P') = 'not_applied', 'with the "ignore the rule" fallback an unknown gender simply is not used');
:as_AD;
select save_matching_policy(true, '{"female":["female"]}', 'admin_queue', 'Fixture only: legal review recorded for the test region, 1 Jan.');
:as_db;
update tasks set for_whom = 'other' where title = 'Gender probe';
select chk(gr('Gender probe', :'U_P') = 'queue', 'a booking for someone else is not matched on the booker''s gender');
update tasks set for_whom = 'self' where title = 'Gender probe';
-- end to end
update profiles set last_assigned_at = now() where id = :'U_P';                  -- Q would rank first on fairness alone
update profiles set last_assigned_at = null where id = :'U_Q';
:as_C;
select mk('Gender offer', (:'monday'::date + 8), '10:00');
:as_db;
select chk(offered_to('Gender offer') = :'U_P', 'gender matching decides who is offered, ahead of fairness ranking');
:as_C2;
update profiles set gender = null where false;
:as_db;
update profiles set gender = null, gender_consent_at = null where id = :'U_C2';
:as_C2;
select mk('Gender queue', (:'monday'::date + 8), '11:00');
:as_db;
select chk((select assignment_state = 'admin_queue' and queue_reason like '%matching policy cannot decide%' from tasks where title = 'Gender queue'), 'when the policy cannot decide, the task goes to the Admin Queue with that reason');
select chk(not exists (select 1 from audit_log where action in ('offer.created', 'profile.gender_set', 'profile.gender_set_by_admin') and details::text ~* '(female|male)'), 'audit rows record the rule''s outcome, never a gender value');
select chk((select details ->> 'gender_rule' = 'allowed' from audit_log where action = 'offer.created' and entity_id = task_of('Gender offer')), 'the matching decision is audited');
select chk((select count(*) >= 1 from audit_log where action = 'matching_policy.changed'), 'policy changes are audited');
:as_AD;
select save_matching_policy(false, '{"female":["female"]}', 'admin_queue', 'Fixture only: legal review recorded for the test region, 1 Jan.');
:as_db;
select chk(gr('Gender probe', :'U_Q') = 'not_applied', 'switching the policy off restores neutral matching');

-- ============================================================ price approval before an offer
:as_AD;
select save_service_draft('quote-only', (select id from service_families where key = 'everyday-tech'), 'general', jsonb_build_object('title', 'Quote only', 'description', 'Needs a quote first.', 'pricing', jsonb_build_object('approach', 'manual_quote'))) as s_q \gset
select publish_service(:'s_q');
:as_C;
insert into tasks (customer_id, title, category, location, service_id, region_code, scheduled_at, est_minutes)
  values (auth.uid(), 'Quote task', 'general', 'Flat 8, Kandivali West', :'s_q', 'IN-T', local_ts((:'monday'::date + 9), '10:00', 'Asia/Kolkata'), 60);
:as_db;
select chk((select assignment_state = 'none' from tasks where title = 'Quote task') and (select count(*) = 0 from assignment_offers where task_id = task_of('Quote task')), 'a non-standard task is not offered to anyone before its price is approved');
:as_AD;
select approve_task_price(task_of('Quote task'), 400, 'Agreed');
:as_db;
select chk((select count(*) = 0 from assignment_offers where task_id = task_of('Quote task')), 'an admin-approved price still waits for the customer''s confirmation');
:as_C;
select confirm_task_price(task_of('Quote task'));
:as_db;
select chk((select count(*) = 0 from assignment_offers where task_id = task_of('Quote task')), 'a confirmed price alone is not enough while the request is still under review');
:as_AD;
select set_review_state(task_of('Quote task'), 'ready');
:as_db;
select chk((select count(*) = 1 from assignment_offers where task_id = task_of('Quote task') and status = 'pending'), 'once the price is approved, confirmed and the request reviewed, the offer is sent');

-- ============================================================ operating hours versus Personal Manager hours
insert into tasks (customer_id, title, category, location, region_code, scheduled_at, est_minutes, status, price_status, review_state, est_cost, currency, routing_mode, price_source)
  values (:'U_C', 'Late task', 'handyman', 'Flat 1, Kandivali West', 'IN-T', local_ts((:'monday'::date + 10), '21:00', 'Asia/Kolkata'), 60, 'requested', 'confirmed', 'ready', 500, 'INR', 'broadcast', 'template');
select chk((select assignment_state = 'admin_queue' and queue_reason like '%outside operating hours%' from tasks where title = 'Late task'), 'the system will not offer a task outside operating hours, even if a PM would work then');
select chk(fails('Late task', :'U_P') ? 'operating_hours' and not (fails('Late task', :'U_P') ? 'schedule'), 'P is free then, but the platform is closed: the stricter rule wins');
select chk(fails('Late task', :'U_Q') ? 'schedule', 'Q is not working then either');
:as_AD;
select expect_error(format($$select approve_hours_exception('%s', 'short')$$, task_of('Late task')), 'an exception needs a recorded reason');
select approve_hours_exception(task_of('Late task'), 'Customer works nights; approved by operations.');
select chk(requeue_task(task_of('Late task')) = 'offered', 'with an authorised exception the task can be offered');
:as_db;
select chk(offered_to('Late task') = :'U_P', 'and only to a PM who works then');
select chk((select count(*) >= 1 from audit_log where action = 'task.hours_exception' and entity_id = task_of('Late task')), 'the exception is audited');
:as_C;
select expect_error(format($$select approve_hours_exception('%s', 'Customers cannot approve their own exceptions')$$, task_of('Late task')), 'a customer cannot authorise an exception');
:as_Q;
select set_working_hours(null, (select jsonb_agg(jsonb_build_object('weekday', d, 'start', '09:00', 'end', '12:00')) from generate_series(1, 5) d));
:as_C;
select mk('Afternoon task', (:'monday'::date + 11), '14:00');
:as_db;
update tasks set assignment_state = 'manual' where title = 'Afternoon task';
select chk(fails('Afternoon task', :'U_Q') ? 'schedule' and not (fails('Afternoon task', :'U_Q') ? 'operating_hours'), 'a PM''s own hours are enforced even when the platform is open');
-- capacity
update platform_settings set value = '1' where key = 'max_active_jobs_per_pm';
select chk(fails('Afternoon task', :'U_P') ? 'at_capacity', 'a configured capacity limit is enforced');
update platform_settings set value = '0' where key = 'max_active_jobs_per_pm';
select chk(not (fails('Afternoon task', :'U_P') ? 'at_capacity'), 'and 0 means no limit');

-- ============================================================ manual assignment and overrides
:as_C;
select mk('Manual cancel', (:'monday'::date + 14), '10:00');
:as_db;
update profiles set last_assigned_at = null where id in (:'U_P', :'U_Q');
select chk(offered_to('Manual cancel') is not null, 'an offer is pending');
select offered_to('Manual cancel') as holder \gset
select (case when :'holder' = :'U_P' then :'U_Q' else :'U_P' end)::uuid as other_pm \gset
:as_AD;
select assign_task(task_of('Manual cancel'), :'other_pm');
:as_db;
select chk((select count(*) = 0 from assignment_offers where task_id = task_of('Manual cancel') and status = 'pending') and (select count(*) = 1 from assignment_offers where task_id = task_of('Manual cancel') and status = 'cancelled'), 'a manual assignment cancels the offer in flight');
select chk((select status = 'matched' and assigned_worker_id = :'other_pm' and assignment_state = 'manual' from tasks where title = 'Manual cancel'), 'and the PM must still accept (the task is "matched", not "assigned")');
:as_AD;
select chk((task_assignment_report(task_of('Manual cancel')) -> 'offers') is not null and jsonb_array_length(task_assignment_report(task_of('Manual cancel')) -> 'history') >= 2, 'administrators get the offer and assignment history');
select chk(jsonb_array_length(task_assignment_report(task_of('Manual cancel')) -> 'candidates') = 2, 'and why each PM is or is not eligible');
select chk((offers_overview() -> 'counts') is not null and jsonb_typeof(offers_overview() -> 'queue') = 'array', 'the dashboard summary lists counts and the queue');
:as_P;
select expect_error(format($$select assign_task('%s', '%s')$$, task_of('Manual cancel'), :'U_P'), 'a PM cannot assign tasks');
select expect_error($$select process_offers()$$, 'a PM cannot run the sweeper');
select expect_error(format($$select task_assignment_report('%s')$$, task_of('Manual cancel')), 'a PM cannot read the assignment report');
:as_C;
select expect_error(format($$select requeue_task('%s')$$, task_of('Manual cancel')), 'a customer cannot requeue or override');
select expect_error(format($$select dispatch_offer('%s')$$, task_of('Manual cancel')), 'a customer cannot dispatch offers');
select expect_error(format($$select pm_eligibility('%s', '%s')$$, task_of('Manual cancel'), :'U_P'), 'eligibility details are not exposed to apps');
:as_db;
select chk((select count(*) >= 1 from audit_log where action = 'task.assigned' and entity_id = task_of('Manual cancel')), 'manual assignment is audited');
