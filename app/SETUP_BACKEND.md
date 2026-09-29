# Mr. Todo — backend setup (Supabase)

This turns the app from a demo into a real, working product with accounts, a real database, and email login — all on Supabase's free tier. Here's exactly what to do, in order.

## 1. Create your Supabase project (5 min)

1. Go to supabase.com and sign up (free — no card needed for the free tier).
2. Click "New project". Pick any name (e.g. "mr-todo"), set a database password (save it somewhere), pick the region closest to India (e.g. Mumbai/Singapore), and create it. Takes about 2 minutes to spin up.

## 2. Run the database schema (2 min)

1. In your new project, open the **SQL Editor** (left sidebar).
2. Click "New query".
3. Open `supabase/schema.sql` from this codebase, copy all of it, paste it in, and click **Run**.
4. You should see "Success. No rows returned." This creates the `profiles`, `tasks`, and `task_visits` tables, sets up security rules, and wires up a trigger so every signup automatically gets a profile.

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
- Tap "Create an account", pick **Customer** or **Personal Manager**, sign up with a real email.
- Confirm the email (check your inbox for the confirmation link from Supabase), then log back in.
- Post a task as a customer, then sign up a second account as a Personal Manager to see it from that side. Task changes now sync live across devices — no more resets on restart.

## Making yourself (or anyone) an Admin

There's no signup option for Admin on purpose — you promote an account manually so nobody can just sign up as one:
1. Sign up normally as a customer first.
2. In Supabase, go to **Table Editor → profiles**, find your row, and change `role` from `customer` to `admin`.
3. Next time you log into the app, you'll see a Customer/PM view switcher appear at the bottom — that's your admin preview control. (The full assignment queue/dashboard for admins is the web prototype for now, covered below.)

## What this gives you vs. what's still manual

Working now: real accounts, email + password or email-code login, a real Postgres database, live sync between customer and worker apps (a visit logged on the worker's phone appears instantly on the customer's tracking screen), row-level security so people can only see their own data.

Still to build when you're ready: connecting the admin assignment queue (currently the web prototype) to this same database so the "system suggests, admin assigns" flow uses real signups instead of seed data; real SMS for OTPs (currently the code just lives in the database — fine for testing, but a real launch should text it); and payments.

## Costs

Supabase's free tier covers this comfortably while testing and even through an early launch: 500MB database, 50,000 monthly active users, and unlimited API requests within fair use. You'd only need to pay (~$25/month for the Pro tier) once you have real production traffic or need backups — no cost to build and test everything above.
