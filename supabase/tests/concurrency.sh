#!/usr/bin/env bash
# Eight Personal Managers claim the same task at the same moment, each in its own
# database session. Exactly one may win.   Usage: concurrency.sh <database>
set -euo pipefail
db=$1
psql -qX -v ON_ERROR_STOP=1 -d "$db" >/dev/null <<'SQL'
update platform_settings set value = '500' where key = 'max_tasks_per_hour';
insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-0000000000c1', 'c@x', '{"full_name":"Priya"}');
insert into auth.users (id, email, raw_user_meta_data)
  select ('00000000-0000-0000-0000-00000000010' || n)::uuid, 'w' || n || '@x', jsonb_build_object('full_name', 'PM ' || n, 'role', 'worker') from generate_series(1, 8) n;
update profiles set worker_status = 'approved' where role = 'worker';
set role authenticated; select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', false);
insert into tasks (customer_id, title, category, location, template_id)
  values (auth.uid(), 'Contested tap', 'handyman', 'Flat 1, Kandivali West', (select id from task_templates where key = 'fix-leaking-tap'));
SQL
task=$(psql -qXAt -d "$db" -c "select id from tasks where title = 'Contested tap'")
for n in 1 2 3 4 5 6 7 8; do
  ( psql -qXAt -d "$db" -c "set role authenticated; select set_config('request.jwt.claims', '{\"sub\":\"00000000-0000-0000-0000-00000000010$n\",\"role\":\"authenticated\"}', false); select claim_task('$task');" >/dev/null 2>&1 && echo won || echo lost ) > "/tmp/claim_$n.out" &
done
wait
wins=$(cat /tmp/claim_*.out | grep -c won || true)
rm -f /tmp/claim_*.out
holder=$(psql -qXAt -d "$db" -c "select count(*) from tasks where id = '$task' and assigned_worker_id is not null and status = 'assigned'")
[ "$wins" = "1" ] && [ "$holder" = "1" ] || { echo "FAILED: $wins PMs won the claim"; exit 1; }
echo "   concurrent claims: 8 tried, exactly 1 won"

# ---- offers: two overlapping offers for one PM, answered at the same moment from eight sessions
psql -qX -v ON_ERROR_STOP=1 -d "$db" >/dev/null <<'SQL'
insert into regions (code, name, currency, timezone, status) values ('IN-C', 'Concurrency test', 'INR', 'Asia/Kolkata', 'active');
insert into pm_working_hours (worker_id, weekday, start_time, end_time) select '00000000-0000-0000-0000-000000000101', d, '06:00', '20:00' from generate_series(0, 6) d;
update profiles set region_codes = array['IN-C'] where id = '00000000-0000-0000-0000-000000000101';
update platform_settings set value = '"offers"' where key = 'auto_assign_mode';
set role authenticated; select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', false);
insert into tasks (customer_id, title, category, location, template_id, region_code, scheduled_at, est_minutes)
  select auth.uid(), 'Offer race ' || n, 'handyman', 'Flat ' || n || ', Kandivali West', (select id from task_templates where key = 'fix-leaking-tap'), 'IN-C',
         (((current_date + 5) + time '11:00') at time zone 'Asia/Kolkata'), 60 from generate_series(1, 2) n;
SQL
offerA=$(psql -qXAt -d "$db" -c "select o.id from assignment_offers o join tasks t on t.id = o.task_id where t.title = 'Offer race 1' and o.status = 'pending'")
offerB=$(psql -qXAt -d "$db" -c "select o.id from assignment_offers o join tasks t on t.id = o.task_id where t.title = 'Offer race 2' and o.status = 'pending'")
[ -n "$offerA" ] && [ -n "$offerB" ] || { echo "FAILED: both tasks should have a pending offer to the same PM"; exit 1; }
for n in 1 2 3 4 5 6 7 8; do
  if [ $((n % 2)) = 0 ]; then o=$offerA; else o=$offerB; fi
  ( psql -qXAt -d "$db" -c "set role authenticated; select set_config('request.jwt.claims', '{\"sub\":\"00000000-0000-0000-0000-000000000101\",\"role\":\"authenticated\"}', false); select respond_offer('$o', true);" 2>&1 | tail -1 > "/tmp/offer_$n.out" ) &
done
wait
accepted=$(cat /tmp/offer_*.out | grep -c '^accepted$' || true)
ineligible=$(cat /tmp/offer_*.out | grep -c '^ineligible$' || true)
rejected=$(cat /tmp/offer_*.out | grep -c '^rejected$' || true)
rm -f /tmp/offer_*.out
assigned=$(psql -qXAt -d "$db" -c "select count(*) from tasks where title like 'Offer race%' and assigned_worker_id is not null and status = 'assigned'")
[ "$assigned" = "1" ] || { echo "FAILED: $assigned overlapping tasks were assigned to one PM"; exit 1; }
[ "$accepted" = "4" ] && [ "$ineligible" = "1" ] && [ "$rejected" = "3" ] || { echo "FAILED: expected 4 answers to the winning offer, and for the losing one a single refusal then 'rejected', got accepted=$accepted ineligible=$ineligible rejected=$rejected"; exit 1; }
echo "   concurrent offer answers: 8 sessions, 2 overlapping offers, exactly 1 task assigned (repeat answers idempotent, the other offer refused once)"
