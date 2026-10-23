import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useLive, q } from '../lib/useLive';
import { money, when } from '../lib/constants';
import { Badge, ErrorBox, Field, useAction } from '../components/ui';

// Pricing rules per service and region. Every number is yours to decide: nothing is pre-filled or live until you activate it.
const MODELS: any = { flat: 'Flat price', ppm: 'Per minute', progressive: 'Progressive per-minute tiers' };
const blank = (service: string, region: string) => ({
  id: '', service_id: service, region_code: region, model: 'ppm', base_charge: '', included_minutes: '', ppm: '', tiers: [{ to: '', ppm: '' }, { to: '', ppm: '' }],
  min_minutes: '', increment_minutes: '1', rounding: 'up', max_minutes: '', approval_threshold_minutes: '',
  qty_enabled: false, qty_unit: '', qty_min: '1', qty_max: '', qty_apply: 'all_units', qty_discount_type: 'percent', qty_tiers: [{ from_qty: '', discount: '' }], duration_qty_interaction: 'none',
  travel_method: 'none', travel_fixed: '', travel_rate: '', auto_price: false, note: '',
});
const num = (v: any) => (v === '' || v == null ? null : Number(v));

function fromRow(r: any) {
  const ts = r.model === 'progressive' ? (r.tiers || []).map((t: any) => ({ to: t.to ?? '', ppm: String(t.ppm) })) : [{ to: '', ppm: '' }, { to: '', ppm: '' }];
  return { ...blank(r.service_id, r.region_code), id: r.id, model: r.model, base_charge: String(r.base_charge || ''), included_minutes: String(r.included_minutes || ''), ppm: r.ppm == null ? '' : String(r.ppm),
    tiers: ts, min_minutes: String(r.min_minutes || ''), increment_minutes: String(r.increment_minutes), rounding: r.rounding, max_minutes: r.max_minutes == null ? '' : String(r.max_minutes),
    approval_threshold_minutes: r.approval_threshold_minutes == null ? '' : String(r.approval_threshold_minutes), qty_enabled: r.qty_enabled, qty_unit: r.qty_unit || '', qty_min: String(r.qty_min), qty_max: r.qty_max == null ? '' : String(r.qty_max),
    qty_apply: r.qty_apply, qty_discount_type: r.qty_discount_type || 'percent', qty_tiers: (r.qty_tiers || []).length ? r.qty_tiers.map((t: any) => ({ from_qty: String(t.from_qty), discount: String(t.discount) })) : [{ from_qty: '', discount: '' }],
    duration_qty_interaction: r.duration_qty_interaction, travel_method: r.travel_method, travel_fixed: r.travel_fixed == null ? '' : String(r.travel_fixed), travel_rate: r.travel_rate == null ? '' : String(r.travel_rate), auto_price: r.auto_price, note: r.note || '' };
}

// Tier start minutes follow from the previous tier's end, so tiers can never leave a gap.
function payload(f: any) {
  let from = 0;
  const tiers = f.model === 'progressive' ? f.tiers.filter((t: any) => t.ppm !== '' || t.to !== '').map((t: any, i: number, all: any[]) => {
    const row = { from, to: i === all.length - 1 ? null : num(t.to), ppm: num(t.ppm) }; from = row.to ?? from; return row;
  }) : [];
  return { id: f.id || undefined, service_id: f.service_id, region_code: f.region_code, model: f.model, base_charge: num(f.base_charge) ?? 0, included_minutes: num(f.included_minutes) ?? 0, ppm: f.model === 'ppm' ? num(f.ppm) : null, tiers,
    min_minutes: num(f.min_minutes) ?? 0, increment_minutes: num(f.increment_minutes) ?? 1, rounding: f.rounding, max_minutes: num(f.max_minutes), approval_threshold_minutes: num(f.approval_threshold_minutes),
    qty_enabled: f.qty_enabled, qty_unit: f.qty_unit, qty_min: num(f.qty_min) ?? 1, qty_max: num(f.qty_max), qty_apply: f.qty_apply, qty_discount_type: f.qty_enabled ? f.qty_discount_type : null,
    qty_tiers: f.qty_enabled ? f.qty_tiers.filter((t: any) => t.from_qty !== '').map((t: any) => ({ from_qty: num(t.from_qty), discount: num(t.discount) })) : [], duration_qty_interaction: f.duration_qty_interaction,
    travel_method: f.travel_method, travel_fixed: num(f.travel_fixed), travel_rate: num(f.travel_rate), auto_price: f.auto_price, note: f.note };
}

export default function Pricing({ profile }: { profile: any }) {
  const superAdmin = (profile?.admin_level || 'super') === 'super';
  const { data: services } = useLive(() => q(supabase.from('catalogue_services').select('id, key, status, draft, current_version').order('key')), ['catalogue_services'], []);
  const { data: regions } = useLive(() => q(supabase.from('regions').select('code, name, currency, status').order('code')), ['regions'], []);
  const [service, setService] = useState('');
  const [region, setRegion] = useState('');
  const { data: rules, reload } = useLive(() => (service && region ? q(supabase.from('pricing_rules').select('*').eq('service_id', service).eq('region_code', region).order('version', { ascending: false })) : Promise.resolve([])), ['pricing_rules'], [service, region]);
  const { data: audit } = useLive(() => (rules?.length ? q(supabase.from('audit_log').select('id, action, created_at, details').eq('entity', 'pricing_rule').in('entity_id', rules.map((r: any) => r.id)).order('created_at', { ascending: false }).limit(30)) : Promise.resolve([])), ['audit_log'], [rules?.length]);
  const { data: elig, reload: reloadElig } = useLive(() => (service ? q(supabase.from('service_eligibility').select('*').eq('service_id', service)) : Promise.resolve([])), ['service_eligibility'], [service]);
  const [f, setF] = useState<any>(null);
  const [problems, setProblems] = useState<string[] | null>(null);
  const [test, setTest] = useState<any>({ minutes: '60', qty: '1', distance: '' });
  const [result, setResult] = useState<any>(null);
  const [run, busy, error] = useAction();
  const [msg, setMsg] = useState('');
  useEffect(() => { setF(null); setProblems(null); setResult(null); }, [service, region]);
  const reg = (regions || []).find((r: any) => r.code === region);
  const cur = reg?.currency || '';
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const title = (s: any) => s.draft?.title || s.key;
  const vehicle = (elig?.[0]?.vehicle_ok || []) as string[];
  const vehicleValue = vehicle.length === 0 ? 'none' : vehicle.length === 2 ? 'either' : vehicle[0];

  const saveDraft = () => run(async () => { const id = await q(supabase.rpc('save_pricing_rule', { p: payload(f) })); setF({ ...f, id }); setProblems(await q(supabase.rpc('pricing_rule_readiness', { p_id: id }))); setMsg('Draft saved.'); reload(); });
  const check = () => run(async () => setProblems(await q(supabase.rpc('pricing_rule_readiness', { p_id: f.id }))));
  const activate = (id: string) => run(async () => {
    if (!window.confirm('Activate this rule? New bookings in this region will be priced with it straight away. Existing bookings keep the price they were given.')) return;
    await q(supabase.rpc('activate_pricing_rule', { p_id: id })); setMsg('Rule activated.'); setF(null); reload();
  });
  const retire = (id: string) => run(async () => {
    if (!window.confirm('Retire this rule? This service will stop being priced automatically in this region and new bookings will wait for a quote.')) return;
    await q(supabase.rpc('retire_pricing_rule', { p_id: id })); setMsg('Rule retired.'); reload();
  });
  const duplicate = (id: string) => run(async () => { const nid = await q(supabase.rpc('duplicate_pricing_rule', { p_id: id })); await reload(); const { data } = await supabase.from('pricing_rules').select('*').eq('id', nid).single(); if (data) setF(fromRow(data)); });
  const runTest = () => run(async () => setResult(await q(supabase.rpc('admin_price_estimate', { p_service: service, p_region: region, p_minutes: num(test.minutes), p_qty: num(test.qty) || 1, p_distance_km: num(test.distance) }))));
  const setVehicle = (v: string) => run(async () => { await q(supabase.rpc('set_service_vehicle', { p_service: service, p_vehicle_ok: v === 'none' ? [] : v === 'either' ? ['two_wheeler', 'four_wheeler'] : [v] })); reloadElig(); setMsg('Vehicle requirement saved.'); });
  const draftEditable = f && (!f.id || (rules || []).find((r: any) => r.id === f.id)?.status === 'draft');

  return (
    <>
      <div className="page-head"><div><h1>Pricing rules</h1><p>One rule per service and region. A rule is a draft until you activate it; an activated rule never changes, so a booking always keeps the terms it was made under. The figures here are yours to decide.</p></div></div>
      <ErrorBox>{error}</ErrorBox>
      {msg && <div className="card small" role="status">{msg}</div>}
      <div className="card stack">
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <Field label="Service"><select className="field" value={service} onChange={(e) => setService(e.target.value)}><option value="">Choose a service</option>{(services || []).map((s: any) => <option key={s.id} value={s.id}>{title(s)} ({s.status})</option>)}</select></Field>
          <Field label="Region"><select className="field" value={region} onChange={(e) => setRegion(e.target.value)}><option value="">Choose a region</option>{(regions || []).map((r: any) => <option key={r.code} value={r.code}>{r.code} · {r.currency}</option>)}</select></Field>
        </div>
        {regions && !regions.length && <div className="small muted">Add a region first (Regions and hours).</div>}
        {service && (
          <Field label="Vehicle a Personal Manager needs for this service">
            <select className="field" value={vehicleValue} disabled={!superAdmin || busy} onChange={(e) => setVehicle(e.target.value)}>
              <option value="none">None</option><option value="two_wheeler">A two-wheeler</option><option value="four_wheeler">A four-wheeler</option><option value="either">A two-wheeler or a four-wheeler</option></select>
          </Field>)}
      </div>

      {service && region && (
        <>
          <div className="card stack" style={{ marginTop: 16 }}>
            <div className="row spread"><h2>Rules for this service in {region}</h2>{superAdmin && <button className="btn" onClick={() => setF(blank(service, region))}>New draft rule</button>}</div>
            {(rules || []).map((r: any) => (
              <div key={r.id} className="row spread" style={{ flexWrap: 'wrap' }}>
                <span><strong>Version {r.version}</strong> · {MODELS[r.model]} · {r.currency} <Badge tone={r.status === 'active' ? 'success' : r.status === 'draft' ? 'brass' : 'neutral'}>{r.status}</Badge>
                  <span className="small muted"> {r.effective_from ? `from ${when(r.effective_from)}` : 'not started'}{r.effective_to ? ` to ${when(r.effective_to)}` : ''} · {r.auto_price ? 'priced automatically' : 'always quoted'}</span></span>
                <span className="row">
                  <button className="btn sm ghost" onClick={() => setF(fromRow(r))}>{r.status === 'draft' ? 'Edit' : 'View'}</button>
                  {superAdmin && <button className="btn sm ghost" disabled={busy} onClick={() => duplicate(r.id)}>Copy as new draft</button>}
                  {superAdmin && r.status === 'draft' && <button className="btn sm" disabled={busy} onClick={() => activate(r.id)}>Activate</button>}
                  {superAdmin && r.status === 'active' && <button className="btn sm danger" disabled={busy} onClick={() => retire(r.id)}>Retire</button>}
                </span>
              </div>))}
            {rules && !rules.length && <div className="muted">No rules yet. Until one is active, this service keeps its published price or quote in this region.</div>}
          </div>

          {f && (
            <div className="card stack" style={{ marginTop: 16 }}>
              <h2>{draftEditable ? (f.id ? 'Edit draft' : 'New draft') : 'Viewing an activated rule (read only)'} · {cur}</h2>
              <fieldset disabled={!draftEditable || !superAdmin} style={{ border: 0, padding: 0, margin: 0 }} className="stack">
                <Field label="How the time is priced"><select className="field" value={f.model} onChange={set('model')}>{Object.keys(MODELS).map((k) => <option key={k} value={k}>{MODELS[k]}</option>)}</select></Field>
                <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
                  <Field label={`${f.model === 'flat' ? 'Price' : 'Base charge'} (${cur})`}><input className="field" inputMode="decimal" value={f.base_charge} onChange={set('base_charge')} /></Field>
                  {f.model !== 'flat' && <Field label="Minutes the base charge covers"><input className="field" inputMode="numeric" value={f.included_minutes} onChange={set('included_minutes')} /></Field>}
                  {f.model === 'ppm' && <Field label={`Price per minute (${cur})`}><input className="field" inputMode="decimal" value={f.ppm} onChange={set('ppm')} /></Field>}
                </div>
                {f.model === 'progressive' && (
                  <div className="stack">
                    <div className="label">Duration tiers: each rate applies only to the minutes inside its own tier. Earlier minutes keep their rate.</div>
                    {f.tiers.map((t: any, i: number) => (
                      <div key={i} className="row" style={{ flexWrap: 'wrap' }}>
                        <span style={{ width: 150 }}>Tier {i + 1}: from minute {i === 0 ? 0 : f.tiers[i - 1].to || '…'}</span>
                        {i < f.tiers.length - 1 ? <><span>up to minute</span><input className="field" style={{ width: 90 }} inputMode="numeric" value={t.to} onChange={(e) => setF({ ...f, tiers: f.tiers.map((x: any, j: number) => (j === i ? { ...x, to: e.target.value } : x)) })} aria-label={`Tier ${i + 1} ends at minute`} /></> : <span>and beyond</span>}
                        <span>rate per minute ({cur})</span><input className="field" style={{ width: 110 }} inputMode="decimal" value={t.ppm} onChange={(e) => setF({ ...f, tiers: f.tiers.map((x: any, j: number) => (j === i ? { ...x, ppm: e.target.value } : x)) })} aria-label={`Tier ${i + 1} rate`} />
                        {f.tiers.length > 2 && <button type="button" className="btn sm ghost" onClick={() => setF({ ...f, tiers: f.tiers.filter((_: any, j: number) => j !== i) })}>Remove</button>}
                      </div>))}
                    <div><button type="button" className="btn sm ghost" onClick={() => setF({ ...f, tiers: [...f.tiers, { to: '', ppm: '' }] })}>Add a tier</button></div>
                  </div>)}
                {f.model !== 'flat' && (
                  <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 1fr 1fr' }}>
                    <Field label="Minimum minutes billed"><input className="field" inputMode="numeric" value={f.min_minutes} onChange={set('min_minutes')} /></Field>
                    <Field label="Billing step (minutes)"><input className="field" inputMode="numeric" value={f.increment_minutes} onChange={set('increment_minutes')} /></Field>
                    <Field label="Rounding"><select className="field" value={f.rounding} onChange={set('rounding')}><option value="up">Up to the next step</option><option value="nearest">To the nearest step</option><option value="down">Down to the step below</option></select></Field>
                    <Field label="Longest priced automatically (minutes)"><input className="field" inputMode="numeric" value={f.max_minutes} onChange={set('max_minutes')} /></Field>
                    <Field label="Quote needed above (minutes)"><input className="field" inputMode="numeric" value={f.approval_threshold_minutes} onChange={set('approval_threshold_minutes')} /></Field>
                  </div>)}
                <label className="row"><input type="checkbox" checked={f.qty_enabled} onChange={set('qty_enabled')} style={{ width: 24, height: 24 }} /> Quantity discount for several units of this service</label>
                {f.qty_enabled && (
                  <div className="card stack" style={{ background: 'var(--surface-alt)' }}>
                    <div className="small muted">Separate from duration pricing: it never looks at minutes. Only one tier ever applies.</div>
                    <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 1fr 1fr' }}>
                      <Field label="What is one unit? (for example item)"><input className="field" value={f.qty_unit} onChange={set('qty_unit')} /></Field>
                      <Field label="Fewest units"><input className="field" inputMode="numeric" value={f.qty_min} onChange={set('qty_min')} /></Field>
                      <Field label="Most units (blank = no limit)"><input className="field" inputMode="numeric" value={f.qty_max} onChange={set('qty_max')} /></Field>
                      <Field label="Discount type"><select className="field" value={f.qty_discount_type} onChange={set('qty_discount_type')}><option value="percent">Percent off each unit</option><option value="per_unit">Amount off each unit</option></select></Field>
                    </div>
                    <Field label="Who gets the discount"><select className="field" value={f.qty_apply} onChange={set('qty_apply')}><option value="all_units">Every unit, once the quantity reaches the tier</option><option value="marginal">Only the units inside the tier</option></select></Field>
                    {f.qty_tiers.map((t: any, i: number) => (
                      <div key={i} className="row"><span>From</span><input className="field" style={{ width: 90 }} inputMode="numeric" value={t.from_qty} onChange={(e) => setF({ ...f, qty_tiers: f.qty_tiers.map((x: any, j: number) => (j === i ? { ...x, from_qty: e.target.value } : x)) })} aria-label={`Quantity tier ${i + 1} starts at`} />
                        <span>units, discount</span><input className="field" style={{ width: 100 }} inputMode="decimal" value={t.discount} onChange={(e) => setF({ ...f, qty_tiers: f.qty_tiers.map((x: any, j: number) => (j === i ? { ...x, discount: e.target.value } : x)) })} aria-label={`Quantity tier ${i + 1} discount`} /><span>{f.qty_discount_type === 'percent' ? '%' : cur}</span>
                        {f.qty_tiers.length > 1 && <button type="button" className="btn sm ghost" onClick={() => setF({ ...f, qty_tiers: f.qty_tiers.filter((_: any, j: number) => j !== i) })}>Remove</button>}</div>))}
                    <div><button type="button" className="btn sm ghost" onClick={() => setF({ ...f, qty_tiers: [...f.qty_tiers, { from_qty: '', discount: '' }] })}>Add a quantity tier</button></div>
                    {f.model !== 'flat' && <label className="row"><input type="checkbox" checked={f.duration_qty_interaction === 'unit_total'} onChange={(e) => setF({ ...f, duration_qty_interaction: e.target.checked ? 'unit_total' : 'none' })} style={{ width: 24, height: 24 }} /> I confirm: the quantity discount reduces each unit’s price after the duration price is worked out (required to combine the two)</label>}
                  </div>)}
                <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
                  <Field label="Travel charge"><select className="field" value={f.travel_method} onChange={set('travel_method')}><option value="none">None</option><option value="fixed">A fixed amount</option><option value="per_km">Per kilometre (quote needed until distance is known)</option><option value="per_minute">Per minute of travel (quote needed until known)</option></select></Field>
                  {f.travel_method === 'fixed' && <Field label={`Fixed travel (${cur})`}><input className="field" inputMode="decimal" value={f.travel_fixed} onChange={set('travel_fixed')} /></Field>}
                  {(f.travel_method === 'per_km' || f.travel_method === 'per_minute') && <Field label={`Rate (${cur})`}><input className="field" inputMode="decimal" value={f.travel_rate} onChange={set('travel_rate')} /></Field>}
                </div>
                <label className="row"><input type="checkbox" checked={f.auto_price} onChange={set('auto_price')} style={{ width: 24, height: 24 }} /> Price automatically. If unticked, every booking is quoted and you approve the price.</label>
                <Field label="Internal note"><input className="field" value={f.note} onChange={set('note')} /></Field>
              </fieldset>
              {problems && (problems.length ? <div className="error"><strong>Fix before activating:</strong><ul style={{ margin: '6px 0 0' }}>{problems.map((p, i) => <li key={i}>{p}</li>)}</ul></div> : <div className="card small" role="status">Nothing is blocking this rule. You can activate it.</div>)}
              <div className="row">
                {draftEditable && superAdmin && <button className="btn" disabled={busy} onClick={saveDraft}>Save draft</button>}
                {f.id && draftEditable && superAdmin && <button className="btn ghost" disabled={busy} onClick={check}>Check it</button>}
                <button className="btn ghost" onClick={() => { setF(null); setProblems(null); }}>Close</button>
              </div>
            </div>)}

          <div className="card stack" style={{ marginTop: 16 }}>
            <h2>Try the active rule</h2>
            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
              <Field label="Minutes"><input className="field" inputMode="numeric" value={test.minutes} onChange={(e) => setTest({ ...test, minutes: e.target.value })} /></Field>
              <Field label="Quantity"><input className="field" inputMode="numeric" value={test.qty} onChange={(e) => setTest({ ...test, qty: e.target.value })} /></Field>
              <Field label="Travel distance, km (if known)"><input className="field" inputMode="decimal" value={test.distance} onChange={(e) => setTest({ ...test, distance: e.target.value })} /></Field>
            </div>
            <div><button className="btn ghost" disabled={busy} onClick={runTest}>Calculate</button></div>
            {result && (result.available ? (
              <div className="stack">
                <div><Badge tone={result.status === 'estimated' ? 'success' : 'brass'}>{result.status === 'estimated' ? 'Estimated' : 'Quote required'}</Badge> <span className="small muted">rule version {result.rule.version} · {result.minutes?.billable ? `${result.minutes.billable} minutes billed` : 'flat'}</span></div>
                {result.lines.map((l: any, i: number) => <div key={i} className="row spread"><span>{l.label}{l.minutes ? <span className="small muted"> · {l.minutes} min × {money(l.rate, result.currency)}</span> : null}</span><strong>{money(l.amount, result.currency)}</strong></div>)}
                <div className="row spread"><strong>Total</strong><strong>{money(result.total, result.currency)}</strong></div>
                {(result.messages || []).map((m: string, i: number) => <div key={i} className="small muted">{m}</div>)}
              </div>) : <div className="small muted">{result.message}</div>)}
          </div>

          <div className="card stack" style={{ marginTop: 16 }}>
            <h2>History</h2>
            {(audit || []).map((a: any) => <div key={a.id} className="small"><strong>{a.action.replace('pricing_rule.', '')}</strong> · {when(a.created_at)}</div>)}
            {audit && !audit.length && <div className="muted">No changes recorded yet.</div>}
          </div>
        </>
      )}
    </>
  );
}
