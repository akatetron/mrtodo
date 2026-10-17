-- Backend overhaul, part 1: price protection, templates, privacy, audit trail,
-- completion codes, evidence, Gold Tier and commission. Every line that starts
-- "ok" is a check that passed; the first failure stops the run.
\i helpers.sql
select seed_people();
update platform_settings set value = '100' where key = 'max_tasks_per_hour';   -- most checks post several tasks

select id as tpl_tap  from task_templates where key = 'fix-leaking-tap' \gset
select id as tpl_deep from task_templates where key = 'deep-clean-home' \gset

-- ============================================================ price protection
:as_anon;
select expect_error($$insert into tasks (customer_id, title, category, location) values ('00000000-0000-0000-0000-0000000000c1', 'Anon task', 'handyman', 'Somewhere 1')$$, 'signed-out visitors cannot post tasks');

:as_P;
select expect_error($$insert into tasks (customer_id, title, category, location) values (auth.uid(), 'PM task', 'handyman', 'Somewhere 1')$$, 'a Personal Manager cannot post a task');

:as_C;
insert into tasks (customer_id, title, category, location, est_cost, rate_per_day, price_status, price_source, routing_mode, is_premium, pm_share_bps, status)
values (auth.uid(), 'Fix tap', 'handyman', 'Flat 4B, Kandivali West', 1, 2, 'confirmed', 'admin', 'broadcast', true, 9999, 'completed');
select id as t_tap from tasks where title = 'Fix tap' \gset
select chk((select est_cost is null and rate_per_day is null and price_status = 'awaiting_approval' and price_source is null
                   and routing_mode = 'admin' and not is_premium and pm_share_bps is null and status = 'requested'
              from tasks where id = :'t_tap'),
           'customer-supplied prices and internal fields are ignored');
select expect_error($$insert into tasks (customer_id, title, category, location) values ('00000000-0000-0000-0000-0000000000c2', 'For someone else', 'handyman', 'Somewhere 1')$$, 'a customer cannot post a task for another customer');
select expect_error($$insert into tasks (customer_id, title, category, location) values (auth.uid(), 'x', 'handyman', 'Somewhere 1')$$, 'a one-letter title is rejected');
select expect_error($$insert into tasks (customer_id, title, category, location) values (auth.uid(), 'Good title', 'astrology', 'Somewhere 1')$$, 'an unknown category is rejected');
update tasks set est_cost = 1, price_status = 'confirmed' where id = :'t_tap';
select chk((select est_cost is null and price_status = 'awaiting_approval' from tasks where id = :'t_tap'), 'a customer cannot edit price fields afterwards');
select expect_error($$select approve_task_price((select id from tasks where title = 'Fix tap'), 500)$$, 'a customer cannot approve a price');

-- templates: the only way to a price without an admin
insert into tasks (customer_id, title, category, location, est_cost, template_id)
values (auth.uid(), 'Leaky tap at home', 'handyman', 'Flat 9, Malad West', 1, :'tpl_tap');
select id as t_tpl from tasks where title = 'Leaky tap at home' \gset
select chk((select est_cost = 650 and rate_per_day is null and price_source = 'template' and price_status = 'confirmed'
                   and template_version = 1 and routing_mode = 'broadcast' and est_duration_minutes = 60 and price_confirmed_at is not null
              from tasks where id = :'t_tpl'),
           'a template applies its approved price and ignores the customer''s number');
select expect_error($$insert into tasks (customer_id, title, category, location, template_id) values (auth.uid(), 'Wrong category', 'cleaning', 'Somewhere 1', (select id from task_templates where key = 'fix-leaking-tap'))$$, 'a template cannot be used for another category');
select expect_error(format($f$insert into tasks (customer_id, title, category, location, template_id) values (auth.uid(), 'Inactive template', 'cleaning', 'Somewhere 1', %L)$f$, :'tpl_deep'), 'an inactive template cannot price tasks');
select chk((select count(*) from task_templates) = 1, 'customers only see active templates');

-- an ongoing task is priced per day
insert into tasks (customer_id, title, category, task_type, location) values (auth.uid(), 'Daily care visits', 'care', 'ongoing', 'Borivali East');
select id as t_ong from tasks where title = 'Daily care visits' \gset
insert into tasks (customer_id, title, category, location) values (auth.uid(), 'Unpriced job', 'handyman', 'Andheri West');
select id as t_unpriced from tasks where title = 'Unpriced job' \gset

-- ============================================================ admin price approval
:as_AD;
select expect_error($$select approve_task_price((select id from tasks where title = 'Fix tap'), -5)$$, 'a negative price is refused');
select expect_error($$select approve_task_price((select id from tasks where title = 'Fix tap'), 0)$$, 'a zero price is refused');
select expect_error($$select approve_task_price((select id from tasks where title = 'Fix tap'), 2000000)$$, 'an absurd price is refused');
select approve_task_price(:'t_tap', 750.456, 'Includes parts');
select chk((select est_cost = 750.46 and rate_per_day is null and price_source = 'admin' and price_status = 'awaiting_confirmation'
                   and price_approved_by = auth.uid() and price_approved_at is not null from tasks where id = :'t_tap'),
           'admin approval sets the price, rounds to cents and waits for the customer');
select chk((select before_value is not null and after_value is not null and (after_value->>'amount')::numeric = 750.46
              from audit_log where action = 'task.price_approved' and entity_id = :'t_tap'),
           'price approval is audited with before and after values');
select approve_task_price(:'t_ong', 400);
select chk((select rate_per_day = 400 and est_cost is null from tasks where id = :'t_ong'), 'an ongoing task is priced per day');
select expect_error($$select approve_task_price((select id from tasks where title = 'Leaky tap at home'), 500)$$, 'a template price cannot be overridden by an admin');

-- ============================================================ assignment needs an approved price
:as_SU;
select expect_error($$select assign_task((select id from tasks where title = 'Unpriced job'), '00000000-0000-0000-0000-0000000000a1')$$, 'a task without an approved price cannot be assigned');
select assign_task(:'t_tpl', :'U_P');
select chk((select status = 'matched' from tasks where id = :'t_tpl'), 'a template task can be assigned straight away');
select assign_task(:'t_tpl', :'U_P');
select chk((select count(*) from audit_log where action = 'task.assigned' and entity_id = :'t_tpl') = 1, 'assigning to the same PM twice does nothing the second time');

:as_C2;
select expect_error(format('select confirm_task_price(%L)', :'t_tap'), 'another customer cannot confirm my price');
:as_C;
select expect_error($$select confirm_task_price((select id from tasks where title = 'Unpriced job'))$$, 'there is nothing to confirm before an admin sets a price');
select confirm_task_price(:'t_tap');
select confirm_task_price(:'t_tap');
select chk((select price_status = 'confirmed' and price_confirmed_at is not null from tasks where id = :'t_tap'), 'the customer confirms the price (and repeating it is harmless)');

-- the full flow: approve, assign, accept, start needs the confirmed price
insert into tasks (customer_id, title, category, location) values (auth.uid(), 'Flow task', 'handyman', 'Flat 2, Kandivali West');
select id as t_flow from tasks where title = 'Flow task' \gset
:as_AD;
select approve_task_price(:'t_flow', 600);
select assign_task(:'t_flow', :'U_P');
:as_P;
select accept_task(:'t_flow');
select expect_error($$select start_task((select id from tasks where title = 'Flow task'))$$, 'work cannot start until the customer has confirmed the price');
:as_C;
select confirm_task_price(:'t_flow');
:as_P;
select start_task(:'t_flow');
select start_task(:'t_flow');
select chk((select status = 'in_progress' from tasks where id = :'t_flow'), 'starting works once the price is confirmed, and repeating it is harmless');
:as_AD;
select expect_error($$select approve_task_price((select id from tasks where title = 'Flow task'), 700)$$, 'the price cannot change once a PM is on the task');

-- ============================================================ templates (super admin only)
:as_SU;
select expect_error($$select save_template('deep-clean-home', 'Deep clean my home', 'cleaning', 'x', 'one-time', 1800, 'INR', 180, false, true)$$, 'a support admin cannot manage templates');
:as_AD;
select expect_error($$select save_template('new-thing', 'New thing', 'cleaning', 'x', 'one-time', null, 'INR', 60, false, true)$$, 'a template cannot be switched on without an approved price');
select save_template('deep-clean-home', 'Deep clean my home', 'cleaning', 'Full clean of kitchen, bathrooms and all rooms.', 'one-time', 1800, 'INR', 180, false, true);
select chk((select version = 2 and is_active and price = 1800 and approved_at is not null and approved_by is not null from task_templates where key = 'deep-clean-home'), 'a super admin prices and activates a template (version goes up)');
select save_template('deep-clean-home', 'Deep clean my whole home', 'cleaning', 'Full clean of kitchen, bathrooms and all rooms.', 'one-time', 1800, 'INR', 180, false, true);
select chk((select version = 2 from task_templates where key = 'deep-clean-home'), 'renaming a template does not change its version');
:as_C;
insert into tasks (customer_id, title, category, location, template_id) values (auth.uid(), 'Deep clean flat', 'cleaning', 'Flat 3, Powai', :'tpl_deep');
:as_AD;
select save_template('deep-clean-home', 'Deep clean my whole home', 'cleaning', 'Full clean of kitchen, bathrooms and all rooms.', 'one-time', 1950, 'INR', 180, false, true);
select chk((select est_cost = 1800 and template_version = 2 from tasks where title = 'Deep clean flat'), 'an existing task keeps the price and version it was posted at');
select chk((select version = 3 from task_templates where key = 'deep-clean-home'), 'a price change creates a new template version');

-- ============================================================ settings
:as_SU;
select expect_error($$select set_setting('premium_window_seconds', '240')$$, 'a support admin cannot change settings');
:as_AD;
select expect_error($$select set_setting('premium_window_seconds', '"soon"')$$, 'a setting of the wrong type is refused');
select expect_error($$select set_setting('premium_window_seconds', '-1')$$, 'a negative setting is refused');
select expect_error($$select set_setting('standard_pm_share_bps', '20000')$$, 'basis points above 100% are refused');
select expect_error($$select set_setting('no_such_setting', '1')$$, 'an unknown setting is refused');
select set_setting('premium_window_seconds', '240');
select chk((select (before_value->>'value')::int = 180 and (after_value->>'value')::int = 240 from audit_log where action = 'setting.changed' order by id desc limit 1), 'a setting change is audited with before and after');
select set_setting('premium_window_seconds', '180');
:as_C;
select chk((select count(*) = 0 from platform_settings), 'customers cannot read settings');

-- ============================================================ privacy
:as_C;
select expect_error($$select phone from profiles where id = '00000000-0000-0000-0000-0000000000a1'$$, 'phone numbers are not readable from profiles');
select expect_error($$select email from profiles where id = '00000000-0000-0000-0000-0000000000a1'$$, 'emails are not readable from profiles');
select expect_error($$select * from profiles$$, 'select * on profiles is refused (apps must name the columns they need)');
select chk((select full_name = 'Rakesh' from profiles where id = '00000000-0000-0000-0000-0000000000a1'), 'name and rating of the PM on my task are readable');
select chk((select phone = '98200 11111' from my_contact()), 'I can read my own number');
:as_P;
select chk((select phone = '98200 22222' and email = 'p@x' from my_contact()), 'a PM reads only their own contact details');
:as_C;
select expect_error($$select * from admin_contacts(array['00000000-0000-0000-0000-0000000000a1']::uuid[])$$, 'a customer cannot ask for contact details');
:as_SU;
select chk((select count(*) = 2 from admin_contacts(array['00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1']::uuid[])), 'an admin can look up contact details');
select chk((select count(*) >= 1 from audit_log where action = 'contacts.viewed'), 'looking up contact details is audited');

:as_C;
insert into tasks (customer_id, title, category, location, for_whom, recipient_name, recipient_phone)
values (auth.uid(), 'Errand for mum', 'care', 'Malad West', 'other', 'Kamala Bai', '98200 77777');
select id as t_mum from tasks where title = 'Errand for mum' \gset
select chk((select recipient_phone is null from tasks where id = :'t_mum'), 'the phone typed for someone else is not stored on the task');
select expect_error($$select * from task_contacts$$, 'customers cannot read stored contact numbers');
:as_P;
select expect_error($$select * from task_contacts$$, 'PMs cannot read stored contact numbers');
:as_AD;
select chk((select recipient_phone = '98200 77777' from admin_task_contact(:'t_mum')), 'an admin can read it, and it is audited');

-- a PM sees the area, not the address, until they accept
:as_P;
select chk((select count(*) = 0 from tasks where id = :'t_tpl'), 'an offered task is not readable by the PM before they accept');
select chk((select count(*) = 1 and bool_and(area = 'Malad West') from pm_offers() where id = :'t_tpl'), 'the offer shows the area only');
select chk(pg_get_function_result('public.pm_offers()'::regprocedure) !~* 'location|customer|phone|email', 'the offer carries no street address or customer details');
select accept_task(:'t_tpl');
select chk((select location = 'Flat 9, Malad West' from tasks where id = :'t_tpl'), 'the full address appears once the PM accepts');
select chk((select count(*) = 0 from pm_offers() where id = :'t_tpl'), 'an accepted task is no longer an offer');

-- ============================================================ audit trail
:as_db;
select expect_error($$update audit_log set action = 'tampered' where id = (select min(id) from audit_log)$$, 'the audit log cannot be edited, even by the owner');
select expect_error($$delete from audit_log where id = (select min(id) from audit_log)$$, 'the audit log cannot be deleted from');
select expect_error($$truncate audit_log$$, 'the audit log cannot be truncated');
:as_C;
select expect_error($$insert into audit_log (action, entity) values ('forged', 'task')$$, 'users cannot write audit entries');
select expect_error($$update audit_log set action = 'x'$$, 'users cannot edit audit entries');
:as_db;
insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-0000000000e9', 'gone@x', '{"full_name":"Leaver"}');
insert into audit_log (actor_id, action, entity) values ('00000000-0000-0000-0000-0000000000e9', 'test.leaver', 'task');
delete from auth.users where id = '00000000-0000-0000-0000-0000000000e9';
select chk((select actor_id is null from audit_log where action = 'test.leaver'), 'deleting an account keeps its audit entries (the name is detached)');

-- ============================================================ rate limiting and idempotency
update platform_settings set value = '3' where key = 'max_tasks_per_hour';
:as_C2;
insert into tasks (customer_id, title, category, location) values (auth.uid(), 'Rate one', 'handyman', 'Place one');
insert into tasks (customer_id, title, category, location) values (auth.uid(), 'Rate two', 'handyman', 'Place two');
insert into tasks (customer_id, title, category, location) values (auth.uid(), 'Rate three', 'handyman', 'Place three');
select expect_error($$insert into tasks (customer_id, title, category, location) values (auth.uid(), 'Rate four', 'handyman', 'Place four')$$, 'a fourth task within the hour is refused');
:as_db;
update platform_settings set value = '100' where key = 'max_tasks_per_hour';
:as_C;
insert into tasks (customer_id, title, category, location, client_request_id) values (auth.uid(), 'Retried task', 'handyman', 'Place five', '11111111-1111-1111-1111-111111111111');
select expect_error($$insert into tasks (customer_id, title, category, location, client_request_id) values (auth.uid(), 'Retried task', 'handyman', 'Place five', '11111111-1111-1111-1111-111111111111')$$, 'retrying the same post request does not create a second task');

-- ============================================================ evidence rules
:as_P;
select expect_error($$insert into task_photos (task_id, kind, storage_path, content_type, size_bytes) values ((select id from tasks where title = 'Flow task'), 'before', (select id::text from tasks where title = 'Flow task') || '/before-x.jpg', 'application/pdf', 100)$$, 'a photo must be an image');
select expect_error($$insert into task_photos (task_id, kind, storage_path, content_type, size_bytes) values ((select id from tasks where title = 'Flow task'), 'before', (select id::text from tasks where title = 'Flow task') || '/before-x.jpg', 'image/jpeg', 20000000)$$, 'a photo over 10 MB is refused');
insert into task_photos (task_id, kind, storage_path, content_type, size_bytes, client_id)
  values (:'t_flow', 'before', :'t_flow' || '/before-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jpg', 'image/jpeg', 120000, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select expect_error($$insert into task_photos (task_id, kind, storage_path, content_type, size_bytes) values ((select id from tasks where title = 'Flow task'), 'before', (select id::text from tasks where title = 'Flow task') || '/before-y.jpg', 'image/jpeg', 100)$$, 'a task cannot have two Before photos');
select expect_error($$insert into task_photos (task_id, kind, storage_path, content_type, size_bytes, client_id) values ((select id from tasks where title = 'Flow task'), 'other', (select id::text from tasks where title = 'Flow task') || '/other-z.jpg', 'image/jpeg', 100, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')$$, 'a repeated upload with the same client id is recognised');
:as_Q;
select expect_error(format($f$insert into task_photos (task_id, kind, storage_path, content_type, size_bytes) values (%L, 'after', %L, 'image/jpeg', 100)$f$, :'t_flow', :'t_flow' || '/after-q.jpg'), 'another PM cannot add photos to my task');
select chk((select count(*) = 0 from task_photos), 'another PM cannot see my task''s photos');
:as_C;
select expect_error($$insert into task_photos (task_id, kind, storage_path, content_type, size_bytes) values ((select id from tasks where title = 'Flow task'), 'after', (select id::text from tasks where title = 'Flow task') || '/after-c.jpg', 'image/jpeg', 100)$$, 'a customer cannot add proof photos');
select chk((select count(*) = 1 from task_photos where task_id = :'t_flow'), 'the customer can see the proof photos');
:as_P;
insert into storage.objects (bucket_id, name) values ('task-photos', :'t_flow' || '/before-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.jpg');
select chk((select count(*) = 1 from storage.objects where bucket_id = 'task-photos'), 'the assigned PM can store a file under the task folder');
select expect_error($$insert into storage.objects (bucket_id, name) values ('task-photos', (select id::text from tasks where title = 'Flow task') || '/anything.exe')$$, 'a file name the database does not recognise is refused');
:as_Q;
select expect_error(format($f$insert into storage.objects (bucket_id, name) values ('task-photos', %L)$f$, :'t_flow' || '/after-cccccccc-cccc-cccc-cccc-cccccccccccc.jpg'), 'another PM cannot store files for my task');
select chk((select count(*) = 0 from storage.objects where bucket_id = 'task-photos'), 'another PM cannot list my task''s files');

-- ============================================================ completion code
:as_C;
select expect_error($$select * from task_otps$$, 'customers cannot read completion codes from the table');
:as_P;
select expect_error($$select * from task_otps$$, 'PMs cannot read completion codes');
:as_AD;
select expect_error($$select * from task_otps$$, 'admins cannot read completion codes either');

:as_C;
select expect_error($$select * from issue_completion_code((select id from tasks where title = 'Unpriced job'))$$, 'no code until a PM has accepted');
:as_C2;
select expect_error(format('select * from issue_completion_code(%L)', :'t_flow'), 'another customer cannot ask for my code');
:as_P;
select expect_error(format('select * from issue_completion_code(%L)', :'t_flow'), 'the PM cannot ask for the customer''s code');

:as_C;
select completion_code as c1 from issue_completion_code(:'t_flow') \gset
select chk(:'c1' ~ '^[0-9]{4}$', 'the customer is given a four-digit code');
select chk((select active and not locked and not expired from completion_code_state(:'t_flow')), 'the code is active');
select case when :'c1' = '1111' then '2222' else '1111' end as w \gset

-- a second task with no photos: completion is refused until the evidence exists
insert into tasks (customer_id, title, category, location, template_id) values (auth.uid(), 'No evidence task', 'handyman', 'Flat 6, Kandivali West', :'tpl_tap');
select id as t_noev from tasks where title = 'No evidence task' \gset
:as_AD;
select assign_task(:'t_noev', :'U_P');
:as_P;
select accept_task(:'t_noev');
select start_task(:'t_noev');
:as_C;
select completion_code as cn from issue_completion_code(:'t_noev') \gset
:as_P;
select chk(complete_task(:'t_noev', :'cn') = 'missing_evidence', 'completion is refused without Before and After photos');
:as_AD;
select chk((select status = 'in_progress' from tasks where id = :'t_noev'), 'a refused completion leaves the task untouched');

-- the proof photos for the main flow task: add the After photo
:as_P;
insert into task_photos (task_id, kind, storage_path, content_type, size_bytes)
  values (:'t_flow', 'after', :'t_flow' || '/after-dddddddd-dddd-dddd-dddd-dddddddddddd.jpg', 'image/jpeg', 130000);

-- wrong codes lock it; a locked code stays locked even if correct
select chk(complete_task(:'t_flow', :'w') = 'wrong', 'a wrong code is rejected (1 of 5)');
select chk(complete_task(:'t_flow', :'w') = 'wrong', 'a wrong code is rejected (2 of 5)');
select chk(complete_task(:'t_flow', 'abcd') = 'wrong', 'a malformed code counts as a wrong attempt (3 of 5)');
select chk(complete_task(:'t_flow', :'w') = 'wrong', 'a wrong code is rejected (4 of 5)');
select chk(complete_task(:'t_flow', :'w') = 'locked', 'the fifth wrong code locks it');
select chk(complete_task(:'t_flow', :'c1') = 'locked', 'the right code is refused while locked');
:as_C;
select chk((select locked from completion_code_state(:'t_flow')), 'the customer sees that it is locked');

-- showing a new code rotates the old one and clears the lock
select completion_code as c2 from issue_completion_code(:'t_flow') \gset
select chk((select active and not locked from completion_code_state(:'t_flow')), 'a fresh code clears the lockout');
select :'c1' <> :'c2' as differ \gset
\if :differ
:as_P;
select chk(complete_task(:'t_flow', :'c1') = 'wrong', 'the previous code no longer works after rotation');
\endif

-- expiry
:as_db;
update task_otps set expires_at = now() - interval '1 minute', failed_attempts = 0, locked_at = null where task_id = :'t_flow';
:as_P;
select chk(complete_task(:'t_flow', :'c2') = 'expired', 'an expired code is refused');
:as_C;
select completion_code as c3 from issue_completion_code(:'t_flow') \gset

-- other PMs, then the real completion
:as_Q;
select expect_error(format('select complete_task(%L, %L)', :'t_flow', '0000'), 'another PM cannot complete a task that is not theirs');
:as_P;
select chk(complete_task(:'t_flow', :'c3', 'phone-request-1') = 'ok', 'the right code completes the task');
select chk((select status = 'completed' and pm_share_bps = 8000 from tasks where id = :'t_flow'), 'the task is completed and the PM share is recorded');
select chk(complete_task(:'t_flow', :'c3', 'phone-request-1') = 'ok', 'repeating the same request (a dropped connection) is harmless');
select expect_error($$select complete_task((select id from tasks where title = 'Flow task'), '0000', 'a-different-request')$$, 'a different request cannot complete it twice');
select expect_error($$select complete_task((select id from tasks where title = 'Flow task'), '0000')$$, 'a completed task cannot be completed again');
:as_C;
select expect_error($$select * from issue_completion_code((select id from tasks where title = 'Flow task'))$$, 'no new code for a completed task');
:as_db;
select chk((select count(*) = 1 and bool_and(method = 'otp' and amount = 600 and pm_share_bps = 8000) from task_completions where task_id = :'t_flow'), 'exactly one verified completion record, with the amount and share');
select chk((select consumed_at is not null from task_otps where task_id = :'t_flow'), 'the code was used up by completion');
select chk((select jobs_done = 1 and verified_jobs = 1 from profiles where email = 'p@x'), 'the PM''s job counts come from the completion records');
select chk((select count(*) = 1 from notifications n join profiles p on p.id = n.user_id where p.email = 'c@x' and n.title like 'Task completed%'), 'the customer is told it was completed');

-- rate limiting on code attempts
:as_C;
insert into tasks (customer_id, title, category, location, template_id) values (auth.uid(), 'Rate limit task', 'handyman', 'Flat 8, Kandivali West', :'tpl_tap');
select id as t_rl from tasks where title = 'Rate limit task' \gset
:as_AD;
select assign_task(:'t_rl', :'U_P');
:as_P;
select accept_task(:'t_rl'); select start_task(:'t_rl');
insert into task_photos (task_id, kind, storage_path, content_type, size_bytes) values (:'t_rl', 'before', :'t_rl' || '/before-eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee.jpg', 'image/jpeg', 1000);
insert into task_photos (task_id, kind, storage_path, content_type, size_bytes) values (:'t_rl', 'after', :'t_rl' || '/after-ffffffff-ffff-ffff-ffff-ffffffffffff.jpg', 'image/jpeg', 1000);
:as_C;
select completion_code as crl from issue_completion_code(:'t_rl') \gset
:as_P;
select chk((select bool_or(complete_task(:'t_rl', '0000') = 'rate_limited') from generate_series(1, 14)), 'too many attempts in a short time are rate limited');
:as_db;
select chk((select count(*) >= 1 from ops_events where event = 'completion.rate_limited'), 'rate limiting is recorded for operators');
select chk((select count(*) >= 1 from ops_events where event = 'completion.wrong_code'), 'wrong codes are recorded for operators');
select chk(not exists (select 1 from ops_events where details ? 'code' or details::text ~* 'completion_code'), 'operator logs never contain completion codes');
select chk(not exists (select 1 from audit_log where details ? 'code' or details::text ~* 'completion_code'), 'the audit log never contains completion codes');

-- ============================================================ Gold Tier
-- Six extra PMs, each with a different record, all created by the operator.
insert into auth.users (id, email, raw_user_meta_data)
select ('00000000-0000-0000-0000-00000000f' || lpad(g::text, 3, '0'))::uuid, 'g' || g || '@x', jsonb_build_object('full_name', 'Gold test ' || g, 'role', 'worker')
  from generate_series(1, 7) g;
update profiles set worker_status = 'approved', categories = array['handyman'] where email ~ '^g[0-9]@x$';
select id as g1 from profiles where email = 'g1@x' \gset
select id as g2 from profiles where email = 'g2@x' \gset
select id as g3 from profiles where email = 'g3@x' \gset
select id as g4 from profiles where email = 'g4@x' \gset
select id as g5 from profiles where email = 'g5@x' \gset
select id as g6 from profiles where email = 'g6@x' \gset
select id as g7 from profiles where email = 'g7@x' \gset


create function public.make_jobs(p_worker uuid, p_method text, p_ratings int[]) returns void language plpgsql as $$
declare i int; tid uuid;
begin
  for i in 1 .. array_length(p_ratings, 1) loop
    insert into tasks (customer_id, assigned_worker_id, title, category, location, status, est_cost, price_status, price_source,
                       customer_rating_of_worker, completed_at, accepted_at, assigned_at)
    values ('00000000-0000-0000-0000-0000000000c1', p_worker, 'Gold job ' || p_worker || ' ' || i, 'handyman', 'Seed', 'completed', 100,
            'confirmed', 'admin', nullif(p_ratings[i], 0), now(), now(), now())
    returning id into tid;
    insert into task_completions (task_id, worker_id, method, pm_share_bps, amount) values (tid, p_worker, p_method, 8000, 100);
  end loop;
end $$;

select make_jobs('00000000-0000-0000-0000-00000000f001', 'otp', array_fill(5, array[50]));                                   -- exactly 50 jobs, perfect ratings
select make_jobs('00000000-0000-0000-0000-00000000f002', 'otp', array_cat(array_fill(5, array[44]), array_fill(4, array[11])));   -- 55 jobs averaging exactly 4.8
select make_jobs('00000000-0000-0000-0000-00000000f003', 'otp', array_cat(array_fill(5, array[45]), array_fill(4, array[10])));   -- 55 jobs averaging just above 4.8
select make_jobs('00000000-0000-0000-0000-00000000f004', 'admin', array_fill(5, array[60]));                                  -- 60 jobs, none verified by a code
select make_jobs('00000000-0000-0000-0000-00000000f005', 'otp', array_cat(array_fill(5, array[49]), array_fill(3, array[6])));   -- 55 jobs averaging 4.78
select make_jobs('00000000-0000-0000-0000-00000000f006', 'otp', array_cat(array_fill(5, array[30]), array_fill(0, array[25])));   -- 55 jobs, only 30 rated, all 5

select chk((select tier = 'standard' and verified_jobs = 50 and jobs_done = 50 from profiles where id = :'g1'), 'exactly 50 verified jobs is not enough (it must be more than 50)');
select chk((select tier = 'standard' and rating = 4.8 from profiles where id = :'g2'), 'an average of exactly 4.8 is not enough (it must be above)');
select chk((select tier = 'gold' and verified_jobs = 55 and tier_since is not null from profiles where id = :'g3'), 'more than 50 verified jobs and an average above 4.8 is Gold');
select chk((select tier = 'standard' and verified_jobs = 0 and jobs_done = 60 from profiles where id = :'g4'), 'jobs finished by an admin do not count as verified');
select chk((select tier = 'standard' from profiles where id = :'g5'), 'a 4.78 average is not Gold');
select chk((select tier = 'gold' and rating_count = 30 from profiles where id = :'g6'), 'only rated jobs count towards the average');
select chk((select count(*) = 1 from audit_log where action = 'pm.tier_changed' and entity_id = :'g3'::uuid), 'reaching Gold is audited');
select chk((select count(*) = 1 from notifications n join profiles p on p.id = n.user_id where p.email = 'g3@x' and n.title = 'You reached Gold Tier'), 'the PM is told they reached Gold');

-- recalculation is idempotent
select recompute_pm_stats(id) from profiles where id = :'g3';
select recompute_pm_stats(id) from profiles where id = :'g3';
select chk((select count(*) = 1 from audit_log where action = 'pm.tier_changed' and entity_id = :'g3'::uuid), 'recalculating twice changes nothing and logs nothing new');

-- review removal and correction
:as_SU;
select expect_error($$select admin_remove_review((select id from tasks where customer_rating_of_worker = 3 limit 1), 'duplicate')$$, 'a support admin cannot remove a review');
:as_AD;
select expect_error($$select admin_remove_review((select id from tasks where customer_rating_of_worker = 3 limit 1), '')$$, 'removing a review needs a reason');
select admin_remove_review((select id from tasks where customer_rating_of_worker = 3 and assigned_worker_id = '00000000-0000-0000-0000-00000000f005' limit 1), 'Review broke the rules');
select chk((select tier = 'gold' and rating_count = 54 from profiles where id = :'g5'), 'removing a legitimate-to-remove review recalculates the tier');
select chk((select (before_value->>'rating')::numeric = 3 from audit_log where action = 'review.removed' order by id desc limit 1), 'review removal is audited with the removed rating');

-- changing a rule applies to everyone immediately
select set_setting('gold_min_avg_rating', '4.85');
select chk((select tier = 'standard' from profiles where id = :'g3'), 'raising the rating bar demotes a PM who no longer qualifies');
select set_setting('gold_min_avg_rating', '4.8');
select chk((select tier = 'gold' from profiles where id = :'g3'), 'restoring it promotes them again');

-- a PM cannot give themselves anything
:as_db;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000f001","role":"authenticated"}', false);
set role authenticated;
select expect_error($$update profiles set tier = 'gold' where id = auth.uid()$$, 'a PM cannot make themselves Gold');
select expect_error($$update profiles set jobs_done = 500 where id = auth.uid()$$, 'a PM cannot change their job count');
select expect_error($$update profiles set rating = 1.5 where id = auth.uid()$$, 'a PM cannot change their rating');
select expect_error($$update profiles set verified_jobs = 500 where id = auth.uid()$$, 'a PM cannot change their verified jobs');
select expect_error($$update task_completions set pm_share_bps = 10000$$, 'a PM cannot edit completion records');
select expect_error($$insert into task_completions (task_id, worker_id, method, pm_share_bps) values (gen_random_uuid(), auth.uid(), 'otp', 8000)$$, 'a PM cannot create completion records');

-- commission, in whole basis points
:as_db;
select chk(relative_bump_bps(1500, 500) = 1575, 'a 5% relative bump on 15% is 15.75% (1575 bps), not 20%');
select chk(relative_bump_bps(8000, 500) = 8400, 'a 5% relative bump on 80% is 84%');
select chk(pm_share_bps_for(:'g3'::uuid) = 8400, 'a Gold PM earns the bumped rate');
select chk(pm_share_bps_for(:'g1'::uuid) = 8000, 'a standard PM earns the standard rate');
update platform_settings set value = '7500' where key = 'standard_pm_share_bps';
update platform_settings set value = '1000' where key = 'gold_commission_bump_bps';
select chk(pm_share_bps_for(:'g3'::uuid) = 8250, 'both rates come from settings');
update platform_settings set value = '8000' where key = 'standard_pm_share_bps';
update platform_settings set value = '500' where key = 'gold_commission_bump_bps';
