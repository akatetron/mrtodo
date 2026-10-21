-- Catalogue, general requests, multi-task bookings and the multi-day approval flow.
\i helpers.sql
select seed_people();
update platform_settings set value = '200' where key = 'max_tasks_per_hour';
select id as fam from service_families where key = 'everyday-tech' \gset

-- ============================================================ who may manage the catalogue
:as_C;
select expect_error($$select save_family('x-family', 'X family', null, null, 1, 'published')$$, 'a customer cannot create a family');
select expect_error($$select save_service_draft('x', (select id from service_families limit 1), 'general', '{}'::jsonb)$$, 'a customer cannot create a service');
:as_SU;
select expect_error($$select save_family('x-family', 'X family', null, null, 1, 'published')$$, 'a support admin cannot manage the catalogue');
:as_P;
select chk((select count(*) from service_families) = 0, 'Personal Managers cannot read the raw catalogue tables');

-- ============================================================ building a service
:as_AD;
select save_service_draft('test-wifi-setup', :'fam', 'general', jsonb_build_object(
  'title', 'Test Wi-Fi setup', 'description', 'Get your Wi-Fi working again.',
  'questions', jsonb_build_array(
     jsonb_build_object('id', 'router', 'type', 'single_choice', 'label', 'Do you have a router?', 'required', true, 'options', jsonb_build_array('Yes', 'No')),
     jsonb_build_object('id', 'router_model', 'type', 'short_text', 'label', 'Which router?', 'required', true, 'show_if', jsonb_build_object('question', 'router', 'equals', 'Yes')),
     jsonb_build_object('id', 'notes', 'type', 'long_text', 'label', 'Anything else?')),
  'pricing', jsonb_build_object('approach', 'manual_quote', 'currency', 'INR'))) as svc_wifi \gset
select chk(array_length(service_readiness(:'svc_wifi'), 1) is null, 'a complete draft has nothing blocking publishing');

select save_service_draft('bad-svc', :'fam', 'general', jsonb_build_object('title', 'x', 'description', 'short', 'pricing', jsonb_build_object('approach', 'time_based'))) as svc_bad \gset
select chk(array_length(service_readiness(:'svc_bad'), 1) >= 3, 'an incomplete draft lists what is missing');
select expect_error(format($$select publish_service('%s')$$, :'svc_bad'), 'an incomplete service cannot be published');
select save_service_draft('photo-svc', :'fam', 'general', jsonb_build_object('title', 'Photo service', 'description', 'Needs photos please.',
  'questions', jsonb_build_array(jsonb_build_object('id', 'pic', 'type', 'photo', 'label', 'Photo')),
  'pricing', jsonb_build_object('approach', 'manual_quote'))) as svc_photo \gset
select expect_error(format($$select publish_service('%s')$$, :'svc_photo'), 'photo questions are refused until supported');
select save_service_draft('fixed-no-price', :'fam', 'general', jsonb_build_object('title', 'Fixed no price', 'description', 'A fixed service.',
  'pricing', jsonb_build_object('approach', 'fixed'))) as svc_np \gset
select expect_error(format($$select publish_service('%s')$$, :'svc_np'), 'a fixed price service needs an amount');

select chk(publish_service(:'svc_wifi') = 1, 'a ready service publishes as version 1');
select save_service_draft('test-phone-setup', :'fam', 'general', jsonb_build_object('title', 'Test phone setup', 'description', 'Set up a new phone.',
  'duration_minutes', 60, 'pricing', jsonb_build_object('approach', 'fixed', 'price', 500, 'currency', 'INR'))) as svc_phone \gset
select publish_service(:'svc_phone');
select save_service_draft('draft-only', :'fam', 'general', jsonb_build_object('title', 'Draft only', 'description', 'Not published yet.',
  'pricing', jsonb_build_object('approach', 'manual_quote'))) as svc_draft \gset

:as_C;
select chk((select count(*) = 2 from jsonb_array_elements(catalogue()) f, jsonb_array_elements(f -> 'services') s where f ->> 'key' = 'everyday-tech' and s -> 'definition' ->> 'title' like 'Test%'),
           'customers see published services only (the draft is hidden)');
select chk((select count(*) from catalogue_services) = 0, 'customers cannot read catalogue tables directly');
:as_anon;
select expect_error($$select catalogue()$$, 'signed-out visitors cannot read the catalogue');

-- ============================================================ booking from the catalogue
:as_C;
insert into tasks (customer_id, title, category, location, service_id, est_cost, answers)
values (auth.uid(), 'Phone setup for me', 'handyman', 'Flat 4B, Kandivali West', :'svc_phone', 1, '{}');
select id as t_phone from tasks where title = 'Phone setup for me' \gset
select chk((select est_cost = 500 and price_status = 'confirmed' and price_source = 'service' and service_version = 1 and category = 'general'
                   and review_state = 'ready' and routing_mode = 'broadcast' and est_duration_minutes = 60
                   and service_snapshot -> 'pricing' ->> 'approach' = 'fixed'
              from tasks where id = :'t_phone'), 'a fixed-price service applies its price and records the version and pricing it was booked at');
select expect_error(format($$insert into tasks (customer_id, title, category, location, service_id, answers) values (auth.uid(), 'Wifi', 'general', 'Flat 4B, Kandivali West', '%s', '{}')$$, :'svc_wifi'),
  'missing required answers are refused');
select expect_error(format($$insert into tasks (customer_id, title, category, location, service_id, answers) values (auth.uid(), 'Wifi', 'general', 'Flat 4B, Kandivali West', '%s', '{"router":"Maybe"}')$$, :'svc_wifi'),
  'an answer outside the offered options is refused');
select expect_error(format($$insert into tasks (customer_id, title, category, location, service_id, answers) values (auth.uid(), 'Wifi', 'general', 'Flat 4B, Kandivali West', '%s', '{"router":"Yes"}')$$, :'svc_wifi'),
  'a conditional question becomes required when its condition is met');
insert into tasks (customer_id, title, category, location, service_id, answers)
values (auth.uid(), 'Wifi at home', 'general', 'Flat 4B, Kandivali West', :'svc_wifi', '{"router":"No","router_model":"ignored"}');
select id as t_wifi from tasks where title = 'Wifi at home' \gset
select chk((select est_cost is null and price_status = 'awaiting_approval' and review_state = 'needs_review' and routing_mode = 'admin' from tasks where id = :'t_wifi'),
           'a quote-required service waits for an admin price and review (never a confirmed price)');
select expect_error(format($$insert into tasks (customer_id, title, category, location, service_id) values (auth.uid(), 'Draft', 'general', 'Flat 4B, Kandivali West', '%s')$$, :'svc_draft'),
  'an unpublished service cannot be booked');
select expect_error(format($$insert into tasks (customer_id, title, category, location, service_id, template_id) values (auth.uid(), 'Both', 'handyman', 'Flat 4B, Kandivali West', '%s', (select id from task_templates where key='fix-leaking-tap'))$$, :'svc_phone'),
  'a template and a service cannot both be used');

-- generic request: never forced into a wrong category, never "booked"
insert into tasks (customer_id, title, category, location, description) values (auth.uid(), 'Help me sort a thing', 'general', 'Flat 4B, Kandivali West', 'Not sure what kind of help.');
select chk((select review_state = 'needs_review' and est_cost is null and price_status = 'awaiting_approval' and category = 'general' from tasks where title = 'Help me sort a thing'),
           'a general request goes to admin review with no price');

-- editing a service never rewrites an existing booking
:as_AD;
select save_service_draft('test-phone-setup', :'fam', 'general', jsonb_build_object('title', 'Test phone setup', 'description', 'Set up a new phone.',
  'pricing', jsonb_build_object('approach', 'fixed', 'price', 900, 'currency', 'INR'))) as _x \gset
select chk(publish_service(:'svc_phone') = 2, 'republishing creates version 2');
select expect_error($$update catalogue_service_versions set definition = '{}'$$, 'a published version cannot be edited');
select expect_error($$delete from catalogue_service_versions$$, 'a published version cannot be deleted');
:as_C;
select chk((select est_cost = 500 and service_version = 1 from tasks where id = :'t_phone'), 'an existing booking keeps the price and version it was made at');
insert into tasks (customer_id, title, category, location, service_id) values (auth.uid(), 'Phone setup again', 'general', 'Flat 4B, Kandivali West', :'svc_phone');
select chk((select est_cost = 900 and service_version = 2 from tasks where title = 'Phone setup again'), 'a new booking gets the new version');
:as_AD;
select set_service_status(:'svc_phone', 'paused');
:as_C;
select expect_error(format($$insert into tasks (customer_id, title, category, location, service_id) values (auth.uid(), 'Paused', 'general', 'Flat 4B, Kandivali West', '%s')$$, :'svc_phone'), 'a paused service cannot be booked');
select chk((select t.est_cost = 500 from tasks t where id = :'t_phone'), 'pausing keeps history intact');
:as_AD;
select chk((select count(*) from catalogue_services where status = 'archived') = 0, 'nothing archived yet');
select set_service_status(:'svc_phone', 'archived');
select chk((select count(*) from tasks where service_id = :'svc_phone') = 2, 'archiving keeps historical bookings');
select duplicate_service(:'svc_wifi', 'test-wifi-setup-2') as svc_copy \gset
select chk((select draft ->> 'title' = 'Test Wi-Fi setup' and status = 'draft' and current_version = 0 from catalogue_services where id = :'svc_copy'), 'a duplicated service starts as an unpublished draft');
select reorder_services(array[:'svc_wifi'::uuid, :'svc_copy'::uuid]);
select chk((select sort_order from catalogue_services where id = :'svc_wifi') < (select sort_order from catalogue_services where id = :'svc_copy'), 'services can be reordered');
select chk((select count(*) from audit_log where action like 'catalogue.%') >= 6, 'catalogue changes are in the audit log');

-- ============================================================ bookings with several tasks
select save_service_draft('test-phone-setup', :'fam', 'general', jsonb_build_object('title', 'Test phone setup', 'description', 'Set up a new phone.',
  'pricing', jsonb_build_object('approach', 'fixed', 'price', 500, 'currency', 'INR'))) as _y \gset
select publish_service(:'svc_phone');
select set_service_status(:'svc_phone', 'published');
:as_C;
select create_booking(
  jsonb_build_array(
    jsonb_build_object('service_id', :'svc_phone', 'title', 'Set up the new phone'),
    jsonb_build_object('service_id', :'svc_wifi', 'title', 'Fix the Wi-Fi', 'answers', jsonb_build_object('router', 'No')),
    jsonb_build_object('title', 'Help sort a few things', 'description', 'Odds and ends', 'category', 'general')),
  jsonb_build_object('location', 'Flat 12, Andheri East', 'for_whom', 'other', 'recipient_name', 'Kamala Bai', 'recipient_relation', 'Mother',
                     'recipient_consent', true, 'share_updates', true, 'recipient_phone', '98200 55555'),
  '11111111-1111-1111-1111-111111111111') as bk \gset
select chk((select (b -> 'total')::int = 3 and (b -> 'awaiting_price')::int = 2 and (b -> 'confirmed_total')::numeric = 500
              from (select booking_summary(:'bk') b) x), 'the summary lists every task, sums only confirmed prices and counts the rest as waiting');
select chk((select count(*) = 3 and count(distinct status) = 1 and bool_and(for_whom = 'other') from tasks where booking_id = :'bk'), 'each task is its own item with its own status');
select chk(create_booking(jsonb_build_array(jsonb_build_object('title', 'Another', 'category', 'general')), '{"location":"Flat 12, Andheri East"}',
           '11111111-1111-1111-1111-111111111111') = :'bk', 'retrying with the same key returns the same booking');
select chk((select count(*) = 3 from tasks where booking_id = :'bk'), 'a retry creates no duplicate tasks');
select chk((select recipient_consent_at is not null and share_updates from bookings where id = :'bk'), 'the recipient consent is recorded with the booking');
select chk((select not exists (select 1 from tasks where booking_id = :'bk' and recipient_phone is not null)), 'the recipient phone is not stored on the task rows');
select expect_error($$select create_booking('[{"title":"Item","category":"general"}]', '{"location":"Flat 12, Andheri East","for_whom":"other","recipient_name":"Kamala Bai"}')$$,
  'booking for someone else needs their consent to be confirmed');
select expect_error($$select create_booking('[]', '{"location":"Flat 12, Andheri East"}')$$, 'an empty booking is refused');
select expect_error(format($$select create_booking((select jsonb_agg(jsonb_build_object('title','Item','category','general')) from generate_series(1,11)), '{"location":"%s"}')$$, 'Flat 12, Andheri East'), 'more than ten tasks are refused');
:as_C2;
select expect_error(format($$select booking_summary('%s')$$, :'bk'), 'another customer cannot read the booking');
select expect_error(format($$insert into tasks (customer_id, title, category, location, booking_id) values (auth.uid(), 'Sneak in', 'general', 'Flat 12, Andheri East', '%s')$$, :'bk'), 'nobody can attach a task to someone else''s booking');

-- ============================================================ single-day to multi-day
:as_AD;
select approve_task_price(:'t_wifi', 400);
:as_C;
select confirm_task_price(:'t_wifi');
:as_AD;
select assign_task(:'t_phone', :'U_P');
select assign_task(:'t_wifi', :'U_P');
:as_P;
select accept_task(:'t_phone');
select accept_task(:'t_wifi');
select start_task(:'t_phone');

:as_C;
select expect_error(format($$select request_multiday_change('%s', 'The job needs more time than planned.', '[{"date":"2026-11-02"}]')$$, :'t_phone'), 'a customer cannot request the change');
:as_Q;
select expect_error(format($$select request_multiday_change('%s', 'The job needs more time than planned.', '[{"date":"2026-11-02"}]')$$, :'t_phone'), 'a different PM cannot request it');
:as_P;
select expect_error(format($$select request_multiday_change('%s', 'short', '[{"date":"2026-11-02"}]')$$, :'t_phone'), 'a reason is required');
select expect_error(format($$select request_multiday_change('%s', 'The job needs more time than planned.', '[]')$$, :'t_phone'), 'at least one visit is required');
select request_multiday_change(:'t_phone', 'The job needs more time than planned.', '[{"date":"2026-11-02","note":"Finish setup"}]', 180, 250) as chg \gset
select expect_error(format($$select request_multiday_change('%s', 'Asking a second time again.', '[{"date":"2026-11-03"}]')$$, :'t_phone'), 'a second open request is refused');
select chk((select schedule_kind = 'single_day' and scope_version = 1 and extra_amount = 0 from tasks where id = :'t_phone'), 'nothing changes while the request is pending');
:as_C;
select chk((select count(*) = 0 from task_scope_changes), 'the customer does not see a request before the admin has decided');
select expect_error(format($$select decide_scope_change_customer('%s', true)$$, :'chg'), 'the customer cannot approve before the admin');
:as_P;
select expect_error(format($$select decide_scope_change_admin('%s', true)$$, :'chg'), 'a PM cannot approve their own request');
:as_C;
select expect_error(format($$select decide_scope_change_admin('%s', true)$$, :'chg'), 'a customer cannot play the admin');
:as_SU;
select decide_scope_change_admin(:'chg', true, 'Fine by us', 200);
select decide_scope_change_admin(:'chg', true, 'Fine by us', 200);
:as_db;
select chk((select schedule_kind = 'single_day' and extra_amount = 0 and scope_version = 1 from tasks where id = :'t_phone'), 'admin approval alone does not change the task');
:as_C;
select chk((select count(*) = 1 and bool_and(status = 'approved_by_admin' and approved_price_impact = 200) from task_scope_changes), 'the customer now sees the admin-approved terms');
:as_C2;
select expect_error(format($$select decide_scope_change_customer('%s', true)$$, :'chg'), 'another customer cannot decide');
:as_C;
select decide_scope_change_customer(:'chg', true);
select decide_scope_change_customer(:'chg', true);
select chk((select schedule_kind = 'multi_day' and scope_version = 2 and extra_amount = 200 and est_duration_minutes = 180 and est_cost = 500 and jsonb_array_length(schedule_plan) = 1
              from tasks where id = :'t_phone'), 'with both approvals the task becomes multi-day, once, with the agreed extra amount');
:as_P;
select expect_error(format($$select request_multiday_change('%s', 'Already multi-day so no again.', '[{"date":"2026-11-09"}]')$$, :'t_phone'), 'a multi-day task cannot be converted again');
:as_db;
select chk((select count(*) >= 3 from audit_log where entity_id = :'t_phone' and action like 'task.scope_change%'), 'request, decision and application are all audited');
select chk((select count(*) >= 2 from notifications where task_id = :'t_phone' and (title like '%ulti-day%' or title like '%review a change%')), 'the people involved were notified');

-- rejection paths and withdrawal
:as_P;
select request_multiday_change(:'t_wifi', 'Needs another visit after the parts arrive.', '[{"date":"2026-11-05"}]') as chg2 \gset
:as_AD;
select decide_scope_change_admin(:'chg2', false, 'Not needed');
:as_P;
select chk((select status = 'rejected' from task_scope_changes where id = :'chg2'), 'an admin can reject');
select request_multiday_change(:'t_wifi', 'Second attempt with better detail.', '[{"date":"2026-11-06"}]') as chg3 \gset
:as_AD;
select decide_scope_change_admin(:'chg3', true);
:as_C;
select decide_scope_change_customer(:'chg3', false);
:as_db;
select chk((select schedule_kind = 'single_day' and extra_amount = 0 from tasks where id = :'t_wifi'), 'a customer refusal leaves the original agreement in force');
:as_P;
select request_multiday_change(:'t_wifi', 'Third attempt, withdrawing soon.', '[{"date":"2026-11-07"}]') as chg4 \gset
select withdraw_scope_change(:'chg4');
:as_AD;
select expect_error(format($$select decide_scope_change_admin('%s', true)$$, :'chg4'), 'a withdrawn request cannot be approved');
:as_db;
select chk(true, 'catalogue and scope suite finished');
