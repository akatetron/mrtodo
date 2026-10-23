-- Platform operating hours, regions' time zones, closures, and Personal Manager schedules.
\i helpers.sql
select seed_people();
update platform_settings set value = '500' where key = 'max_tasks_per_hour';

create function public.local_ts(d date, t time, tz text) returns timestamptz language sql immutable as $$ select (d + t) at time zone tz $$;
:as_AD;
select save_region('{"code":"IN-T","name":"Test India","currency":"INR","timezone":"Asia/Kolkata","status":"active"}');
select save_region('{"code":"US-T","name":"Test USA","currency":"USD","timezone":"America/New_York","status":"active"}');
select save_region('{"code":"IN-LATE","name":"Test India (hours only)","currency":"INR","timezone":"Asia/Kolkata","status":"active","allow_outside_hours_requests":false}');
select (current_date + 10) as day10 \gset
select extract(dow from (current_date + 10))::int as dow10 \gset

-- ============================================================ the default window is 06:00-20:00 local time
reset role;
select chk(setting_text('operating_start', '') = '06:00' and setting_text('operating_end', '') = '20:00', 'the initial window is 06:00 to 20:00, held in settings');
:as_C;
select chk(slot_problem('IN-T', local_ts(:'day10', '06:00', 'Asia/Kolkata'), 60) is null, 'a slot starting exactly at opening is valid');
select chk(slot_problem('IN-T', local_ts(:'day10', '05:59', 'Asia/Kolkata'), 30) is not null, 'a slot starting a minute before opening is refused');
select chk(slot_problem('IN-T', local_ts(:'day10', '19:00', 'Asia/Kolkata'), 60) is null, 'a slot finishing exactly at closing is valid');
select chk(slot_problem('IN-T', local_ts(:'day10', '19:30', 'Asia/Kolkata'), 60) is not null, 'a slot that would finish after closing is refused');
select chk(slot_problem('IN-T', local_ts(:'day10', '20:00', 'Asia/Kolkata'), 15) is not null, 'a slot starting at closing is refused');
select chk(slot_problem('IN-T', local_ts(:'day10', '23:30', 'Asia/Kolkata'), 120) is not null, 'a visit that runs past midnight is refused');
select chk(slot_problem('IN-NOPE', local_ts(:'day10', '10:00', 'Asia/Kolkata'), 60) is not null, 'an unknown region has no valid slots');
select chk(slot_problem('IN-T', now() - interval '2 hours', 30) is not null, 'a time in the past is refused');
select chk((select count(*) from available_slots('IN-T', :'day10', 60)) = 27, 'a 60-minute task has 27 half-hour slots between 06:00 and 19:00');
select chk((select local_time from available_slots('IN-T', :'day10', 60) order by slot_start limit 1) = '06:00' and (select local_time from available_slots('IN-T', :'day10', 60) order by slot_start desc limit 1) = '19:00', 'the first and last slots');
select chk((select count(*) from available_slots('IN-T', :'day10', 180)) = 23, 'a longer task has fewer slots (last start 17:00)');
select chk((select count(*) from available_slots('IN-NOPE', :'day10', 60)) = 0, 'no slots for an unsupported region');

-- ============================================================ time zones and daylight saving
-- New York changes clocks on 2026-03-08 (spring forward) and 2026-11-01 (fall back).
:as_db;
select chk(within_platform_hours('US-T', '2026-03-08 10:00+00', '2026-03-08 11:00+00') is null, 'DST: 10:00 UTC on 8 March is 06:00 EDT (clocks have moved), so it is open');
select chk(within_platform_hours('US-T', '2026-03-07 10:00+00', '2026-03-07 11:00+00') is not null, 'DST: 10:00 UTC the day before is 05:00 EST, so it is closed');
select chk(within_platform_hours('US-T', '2026-11-01 11:00+00', '2026-11-01 12:00+00') is null, 'DST: 11:00 UTC on 1 November is 06:00 EST (after clocks go back), open');
select chk(within_platform_hours('US-T', '2026-11-01 10:00+00', '2026-11-01 11:00+00') is not null, 'DST: 10:00 UTC on 1 November is 05:00 EST, closed');
select chk(within_platform_hours('IN-T', '2026-07-01 00:30+00', '2026-07-01 01:30+00') is null, 'a zone with no DST: 00:30 UTC is 06:00 in Kolkata');
select chk(within_platform_hours('IN-T', '2026-07-01 00:29+00', '2026-07-01 01:29+00') is not null, 'and one minute earlier is closed');

-- ============================================================ per-weekday hours, closures and special hours
:as_AD;
select save_region_hours('IN-T', jsonb_build_array(jsonb_build_object('weekday', :'dow10', 'closed', true)));
:as_C;
select chk(slot_problem('IN-T', local_ts(:'day10', '10:00', 'Asia/Kolkata'), 60) like '%closed%', 'a weekday marked closed has no slots');
select chk((select count(*) from available_slots('IN-T', :'day10', 60)) = 0, 'and shows none');
:as_AD;
select save_region_hours('IN-T', jsonb_build_array(jsonb_build_object('weekday', :'dow10', 'closed', false, 'open', '09:00', 'close', '13:00')));
:as_C;
select chk(slot_problem('IN-T', local_ts(:'day10', '08:30', 'Asia/Kolkata'), 30) is not null and slot_problem('IN-T', local_ts(:'day10', '12:30', 'Asia/Kolkata'), 30) is null, 'a region''s own hours replace the default for that weekday');
:as_AD;
select save_region_hours('IN-T', '[]');
select save_hours_exception(jsonb_build_object('region_code', 'IN-T', 'on_date', :'day10', 'closed', true, 'reason', 'Public holiday'));
:as_C;
select chk(slot_problem('IN-T', local_ts(:'day10', '10:00', 'Asia/Kolkata'), 60) like '%closed%', 'a closure on one date closes that date');
select chk(slot_problem('US-T', local_ts(:'day10', '10:00', 'America/New_York'), 60) is null, 'and only that region');
:as_AD;
select save_hours_exception(jsonb_build_object('region_code', 'IN-T', 'on_date', :'day10', 'closed', false, 'open', '10:00', 'close', '12:00'));
:as_C;
select chk(slot_problem('IN-T', local_ts(:'day10', '10:30', 'Asia/Kolkata'), 60) is null and slot_problem('IN-T', local_ts(:'day10', '11:30', 'Asia/Kolkata'), 60) is not null, 'special hours for a date replace the usual window');
:as_AD;
select delete_hours_exception((select id from region_exceptions where on_date = :'day10'));
:as_C;
select chk(slot_problem('IN-T', local_ts(:'day10', '10:30', 'Asia/Kolkata'), 60) is null, 'removing the exception restores the normal window');
select expect_error($$select save_hours_exception('{"on_date":"2026-12-25","closed":true}')$$, 'a customer cannot close the platform');
:as_P;
select expect_error($$select save_region_hours('IN-T', '[]')$$, 'a Personal Manager cannot change operating hours');
:as_SU;
select expect_error($$select save_region_hours('IN-T', '[]')$$, 'a support admin cannot change operating hours');
:as_AD;
select expect_error($$select save_region_hours('IN-T', '[{"weekday":1,"closed":false,"open":"18:00","close":"09:00"}]')$$, 'hours that close before they open are refused');

-- ============================================================ bookings are checked on the server
:as_C;
insert into tasks (customer_id, title, category, location, region_code, scheduled_at, est_minutes)
  values (auth.uid(), 'Inside hours', 'general', 'Flat 1, Bandra', 'IN-T', local_ts(:'day10', '10:00', 'Asia/Kolkata'), 60);
select expect_error(format($$insert into tasks (customer_id, title, category, location, region_code, scheduled_at, est_minutes) values (auth.uid(), 'Too early', 'general', 'Flat 1, Bandra', 'IN-T', '%s', 60)$$, local_ts(:'day10', '05:00', 'Asia/Kolkata')), 'a booking before opening is refused by the database, not only by the app');
select expect_error(format($$insert into tasks (customer_id, title, category, location, region_code, scheduled_at, est_minutes) values (auth.uid(), 'Too late', 'general', 'Flat 1, Bandra', 'IN-T', '%s', 120)$$, local_ts(:'day10', '19:00', 'Asia/Kolkata')), 'a booking that finishes after closing is refused');
select expect_error(format($$insert into tasks (customer_id, title, category, location, region_code, scheduled_at) values (auth.uid(), 'Wrong region', 'general', 'Flat 1', 'ZZ-NONE', '%s')$$, local_ts(:'day10', '10:00', 'Asia/Kolkata')), 'an unsupported region is refused');
insert into tasks (customer_id, title, category, location) values (auth.uid(), 'Flexible, no region', 'general', 'Flat 2, Bandra');
select chk((select count(*) = 1 from tasks where title = 'Flexible, no region'), 'a flexible task with no region is unaffected (the existing behaviour)');
-- structured multi-day plans are checked visit by visit
select expect_error(format($$insert into tasks (customer_id, title, category, location, region_code, schedule_kind, schedule_plan, est_minutes) values (auth.uid(), 'Multi bad', 'general', 'Flat 3', 'IN-T', 'multi_day', '[{"date":"%s","start":"10:00","minutes":60},{"date":"%s","start":"21:00","minutes":60}]'::jsonb, 60)$$, :'day10', :'day10'),
  'one visit outside hours refuses a multi-day plan');
insert into tasks (customer_id, title, category, location, region_code, schedule_kind, schedule_plan, est_minutes)
  values (auth.uid(), 'Multi good', 'general', 'Flat 3, Bandra', 'IN-T', 'multi_day', jsonb_build_array(jsonb_build_object('date', :'day10', 'start', '10:00', 'minutes', 60), jsonb_build_object('date', (:'day10'::date + 2), 'start', '14:00', 'minutes', 90)), 60);
insert into tasks (customer_id, title, category, location, region_code, schedule_kind, schedule_plan)
  values (auth.uid(), 'Multi free text', 'general', 'Flat 4, Bandra', 'IN-T', 'multi_day', '[{"date":"Mon 2 Nov","note":"first visit"}]');
:as_db;
select chk((select count(*) = 2 from tasks t, lateral task_windows(t) w where t.title = 'Multi good'), 'a structured multi-day task occupies one window per visit, not continuous time');
select chk((select task_schedule_checkable(t) from tasks t where title = 'Multi good') and not (select task_schedule_checkable(t) from tasks t where title = 'Multi free text'), 'free-text visit dates cannot be checked, and are known to be uncheckable');
select chk((select task_schedule_checkable(t) = false from tasks t where title = 'Flexible, no region'), 'a flexible task has no time to check');
-- a region that takes requests only during operating hours
:as_AD;
select save_hours_exception(jsonb_build_object('region_code', 'IN-LATE', 'on_date', (now() at time zone 'Asia/Kolkata')::date, 'closed', true, 'reason', 'Closed today'));
:as_C;
select expect_error(format($$insert into tasks (customer_id, title, category, location, region_code, scheduled_at) values (auth.uid(), 'After hours request', 'general', 'Flat 6', 'IN-LATE', '%s')$$, local_ts(:'day10', '10:00', 'Asia/Kolkata')), 'a region that only takes requests during hours refuses them when closed');
insert into tasks (customer_id, title, category, location, region_code, scheduled_at) values (auth.uid(), 'After hours allowed', 'general', 'Flat 7', 'IN-T', local_ts(:'day10', '10:00', 'Asia/Kolkata'));
select chk((select count(*) = 1 from tasks where title = 'After hours allowed'), 'a region that allows it accepts a request for a future slot inside hours');

-- ============================================================ Personal Manager schedules
:as_P;
select chk((select jsonb_array_length(my_schedule() -> 'hours') = 0), 'a PM starts with no stated hours');
select set_working_hours(null, jsonb_build_array(
  jsonb_build_object('weekday', 1, 'start', '09:00', 'end', '13:00'), jsonb_build_object('weekday', 1, 'start', '14:00', 'end', '18:00'),
  jsonb_build_object('weekday', 2, 'start', '09:00', 'end', '18:00'), jsonb_build_object('weekday', 3, 'start', '09:00', 'end', '18:00'),
  jsonb_build_object('weekday', 4, 'start', '09:00', 'end', '18:00'), jsonb_build_object('weekday', 5, 'start', '09:00', 'end', '18:00')));
select chk((select jsonb_array_length(my_schedule() -> 'hours') = 6), 'a PM sets their own working hours');
select expect_error($$select set_working_hours(null, '[{"weekday":1,"start":"09:00","end":"12:00"},{"weekday":1,"start":"11:00","end":"13:00"}]')$$, 'overlapping windows are refused');
select expect_error(format($$select set_working_hours('%s', '[]')$$, :'U_Q'), 'a PM cannot change another PM''s hours');
:as_C;
select expect_error($$select set_working_hours(null, '[]')$$, 'a customer has no working hours');
select chk((select count(*) = 0 from pm_working_hours), 'a customer cannot read PM schedules');
:as_Q;
select chk((select count(*) = 0 from pm_working_hours), 'a PM cannot read another PM''s schedule');
:as_db;
select ((current_date + 20) - extract(dow from current_date + 20)::int + 1) as monday \gset
select pm_free_problem(:'U_P', 'IN-T', local_ts(:'monday', '10:00', 'Asia/Kolkata'), local_ts(:'monday', '11:00', 'Asia/Kolkata')) is null as free_morning \gset
select chk(:'free_morning', 'inside working hours the PM is free');
select chk(pm_free_problem(:'U_P', 'IN-T', local_ts(:'monday', '13:30', 'Asia/Kolkata'), local_ts(:'monday', '14:30', 'Asia/Kolkata')) like '%working hours%', 'a visit that spans the gap between two windows (the break) is refused');
select chk(pm_free_problem(:'U_P', 'IN-T', local_ts(:'monday', '12:30', 'Asia/Kolkata'), local_ts(:'monday', '13:30', 'Asia/Kolkata')) is not null, 'a visit ending after a window ends is refused');
select chk(pm_free_problem(:'U_P', 'IN-T', local_ts(:'monday', '17:00', 'Asia/Kolkata'), local_ts(:'monday', '18:00', 'Asia/Kolkata')) is null, 'a visit finishing exactly when the window ends is fine');
select chk(pm_free_problem(:'U_P', 'IN-T', local_ts((:'monday'::date + 5), '10:00', 'Asia/Kolkata'), local_ts((:'monday'::date + 5), '11:00', 'Asia/Kolkata')) like '%working hours%', 'a day the PM does not work (Saturday) is refused');
select chk(pm_free_problem(:'U_Q', 'IN-T', local_ts(:'monday', '10:00', 'Asia/Kolkata'), local_ts(:'monday', '11:00', 'Asia/Kolkata')) like '%No working hours%', 'a PM who has stated no hours is never treated as available');
:as_P;
select add_pm_block(null, local_ts(:'monday', '10:30', 'Asia/Kolkata'), local_ts(:'monday', '11:30', 'Asia/Kolkata'), 'time_off', 'Appointment') as blk \gset
:as_db;
select chk(pm_free_problem(:'U_P', 'IN-T', local_ts(:'monday', '10:00', 'Asia/Kolkata'), local_ts(:'monday', '11:00', 'Asia/Kolkata')) like '%time off%', 'time off blocks the overlapping visit');
select chk(pm_free_problem(:'U_P', 'IN-T', local_ts(:'monday', '11:30', 'Asia/Kolkata'), local_ts(:'monday', '12:30', 'Asia/Kolkata')) is null, 'and the time after it is free');
:as_Q;
select remove_pm_block(:'blk');
:as_db;
select chk((select count(*) = 1 from pm_blocks), 'another PM cannot remove my time off');
:as_P;
select remove_pm_block(:'blk');
:as_db;
select chk((select count(*) = 0 from pm_blocks), 'but I can');
-- an existing task, with a buffer
insert into tasks (customer_id, title, category, location, scheduled_at, est_minutes, status, assigned_worker_id, price_status)
  values (:'U_C', 'Existing job', 'general', 'Flat 9', local_ts(:'monday', '10:00', 'Asia/Kolkata'), 60, 'assigned', :'U_P', 'confirmed');
select chk(pm_free_problem(:'U_P', 'IN-T', local_ts(:'monday', '10:30', 'Asia/Kolkata'), local_ts(:'monday', '11:30', 'Asia/Kolkata')) like '%already has a task%', 'an overlapping assigned task is a conflict');
select chk(pm_free_problem(:'U_P', 'IN-T', local_ts(:'monday', '11:00', 'Asia/Kolkata'), local_ts(:'monday', '12:00', 'Asia/Kolkata')) is null, 'back-to-back is fine with no buffer');
update platform_settings set value = '30' where key = 'schedule_buffer_minutes';
select chk(pm_free_problem(:'U_P', 'IN-T', local_ts(:'monday', '11:00', 'Asia/Kolkata'), local_ts(:'monday', '12:00', 'Asia/Kolkata')) like '%already has a task%', 'a configured buffer keeps time free around other tasks');
select chk(pm_free_problem(:'U_P', 'IN-T', local_ts(:'monday', '11:30', 'Asia/Kolkata'), local_ts(:'monday', '12:30', 'Asia/Kolkata')) is null, 'and ends where it should');
update platform_settings set value = '0' where key = 'schedule_buffer_minutes';
-- time zones for PM schedules
select chk(pm_free_problem(:'U_P', 'US-T', local_ts(:'monday', '10:00', 'America/New_York'), local_ts(:'monday', '11:00', 'America/New_York')) is null, 'the PM''s hours are read in the task region''s time zone');
