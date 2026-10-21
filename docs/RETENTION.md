# What Mr. Todo keeps, and for how long

These are the rules the database enforces today (`retention_cleanup()`, run daily by
pg_cron when the extension is available, otherwise run it by hand from the SQL
editor: `select retention_cleanup();`). They are starting points for you and your
adviser to confirm; none is legal advice.

| Data | Kept | Why |
|---|---|---|
| Tasks, quotes, price history, scope changes | Indefinitely (not deleted automatically) | Billing and dispute resolution |
| Audit log | Indefinitely, cannot be edited or deleted | Accountability |
| Before/After photos and PM documents | Not deleted automatically | Disputes. Decide a period, then add a job: they live in private Storage buckets |
| Completion codes (hashed) | Deleted 30 days after the task finishes | A used code has no further value |
| Task map points (lat/lng) | Cleared 90 days after the task finishes | Location is only needed to match nearby PMs |
| Subscriptions, plan changes | Indefinitely | Billing |
| Payment webhook records | 180 days | Duplicate protection and troubleshooting |
| Operations events | 90 days | Troubleshooting |
| Delivered/dead push notifications | 30 days | Troubleshooting |
| Rate-limit counters | 2 days | Abuse prevention |

Account deletion (Account → Delete my account): the person's name, contact details, documents,
skills, devices, notifications, saved locations and any recipient they booked for are erased at
once, and their sign-in is disabled. Blocked while they have open tasks or a live Todo+ plan.
Tasks, prices, quotes, ratings, task photos and the audit log are kept, without the person's name,
for billing and disputes. Task photos may still show a place or a person: decide whether to
remove photos after a set time.
