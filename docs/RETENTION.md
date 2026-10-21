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

Not implemented: deleting a person's account and data on request. That needs a
decision on what must be kept for billing and disputes first.
