-- Regions, currencies and the pricing engine: per-minute and progressive duration pricing,
-- quantity discounts, travel, quotes, history and who may change what.
-- Every rate below is a test fixture invented for this suite. None is a business value.
\i helpers.sql
select seed_people();
update platform_settings set value = '500' where key = 'max_tasks_per_hour';
select id as fam from service_families where key = 'everyday-tech' \gset

create function public.mksvc(k text, def_price numeric default 500) returns uuid language plpgsql as $$
declare s uuid;
begin
  s := save_service_draft(k, (select id from service_families where key = 'everyday-tech'), 'general', jsonb_build_object('title', 'Svc ' || k, 'description', 'A test service called ' || k,
         'pricing', jsonb_build_object('approach', 'manual_quote')));
  perform publish_service(s);
  return s;
end $$;
create function public.rule(p jsonb) returns uuid language plpgsql as $$
declare r uuid;
begin r := save_pricing_rule(p); perform activate_pricing_rule(r); return r; end $$;
create function public.est(svc uuid, region text, mins int, qty int default 1) returns jsonb language sql security definer as $$ select compute_estimate(svc, region, mins, qty) $$;
grant execute on function public.est(uuid, text, int, int) to authenticated;
create function public.est_at(svc uuid, region text, mins int, at timestamptz) returns jsonb language sql security definer as $$ select compute_estimate(svc, region, mins, 1, null, null, at) $$;
grant execute on function public.est_at(uuid, text, int, timestamptz) to authenticated;

-- ============================================================ regions
:as_C;
select expect_error($$select save_region('{"code":"IN-T","name":"Test India","currency":"INR","timezone":"Asia/Kolkata","status":"active"}')$$, 'a customer cannot create a region');
:as_SU;
select expect_error($$select save_region('{"code":"IN-T","name":"Test India","currency":"INR","timezone":"Asia/Kolkata","status":"active"}')$$, 'a support admin cannot create a region');
:as_AD;
select expect_error($$select save_region('{"code":"IN-T","name":"Test India","currency":"RUPEE","timezone":"Asia/Kolkata"}')$$, 'a currency must be a three-letter code');
select expect_error($$select save_region('{"code":"IN-T","name":"Test India","currency":"INR","timezone":"Mars/Olympus"}')$$, 'an unknown time zone is refused');
select save_region('{"code":"IN-T","name":"Test India","country":"IN","currency":"INR","timezone":"Asia/Kolkata","status":"active"}');
select save_region('{"code":"US-T","name":"Test USA","country":"US","currency":"USD","timezone":"America/New_York","status":"active"}');
select save_region('{"code":"XX-DRAFT","name":"Not open yet","currency":"EUR","timezone":"Europe/Paris"}');
select chk((select payments_enabled = false from regions where code = 'US-T'), 'a new region does not claim payment support');
:as_C;
select chk((select count(*) = 2 from regions), 'customers see active regions only');

-- ============================================================ per-minute pricing, minimum, increments, rounding
:as_AD;
select mksvc('ppm-up') as s_ppm \gset
select rule(jsonb_build_object('service_id', :'s_ppm', 'region_code', 'IN-T', 'model', 'ppm', 'base_charge', 100, 'ppm', 2, 'min_minutes', 30, 'increment_minutes', 15, 'rounding', 'up', 'auto_price', true)) as r_ppm1 \gset
select chk((est(:'s_ppm', 'IN-T', 50) ->> 'total')::numeric = 220, 'PPM: 50 minutes rounds up to 60, so 100 + 60 x 2 = 220');
select chk((est(:'s_ppm', 'IN-T', 50) -> 'minutes' ->> 'billable')::int = 60, 'PPM: billable minutes are shown');
select chk((est(:'s_ppm', 'IN-T', 10) -> 'minutes' ->> 'billable')::int = 30, 'the minimum billable duration applies');
select chk((est(:'s_ppm', 'IN-T', 10) ->> 'total')::numeric = 160, 'minimum duration price is 100 + 30 x 2');
select chk((est(:'s_ppm', 'IN-T', 50) ->> 'status') = 'estimated', 'an auto-priced estimate is an estimate, not an approved price');
select chk((est(:'s_ppm', 'IN-T', 50) ->> 'currency') = 'INR', 'the region decides the currency');
select chk((est(:'s_ppm', 'IN-T', null) ->> 'reason') = 'duration_required', 'a per-minute service needs a duration');

select mksvc('ppm-nearest') as s_near \gset
select rule(jsonb_build_object('service_id', :'s_near', 'region_code', 'IN-T', 'model', 'ppm', 'ppm', 1, 'increment_minutes', 15, 'rounding', 'nearest', 'auto_price', true));
select chk((est(:'s_near', 'IN-T', 50) -> 'minutes' ->> 'billable')::int = 45 and (est(:'s_near', 'IN-T', 53) -> 'minutes' ->> 'billable')::int = 60, 'rounding to the nearest increment');
select mksvc('ppm-down') as s_down \gset
select rule(jsonb_build_object('service_id', :'s_down', 'region_code', 'IN-T', 'model', 'ppm', 'ppm', 1, 'min_minutes', 30, 'increment_minutes', 15, 'rounding', 'down', 'auto_price', true));
select chk((est(:'s_down', 'IN-T', 59) -> 'minutes' ->> 'billable')::int = 45 and (est(:'s_down', 'IN-T', 20) -> 'minutes' ->> 'billable')::int = 30, 'rounding down never goes below the minimum');

-- ============================================================ progressive tiers: each rate applies only to its own minutes
select mksvc('progressive') as s_prog \gset
select rule(jsonb_build_object('service_id', :'s_prog', 'region_code', 'IN-T', 'model', 'progressive', 'base_charge', 50, 'min_minutes', 30, 'increment_minutes', 15, 'rounding', 'up', 'auto_price', true,
  'tiers', jsonb_build_array(jsonb_build_object('from', 0, 'to', 60, 'ppm', 3), jsonb_build_object('from', 60, 'to', 120, 'ppm', 2), jsonb_build_object('from', 120, 'to', null, 'ppm', 1)))) as r_prog \gset
select chk((est(:'s_prog', 'IN-T', 150) ->> 'total')::numeric = 380, 'progressive: 60x3 + 60x2 + 30x1 + base 50 = 380');
select chk((est(:'s_prog', 'IN-T', 90) ->> 'total')::numeric = 290, 'progressive: a partial second tier, 60x3 + 30x2 + 50 = 290');
select chk((est(:'s_prog', 'IN-T', 60) ->> 'total')::numeric = 230, 'progressive: exactly on a boundary is charged in the lower tier only');
select chk((est(:'s_prog', 'IN-T', 61) ->> 'total')::numeric = 260, 'progressive: 61 rounds to 75, so one minute over the boundary adds 15 minutes at the next rate');
select chk((est(:'s_prog', 'IN-T', 10) ->> 'total')::numeric = 140, 'progressive: the minimum duration is priced through the tiers');
select chk((select count(*) = 3 from jsonb_array_elements(est(:'s_prog', 'IN-T', 150) -> 'lines') l where l ->> 'kind' = 'tier'), 'the breakdown lists each tier used');
select chk((select (l ->> 'minutes')::int = 30 and (l ->> 'rate')::numeric = 1 from jsonb_array_elements(est(:'s_prog', 'IN-T', 150) -> 'lines') l where l ->> 'kind' = 'tier' and (l ->> 'from')::int = 120),
           'the breakdown shows minutes charged and the rate in each tier');
select chk((select (l ->> 'minutes')::int = 60 and (l ->> 'rate')::numeric = 3 from jsonb_array_elements(est(:'s_prog', 'IN-T', 150) -> 'lines') l where l ->> 'kind' = 'tier' and (l ->> 'from')::int = 0),
           'earlier minutes keep their original rate (the lower rate is not applied retroactively)');
select mksvc('included') as s_inc \gset
select rule(jsonb_build_object('service_id', :'s_inc', 'region_code', 'IN-T', 'model', 'progressive', 'base_charge', 50, 'included_minutes', 30, 'auto_price', true,
  'tiers', jsonb_build_array(jsonb_build_object('from', 0, 'to', 60, 'ppm', 3), jsonb_build_object('from', 60, 'to', null, 'ppm', 2))));
select chk((est(:'s_inc', 'IN-T', 90) ->> 'total')::numeric = 200, 'included minutes are covered by the base charge: 50 + 30x3 + 30x2');

-- ============================================================ invalid rules cannot be activated
select mksvc('bad') as s_bad \gset
select save_pricing_rule(jsonb_build_object('service_id', :'s_bad', 'region_code', 'IN-T', 'model', 'progressive', 'tiers',
  jsonb_build_array(jsonb_build_object('from', 0, 'to', 60, 'ppm', 3), jsonb_build_object('from', 70, 'to', null, 'ppm', 2)))) as r_gap \gset
select expect_error(format($$select activate_pricing_rule('%s')$$, :'r_gap'), 'tiers with a gap cannot be activated');
select save_pricing_rule(jsonb_build_object('service_id', :'s_bad', 'region_code', 'IN-T', 'model', 'progressive', 'tiers',
  jsonb_build_array(jsonb_build_object('from', 0, 'to', 60, 'ppm', 3), jsonb_build_object('from', 60, 'to', 90, 'ppm', 2)))) as r_closed \gset
select expect_error(format($$select activate_pricing_rule('%s')$$, :'r_closed'), 'the last tier must be open-ended');
select save_pricing_rule(jsonb_build_object('service_id', :'s_bad', 'region_code', 'IN-T', 'model', 'ppm')) as r_noppm \gset
select expect_error(format($$select activate_pricing_rule('%s')$$, :'r_noppm'), 'a per-minute rule needs a rate');
select expect_error($$select save_pricing_rule('{"service_id":"00000000-0000-0000-0000-000000000000","region_code":"NOPE"}')$$, 'a rule needs a real region');
select expect_error(format($$select save_pricing_rule(jsonb_build_object('service_id', '%s', 'region_code', 'IN-T', 'model', 'flat', 'base_charge', -5))$$, :'s_bad'), 'a negative price is refused');
select array_to_string(pricing_rule_readiness(:'r_gap'), ' ') ~ 'minute 60' as readiness_names_the_gap \gset
select chk(:'readiness_names_the_gap', 'the problems list says what to fix');

-- ============================================================ quantity discounts
select mksvc('qty-all') as s_qa \gset
select rule(jsonb_build_object('service_id', :'s_qa', 'region_code', 'IN-T', 'model', 'flat', 'base_charge', 100, 'auto_price', true, 'qty_enabled', true, 'qty_unit', 'item', 'qty_discount_type', 'percent',
  'qty_tiers', jsonb_build_array(jsonb_build_object('from_qty', 3, 'discount', 10), jsonb_build_object('from_qty', 5, 'discount', 20))));
select chk((est(:'s_qa', 'IN-T', null, 1) ->> 'total')::numeric = 100, 'quantity 1: no discount');
select chk((est(:'s_qa', 'IN-T', null, 2) ->> 'total')::numeric = 200 and (est(:'s_qa', 'IN-T', null, 2) ->> 'discount_total')::numeric = 0, 'quantity 2 is below the first tier: no discount');
select chk((est(:'s_qa', 'IN-T', null, 3) ->> 'total')::numeric = 270, 'quantity 3 is exactly on the first tier: 10 percent off each unit');
select chk((est(:'s_qa', 'IN-T', null, 4) ->> 'total')::numeric = 360, 'quantity 4 stays in the first tier');
select chk((est(:'s_qa', 'IN-T', null, 5) ->> 'total')::numeric = 400, 'quantity 5 takes the second tier only, not both (no stacking)');
select chk((select count(*) = 1 from jsonb_array_elements(est(:'s_qa', 'IN-T', null, 5) -> 'lines') l where l ->> 'kind' = 'quantity_discount'), 'one quantity discount line, showing the savings');
select chk((est(:'s_qa', 'IN-T', null, 5) ->> 'discount_total')::numeric = -100, 'the savings are reported');

select mksvc('qty-unit') as s_qu \gset
select rule(jsonb_build_object('service_id', :'s_qu', 'region_code', 'IN-T', 'model', 'flat', 'base_charge', 100, 'auto_price', true, 'qty_enabled', true, 'qty_unit', 'item', 'qty_discount_type', 'per_unit',
  'qty_tiers', jsonb_build_array(jsonb_build_object('from_qty', 3, 'discount', 10))));
select chk((est(:'s_qu', 'IN-T', null, 3) ->> 'total')::numeric = 270, 'a per-unit reduction takes the amount off every unit');
select mksvc('qty-marginal') as s_qm \gset
select rule(jsonb_build_object('service_id', :'s_qm', 'region_code', 'IN-T', 'model', 'flat', 'base_charge', 100, 'auto_price', true, 'qty_enabled', true, 'qty_unit', 'item', 'qty_discount_type', 'percent', 'qty_apply', 'marginal',
  'qty_tiers', jsonb_build_array(jsonb_build_object('from_qty', 3, 'discount', 10), jsonb_build_object('from_qty', 5, 'discount', 20))));
select chk((est(:'s_qm', 'IN-T', null, 5) ->> 'total')::numeric = 460, 'marginal quantity tiers discount only the units inside each tier');
select mksvc('qty-capped') as s_qc \gset
select rule(jsonb_build_object('service_id', :'s_qc', 'region_code', 'IN-T', 'model', 'flat', 'base_charge', 100, 'auto_price', true, 'qty_enabled', true, 'qty_unit', 'item', 'qty_min', 1, 'qty_max', 6, 'qty_discount_type', 'percent',
  'qty_tiers', jsonb_build_array(jsonb_build_object('from_qty', 3, 'discount', 10))));
select chk((est(:'s_qc', 'IN-T', null, 7) ->> 'status') = 'quote_required' and (est(:'s_qc', 'IN-T', null, 7) -> 'reasons') ? 'quantity_out_of_range', 'a quantity above the maximum goes to a quote');
select chk((est(:'s_ppm', 'IN-T', 60, 3) ->> 'status') = 'quote_required' and (est(:'s_ppm', 'IN-T', 60, 3) -> 'reasons') ? 'quantity_not_supported', 'a service not priced by quantity needs a quote for several units');
select mksvc('qty-bad') as s_qb \gset
select save_pricing_rule(jsonb_build_object('service_id', :'s_qb', 'region_code', 'IN-T', 'model', 'flat', 'base_charge', 100, 'qty_enabled', true, 'qty_unit', 'item', 'qty_discount_type', 'percent',
  'qty_tiers', jsonb_build_array(jsonb_build_object('from_qty', 3, 'discount', 10), jsonb_build_object('from_qty', 3, 'discount', 15)))) as r_dup \gset
select expect_error(format($$select activate_pricing_rule('%s')$$, :'r_dup'), 'duplicate quantity tier boundaries are refused');
select save_pricing_rule(jsonb_build_object('service_id', :'s_qb', 'region_code', 'IN-T', 'model', 'flat', 'base_charge', 100, 'qty_enabled', true, 'qty_unit', 'item', 'qty_discount_type', 'percent',
  'qty_tiers', jsonb_build_array(jsonb_build_object('from_qty', 3, 'discount', 150)))) as r_pct \gset
select expect_error(format($$select activate_pricing_rule('%s')$$, :'r_pct'), 'a discount over 100 percent is refused');
select save_pricing_rule(jsonb_build_object('service_id', :'s_qb', 'region_code', 'IN-T', 'model', 'flat', 'base_charge', 100, 'qty_enabled', true, 'qty_unit', 'item', 'qty_discount_type', 'per_unit',
  'qty_tiers', jsonb_build_array(jsonb_build_object('from_qty', 3, 'discount', 150)))) as r_neg \gset
select expect_error(format($$select activate_pricing_rule('%s')$$, :'r_neg'), 'a per-unit discount larger than the price (a negative price) is refused');

-- ============================================================ duration pricing and quantity discounts stay separate
select mksvc('both') as s_both \gset
select save_pricing_rule(jsonb_build_object('service_id', :'s_both', 'region_code', 'IN-T', 'model', 'ppm', 'ppm', 2, 'auto_price', true, 'qty_enabled', true, 'qty_unit', 'unit', 'qty_discount_type', 'percent',
  'qty_tiers', jsonb_build_array(jsonb_build_object('from_qty', 2, 'discount', 10)))) as r_both \gset
select expect_error(format($$select activate_pricing_rule('%s')$$, :'r_both'), 'per-minute pricing and quantity discounts cannot combine unless the rule says how');
select save_pricing_rule(jsonb_build_object('id', :'r_both', 'service_id', :'s_both', 'region_code', 'IN-T', 'model', 'ppm', 'ppm', 2, 'auto_price', true, 'qty_enabled', true, 'qty_unit', 'unit', 'qty_discount_type', 'percent',
  'duration_qty_interaction', 'unit_total', 'qty_tiers', jsonb_build_array(jsonb_build_object('from_qty', 2, 'discount', 10))));
select activate_pricing_rule(:'r_both');
select chk((est(:'s_both', 'IN-T', 600, 1) ->> 'discount_total')::numeric = 0, 'a long duration alone never earns a quantity discount');
select chk((est(:'s_both', 'IN-T', 60, 2) ->> 'total')::numeric = 216, 'with the interaction enabled, two units of 60 minutes: 2 x 120 less 10 percent');
select chk((est(:'s_both', 'IN-T', 120, 1) ->> 'total')::numeric = 240, 'a single unit is priced by duration only');
select chk((est(:'s_both', 'IN-T', 60, 2) ->> 'unit_total')::numeric = 120, 'the quantity discount works on the unit total; the duration price is untouched');

-- ============================================================ travel
select mksvc('travel-fixed') as s_tf \gset
select rule(jsonb_build_object('service_id', :'s_tf', 'region_code', 'IN-T', 'model', 'flat', 'base_charge', 100, 'auto_price', true, 'travel_method', 'fixed', 'travel_fixed', 40));
select chk((est(:'s_tf', 'IN-T', null) ->> 'total')::numeric = 140 and (est(:'s_tf', 'IN-T', null) ->> 'travel_total')::numeric = 40, 'an approved fixed travel charge is its own line, apart from the price');
select mksvc('travel-km') as s_tk \gset
select rule(jsonb_build_object('service_id', :'s_tk', 'region_code', 'IN-T', 'model', 'flat', 'base_charge', 100, 'auto_price', true, 'travel_method', 'per_km', 'travel_rate', 8));
select chk((est(:'s_tk', 'IN-T', null) ->> 'status') = 'quote_required' and (est(:'s_tk', 'IN-T', null) -> 'reasons') ? 'travel_to_be_confirmed', 'distance-based travel with no distance is an uncertainty that goes to a quote');
select chk((est(:'s_tk', 'IN-T', null) ->> 'travel_total')::numeric = 0, 'unknown travel is not invented as a number');
select chk((admin_price_estimate(:'s_tk', 'IN-T', null, 1, 10) ->> 'total')::numeric = 180 and (admin_price_estimate(:'s_tk', 'IN-T', null, 1, 10) ->> 'status') = 'estimated', 'with a distance an administrator confirms, travel is priced');
select mksvc('no-travel') as s_nt \gset
select rule(jsonb_build_object('service_id', :'s_nt', 'region_code', 'IN-T', 'model', 'flat', 'base_charge', 100, 'auto_price', true));
select chk((est(:'s_nt', 'IN-T', null) ->> 'travel_total')::numeric = 0, 'with no travel method configured, no travel is charged');

-- ============================================================ regions and currency
select rule(jsonb_build_object('service_id', :'s_ppm', 'region_code', 'US-T', 'model', 'ppm', 'base_charge', 5, 'ppm', 0.5, 'auto_price', true));
select chk((est(:'s_ppm', 'US-T', 60) ->> 'currency') = 'USD' and (est(:'s_ppm', 'US-T', 60) ->> 'total')::numeric = 35, 'the same service is priced in another region''s own currency and rule');
select chk((est(:'s_ppm', 'IN-T', 60) ->> 'currency') = 'INR', 'and the first region is unaffected');
select chk((est(:'s_prog', 'US-T', 60) ->> 'reason') = 'no_rule', 'a service with no rule in a region is not priced there');
select chk((est(:'s_ppm', 'XX-DRAFT', 60) ->> 'reason') = 'unsupported_region', 'a region that is not active is unsupported');
select chk((est(:'s_ppm', 'ZZ-NONE', 60) ->> 'reason') = 'unsupported_region', 'an unknown region is unsupported, never silently defaulted');
select chk((est(:'s_ppm', null, 60) ->> 'reason') = 'no_region', 'a missing region is reported, never silently defaulted');
select expect_error(format($$select save_region('{"code":"IN-T","name":"Test India","currency":"USD","timezone":"Asia/Kolkata","status":"active"}')$$), 'a region with pricing rules cannot change currency');
select save_pricing_rule(jsonb_build_object('service_id', :'s_bad', 'region_code', 'US-T', 'model', 'flat', 'base_charge', 10)) as r_us \gset
select chk((select currency = 'USD' from pricing_rules where id = :'r_us'), 'a rule''s currency always comes from its region');

-- ============================================================ bookings: the backend decides the price
:as_AD;
select save_service_draft('quote-svc', :'fam', 'general', jsonb_build_object('title', 'Quote service', 'description', 'Priced by a quote.', 'pricing', jsonb_build_object('approach', 'manual_quote'))) as s_quote \gset
select publish_service(:'s_quote');
select rule(jsonb_build_object('service_id', :'s_quote', 'region_code', 'IN-T', 'model', 'ppm', 'ppm', 4, 'auto_price', false));
select ((current_date + 9) + time '10:00') at time zone 'Asia/Kolkata' as when_ok \gset
:as_C;
select chk((price_estimate(:'s_ppm', 'IN-T', 60, 1) ->> 'total')::numeric = 220, 'a customer can ask for an estimate');
select expect_error($$select compute_estimate('00000000-0000-0000-0000-000000000000', 'IN-T', 60, 1)$$, 'the raw calculation is not exposed to apps');
insert into tasks (customer_id, title, category, location, service_id, region_code, est_minutes, quantity, scheduled_at, est_cost, price_status, pricing_state, pricing_rule_id, currency)
  values (auth.uid(), 'Auto priced', 'general', 'Flat 1, Bandra', :'s_ppm', 'IN-T', 50, 1, :'when_ok', 1, 'confirmed', 'approved', null, 'USD');
:as_db;
select chk((select est_cost = 220 and currency = 'INR' and price_status = 'confirmed' and pricing_state = 'estimated' and price_source = 'rule' and pricing_rule_version = 1 from tasks where title = 'Auto priced'),
           'the booking is priced by the rule; the customer''s own total, currency and state are ignored');
select chk((select pricing_breakdown -> 'minutes' ->> 'billable' = '60' and pricing_breakdown ->> 'currency' = 'INR' from tasks where title = 'Auto priced'), 'the breakdown is stored with the booking');
select chk((select pricing_rule_id = :'r_ppm1' from tasks where title = 'Auto priced'), 'and the exact rule version');
:as_C;
insert into tasks (customer_id, title, category, location, service_id, region_code, est_minutes, scheduled_at)
  values (auth.uid(), 'Needs a quote', 'general', 'Flat 2, Bandra', :'s_quote', 'IN-T', 60, :'when_ok');
insert into tasks (customer_id, title, category, location, service_id, est_minutes)
  values (auth.uid(), 'No region given', 'general', 'Flat 3, Bandra', :'s_ppm', 60);
insert into tasks (customer_id, title, category, location, service_id, region_code, est_minutes)
  values (auth.uid(), 'Region without a rule', 'general', 'Flat 4, Bandra', :'s_prog', 'US-T', 60);
select expect_error(format($$insert into tasks (customer_id, title, category, location, service_id, region_code, est_minutes) values (auth.uid(), 'Closed region', 'general', 'Flat 5', '%s', 'XX-DRAFT', 60)$$, :'s_ppm'), 'a region that is not active cannot be booked');
:as_db;
select chk((select price_status = 'awaiting_approval' and est_cost is null and pricing_state = 'quote_pending' and routing_mode = 'admin' from tasks where title = 'Needs a quote'), 'a quote-priced service waits for an approved price');
select chk((select price_status = 'awaiting_approval' and pricing_state = 'quote_pending' and pricing_breakdown ->> 'reason' = 'no_region' from tasks where title = 'No region given'), 'a booking with no region goes to review, never to a guessed currency');
select chk((select pricing_state = 'quote_pending' and pricing_breakdown ->> 'reason' = 'no_rule' from tasks where title = 'Region without a rule'), 'a region with no published rate goes to review');
select id as t_quote from tasks where title = 'Needs a quote' \gset
select id as t_auto from tasks where title = 'Auto priced' \gset
:as_AD;
select approve_task_price(:'t_quote', 300, 'Agreed after review');
:as_C;
select confirm_task_price(:'t_quote');
:as_db;
select chk((select pricing_state = 'approved' and price_status = 'confirmed' and est_cost = 300 and currency = 'INR' from tasks where id = :'t_quote'), 'a quoted price is "approved" once the customer confirms it');

-- ============================================================ history: rule changes never rewrite an existing booking
:as_AD;
select duplicate_pricing_rule(:'r_ppm1') as r_ppm2 \gset
select save_pricing_rule(jsonb_build_object('id', :'r_ppm2', 'service_id', :'s_ppm', 'region_code', 'IN-T', 'model', 'ppm', 'base_charge', 100, 'ppm', 3, 'min_minutes', 30, 'increment_minutes', 15, 'rounding', 'up', 'auto_price', true));
select activate_pricing_rule(:'r_ppm2');
select chk((select status = 'retired' and effective_to is not null from pricing_rules where id = :'r_ppm1') and (select status = 'active' from pricing_rules where id = :'r_ppm2'), 'activating a new version retires the old one');
select chk((est(:'s_ppm', 'IN-T', 50) ->> 'total')::numeric = 280, 'new bookings use the new rate (100 + 60 x 3)');
select chk((est(:'s_ppm', 'IN-T', 50, 1) -> 'rule' ->> 'version') = '2', 'and say which version priced them');
select chk((select est_cost = 220 and pricing_rule_version = 1 from tasks where id = :'t_auto'), 'an existing booking keeps its price and the rule version it was booked under');
select chk((est_at(:'s_ppm', 'IN-T', 50, (select created_at from tasks where id = :'t_auto')) ->> 'total')::numeric = 220, 'the price in force at an earlier moment can be reproduced');
select expect_error(format($$update pricing_rules set ppm = 99 where id = '%s'$$, :'r_ppm1'), 'a retired rule cannot be edited');
select expect_error(format($$update pricing_rules set ppm = 99 where id = '%s'$$, :'r_ppm2'), 'an active rule cannot be edited');
select expect_error(format($$delete from pricing_rules where id = '%s'$$, :'r_ppm2'), 'a rule that has been active cannot be deleted');
select expect_error(format($$select save_pricing_rule(jsonb_build_object('id', '%s', 'region_code', 'IN-T', 'model', 'ppm', 'ppm', 1))$$, :'r_ppm2'), 'editing an active rule through the API is refused too');
select chk((finalise_task_price(:'t_auto', 90) ->> 'total')::numeric = 280, 'the final charge uses the booking''s own rule version: 100 + 90 x 2 = 280, not today''s rate');
select chk((select pricing_state = 'final' and final_amount = 280 and final_minutes = 90 and est_cost = 220 from tasks where id = :'t_auto'), 'estimate and final charge are both kept');
select chk((select count(*) >= 3 from audit_log where entity = 'pricing_rule' and action in ('pricing_rule.created', 'pricing_rule.activated', 'pricing_rule.duplicated')), 'pricing changes are audited');
select chk((select before_value is not null from audit_log where action = 'pricing_rule.activated' and entity_id = :'r_ppm2'), 'activation records what it replaced');

-- ============================================================ who may change pricing
:as_C;
select expect_error($$select save_pricing_rule('{"region_code":"IN-T"}')$$, 'a customer cannot create a pricing rule');
select expect_error(format($$select activate_pricing_rule('%s')$$, :'r_ppm2'), 'a customer cannot activate a pricing rule');
select expect_error(format($$select finalise_task_price('%s', 10)$$, :'t_auto'), 'a customer cannot set a final charge');
select chk((select count(*) = 0 from pricing_rules), 'customers cannot read the rate card');
:as_P;
select expect_error($$select save_pricing_rule('{"region_code":"IN-T"}')$$, 'a Personal Manager cannot create a pricing rule');
select chk((select count(*) = 0 from pricing_rules), 'Personal Managers cannot read the rate card');
:as_SU;
select expect_error(format($$select activate_pricing_rule('%s')$$, :'r_ppm2'), 'a support admin cannot change pricing');
select expect_error($$select save_region('{"code":"IN-T","name":"x","currency":"INR","timezone":"Asia/Kolkata"}')$$, 'a support admin cannot change regions');
select chk((select count(*) > 0 from pricing_rules), 'a support admin can read rules');
:as_C;
with u as (update tasks set est_cost = 1, pricing_state = 'final' returning 1) select chk((select count(*) = 0 from u), 'a customer cannot rewrite a booking''s price (no update is permitted)');
