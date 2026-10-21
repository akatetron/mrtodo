-- Sample catalogue, PM qualifications and assessments, eligibility, specialists, quote revisions, PM profile.
\i helpers.sql
select seed_people();
update platform_settings set value = '200' where key = 'max_tasks_per_hour';

-- ============================================================ sample catalogue
:as_C;
select chk((select count(*) >= 7 from jsonb_array_elements(catalogue()) f, jsonb_array_elements(f -> 'services') s), 'the sample catalogue is published for customers');
select chk((select not exists (select 1 from jsonb_array_elements(catalogue()) f, jsonb_array_elements(f -> 'services') s where s ->> 'key' in ('plumbing-coordination', 'electrical-coordination', 'appliance-repair', 'parent-practical-help')) ), 'services that promised an arranged technician are not offered');
select chk((select not exists (select 1 from jsonb_array_elements(catalogue()) f, jsonb_array_elements(f -> 'services') s where (s -> 'definition')::text ~* '(we arrange|arrange a (plumber|electrician|technician)|we find and manage)') ), 'no published service promises to arrange a specialist');
select chk((select count(*) = 0 from jsonb_array_elements(catalogue()) f where f ->> 'key' in ('home-repairs', 'family-support')), 'families with nothing bookable are not shown');
select chk((select (s -> 'definition' -> 'pricing' ->> 'price')::numeric = 499 from jsonb_array_elements(catalogue()) f, jsonb_array_elements(f -> 'services') s where s ->> 'key' = 'phone-setup'), 'a sample price is there to try');
select chk((select count(*) = 0 from jsonb_array_elements(catalogue()) f, jsonb_array_elements(f -> 'services') s
             where s -> 'definition' -> 'pricing' ->> 'approach' = 'manual_quote' and s -> 'definition' -> 'pricing' ? 'price'), 'quote-based services carry no invented price');
:as_db;
select id as svc_phone from catalogue_services where key = 'phone-setup' \gset

select id as svc_printer from catalogue_services where key = 'printer-setup' \gset
:as_AD;
select save_service_draft('test-specialist-svc', (select id from service_families where key = 'everyday-tech'), 'general', '{"title":"Test specialist service","description":"Used only by the test suite.","required_skills":["home-repair-coordination"],"requires_specialist":true,"questions":[{"id":"issue","type":"long_text","label":"What needs fixing?","required":true}],"pricing":{"approach":"manual_quote"}}') as svc_plumb \gset
select publish_service(:'svc_plumb');
:as_db;
:as_AD;
select save_service_draft('phone-setup', (select family_id from catalogue_services where key = 'phone-setup'), 'general',
  (select draft || jsonb_build_object('pricing', jsonb_build_object('approach', 'fixed', 'price', 550, 'currency', 'INR')) from catalogue_services where key = 'phone-setup')) as _a \gset
select chk(publish_service(:'svc_phone') = 2, 'a sample service can be edited and republished');
:as_db;
\i ../migrations/0007_qualifications_quotes_specialists.sql
select chk((select (draft -> 'pricing' ->> 'price')::numeric = 550 and current_version = 2 from catalogue_services where key = 'phone-setup'), 're-running the migration never overwrites an edited sample');

-- ============================================================ qualifications
:as_P;
select chk((select count(*) >= 6 from skills), 'skills are readable');
select claim_skill('tech-support', 'I fix phones for friends');
select chk((select status = 'claimed' and source = 'self_reported' from pm_qualifications where skill_key = 'tech-support'), 'a self-claimed skill is only "claimed"');
select expect_error($$select set_pm_qualification(auth.uid(), 'tech-support', 'verified')$$, 'a PM cannot verify themselves');
:as_C;
select expect_error($$select claim_skill('tech-support')$$, 'a customer cannot claim skills');
:as_db;
select chk(not pm_has_skill(:'U_P', 'tech-support'), 'a claim does not count as verified');

-- booking the sample service: it needs tech-support
:as_C;
insert into tasks (customer_id, title, category, location, service_id, answers)
values (auth.uid(), 'Set up my phone', 'general', 'Flat 4B, Kandivali West', :'svc_phone', '{"phone":"iPhone"}');
select id as t1 from tasks where title = 'Set up my phone' \gset
select chk((select est_cost = 550 and service_version = 2 and service_snapshot -> 'required_skills' ? 'tech-support' from tasks where id = :'t1'), 'the booking records the edited price and the skills the service needs');
:as_AD;
select chk((select not eligible and missing_skills = array['tech-support'] from shortlist_workers(:'t1') where id = :'U_P'), 'the shortlist shows an unverified PM as not eligible');
select expect_error(format($$select assign_task('%s', '%s')$$, :'t1', :'U_P'), 'an unverified PM cannot be assigned');
:as_SU;
select expect_error(format($$select set_pm_qualification('%s', 'tech-support', 'verified')$$, :'U_P'), 'a support admin cannot verify qualifications');
:as_AD;
select record_interview(:'U_P', 'passed', 'Good phone manner');
select set_pm_qualification(:'U_P', 'tech-support', 'verified', 2, 'interview', now() + interval '1 year', 'Interview passed');
select chk((select eligible from shortlist_workers(:'t1') where id = :'U_P'), 'a verified PM becomes eligible');
select assign_task(:'t1', :'U_P');
:as_P;
select accept_task(:'t1');
:as_AD;
select chk((select count(*) >= 2 from audit_log where action in ('pm.qualification', 'pm.interview')), 'interviews and qualification changes are audited');

-- revocation / expiry stop acceptance
:as_C;
insert into tasks (customer_id, title, category, location, service_id) values (auth.uid(), 'Printer please', 'general', 'Flat 4B, Kandivali West', (:'svc_printer'));
select id as t2 from tasks where title = 'Printer please' \gset
:as_AD;
select assign_task(:'t2', :'U_P');
select set_pm_qualification(:'U_P', 'tech-support', 'revoked');
:as_P;
select expect_error(format($$select accept_task('%s')$$, :'t2'), 'accepting is refused once the qualification is revoked');
:as_AD;
select set_pm_qualification(:'U_P', 'tech-support', 'verified', 1, 'interview', now() - interval '1 day');
select chk((select not eligible from shortlist_workers(:'t2') where id = :'U_P'), 'an expired qualification does not count');
select set_pm_qualification(:'U_P', 'tech-support', 'verified', 1, 'interview', now() + interval '1 year');
:as_P;
select accept_task(:'t2');

-- regulated skills need more than a claim
:as_db;
select chk(not pm_has_skill(:'U_Q', 'regulated-electrical'), 'nobody starts with a regulated skill');
select claim_skill('regulated-electrical') from (select 1) x where false;
:as_Q;
select claim_skill('regulated-electrical', 'I am an electrician');
:as_db;
update pm_qualifications set status = 'verified', source = 'self_reported' where worker_id = :'U_Q' and skill_key = 'regulated-electrical';
select chk(not pm_has_skill(:'U_Q', 'regulated-electrical'), 'a self-reported regulated skill never counts, even if marked verified');
update pm_qualifications set source = 'document' where worker_id = :'U_Q' and skill_key = 'regulated-electrical';
select chk(pm_has_skill(:'U_Q', 'regulated-electrical'), 'a document-backed regulated skill counts');

-- ============================================================ assessments
:as_AD;
select expect_error($$select save_assessment('bad', 'Bad', 'tech-support', 1, '[{"text":"Q?","options":["a"],"correct":3}]')$$, 'an assessment with a broken question is refused');
select save_assessment('phones-1', 'Phone basics', 'tech-support', 1,
  '[{"text":"Which button powers a phone on?","options":["Side button","Volume","Camera"],"correct":0},{"text":"What is a SIM?","options":["A battery","A subscriber card","A charger"],"correct":1}]', 100, 365, true) as asm \gset
select save_assessment('shop-1', 'Errand basics', 'errands', 1, '[{"text":"Check the bill before paying?","options":["Yes","No"],"correct":0}]', 100, null, true) as asm2 \gset
:as_db;
select expect_error($$insert into assessments (key, name, skill_key, questions, fee_enabled) values ('paid', 'Paid', 'errands', '[]', true)$$, 'paid assessments cannot be switched on, even by the database owner');
:as_AD;
:as_Q;
select chk((select count(*) = 2 and not bool_or(questions::text like '%correct%') from available_assessments()), 'a PM sees the questions but never the answer key');
select chk((submit_assessment(:'asm', '[1,1]') ->> 'passed')::boolean = false, 'a failed assessment is recorded as failed');
select chk((select count(*) = 0 from pm_qualifications where worker_id = auth.uid() and skill_key = 'tech-support'), 'a failed assessment grants nothing');
select chk((submit_assessment(:'asm', '[0,1]') ->> 'passed')::boolean, 'a pass is graded on the server');
select chk((select status = 'verified' and source = 'assessment' and expires_at > now() + interval '300 days' from pm_qualifications where worker_id = auth.uid() and skill_key = 'tech-support'),
           'passing verifies that one skill with an expiry');
select chk((select count(*) = 0 from pm_qualifications where worker_id = auth.uid() and skill_key = 'errands'), 'passing one test qualifies for nothing else');
select expect_error(format($$select submit_assessment('%s', '[0]')$$, :'asm'), 'every question must be answered');
select submit_assessment(:'asm', '[0,1]');
select expect_error(format($$select submit_assessment('%s', '[0,1]')$$, :'asm'), 'attempts are limited per day');
:as_C;
select expect_error(format($$select submit_assessment('%s', '[0,1]')$$, :'asm'), 'a customer cannot take a PM assessment');
:as_AD;
select set_pm_qualification(:'U_Q', 'errands', 'revoked');
:as_Q;
select submit_assessment(:'asm2', '[0]');
select chk((select status = 'revoked' from pm_qualifications where worker_id = auth.uid() and skill_key = 'errands'), 'a test cannot undo an admin''s revocation');

-- ============================================================ specialists and regulated work
:as_C;
insert into tasks (customer_id, title, category, location, service_id, answers) values (auth.uid(), 'Tap leak', 'handyman', 'Flat 4B, Kandivali West', :'svc_plumb', '{"issue":"Tap leaking"}');
select id as t3 from tasks where title = 'Tap leak' \gset
select chk((select est_cost is null and price_status = 'awaiting_approval' and review_state = 'needs_review' from tasks where id = :'t3'), 'a specialist service waits for a quote');
:as_AD;
select set_pm_qualification(:'U_P', 'home-repair-coordination', 'verified', 1, 'interview');
select approve_task_price(:'t3', 1200);
:as_C;
select confirm_task_price(:'t3');
:as_AD;
select assign_task(:'t3', :'U_P');
:as_P;
select accept_task(:'t3');
:as_AD;
select save_specialist(null, 'Anil Plumbing', 'regulated-plumbing', false, 'Licence not checked yet', '98200 77777') as sp_un \gset
select save_specialist(null, 'Verified Pipes', 'regulated-plumbing', true, 'Licence 123 checked', '98200 88888') as sp_ok \gset
:as_P;
select expect_error(format($$select assign_specialist('%s', '%s')$$, :'t3', :'sp_un'), 'regulated work cannot go to an unverified specialist');
select assign_specialist(:'t3', :'sp_ok', 'Customer is free after 5') as job \gset
select chk((select count(*) = 1 from task_specialist_jobs), 'a verified specialist can be arranged by the assigned PM');
select chk((select count(*) = 0 from specialist_contacts), 'specialist phone numbers are not readable by a PM');
select set_specialist_job(:'job', 'completed');
select chk((select status = 'assigned' from tasks where id = :'t3'), 'a specialist finishing a visit does not complete the customer''s task');
:as_Q;
select expect_error(format($$select assign_specialist('%s', '%s')$$, :'t3', :'sp_ok'), 'another PM cannot arrange a specialist');
:as_C;
select expect_error($$select save_specialist(null, 'Fake', 'regulated-plumbing', true, null, null)$$, 'a customer cannot add specialists');

-- ============================================================ revised quotes
:as_P;
select expect_error(format($$select propose_quote('%s', '[{"label":"Pipe","kind":"specialist","amount":-5}]', 'The pipe behind the wall is corroded.')$$, :'t3'), 'only a discount can be negative');
select expect_error(format($$select propose_quote('%s', '[]', 'The pipe behind the wall is corroded.')$$, :'t3'), 'a quote needs lines');
select propose_quote(:'t3', '[{"label":"Management fee","kind":"management_fee","amount":300},{"label":"Plumber: replace pipe","kind":"specialist","amount":1500},{"label":"Extra work","kind":"extra_work","amount":400}]', 'The pipe behind the wall is corroded.') as q1 \gset
:as_C;
select chk((select count(*) = 0 from task_quotes), 'the customer does not see a quote before an admin has reviewed it');
select expect_error(format($$select decide_quote_customer('%s', true)$$, :'q1'), 'the customer cannot approve before the admin');
:as_P;
select expect_error(format($$select decide_quote_admin('%s', true)$$, :'q1'), 'a PM cannot approve their own quote');
:as_AD;
select decide_quote_admin(:'q1', true, 'Looks right');
:as_db;
select chk((select est_cost = 1200 from tasks where id = :'t3'), 'the price is unchanged until the customer agrees');
:as_C;
select chk((select count(*) = 1 and total = 2200 from task_quotes group by total), 'the customer sees the approved quote and its total');
:as_C2;
select expect_error(format($$select decide_quote_customer('%s', true)$$, :'q1'), 'another customer cannot decide');
:as_C;
select decide_quote_customer(:'q1', true);
select decide_quote_customer(:'q1', true);
select chk((select est_cost = 2200 and price_status = 'confirmed' from tasks where id = :'t3'), 'both approvals change the price, once');
:as_P;
select propose_quote(:'t3', '[{"label":"Everything","kind":"specialist","amount":2000}]', 'We found a cheaper way to do it.') as q2 \gset
select chk((select status = 'customer_approved' from task_quotes where id = :'q1'), 'an earlier approved quote is kept in the history');
:as_AD;
select decide_quote_admin(:'q2', true);
:as_C;
select decide_quote_customer(:'q2', false);
:as_db;
select chk((select est_cost = 2200 from tasks where id = :'t3'), 'a declined revision leaves the agreed price alone');
select chk((select count(*) = 2 and bool_or(version = 1 and status = 'customer_approved') and bool_or(version = 2 and status = 'rejected') from task_quotes), 'versions and outcomes are all preserved');
select chk((select count(*) >= 4 from audit_log where action like 'task.quote%'), 'quote steps are audited');

-- ============================================================ what a customer may see about their PM
:as_C;
select chk((pm_public_profile(:'U_P') ->> 'name') = 'Rakesh', 'a customer sees the PM assigned to their task');
select chk(not (pm_public_profile(:'U_P')::text ~* '(phone|email|98200)'), 'the profile has no phone or email');
select chk(jsonb_array_length(pm_public_profile(:'U_P') -> 'verified_skills') >= 1, 'verified skills are listed');
:as_C2;
select expect_error(format($$select pm_public_profile('%s')$$, :'U_P'), 'a customer with no task for this PM cannot look them up');
:as_P;
select expect_error(format($$select pm_public_profile('%s')$$, :'U_Q'), 'PMs cannot browse each other''s profiles');
-- A project that already ran the first version of the sample catalogue has the old specialist services published.
:as_db;
delete from platform_settings where key = 'catalogue_correction_0010';
update service_families set status = 'published' where key = 'home-repairs';
insert into catalogue_services (key, family_id, category, status, current_version, draft)
  select 'plumbing-coordination', id, 'handyman', 'published', 1, '{"title":"Plumbing repair (we arrange a plumber)","description":"x","pricing":{"approach":"manual_quote"}}' from service_families where key = 'home-repairs';
insert into catalogue_service_versions (service_id, version, definition) select id, 1, draft from catalogue_services where key = 'plumbing-coordination';
\i ../migrations/0010_catalogue_correction.sql
select chk((select status = 'archived' from catalogue_services where key = 'plumbing-coordination'), 'upgrading archives a specialist service an earlier version published');
select chk((select status = 'paused' from service_families where key = 'home-repairs'), 'and pauses the home-repairs family');
:as_C;
select chk((select not exists (select 1 from jsonb_array_elements(catalogue()) f, jsonb_array_elements(f -> 'services') s where s ->> 'key' = 'plumbing-coordination')), 'customers no longer see it');
:as_db;
update catalogue_services set status = 'published' where key = 'plumbing-coordination';
\i ../migrations/0010_catalogue_correction.sql
select chk((select status = 'published' from catalogue_services where key = 'plumbing-coordination'), 're-running the migration does not re-archive something an admin reinstated');
-- family images (migration 0011 comes after the 0010 we just re-ran)
:as_db;
\i ../migrations/0011_family_images.sql
:as_AD;
select set_family_image((select id from service_families where key = 'everyday-tech'), 'https://example.com/tech.jpg', 'A person helping set up a phone');
:as_C;
select chk((select (f ->> 'image_url') = 'https://example.com/tech.jpg' and (f ->> 'image_alt') like 'A person%' from jsonb_array_elements(catalogue()) f where f ->> 'key' = 'everyday-tech'), 'customers receive a family image link and its description');
select expect_error($$select set_family_image((select id from service_families limit 1), 'https://x.test/a.jpg')$$, 'a customer cannot set a family image');
:as_SU;
select expect_error($$select set_family_image((select id from service_families limit 1), 'https://x.test/a.jpg')$$, 'a support admin cannot set one either');
:as_AD;
select expect_error($$select set_family_image((select id from service_families limit 1), 'http://insecure.test/a.jpg')$$, 'only https links are accepted');
select expect_error($$select set_family_image((select id from service_families limit 1), 'javascript:alert(1)')$$, 'a script link is refused');
select set_family_image((select id from service_families where key = 'everyday-tech'), '');
:as_C;
select chk((select (f ->> 'image_url') is null from jsonb_array_elements(catalogue()) f where f ->> 'key' = 'everyday-tech'), 'clearing the link falls back to the built-in artwork');
:as_db;
select chk(true, 'qualifications suite finished');
