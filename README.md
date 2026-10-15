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
   | Admin | `admin@example.com` |

   It also posts two sample tasks, so the app and dashboard have something in
   them. **Run `supabase/seed_demo_remove.sql` before real users arrive** —
   these passwords are public, and the admin account can read everyone's
   tasks and uploaded ID documents.
2. Run the app: `cd app && npm install && npm start` (scan the QR code with
   Expo Go, or press `w` for the web version).
3. Run the admin dashboard: `cd admin && npm install && npm run dev`.

Database tests (plain Postgres 16, no Supabase needed):
`PGHOST=... PGUSER=postgres supabase/tests/run.sh`
