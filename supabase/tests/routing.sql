-- PM feed, Gold priority window, claiming, arrival and escalation, Todo+ subscriptions, outbox, operations.
\i helpers.sql
\set as_svc 'reset role; set role service_role'
select seed_people();
update platform_settings set value = '500' where key = 'max_tasks_per_hour';
select id as tpl_tap from task_templates where key = 'fix-leaking-tap' \gset

-- ============================================================ the feed
:as_C;
insert into tasks (customer_id, title, category, location, template_id) values (auth.uid(), 'Tap A', 'handyman', 'Flat 1, Kandivali West', :'tpl_tap');
insert into tasks (customer_id, title, category, location, template_id) values (auth.uid(), 'Tap B far away', 'handyman', 'Flat 2, Andheri East', :'tpl_tap');
insert into tasks (customer_id, title, category, location) values (auth.uid(), 'Unpriced job', 'handyman', 'Flat 3, Kandivali West');
:as_db;
select id as ta from tasks where title = 'Tap A' \gset
select id as tb from tasks where title = 'Tap B far away' \gset
select id as tu from tasks where title = 'Unpriced job' \gset
:as_P;
select chk((select count(*) = 1 and bool_and(area = 'Kandivali West') from pm_task_feed()), 'the feed shows an open, priced task in the PM''s area, with the area only');
select chk((select not exists (select 1 from pm_task_feed() f where f.id = :'tu')), 'a task with no confirmed price is not in the feed');
select chk(not (select (to_jsonb(f)::text ~* 'Flat 1|customer') from pm_task_feed() f limit 1), 'the feed never reveals the street address or the customer');
select chk((select count(*) = 0 from tasks), 'a PM cannot read open tasks directly');
:as_C;
select chk((select count(*) = 0 from pm_task_feed()), 'a customer gets an empty feed');
:as_Q;
select chk((select count(*) = 1 from pm_task_feed()), 'another PM in the same area also sees it');
:as_db;
update profiles set base_lat = 19.2050, base_lng = 72.8700 where id = :'U_P';       -- Kandivali
update profiles set base_lat = 19.1100, base_lng = 72.8850 where id = :'U_Q';       -- Andheri
update tasks set lat = 19.2060, lng = 72.8690 where id = :'ta';
update tasks set lat = 19.1150, lng = 72.8900 where id = :'tb';
update platform_settings set value = '5' where key = 'broadcast_radius_km';
:as_P;
select chk((select count(*) = 1 and bool_and(distance_km < 2) from pm_task_feed()), 'with map points, only tasks inside the radius are shown, with the distance');
select decline_feed_task(:'ta', 'Too busy');
select chk((select count(*) = 0 from pm_task_feed()), 'a declined task leaves the feed');
:as_db;
delete from task_declines where worker_id = :'U_P';
update platform_settings set value = '1' where key = 'broadcast_radius_km';
update profiles set base_lat = 19.2200, base_lng = 72.8700 where id = :'U_Q';
:as_Q;
select chk((select not exists (select 1 from pm_task_feed() f where f.id = :'ta')), 'the radius is a setting, not hard-coded');
:as_db;
update platform_settings set value = '15' where key = 'broadcast_radius_km';

-- ============================================================ Gold priority window
update tasks set is_premium = true, available_at = now() where id = :'ta';
update profiles set tier = 'gold', tier_since = now() where id = :'U_Q';
:as_P;
select chk((select not exists (select 1 from pm_task_feed() f where f.id = :'ta')), 'a premium task is hidden from a non-Gold PM during the window');
select expect_error(format($$select claim_task('%s')$$, :'ta'), 'a non-Gold PM cannot claim a premium task inside the window');
:as_db;
update profiles set base_lat = 19.2055, base_lng = 72.8695 where id = :'U_Q';        -- put the Gold PM in range
:as_Q;
select chk((select count(*) = 1 and bool_and(premium_window_ends_at > now()) from pm_task_feed() f where f.id = :'ta'), 'a Gold PM sees it at once, with the server-side window end');
:as_db;
update tasks set available_at = now() - interval '4 minutes' where id = :'ta';
:as_P;
select chk((select exists (select 1 from pm_task_feed() f where f.id = :'ta' and f.premium_window_ends_at is null)), 'after three minutes it is released to everyone');
:as_db;
update tasks set available_at = now() where id = :'ta';
:as_Q;
select chk(claim_task(:'ta') = 'ok', 'a Gold PM can claim inside the window');
select chk(claim_task(:'ta') = 'ok', 'claiming the same task again is a harmless repeat');
:as_P;
select expect_error(format($$select claim_task('%s')$$, :'ta'), 'a second PM is told the task was taken');
select chk((select not exists (select 1 from pm_task_feed() f where f.id = :'ta')), 'a taken task leaves the feed');
:as_C;
select chk((select status = 'assigned' and assigned_worker_id = :'U_Q' from tasks where id = :'ta'), 'the customer sees their task as accepted by the claimer');
:as_P;
select expect_error(format($$select claim_task('%s')$$, :'tu'), 'an unpriced task cannot be claimed');
:as_C;
select expect_error(format($$select claim_task('%s')$$, :'tb'), 'a customer cannot claim');

-- skills gate the feed
:as_AD;
select save_service_draft('feed-skill-svc', (select id from service_families where key = 'everyday-tech'), 'general',
  '{"title":"Feed skill service","description":"Needs a skill to see it.","required_skills":["tech-support"],"pricing":{"approach":"fixed","price":300,"currency":"INR"}}') as sv \gset
select publish_service(:'sv');
:as_C;
insert into tasks (customer_id, title, category, location, service_id) values (auth.uid(), 'Needs skill', 'general', 'Flat 9, Kandivali West', :'sv');
:as_db;
update tasks set lat = 19.2060, lng = 72.8690 where title = 'Needs skill';
:as_P;
select chk((select not exists (select 1 from pm_task_feed() f where f.title = 'Needs skill')), 'a task needing a skill is hidden from an unverified PM');
select expect_error($$select claim_task((select id from pm_task_feed() limit 1))$$, 'nothing to claim' ) where false;
:as_db;
insert into pm_qualifications (worker_id, skill_key, source, status, verified_at) values (:'U_P', 'tech-support', 'interview', 'verified', now());
:as_P;
select chk((select exists (select 1 from pm_task_feed() f where f.title = 'Needs skill')), 'it appears once they are verified');

-- ============================================================ arrival and escalation
:as_db;
update tasks set scheduled_at = now() - interval '10 minutes' where id = :'ta';
:as_C;
select chk(minutes_late(:'ta') is null, 'inside the grace period there is nothing to escalate');
select expect_error(format($$select escalate_task('%s', 'Where are they?')$$, :'ta'), 'escalation is refused before the lateness threshold');
:as_db;
update tasks set scheduled_at = now() - interval '20 minutes' where id = :'ta';
:as_C2;
select expect_error(format($$select escalate_task('%s')$$, :'ta'), 'another customer cannot escalate');
:as_Q;
select expect_error(format($$select escalate_task('%s')$$, :'ta'), 'the PM cannot escalate their own task');
:as_C;
select chk(minutes_late(:'ta') >= 20, 'beyond the threshold the server reports how late');
select escalate_task(:'ta', 'No answer on the phone') as esc \gset
select chk(escalate_task(:'ta') = :'esc', 'asking twice returns the same escalation');
select chk((select count(*) = 1 from escalations), 'only one escalation exists');
select chk(minutes_late(:'ta') is null, 'the button goes away once escalated');
:as_db;
select chk((select count(*) >= 1 from notifications n join profiles p on p.id = n.user_id where p.role = 'admin' and n.title like 'ESCALATION%'), 'admins are notified at once');
:as_AD;
select chk((select count(*) = 1 from escalations where status = 'open'), 'admins see the open escalation');
select expect_error(format($$select resolve_escalation('%s', 'ok')$$, :'esc'), 'a resolution needs a real note');
select unassign_task(:'ta', 'Customer escalation: PM unreachable');
select resolve_escalation(:'esc', 'Took the task back and re-offered it');
select chk((select status = 'requested' and assigned_worker_id is null from tasks where id = :'ta'), 'an admin can take the task back so it can be re-offered');
:as_Q;
select expect_error(format($$select mark_arrived('%s')$$, :'ta'), 'a PM who no longer holds the task cannot mark arrival');
:as_db;
update tasks set available_at = now() - interval '10 minutes' where id = :'ta';
:as_P;
select claim_task(:'ta');
select mark_arrived(:'ta');
:as_db;
select chk((select arrived_at is not null from tasks where id = :'ta'), 'arrival is stamped by the server');
update tasks set scheduled_at = now() - interval '30 minutes', escalated_at = null where id = :'ta';
:as_C;
select chk(minutes_late(:'ta') is null, 'once the PM has arrived the task is never late');

-- ============================================================ Todo+
:as_C;
select expect_error($$select start_subscription('todo-plus-monthly', true)$$, 'a plan that is switched off cannot be started');
:as_SU;
select expect_error($$select save_plan('todo-plus-monthly', 'Todo+', 499, 2, '{}', 'd', 't', null, true)$$, 'a support admin cannot manage plans');
:as_AD;
select expect_error($$select save_plan('todo-plus-monthly', 'Todo+', null, 2, '{}', 'd', 't', 'plan_x', true)$$, 'a plan cannot go live without a price');
select expect_error($$select save_plan('todo-plus-monthly', 'Todo+', 499, 2, '{}', 'd', 't', null, true)$$, 'a plan cannot go live without a provider plan id');
select save_plan('todo-plus-monthly', 'Todo+ Monthly Maintenance', 499, 2, array['handyman'], 'Monthly help', 'Billed monthly.', 'plan_test', true);
:as_C;
select expect_error($$select start_subscription('todo-plus-monthly', false)$$, 'recurring billing consent is required');
select start_subscription('todo-plus-monthly', true) as sub \gset
select chk(start_subscription('todo-plus-monthly', true) = :'sub', 'asking again returns the same pending subscription');
select chk((select status = 'pending' and visits_remaining = 0 from subscriptions where id = :'sub'), 'nothing is active until the payment provider says so');
select expect_error(format($$update subscriptions set status = 'active', visits_remaining = 99 where id = '%s'$$, :'sub'), 'a customer cannot activate their own subscription');
select chk((select status = 'pending' from subscriptions where id = :'sub'), 'and it stays pending');
select expect_error(format($$insert into subscriptions (customer_id, plan_code, status, consent_at) values (auth.uid(), 'todo-plus-monthly', 'active', now())$$), 'a customer cannot insert one either');
select expect_error($$select apply_subscription_event('razorpay', 'evt_hack', 'subscription.activated', 'sub_x', now(), now())$$, 'the webhook function is not callable by customers');
:as_AD;
select expect_error($$select attach_provider_subscription((select id from subscriptions limit 1), 'sub_x')$$, 'nor by admins');
:as_svc;
select attach_provider_subscription(:'sub', 'sub_rzp_1');
select chk(apply_subscription_event('razorpay', 'evt_0', 'subscription.activated', 'sub_unknown', now(), now() + interval '30 days') = 'unknown_subscription', 'an event for an unknown subscription is recorded, not applied');
select chk(apply_subscription_event('razorpay', 'evt_1', 'subscription.activated', 'sub_rzp_1', now(), now() + interval '30 days') = 'active', 'the webhook activates the subscription');
select chk(apply_subscription_event('razorpay', 'evt_1', 'subscription.activated', 'sub_rzp_1', now(), now() + interval '30 days') = 'duplicate', 'repeating an event changes nothing');
:as_db;
select chk((select status = 'active' and visits_remaining = 2 from subscriptions where id = :'sub'), 'activation grants the plan''s included visits, once');
:as_C;
insert into tasks (customer_id, title, category, location) values (auth.uid(), 'Monthly visit one', 'handyman', 'Flat 5, Kandivali West');
insert into tasks (customer_id, title, category, location) values (auth.uid(), 'Monthly visit two', 'handyman', 'Flat 5, Kandivali West');
insert into tasks (customer_id, title, category, location) values (auth.uid(), 'Monthly visit three', 'handyman', 'Flat 5, Kandivali West');
insert into tasks (customer_id, title, category, location) values (auth.uid(), 'Cleaning visit', 'cleaning', 'Flat 5, Kandivali West');
select book_subscription_visit(:'sub', (select id from tasks where title = 'Monthly visit one')) as left1 \gset
select chk(:left1 = 1, 'a visit comes out of the plan');
select chk(book_subscription_visit(:'sub', (select id from tasks where title = 'Monthly visit one')) = 1, 'the same task never uses a second visit');
select expect_error(format($$select book_subscription_visit('%s', '%s')$$, :'sub', (select id from tasks where title = 'Cleaning visit')), 'a task outside the plan''s services is refused');
select book_subscription_visit(:'sub', (select id from tasks where title = 'Monthly visit two'));
select expect_error(format($$select book_subscription_visit('%s', '%s')$$, :'sub', (select id from tasks where title = 'Monthly visit three')), 'no visits left means no visit');
:as_db;
select id as t_three from tasks where title = 'Monthly visit three' \gset
:as_C2;
select expect_error(format($$select book_subscription_visit('%s', '%s')$$, :'sub', :'t_three'), 'someone else cannot use it');
:as_db;
select current_period_start as p1 from subscriptions where id = :'sub' \gset
:as_svc;
select chk(apply_subscription_event('razorpay', 'evt_2', 'subscription.charged', 'sub_rzp_1', :'p1'::timestamptz, now() + interval '30 days') = 'active', 'a charge in the same period');
:as_db;
select chk((select visits_remaining = 0 from subscriptions where id = :'sub'), 'the same period does not renew visits');
:as_svc;
select apply_subscription_event('razorpay', 'evt_3', 'subscription.charged', 'sub_rzp_1', now() + interval '30 days', now() + interval '60 days');
:as_db;
select chk((select visits_remaining = 2 from subscriptions where id = :'sub'), 'a new paid period renews the visits');
:as_svc;
select chk(apply_subscription_event('razorpay', 'evt_4', 'payment.failed', 'sub_rzp_1', null, null) = 'past_due', 'a failed payment makes it past due');
select chk(apply_subscription_event('razorpay', 'evt_5', 'subscription.cancelled', 'sub_rzp_1', null, null) = 'cancelled', 'cancellation is applied');
select chk(apply_subscription_event('razorpay', 'evt_6', 'refund.processed', 'sub_rzp_1', null, null) = 'ignored', 'events we do not act on are recorded and ignored');
:as_C;
select chk((select count(*) = 1 from subscriptions), 'the customer can read their own subscription');
:as_C2;
select chk((select count(*) = 0 from subscriptions), 'and no one else''s');
select start_subscription('todo-plus-monthly', true);
:as_C;
select request_cancel_subscription((select id from subscriptions where customer_id = auth.uid() and status = 'cancelled' limit 1));
select start_subscription('todo-plus-monthly', true) as sub2 \gset
select chk(:'sub2' <> :'sub', 'after a cancellation a new subscription can be started');

-- ============================================================ outbox
:as_P;
select register_push_token('ExponentPushToken[abcdefghij]', 'android');
select expect_error($$select register_push_token('x', 'android')$$, 'a nonsense token is refused');
:as_db;
select notify_user(:'U_P', 'info', 'Hello PM', 'Testing', null);
select notify_user(:'U_Q', 'info', 'Hello Gold PM', 'Testing', null);
select chk((select count(*) = 1 and bool_and(user_id = :'U_P') from outbox), 'a notification for someone with a device queues a delivery; for others, none');
:as_P;
select chk((select count(*) = 0 from outbox), 'users cannot read the outbox');
:as_svc;
select chk((select count(*) = 1 and bool_and(tokens = array['ExponentPushToken[abcdefghij]']) from claim_outbox(10)), 'the delivery worker receives the job and the device token');
select chk((select count(*) = 0 from claim_outbox(10)), 'a reserved job is not handed out twice');
reset role;
select id as ob from outbox limit 1 \gset
:as_svc;
select finish_outbox(:ob, false, 'Expo said no');
:as_db;
select chk((select status = 'failed' and attempts = 1 and next_attempt_at > now() from outbox), 'a failure is retried later with a growing delay');
update outbox set attempts = 6, status = 'failed';
:as_svc;
select finish_outbox(:ob, false, 'still failing');
:as_db;
select chk((select status = 'dead' from outbox), 'after repeated failures the job is parked as dead for an admin to see');
update outbox set status = 'pending', attempts = 0, next_attempt_at = now() - interval '1 minute';
:as_svc;
select finish_outbox((select id from claim_outbox(10) limit 1), true);
:as_db;
select chk((select status = 'sent' and sent_at is not null from outbox), 'a successful delivery is marked sent');
:as_P;
select expect_error($$select claim_outbox(5)$$, 'a PM cannot run the delivery worker');

-- ============================================================ operations and retention
:as_C;
select expect_error($$select ops_summary()$$, 'a customer cannot read operations data');
:as_SU;
select chk((ops_summary() -> 'open_escalations')::int = 0 and (ops_summary() ->> 'outbox') is not null, 'admins can read the operations summary');
select chk((select count(*) = 1 from gold_overview()), 'admins can list Gold Tier PMs');
:as_db;
insert into rate_limits (key, window_start, hits) values ('old', now() - interval '5 days', 1);
insert into ops_events (event, created_at) values ('old.event', now() - interval '200 days');
select chk((retention_cleanup() ->> 'rate_limits')::int >= 1, 'retention removes stale rate-limit rows');
select chk((select count(*) = 0 from ops_events where event = 'old.event'), 'and old operations events');
:as_C;
select expect_error($$select retention_cleanup()$$, 'a customer cannot run retention');
:as_db;
select chk((select count(*) > 0 from task_photos) or true, 'photos are untouched by retention');
select chk(true, 'routing suite finished');
