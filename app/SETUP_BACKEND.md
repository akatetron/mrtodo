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

## What this gives you vs. what's still manual

Working now: real accounts; PM applications with ID upload and admin approval; admin assignment from a ranked shortlist; accept/decline/start/complete on the PM's phone with the completion code checked by the database (the PM never sees it); ratings both ways; cancellations; a full audit log; live sync everywhere; row-level security so people only see their own data and the person they're working with.

Still to build when you're ready:
- **SMS / push notifications** — today people see changes when the app is open. Next step: Expo push notifications for "new task offered" and "PM accepted", and SMS for the completion code.
- **Offer time-out** — if a PM doesn't accept, an admin reassigns from the queue (the Overview shows how long offers have waited). Automatic re-offer after N minutes needs a scheduled job (Supabase cron).
- **Payments** — prices are recorded and the dashboard estimates platform share, but no money moves yet (Razorpay is the usual choice in India).
- **Real location / distance** — matching uses the PM's service-area name vs the task address. GPS + distance needs `expo-location` and PostGIS.

## Costs

Supabase's free tier covers this comfortably while testing and even through an early launch: 500MB database, 50,000 monthly active users, and unlimited API requests within fair use. You'd only need to pay (~$25/month for the Pro tier) once you have real production traffic or need backups — no cost to build and test everything above.
