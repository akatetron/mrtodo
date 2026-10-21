-- Account deletion.
\i helpers.sql
select seed_people();
update platform_settings set value = '500' where key = 'max_tasks_per_hour';
select id as tpl from task_templates where key = 'fix-leaking-tap' \gset
:as_C;
insert into tasks (customer_id, title, category, location, template_id, for_whom, recipient_name, recipient_relation, recipient_phone)
values (auth.uid(), 'Tap for mum', 'handyman', 'Flat 1, Kandivali West', :'tpl', 'other', 'Kamala Bai', 'Mother', '98200 55555');
select id as t1 from tasks where title = 'Tap for mum' \gset
select expect_error($$select request_account_deletion()$$, 'a customer with an open task cannot delete yet');
:as_AD;
select expect_error($$select request_account_deletion()$$, 'an admin account cannot delete itself');
:as_anon;
select expect_error($$select request_account_deletion()$$, 'a signed-out visitor cannot call it');
:as_AD;
select cancel_task(:'t1', 'Changed my mind') ;
:as_db;
insert into subscription_plans (code, name, price_amount, provider_plan_id, active) values ('plan-test', 'Plan', 100, 'plan_x', true) on conflict (code) do update set price_amount = 100, provider_plan_id = 'plan_x', active = true;
:as_C;
select start_subscription('plan-test', true);
select expect_error($$select request_account_deletion()$$, 'a live subscription must be cancelled first');
:as_db;
update subscriptions set status = 'cancelled';
insert into notifications (user_id, title) values (:'U_C', 'hello');
:as_C;
select chk(array_length(request_account_deletion(), 1) is null, 'a customer with nothing open can delete (no documents)');
:as_db;
select chk((select full_name = 'Deleted user' and phone is null and email like 'deleted-%@deleted.invalid' and deleted_at is not null and not online from profiles where id = :'U_C'), 'their identity and contact details are erased');
select chk((select recipient_name is null and recipient_relation is null from tasks where id = :'t1'), 'the person they booked for is erased from the task');
select chk((select count(*) = 0 from task_contacts), 'the recipient phone number is erased');
select chk((select count(*) = 0 from notifications where user_id = :'U_C'), 'their notifications are erased');
select chk((select count(*) = 1 from tasks where id = :'t1'), 'the task record itself stays for billing and disputes');
select chk((select count(*) = 1 from audit_log where action = 'account.deleted' and entity_id = :'U_C'), 'the deletion is audited');
:as_C;
select expect_error($$select request_account_deletion()$$, 'deleting twice is refused');

-- a Personal Manager with documents
:as_db;
insert into pm_documents (worker_id, doc_type, label, storage_path) values (:'U_P', 'id', 'Aadhaar', 'a1/id.jpg'), (:'U_P', 'other', 'Cert', 'a1/cert.pdf');
insert into pm_qualifications (worker_id, skill_key, status) values (:'U_P', 'tech-support', 'verified');
insert into push_tokens (token, user_id, platform) values ('ExponentPushToken[zzzzzzzzzz]', :'U_P', 'ios');
:as_P;
select chk((select count(*) = 2 from unnest(request_account_deletion()) p where p in ('a1/id.jpg', 'a1/cert.pdf')), 'a PM gets back their document paths so the files can be removed');
:as_db;
select chk((select count(*) = 0 from pm_documents where worker_id = :'U_P') and (select count(*) = 0 from pm_qualifications where worker_id = :'U_P') and (select count(*) = 0 from push_tokens where user_id = :'U_P'), 'documents, qualifications and devices are erased');
select chk((select worker_status = 'suspended' and full_name = 'Deleted user' from profiles where id = :'U_P'), 'a deleted PM can no longer take tasks');
select chk(true, 'deletion suite finished');
