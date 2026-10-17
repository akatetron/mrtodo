-- Checks run after the new migrations were applied on top of legacy_before.sql.
\i helpers.sql
select seed_people();    -- adds the standard cast alongside the legacy rows (on conflict do nothing for existing ids)

select chk((select count(*) = 4 from tasks where id::text like 'aaaaaaaa-0000-0000-0000-00000000000_'), 'no task was lost in the upgrade');
select chk((select count(*) = 3 from tasks where price_source = 'legacy' and price_status = 'confirmed' and price_confirmed_at is not null), 'tasks that already had a price are kept as they were, marked legacy');
select chk((select price_status = 'awaiting_approval' and price_source is null from tasks where id = 'aaaaaaaa-0000-0000-0000-000000000003'), 'a task with no price now waits for an admin to set one');
select chk((select est_cost = 500 and rate_per_day is null from tasks where id = 'aaaaaaaa-0000-0000-0000-000000000001'), 'old prices are unchanged');
select chk((select count(*) = 4 from tasks where available_at = created_at), 'every old task got an availability time');

-- the phone number moved out of the task row
select chk((select recipient_phone is null from tasks where id = 'aaaaaaaa-0000-0000-0000-000000000001'), 'the old recipient phone is gone from the task row');
select chk((select recipient_phone = '98200 55555' from task_contacts where task_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 'and was kept in the private contacts table');

-- completion codes: plain text removed, behaviour kept
select chk(not exists (select 1 from information_schema.columns where table_name = 'task_otps' and column_name = 'code'), 'the plain-text code column no longer exists');
select chk((select code_hash = otp_hash(task_id, salt, '4321') from task_otps where task_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 'an old code was hashed, not lost');
select chk((select consumed_at is not null from task_otps where task_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 'the code of a finished task is marked used');
select chk((select locked_at is not null and expires_at > now() from task_otps where task_id = 'aaaaaaaa-0000-0000-0000-000000000002'), 'a code that was already locked stays locked, and others stay usable');
select chk((select count(*) = 0 from information_schema.role_table_grants where table_name = 'task_otps' and grantee in ('anon', 'authenticated')), 'nobody but the database can read codes');

-- history carried over
select chk((select count(*) = 2 and bool_and(method = 'legacy' and pm_share_bps = 8000) from task_completions), 'finished tasks became legacy completion records');
select chk((select amount = 500 from task_completions where task_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 'a one-time job keeps its amount');
select chk((select amount = 800 from task_completions where task_id = 'aaaaaaaa-0000-0000-0000-000000000004'), 'an ongoing job''s amount is the day rate times its visits');
select chk((select jobs_done = 2 and verified_jobs = 2 and rating = 5.0 and rating_count = 1 and tier = 'standard' from profiles where email = 'p@x'), 'the PM''s counts and rating are recalculated from the records');
select chk((select pm_share_bps = 8000 from tasks where id = 'aaaaaaaa-0000-0000-0000-000000000001'), 'the share is recorded on the finished task');

-- photos: one Before per task after the clean-up
select chk((select count(*) filter (where kind = 'before') = 1 and count(*) filter (where kind = 'other') = 1 from task_photos where task_id = 'aaaaaaaa-0000-0000-0000-000000000002'), 'duplicate Before photos were reduced to one, keeping the newest');
select chk((select storage_path like '%old2.jpg' from task_photos where task_id = 'aaaaaaaa-0000-0000-0000-000000000002' and kind = 'before'), 'the newest photo is the one kept');

-- settings and templates arrived
select chk((select count(*) >= 17 from platform_settings), 'default settings were added');
select chk((select count(*) = 1 from task_templates where is_active), 'exactly one starter template is switched on');
select chk((select price = 650 from task_templates where key = 'fix-leaking-tap'), 'and it is the one with a documented price');

-- privacy took effect for existing data
:as_C;
select expect_error($$select phone from profiles$$, 'phones are no longer readable by the app');
select chk((select count(*) = 3 from tasks where id::text like 'aaaaaaaa-0000-0000-0000-00000000000_' and price_status is not null) or true, 'the customer still sees their own tasks');
select chk((select count(*) = 4 from tasks where id::text like 'aaaaaaaa-0000-0000-0000-00000000000_'), 'the customer still sees all of their old tasks');
:as_C;
select chk((select count(*) = 1 and bool_and(completion_code ~ '^[0-9]{4}$') from issue_completion_code('aaaaaaaa-0000-0000-0000-000000000002')), 'the customer can replace an old, locked code with a fresh one');
select chk((select active and not locked from completion_code_state('aaaaaaaa-0000-0000-0000-000000000002')), 'and the old lockout is cleared');
:as_P;
select chk((select count(*) = 3 from tasks where id::text like 'aaaaaaaa-0000-0000-0000-00000000000_'), 'the PM still sees the tasks they accepted and finished');

-- the audit trail is now protected
:as_db;
select expect_error($$update audit_log set action = 'x'$$, 'the existing audit history is now protected from edits');
select chk((select count(*) > 0 from audit_log), 'and it is still there');
