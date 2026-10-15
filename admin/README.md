# Mr. Todo — Admin dashboard

The back-office web app for the Mr. Todo team. It talks to the same Supabase
database as the mobile/web app in `../app`.

What admins do here:

- **Overview** — tasks waiting for a Personal Manager, applications to review,
  last 7/30 days of completed work and platform share, demand by category.
- **Task queue** — every task, oldest-waiting first. Open one to see a ranked
  shortlist of approved PMs (skill match → hasn't declined → available → same
  area → rating → workload → longest since last job) and assign with one click.
  Reassign if a PM is slow to accept, cancel, or close a task without the code
  when the customer confirms another way.
- **Applications** — review PM applicants' details and their private ID /
  certificate uploads; approve, request more info (with a note they see in the
  app), or reject.
- **Personal Managers** — directory with skills, area, rating, availability and
  active jobs; suspend or reinstate.
- **Audit log** — every action on the platform, written by the database itself.

Everything updates live.

> The same admin tools, plus reports, reviews, money, insights, broadcasts and admin levels, are also built
> into the mobile app (the **Tools** button on the admin home). This web dashboard has the original set:
> overview, task queue, applications, Personal Managers and the audit log.

## Run it

```
cd admin
npm install
npm run dev        # http://localhost:5173
```

Sign in with an account whose `role` is `admin` (see `../app/SETUP_BACKEND.md`,
"Making yourself an Admin"). Other accounts are signed straight back out — and
even if someone bypassed this screen, the database refuses admin actions from
non-admins.

## Deploy it

`npm run build` produces a static site in `admin/dist/` — upload it to any static
host (Netlify, Vercel, Cloudflare Pages, Supabase Storage, S3…). It uses relative
paths, so it also works from a sub-folder.

It connects to the Supabase project configured in `src/lib/supabase.js`. To
point it elsewhere, copy `.env.example` to `.env` and fill in the URL and key.
