# Regions, pricing, scheduling and assignment: how to switch it on

Run migrations 0012 to 0015 (or paste `supabase/schema.sql`). Nothing changes for customers until you configure it:
no region, rate, schedule or gender mapping is shipped, and automatic offers are **off**.

1. **Regions and hours** (dashboard): add each region with its ISO currency and IANA time zone, set it Active. The default window is 06:00-20:00; override per weekday, add closures. Tick "payments accepted" only after checking with Razorpay.
2. **Pricing rules**: per service and region choose flat, per-minute or progressive tiers (each rate applies only to the minutes in its own tier), minimum minutes, billing step, rounding, optional quantity discount (separate from duration pricing; combining the two needs an explicit tick), travel, and whether it prices automatically or always needs an approved quote. Save a draft, "Check it", then Activate. An activated rule never changes: copy it to change it. Bookings keep the rule version they were made under.
3. **Vehicle need** per service (none / two-wheeler / four-wheeler / either) is set on the Pricing page.
4. **Personal Managers** set working hours, time off, vehicle and regions in the app (Availability). A PM with no hours is never offered a timed task.
5. **Assignment**: set mode to "offers" when ready. Offer expiry, attempts, ranking weights and capacity are settings. Offers, the Admin Queue and per-task eligibility reasons are on the Assignment page. Schedule `process_offers()` every minute (pg_cron or the Edge Function) so expired offers move on.
6. **Gender matching**: off, empty mapping. The mapping and legal review are business decisions that are not made. Do not enable it until the legal position for each region is reviewed. For a booking made for someone else the booker's gender is not used.

Limits to know: a flexible task (no time) or a multi-day plan with free-text dates cannot be checked against schedules, so it goes to the Admin Queue rather than being offered. Distance-based travel always needs a quote until an administrator supplies the distance. Todo+ subscription plans stay INR/Razorpay as configured.
