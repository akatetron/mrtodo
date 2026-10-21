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
