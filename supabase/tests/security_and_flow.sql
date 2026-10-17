-- Behaviour tests for schema.sql: who can see and change what, and the full
-- task lifecycle. Every line prints "ok ..." or the run stops at the first FAIL.
\set ON_ERROR_STOP 1
create function public.expect_error(q text, label text) returns text language plpgsql as $$
begin execute q; raise exception 'FAIL (no error): %', label;
exception when others then
  if sqlerrm like 'FAIL (no error)%' then raise; end if;
  return 'ok  ' || label || '  -> ' || sqlerrm; end $$;
grant execute on function public.expect_error(text,text) to authenticated, anon;
create function public.chk(cond boolean, label text) returns text language plpgsql as $$
begin if not coalesce(cond,false) then raise exception 'FAIL: %', label; end if; return 'ok  ' || label; end $$;
grant execute on function public.chk(boolean,text) to authenticated, anon;

-- signups (C customer, P PM, Q second PM, A admin, E evil tries admin)
insert into auth.users(id,email,raw_user_meta_data) values
 ('00000000-0000-0000-0000-0000000000c1','c@x','{"full_name":"Priya","phone":"999"}'),
 ('00000000-0000-0000-0000-0000000000a1','p@x','{"full_name":"Rakesh","role":"worker"}'),
 ('00000000-0000-0000-0000-0000000000a2','q@x','{"full_name":"Suresh","role":"worker"}'),
 ('00000000-0000-0000-0000-0000000000ad','a@x','{"full_name":"Admin"}'),
 ('00000000-0000-0000-0000-0000000000ee','e@x','{"full_name":"Evil","role":"admin"}');
update profiles set role='admin' where email='a@x';  -- as SQL editor
select chk((select role from profiles where email='e@x')='customer', 'signup cannot choose admin');
select chk((select worker_status from profiles where email='p@x')='draft', 'PM starts as draft');

-- ===== Evil customer
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000ee","role":"authenticated"}';
select expect_error($$update profiles set role='admin' where id=auth.uid()$$, 'self-promote to admin');
select expect_error($$update profiles set rating=5 where id=auth.uid()$$, 'self-set rating');
update profiles set full_name='Evil Renamed' where id=auth.uid();
select chk((select full_name from profiles where id=auth.uid())='Evil Renamed', 'can edit own name');
select chk((select count(*) from profiles)=1, 'only sees own profile');

-- ===== PM applies
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select expect_error($$update profiles set worker_status='approved' where id=auth.uid()$$, 'PM self-approve');
select expect_error($$select submit_pm_application('Rakesh K','98','plumber',array['handyman'],5,'Kandivali')$$, 'apply needs ID doc');
select expect_error($$insert into pm_documents(doc_type,storage_path) values ('id','00000000-0000-0000-0000-0000000000a2/x.jpg')$$, 'doc path in someone elses folder');
insert into pm_documents(doc_type,label,storage_path) values ('id','Aadhaar','00000000-0000-0000-0000-0000000000a1/id.jpg');
select expect_error($$select submit_pm_application('Rakesh K','98','x',array['hacking'],5,'Kandivali')$$, 'invalid category');
select submit_pm_application('Rakesh K','98','plumber',array['handyman','moving'],5,'Kandivali');
select chk((select worker_status from profiles where id=auth.uid())='pending', 'status pending after apply');
select expect_error($$update profiles set categories=array['care'] where id=auth.uid()$$, 'cannot edit skills while pending');
select expect_error($$insert into pm_documents(doc_type,storage_path) values ('other','00000000-0000-0000-0000-0000000000a1/y.jpg')$$, 'no new docs while pending');
select expect_error($$select review_pm_application(auth.uid(),'approved')$$, 'PM cannot review self');
-- second PM
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
insert into pm_documents(doc_type,storage_path) values ('id','00000000-0000-0000-0000-0000000000a2/id.jpg');
select submit_pm_application('Suresh','97','',array['cleaning'],2,'Borivali');

-- ===== Customer posts task, tries to cheat
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
insert into tasks(customer_id,title,category,location,status,assigned_worker_id) values
  (auth.uid(),'Fix tap','handyman','Flat 4B, Kandivali West','completed','00000000-0000-0000-0000-0000000000a1');
select chk((select status from tasks)='requested' and (select assigned_worker_id from tasks) is null, 'insert forced to requested/unassigned');
select expect_error($$select * from task_otps$$, 'customers cannot read completion codes from the table');
update tasks set status='completed';
select chk((select status from tasks)='requested', 'direct update is a no-op (no update policy)');
select expect_error($$select assign_task((select id from tasks limit 1),'00000000-0000-0000-0000-0000000000a1')$$, 'customer cannot assign');
select expect_error($$insert into tasks(customer_id,title,category,location) values ('00000000-0000-0000-0000-0000000000ee','spoof','handyman','y')$$, 'cannot post a task as someone else');

-- ===== Admin
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000ad","role":"authenticated"}';
select approve_task_price((select id from tasks limit 1), 650);
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select confirm_task_price((select id from tasks limit 1));
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000ad","role":"authenticated"}';
select expect_error($$select review_pm_application('00000000-0000-0000-0000-0000000000a1','more_info','')$$, 'more_info needs note');
select expect_error($$select assign_task((select id from tasks limit 1),'00000000-0000-0000-0000-0000000000a1')$$, 'cannot assign unapproved PM');
select review_pm_application('00000000-0000-0000-0000-0000000000a1','approved','Welcome');
select review_pm_application('00000000-0000-0000-0000-0000000000a2','approved');
select chk((select full_name from shortlist_workers((select id from tasks limit 1)) limit 1)='Rakesh K', 'shortlist ranks category match first');
select chk((select area_match from shortlist_workers((select id from tasks limit 1)) where full_name='Rakesh K'), 'area match detected');
select assign_task((select id from tasks limit 1),'00000000-0000-0000-0000-0000000000a1');
select chk((select count(*) from profiles)=5, 'admin sees all profiles');

-- ===== PM declines, gets reassigned, accepts
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select chk((select count(*) from pm_offers())=1, 'PM sees the offer (area only) through the offers list');
select expect_error($$select * from task_otps$$, 'PM cannot read completion codes');
select chk((select full_name from profiles where id='00000000-0000-0000-0000-0000000000c1')='Priya', 'PM sees customer name');
select expect_error($$select start_task((select id from pm_offers() limit 1))$$, 'cannot start before accept');
select decline_task((select id from pm_offers() limit 1),'busy');
select chk((select count(*) from pm_offers())=0 and (select count(*) from tasks)=0, 'declined task leaves PM view');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000ad","role":"authenticated"}';
select chk((select declined from shortlist_workers((select id from tasks limit 1)) where full_name='Rakesh K'), 'shortlist flags decline');
select assign_task((select id from tasks limit 1),'00000000-0000-0000-0000-0000000000a1');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select accept_task((select id from pm_offers() limit 1));
select expect_error($$select complete_task((select id from tasks limit 1),'0000')$$, 'cannot complete before start');
select start_task((select id from tasks limit 1));
select log_visit((select id from tasks limit 1),'Day 1');
-- other PM cannot touch it
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select chk((select count(*) from tasks)=0, 'other PM cannot see task');
select expect_error($$select complete_task((select id from tasks where title='Fix tap'),'1')$$, 'other PM cannot complete');
select expect_error($$select rate_task('00000000-0000-0000-0000-000000000000',5)$$, 'rate unknown task');
-- customer cannot cancel in-progress
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select expect_error($$select cancel_task((select id from tasks limit 1))$$, 'customer cannot cancel in-progress');
select chk((select count(*) from task_visits)=1, 'customer sees visit');
select expect_error($$select rate_task((select id from tasks limit 1),5)$$, 'cannot rate before completion');
create temp table code as select completion_code as code from issue_completion_code((select id from tasks limit 1)); grant select on code to authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select chk(complete_task((select id from tasks limit 1), (select code from code))='missing_evidence', 'completion needs Before and After photos');
insert into task_photos(task_id,kind,storage_path,content_type,size_bytes) select id,'before',id::text||'/before-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jpg','image/jpeg',100 from tasks;
insert into task_photos(task_id,kind,storage_path,content_type,size_bytes) select id,'after',id::text||'/after-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.jpg','image/jpeg',100 from tasks;
select chk(complete_task((select id from tasks limit 1), case when (select code from code)='1111' then '2222' else '1111' end)='wrong', 'wrong code rejected');
select chk(complete_task((select id from tasks limit 1), (select code from code))='ok', 'right code completes');
select chk((select jobs_done from profiles where id=auth.uid())=1, 'jobs_done incremented');
select rate_task((select id from tasks limit 1),4);
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select rate_task((select id from tasks limit 1),5,'Great');
select expect_error($$select rate_task((select id from tasks limit 1),1)$$, 'cannot rate twice');
select chk((select rating from profiles where id='00000000-0000-0000-0000-0000000000a1')=5.0, 'PM rating updated');
select chk((select rating from profiles where id=auth.uid())=4.0, 'customer rating updated');
select chk((select count(*) from audit_log)=0, 'customer cannot read audit log');
-- lockout
insert into tasks(customer_id,title,category,location) values (auth.uid(),'Clean','cleaning','Borivali');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000ad","role":"authenticated"}';
select approve_task_price((select id from tasks where title='Clean'), 500);
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select confirm_task_price((select id from tasks where title='Clean'));
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000ad","role":"authenticated"}';
select assign_task((select id from tasks where title='Clean'),'00000000-0000-0000-0000-0000000000a2');
select review_pm_application('00000000-0000-0000-0000-0000000000a1','suspended','test');
select expect_error($$select assign_task((select id from tasks where title='Clean'),'00000000-0000-0000-0000-0000000000a1')$$, 'suspended PM cannot be assigned');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select accept_task((select id from pm_offers() limit 1)); select start_task((select id from tasks where title='Clean'));
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000ad","role":"authenticated"}';
select admin_complete_task((select id from tasks where title='Clean'),'Customer confirmed by phone');
select chk((select count(*) from audit_log) > 10, 'admin reads audit log');
reset role;
select action, count(*) from audit_log group by 1 order by 1;
