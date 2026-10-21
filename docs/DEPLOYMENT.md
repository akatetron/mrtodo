# Deploying the database update, Edge Functions and apps

## 1. Database (in order)
1. Back up: Supabase → Project Settings → Database → Backups.
2. SQL Editor → paste all of `supabase/schema.sql` → Run. It contains migrations
   `0001` to `0008` in order and is safe to run again. (The individual files are in
   `supabase/migrations/` if you prefer to run them one by one, in number order.)
3. Optional demo data: `supabase/seed_demo.sql` (accounts + sample tasks) and
   `supabase/seed_demo_skills.sql` (lets the demo Personal Manager accept the sample services).
4. Sample catalogue: migration 0007 publishes 12 sample services with SAMPLE prices.
   Edit or pause them in the app: More → Service catalogue.

What each migration adds: 0002 settings, rate limits, audit trail; 0003 prices and
templates; 0004 completion codes, Gold Tier; 0005 contact privacy; 0006 catalogue,
bookings, multi-day approval; 0007 qualifications, specialists, quotes, sample
catalogue; 0008 PM feed, claiming, escalation, Todo+, notification outbox, retention.

Rollback: the migrations only add; they do not delete your data. To undo a feature,
switch it off in the app (pause services, switch plans off). Restoring the backup
is the only full rollback.

## 2. Settings you may want to change (super admin)
In `platform_settings`: `premium_window_seconds` (180), `escalation_grace_minutes` (15),
`broadcast_radius_km` (15), `sla_unassigned_minutes` (15), `quote_requires_admin`,
`standard_pm_share_bps`, `gold_*`. Commission numbers are placeholders from the first
design (PM share 80%, Gold +5% relative): confirm them before launch.

## 3. Edge Functions (not run against live services by me)
```
supabase functions deploy razorpay-webhook --no-verify-jwt
supabase functions deploy create-subscription
supabase functions deploy send-push --no-verify-jwt
supabase secrets set RAZORPAY_WEBHOOK_SECRET=... RAZORPAY_KEY_ID=... RAZORPAY_KEY_SECRET=...
```
- Razorpay dashboard: create the monthly plan; copy its plan id into More → Todo+ plans
  (a plan cannot go live without a price and that id). Add a webhook pointing at
  `https://<project>.functions.supabase.co/razorpay-webhook` for events
  `subscription.activated`, `.charged`, `.pending`, `.halted`, `.cancelled`, `.completed`,
  `payment.failed`, and use the same secret as `RAZORPAY_WEBHOOK_SECRET`.
- `send-push`: schedule it every minute (Supabase → Edge Functions → Schedules) with the
  service-role key as a Bearer token. The apps do not register device tokens yet (no
  `expo-notifications` dependency), so no push is delivered until that is added.
- Cancelling at the provider is not automated: a cancellation request sets a flag and
  notifies admins, who cancel in Razorpay; the webhook then updates the subscription.

## 4. Apps
- Expo app: `cd app && npm install && npx expo start`. Web build: `npx expo export --platform web`.
- Snack: the `snack` branch (SDK 54) at `https://github.com/akatetron/mrtodo/tree/snack/app`.
- Admin dashboard: `cd admin && npm install && npm run build`.

## 5. Tests
- Database (needs Postgres 16 and psql): `PGUSER=postgres supabase/tests/run.sh`.
- Webhook signature/parsing: `node --experimental-strip-types --test supabase/functions/tests/razorpay.test.mjs`.

## 6. Not done / not verified
- In-App Call: no calling provider; the button says calling is unavailable.
- Maps/navigation and device location: not implemented; PMs and tasks match on area text
  unless map points are set directly in the database.
- Razorpay and Expo push: written, not exercised against live services.
- Offline: photos queue and upload later; the completion code is never stored offline,
  so completion itself needs a connection.
