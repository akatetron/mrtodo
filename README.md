# Mr. Todo

A marketplace where people ask for a **Personal Manager** to get a task done —
fix a tap, deep-clean a flat, accompany a parent to the bank — and where people
can sign up to **become** a Personal Manager. Every PM is ID-checked and approved
by the Mr. Todo team, and the team matches each task to the right PM.

| Folder | What it is | Who uses it |
| --- | --- | --- |
| [`app/`](app/README.md) | Expo / React Native app — **iOS, Android and web** from one codebase | Customers and Personal Managers |
| [`admin/`](admin/README.md) | Admin dashboard website (Vite + React) | The Mr. Todo team |
| [`supabase/`](supabase/schema.sql) | Database, security rules and task actions (Supabase / Postgres) | Both apps |
| [`docs/`](docs) | Business plan, brand colours, task-journey walkthrough | Everyone |

## How one task flows

1. **Customer** posts a task in the app (what, where, when, price).
2. **Admin** opens it in the dashboard's task queue, picks from a ranked shortlist
   of approved PMs and assigns it.
3. **PM** gets the offer in their app and accepts (or declines — it goes back to
   the queue), then taps Start on site.
4. When the job is done the customer reads out their **4-digit completion code**;
   the PM enters it and the task closes. Both rate each other.

Every step updates live on all three screens and is recorded in the audit log.

## What's in it

**Customers:** post a task (with a time, saved addresses, "book again" on past tasks), watch it progress,
see before/after photos from the Personal Manager, cancel, rate, report a problem, get notifications.

**Personal Managers:** apply with ID and certificates, accept or decline offers, log visits, upload
before/after photos, finish with the customer's code, track earnings, renew certificates (with a warning
before they expire), report a problem, get notifications.

**Admins** (inside the app, under the **Tools** button, and in the separate web dashboard):
task queue with search and filters, ranked Personal Manager shortlist and one-click assign, offers that
lapse after 15 minutes without an answer, application review with ID previews, people profiles with
reliability stats and warning flags, reports inbox, ratings and reviews (lowest first), money (job value,
platform share, what each Personal Manager is owed, payout records), insights (demand by category and
area, where to recruit), broadcast messages, CSV export, and two admin levels.

**Not built yet:** push notifications to a locked phone (notifications show in the in-app bell), chat
between customer and Personal Manager, address autocomplete and maps, two-factor sign-in, real payments.

## Becoming a Personal Manager

Sign up in the app as a Personal Manager → fill in skills, service area and
experience → upload a government ID (and any certificates) → submit. An admin
approves, asks for more information, or rejects from the dashboard's
Applications page; the applicant's app updates on its own.

## Getting started

1. Set up the database: [`app/SETUP_BACKEND.md`](app/SETUP_BACKEND.md)
   (run `supabase/schema.sql` in your Supabase project — safe to re-run).
1. Optional, for trying it out: run `supabase/seed_demo.sql` to create one
   account of each role, all with the password `demo1234`:

   | Role | Email |
   | --- | --- |
   | Customer | `priya@example.com` |
   | Personal Manager (approved) | `rakesh@example.com` |
   | Admin (super: can do everything) | `admin@example.com` |
   | Admin (support: no approvals, ID documents, money or broadcasts) | `support@example.com` |

   It also posts two sample tasks, so the app and dashboard have something in
   them. **Run `supabase/seed_demo_remove.sql` before real users arrive** —
   these passwords are public, and the admin account can read everyone's
   tasks and uploaded ID documents.
2. Run the app: `cd app && npm install && npm start` (scan the QR code with
   Expo Go, or press `w` for the web version).
3. Run the admin dashboard: `cd admin && npm install && npm run dev`.

Database tests (plain Postgres 16, no Supabase needed):
`PGHOST=... PGUSER=postgres supabase/tests/run.sh`
