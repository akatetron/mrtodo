-- Runs against a database that has ONLY migration 0001 applied, the schema your
-- Supabase project has today, and fills it with the kinds of rows a live project
-- holds: tasks priced by customers, plain-text completion codes, finished jobs,
-- duplicate photos, a locked code, and a phone number for "someone else".
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c1', 'c@x',  '{"full_name":"Priya","phone":"98200 11111"}'),
  ('00000000-0000-0000-0000-0000000000a1', 'p@x',  '{"full_name":"Rakesh","role":"worker","phone":"98200 22222"}'),
  ('00000000-0000-0000-0000-0000000000ad', 'ad@x', '{"full_name":"Admin"}');
update profiles set role = 'admin' where email = 'ad@x';
update profiles set worker_status = 'approved', categories = array['handyman'], service_area = 'Kandivali', jobs_done = 2, rating = 5.0, rating_count = 1
 where email = 'p@x';

-- T1: finished one-time task, customer-priced, rated 5, booked for someone else
insert into tasks (id, customer_id, assigned_worker_id, title, category, location, status, est_cost, completed_at, customer_rating_of_worker, for_whom, recipient_name, recipient_phone)
values ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', 'Old finished task', 'handyman', 'Flat 4B, Kandivali West', 'completed', 500, now() - interval '3 days', 5, 'other', 'Kamala Bai', '98200 55555');
-- T2: in progress, customer-priced, code with 5 wrong attempts already (locked), two Before photos
insert into tasks (id, customer_id, assigned_worker_id, title, category, location, status, est_cost, accepted_at, started_at)
values ('aaaaaaaa-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', 'Old task in progress', 'handyman', 'Malad West', 'in_progress', 700, now(), now());
-- T3: waiting in the queue, no price
insert into tasks (id, customer_id, title, category, location) values ('aaaaaaaa-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000c1', 'Old unpriced task', 'cleaning', 'Borivali');
-- T4: finished ongoing task with two visits at 400 a day
insert into tasks (id, customer_id, assigned_worker_id, title, category, task_type, location, status, rate_per_day, completed_at)
values ('aaaaaaaa-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', 'Old ongoing task', 'care', 'ongoing', 'Andheri West', 'completed', 400, now() - interval '5 days');
insert into task_visits (task_id, note) values ('aaaaaaaa-0000-0000-0000-000000000004', 'Day 1'), ('aaaaaaaa-0000-0000-0000-000000000004', 'Day 2');

update task_otps set code = '4321', failed_attempts = 0 where task_id = 'aaaaaaaa-0000-0000-0000-000000000001';
update task_otps set code = '1234', failed_attempts = 5 where task_id = 'aaaaaaaa-0000-0000-0000-000000000002';

insert into task_photos (task_id, uploader_id, kind, storage_path, created_at) values
  ('aaaaaaaa-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a1', 'before', 'aaaaaaaa-0000-0000-0000-000000000002/old1.jpg', now() - interval '2 hours'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a1', 'before', 'aaaaaaaa-0000-0000-0000-000000000002/old2.jpg', now() - interval '1 hour');
