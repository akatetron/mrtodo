-- Behaviour tests for the second round of features: notifications, offer
-- time-out, reports, proof-of-work photos, document expiry, payouts,
-- broadcasts, admin levels and PM reliability. Prints "ok ..." per check and
-- stops at the first FAIL.
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

-- C customer, P approved PM, Q second approved PM, AD super admin, SU support admin
insert into auth.users(id,email,raw_user_meta_data) values
 ('00000000-0000-0000-0000-0000000000c1','c@x','{"full_name":"Priya"}'),
 ('00000000-0000-0000-0000-0000000000a1','p@x','{"full_name":"Rakesh","role":"worker"}'),
 ('00000000-0000-0000-0000-0000000000a2','q@x','{"full_name":"Suresh","role":"worker"}'),
 ('00000000-0000-0000-0000-0000000000ad','ad@x','{"full_name":"Admin"}'),
 ('00000000-0000-0000-0000-0000000000a5','su@x','{"full_name":"Support"}');
update profiles set role='admin' where email='ad@x';
update profiles set role='admin', admin_level='support' where email='su@x';
update profiles set worker_status='approved', categories=array['handyman'], service_area='Kandivali' where email in ('p@x','q@x');

select chk((select count(*) from profiles where role='admin')=2, 'two admins exist');

-- ===== customer posts a task: admins are told, nobody else
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
insert into tasks(customer_id,title,category,location) values (auth.uid(),'Fix tap','handyman','Flat 4B, Kandivali West');
select chk((select count(*) from notifications)=0, 'customer is not notified of own task');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000ad","role":"authenticated"}';
select chk((select count(*) from notifications where title like 'New task%')=1, 'admin notified of new task');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select chk((select count(*) from notifications where title like 'New task%')=1, 'support admin notified too');
select chk((select count(*) from notifications)=1, 'support admin sees only their own notification');

-- ===== support admin can run the queue, but not the sensitive things
select assign_task((select id from tasks limit 1),'00000000-0000-0000-0000-0000000000a1');
select chk((select status from tasks limit 1)='matched', 'support admin can assign');
select expect_error($$select review_pm_application('00000000-0000-0000-0000-0000000000a2','suspended','x')$$, 'support cannot suspend a PM');
select expect_error($$select record_payout('00000000-0000-0000-0000-0000000000a1', 100)$$, 'support cannot record payouts');
select expect_error($$select send_announcement('all','Hi')$$, 'support cannot broadcast');
select expect_error($$select set_admin_level('00000000-0000-0000-0000-0000000000a5','super')$$, 'support cannot promote themselves via function');
select expect_error($$update profiles set admin_level='super' where id=auth.uid()$$, 'support cannot promote themselves directly');
select expect_error($$update profiles set role='admin' where id='00000000-0000-0000-0000-0000000000c1'$$, 'support cannot make someone admin');
reset role; insert into pm_documents(worker_id,doc_type,storage_path) values ('00000000-0000-0000-0000-0000000000a1','id','00000000-0000-0000-0000-0000000000a1/id.jpg'); set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select chk((select count(*) from pm_documents)=0, 'support admin cannot read ID documents');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000ad","role":"authenticated"}';
select chk((select count(*) from pm_documents)=1, 'super admin can read ID documents');

-- ===== PM gets the offer, accepts; customer is told at each step
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select chk((select count(*) from notifications where title='New task offered to you')=1, 'PM notified of offer');
select chk((select count(*) from notifications where title like 'New task needs%')=0, 'PM does not see admin notifications');
select accept_task((select id from tasks limit 1));
select start_task((select id from tasks limit 1));
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select chk((select count(*) from notifications where title='Your Personal Manager accepted')=1, 'customer told PM accepted');
select chk((select count(*) from notifications where title='Work has started')=1, 'customer told work started');
select mark_notifications_read();
select chk((select count(*) from notifications where read_at is null)=0, 'mark read clears own unread');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select chk((select count(*) from notifications where read_at is null)=1, 'marking read does not touch other people''s');

-- ===== proof-of-work photos
-- remember the task id as the superuser, so tests can name a task the acting user cannot see
reset role; select set_config('t.id', (select id::text from tasks limit 1), false); set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select chk(public.safe_uuid('not-a-uuid') is null, 'safe_uuid returns null for junk');
insert into task_photos(task_id,kind,storage_path) select id,'before',id::text||'/before.jpg' from tasks;
select chk((select count(*) from task_photos)=1, 'assigned PM can add a photo while working');
select expect_error($$insert into task_photos(task_id,kind,storage_path) select id,'after','elsewhere/after.jpg' from tasks$$, 'photo path must be inside the task folder');
insert into storage.objects(bucket_id,name) select 'task-photos', id::text||'/before.jpg' from tasks;
select chk((select count(*) from storage.objects where bucket_id='task-photos')=1, 'assigned PM can upload to storage');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select chk((select count(*) from task_photos)=0, 'other PM cannot see photos');
select chk((select count(*) from storage.objects where bucket_id='task-photos')=0, 'other PM cannot see stored files');
select expect_error($$insert into task_photos(task_id,kind,storage_path) values (current_setting('t.id')::uuid,'after',current_setting('t.id')||'/x.jpg')$$, 'other PM cannot add photos');
select expect_error($$insert into storage.objects(bucket_id,name) select 'task-photos', id::text||'/x.jpg' from (select '00000000-0000-0000-0000-000000000000'::uuid id) s$$, 'other PM cannot upload to storage');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select chk((select count(*) from task_photos)=1, 'customer can see proof photos');
select chk((select count(*) from storage.objects where bucket_id='task-photos')=1, 'customer can open stored files');
select expect_error($$insert into task_photos(task_id,kind,storage_path) select id,'after',id::text||'/c.jpg' from tasks$$, 'customer cannot add photos');

-- ===== reports
select expect_error($$select report_task((select id from tasks limit 1),'bogus')$$, 'unknown report reason rejected');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select expect_error($$select report_task('00000000-0000-0000-0000-000000000000','other')$$, 'cannot report a task you are not on');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select report_task((select id from tasks limit 1),'late','Arrived an hour late');
select expect_error($$select report_task((select id from tasks limit 1),'quality')$$, 'second open report on same task rejected');
select chk((select count(*) from reports)=1, 'reporter sees their report');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select chk((select count(*) from reports)=0, 'other side cannot read the report');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select chk((select count(*) from reports where status='open')=1, 'support admin sees the open report');
select chk((select count(*) from notifications where kind='report')=1, 'admins notified of the report');
select expect_error($$select resolve_report((select id from reports limit 1), '')$$, 'resolution needs a note');
select resolve_report((select id from reports limit 1), 'Spoke to both; PM apologised');
select chk((select status from reports limit 1)='resolved', 'support admin can resolve');
select expect_error($$select resolve_report((select id from reports limit 1), 'again')$$, 'cannot resolve twice');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select chk((select count(*) from notifications where title='Your report was resolved')=1, 'reporter told it was resolved');

-- ===== completion: both notified; photos locked afterwards
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000ad","role":"authenticated"}';
select admin_complete_task((select id from tasks limit 1),'confirmed by phone');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select chk((select count(*) from notifications where title like 'Task completed%')=1, 'customer told task completed');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select expect_error($$insert into task_photos(task_id,kind,storage_path) select id,'after',id::text||'/late.jpg' from tasks$$, 'photos locked once completed');

-- ===== document renewal: approved PM may add a certificate, never an ID
insert into pm_documents(doc_type,label,storage_path,expires_on) values ('qualification','Plumbing licence','00000000-0000-0000-0000-0000000000a1/lic.pdf', current_date + 20);
select chk((select count(*) from pm_documents where expires_on is not null)=1, 'approved PM can add a certificate with an expiry date');
select expect_error($$insert into pm_documents(doc_type,storage_path) values ('id','00000000-0000-0000-0000-0000000000a1/id2.jpg')$$, 'approved PM cannot swap their ID');

-- ===== offer time-out
reset role;
insert into tasks(customer_id,title,category,location) values ('00000000-0000-0000-0000-0000000000c1','Clean flat','handyman','Kandivali');
set role authenticated; set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000ad","role":"authenticated"}';
select assign_task((select id from tasks where title='Clean flat'),'00000000-0000-0000-0000-0000000000a2');
select chk(expire_stale_offers(15)=0, 'a fresh offer is not expired');
reset role; update tasks set assigned_at = now() - interval '30 minutes' where title='Clean flat'; set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select expect_error($$select expire_stale_offers(15)$$, 'customer cannot expire offers');
select expect_error($$select expire_stale_offers_internal(15)$$, 'nobody can call the internal expiry function');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select chk(expire_stale_offers(15)=1, 'a stale offer expires');
select chk((select status from tasks where title='Clean flat')='requested' and (select assigned_worker_id from tasks where title='Clean flat') is null, 'expired task is back in the queue');
select chk((select count(*) from notifications where title='A task needs reassigning')>=1, 'admins told it needs reassigning');
select chk((select declined from shortlist_workers((select id from tasks where title='Clean flat')) where full_name='Suresh'), 'shortlist marks the PM who did not answer');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select chk((select count(*) from notifications where title='An offer lapsed')=1, 'PM told the offer lapsed');

-- ===== payouts + broadcast + admin levels (super admin)
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000ad","role":"authenticated"}';
select expect_error($$select record_payout('00000000-0000-0000-0000-0000000000a1', 0)$$, 'payout must be above zero');
select expect_error($$select record_payout('00000000-0000-0000-0000-0000000000c1', 100)$$, 'cannot pay a non-PM');
select record_payout('00000000-0000-0000-0000-0000000000a1', 520, 'UPI ref 4411');
select chk((select sum(amount) from payouts)=520, 'super admin records a payout');
select chk(send_announcement('workers','Heavy rain tomorrow','Expect delays')=2, 'broadcast reaches both approved PMs');
select chk(send_announcement('customers','Hello')=1, 'broadcast to customers reaches the customer');
select expect_error($$select send_announcement('everyone','x')$$, 'unknown audience rejected');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select chk((select count(*) from payouts)=1, 'PM sees their own payout');
select chk((select count(*) from notifications where kind='announcement')=1, 'PM received the announcement');
select chk((select count(*) from notifications where title like 'Payout recorded%')=1, 'PM told about the payout');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select chk((select count(*) from payouts)=0, 'other PM cannot see someone else''s payout');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select chk((select count(*) from notifications where title='Hello')=1 and (select count(*) from notifications where title='Heavy rain tomorrow')=0, 'customer got only the customer broadcast');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000ad","role":"authenticated"}';
select expect_error($$select set_admin_level('00000000-0000-0000-0000-0000000000c1','super')$$, 'cannot give a customer an admin level');
select expect_error($$select set_admin_level('00000000-0000-0000-0000-0000000000ad','support')$$, 'cannot demote the last super admin');
select set_admin_level('00000000-0000-0000-0000-0000000000a5','super');
select chk((select admin_level from profiles where email='su@x')='super', 'super admin can promote');
select set_admin_level('00000000-0000-0000-0000-0000000000ad','support');
select chk((select admin_level from profiles where email='ad@x')='support', 'a super admin can step down when another exists');

-- ===== reliability stats
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select chk((select offers from pm_reliability() where worker_id='00000000-0000-0000-0000-0000000000a1')>=1, 'reliability counts offers');
select chk((select accepted from pm_reliability() where worker_id='00000000-0000-0000-0000-0000000000a1')=1, 'reliability counts acceptance');
select chk((select expired from pm_reliability() where worker_id='00000000-0000-0000-0000-0000000000a2')=1, 'reliability counts lapsed offers');
select chk((select completed from pm_reliability() where worker_id='00000000-0000-0000-0000-0000000000a1')=1, 'reliability counts completed tasks');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select chk((select count(*) from pm_reliability())=0, 'customers get no reliability data');
reset role;
select action, count(*) from audit_log group by 1 order by 1;
