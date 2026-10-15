# Mr. Todo — backend setup (Supabase)

This turns the app from a demo into a real, working product with accounts, a real database, and email login — all on Supabase's free tier. Here's exactly what to do, in order.

## 1. Create your Supabase project (5 min)

1. Go to supabase.com and sign up (free — no card needed for the free tier).
2. Click "New project". Pick any name (e.g. "mr-todo"), set a database password (save it somewhere), pick the region closest to India (e.g. Mumbai/Singapore), and create it. Takes about 2 minutes to spin up.

## 2. Run the database schema (2 min)

1. In your new project, open the **SQL Editor** (left sidebar).
2. Click "New query".
3. Open `supabase/schema.sql` (in the repository root, next to `app/` and `admin/`), copy all of it, paste it in, and click **Run**.
4. You should see "Success. No rows returned." This creates the tables (profiles, tasks, visits, completion codes, PM documents, audit log), the security rules, the task actions (assign, accept, complete…), and a private `pm-documents` storage bucket for ID uploads.

**Already ran an older version of this file?** Run the new one anyway — it's safe to run as many times as you like and upgrades what's there. Existing Personal Manager accounts are moved back to "application not submitted" so they go through verification.

## 3. Turn on email login (2 min)

1. Go to **Authentication → Providers** in the sidebar. Email should already be enabled by default — leave it on.
2. Go to **Authentication → Settings** (or "URL Configuration"). For now, during testing, you can leave "Confirm email" ON (Supabase will email a confirmation link automatically using their built-in email service — fine for testing, but Supabase's shared email sender has a low daily limit and can land in spam). When you're ready for real users, connect a custom SMTP sender (e.g. free tier of Resend, Postmark, or Brevo) under **Authentication → Settings → SMTP Settings** so confirmation and login-code emails come from your own domain and land reliably.
3. That's it — password login and 6-digit email-code login both work out of the box with no extra setup.

## 4. Connect the app to your project (1 min)

1. In Supabase, go to **Project Settings → API**.
2. Copy the **Project URL** and the **anon public** key.
3. Open `src/lib/supabase.js` in this codebase and paste them in:
   ```js
   const SUPABASE_URL = 'https://your-project-id.supabase.co';
   const SUPABASE_ANON_KEY = 'your-anon-key-here';
   ```
4. Run `npm install` (picks up the new Supabase packages), then `npm start` as before.

## 5. Try it

- Open the app (Expo Go on your phone, or `w` for web preview) — you'll now see a login screen first.
- Tap "Create an account", pick **Customer**, sign up with a real email, confirm it, log in, and post a task.
- Sign up a second account as **Personal Manager**. After logging in it shows the application form: pick skills, enter an area, upload a photo of an ID, submit.
- Make yourself an admin (below), open the admin dashboard (`admin/README.md`), approve the application under **Applications**, then assign the task under **Task queue**.
- The PM's phone shows the offer → Accept → Start → enter the customer's 4-digit completion code. Every step shows up live on the customer's screen and in the admin audit log.

## Making yourself (or anyone) an Admin

There's no signup option for Admin on purpose — you promote an account manually so nobody can just sign up as one (the database also refuses it if someone tries through the API):
1. Sign up normally as a customer first.
2. In Supabase, open the **SQL Editor** and run (with your email):
   ```sql
   update profiles set role = 'admin' where email = 'you@example.com';
   ```
3. Sign in to the admin dashboard (`admin/`) with that account. In the mobile app, admins also get a Customer/PM view switcher at the bottom.

## Updating an existing project

Whenever a new version of `supabase/schema.sql` comes along, paste it into the SQL Editor and run it again.
It only adds and upgrades, never deletes, so it is safe on a project with data. The app tolerates running
*before* you update: new features simply hide or say "needs the latest database update" instead of crashing.

The latest version adds notifications, offer time-outs, reports, proof-of-work photos, document expiry,
payouts, broadcasts, reliability stats and admin levels.

**Offer time-out:** an offer nobody answers returns to the queue after 15 minutes. If your project has the
`pg_cron` extension the database does this every 5 minutes by itself; if not, it happens whenever an admin
has the app open (every minute). To turn pg_cron on: Supabase dashboard → Database → Extensions → pg_cron,
then run schema.sql again.

**Admin levels:** admins you made before this update count as *super* admins. Change someone to *support*
from Tools → Admin team. A support admin can assign, reassign, cancel and complete tasks and handle reports,
but cannot approve or suspend Personal Managers, open ID documents, record payouts or send broadcasts.

## What this gives you vs. what's still manual

Working now: everything in the list in the top-level README, with the rules enforced by the database (so a
modified app can't bypass them).

Still to build when you're ready:
- **Push notifications to a locked phone.** The in-app bell works now. Waking a phone needs Expo push tokens, an
  Apple/Google credential, and a small Supabase Edge Function that sends when a notification row is created.
  SMS for the completion code is similar.
- **Payments.** Money is recorded (jobs, shares, payouts) but nothing is charged or paid in the app. Razorpay is the
  usual choice in India.
- **Real distance.** Matching compares the Personal Manager's area name with the task address. GPS and distance
  need `expo-location` and PostGIS.
- **Chat, maps and address autocomplete, two-factor sign-in for admins.**

## Costs

Supabase's free tier covers this comfortably while testing and even through an early launch: 500MB database, 50,000 monthly active users, and unlimited API requests within fair use. You'd only need to pay (~$25/month for the Pro tier) once you have real production traffic or need backups — no cost to build and test everything above.
