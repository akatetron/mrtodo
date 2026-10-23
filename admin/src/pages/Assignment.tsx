import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useLive, q } from '../lib/useLive';
import { when } from '../lib/constants';
import { Badge, ErrorBox, Field, useAction } from '../components/ui';

const CUSTOMER = [['female', 'Female'], ['male', 'Male'], ['non_binary', 'Non-binary'], ['self_described', 'Self-described']];
const SETTINGS: [string, string, string][] = [
  ['offer_timeout_minutes', 'Minutes a PM has to answer an offer', 'number'],
  ['offer_max_attempts', 'Offers sent before a task goes to the Admin Queue', 'number'],
  ['rank_weight_fairness', 'Ranking weight: workload fairness', 'number'],
  ['rank_weight_distance', 'Ranking weight: distance (only when both sides have a map point)', 'number'],
  ['rank_weight_rating', 'Ranking weight: customer rating (only for PMs who have ratings)', 'number'],
  ['max_active_jobs_per_pm', 'Most tasks one PM may hold at once (0 = no limit)', 'number'],
  ['schedule_buffer_minutes', 'Minutes kept free around a PM’s other tasks', 'number'],
  ['default_task_minutes', 'Length assumed when a task has no stated duration', 'number'],
];

export default function Assignment({ profile }: { profile: any }) {
  const superAdmin = (profile?.admin_level || 'super') === 'super';
  const { data: ov, reload } = useLive(() => q(supabase.rpc('offers_overview')), ['assignment_offers', 'tasks'], []);
  const { data: settings, reload: reloadSettings } = useLive(() => q(supabase.from('platform_settings').select('key, value').in('key', ['auto_assign_mode', ...SETTINGS.map((s) => s[0])])), ['platform_settings'], []);
  const { data: policy, reload: reloadPolicy } = useLive(() => q(supabase.rpc('matching_policy_status')), ['matching_policy'], []);
  const { data: pms } = useLive(async () => {
    const [p, h] = await Promise.all([q(supabase.from('profiles').select('id, full_name, vehicles, region_codes, travel_available, service_area').eq('role', 'worker').eq('worker_status', 'approved').order('full_name')), q(supabase.from('pm_working_hours').select('worker_id'))]);
    const n: any = {}; (h || []).forEach((r: any) => { n[r.worker_id] = (n[r.worker_id] || 0) + 1; });
    return (p || []).map((x: any) => ({ ...x, windows: n[x.id] || 0 }));
  }, ['profiles', 'pm_working_hours'], []);
  const [vals, setVals] = useState<any>({});
  const [pol, setPol] = useState<any>(null);
  const [run, busy, error] = useAction();
  const [msg, setMsg] = useState('');
  const val = (k: string) => (vals[k] ?? (settings || []).find((s: any) => s.key === k)?.value ?? '');
  useEffect(() => { if (policy && !pol) setPol({ enabled: policy.enabled, fallback: policy.fallback, mapping: policy.mapping || {}, note: policy.review_note || '' }); }, [policy]);

  const saveSettings = () => run(async () => {
    for (const [k] of SETTINGS) if (vals[k] !== undefined) await q(supabase.rpc('set_setting', { p_key: k, p_value: Number(vals[k]) }));
    if (vals.auto_assign_mode !== undefined) await q(supabase.rpc('set_setting', { p_key: 'auto_assign_mode', p_value: vals.auto_assign_mode }));
    setVals({}); setMsg('Settings saved.'); reloadSettings();
  });
  const toggleMap = (c: string, g: string) => {
    const cur: string[] = pol.mapping[c] || [];
    const next = cur.includes(g) ? cur.filter((x) => x !== g) : [...cur, g];
    const m = { ...pol.mapping }; if (next.length) m[c] = next; else delete m[c];
    setPol({ ...pol, mapping: m });
  };
  const savePolicy = () => run(async () => {
    if (pol.enabled && !window.confirm('Switch customer-gender matching ON? Check the legal position for every region it will apply in first. Matching decisions are recorded in the audit log.')) return;
    await q(supabase.rpc('save_matching_policy', { p_enabled: pol.enabled, p_mapping: pol.mapping, p_fallback: pol.fallback, p_review_note: pol.note }));
    setMsg('Matching policy saved.'); reloadPolicy();
  });
  const mode = val('auto_assign_mode') || 'off';

  return (
    <>
      <div className="page-head"><div><h1>Assignment</h1><p>How tasks reach Personal Managers. With offers on, the system offers each task to the best eligible PM, one at a time. The PM must accept before anyone is told a PM is assigned.</p></div></div>
      <ErrorBox>{error}</ErrorBox>
      {msg && <div className="card small" role="status">{msg}</div>}

      <div className="card stack">
        <h2>Offers and ranking</h2>
        <Field label="Mode"><select className="field" disabled={!superAdmin} value={mode} onChange={(e) => setVals({ ...vals, auto_assign_mode: e.target.value })}>
          <option value="off">Off: PMs pick tasks from the job feed</option><option value="offers">Offers: the system offers each task to one PM at a time</option></select></Field>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          {SETTINGS.map(([k, label]) => <Field key={k} label={label}><input className="field" inputMode="decimal" disabled={!superAdmin} value={val(k)} onChange={(e) => setVals({ ...vals, [k]: e.target.value })} /></Field>)}
        </div>
        <div className="small muted">A task is only offered when: the PM is active and verified for it, free then (own hours, time off, other tasks), the platform is open, any vehicle need is met, the price is approved, the PM serves its region and area, and the matching policy allows it. A PM who has not set working hours is never offered a timed task.</div>
        {superAdmin && <div><button className="btn" disabled={busy || !Object.keys(vals).length} onClick={saveSettings}>Save</button></div>}
      </div>

      <div className="card stack" style={{ marginTop: 16, border: pol?.enabled ? '2px solid var(--brass)' : undefined }}>
        <div className="row spread"><h2>Customer-gender matching</h2><Badge tone={policy?.enabled ? 'brass' : 'neutral'}>{policy?.enabled ? 'On' : 'Off'}</Badge></div>
        <div className="card small" style={{ background: 'var(--brass-tint)' }}>
          <strong>Not confirmed.</strong> The mapping from customer gender to eligible Personal Manager gender is a business decision and has not been made, so nothing is pre-selected and the policy is off. Review privacy, equality, anti-discrimination and employment requirements for each region before turning it on. Gender is only ever used inside matching; it is never shown to PMs, customers or this dashboard.
        </div>
        {pol && (
          <>
            <div className="label">Allowed Personal Manager genders, for each customer gender (leave a row empty if it is not covered)</div>
            <div className="table-wrap"><table><thead><tr><th>Customer gender</th>{CUSTOMER.map(([g, l]) => <th key={g}>{l}</th>)}</tr></thead>
              <tbody>{CUSTOMER.map(([c, cl]) => (
                <tr key={c}><td><strong>{cl}</strong></td>{CUSTOMER.map(([g, gl]) => (
                  <td key={g}><input type="checkbox" disabled={!superAdmin} checked={(pol.mapping[c] || []).includes(g)} onChange={() => toggleMap(c, g)} style={{ width: 22, height: 22 }} aria-label={`${cl} customer may be matched with ${gl}`} /></td>))}</tr>))}</tbody></table></div>
            <Field label="When the customer’s gender is missing, undisclosed, not covered above, or the booking is for someone else"><select className="field" disabled={!superAdmin} value={pol.fallback} onChange={(e) => setPol({ ...pol, fallback: e.target.value })}>
              <option value="admin_queue">Send the task to the Admin Queue (nothing is guessed)</option><option value="ignore_rule">Do not apply the rule to that task</option></select></Field>
            <Field label="Legal review: who reviewed it, for which region, and when (required to switch on)"><textarea className="field" disabled={!superAdmin} value={pol.note} onChange={(e) => setPol({ ...pol, note: e.target.value })} /></Field>
            <label className="row"><input type="checkbox" disabled={!superAdmin} checked={pol.enabled} onChange={(e) => setPol({ ...pol, enabled: e.target.checked })} style={{ width: 24, height: 24 }} /> Apply this policy when matching</label>
            {superAdmin && <div><button className="btn" disabled={busy} onClick={savePolicy}>Save matching policy</button></div>}
          </>)}
      </div>

      <div className="card stack" style={{ marginTop: 16 }}>
        <div className="row spread"><h2>Admin Queue</h2><Badge tone={(ov?.queue || []).length ? 'danger' : 'success'}>{(ov?.queue || []).length} waiting</Badge></div>
        {(ov?.queue || []).map((t: any) => (
          <div key={t.task_id} className="stack" style={{ gap: 4, borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
            <div className="row spread"><strong>{t.title}</strong><span className="small muted">{when(t.queued_at)}</span></div>
            <div className="small">{t.reason || 'No reason recorded.'}</div>
            <div className="row"><a className="btn sm ghost" href={`#tasks/${t.task_id}`}>Open task and assign</a>
              <button className="btn sm" disabled={busy} onClick={() => run(async () => { const r = await q(supabase.rpc('requeue_task', { p_task: t.task_id })); setMsg(`Re-queued: ${r}`); reload(); })}>Try automatic matching again</button></div>
          </div>))}
        {ov && !(ov.queue || []).length && <div className="muted">Nothing is waiting for a manual assignment.</div>}
      </div>

      <div className="card stack" style={{ marginTop: 16 }}>
        <h2>Offers</h2>
        <div className="row">{Object.entries(ov?.counts || {}).map(([k, n]) => <Badge key={k} tone={k === 'accepted' ? 'success' : k === 'pending' ? 'brass' : 'neutral'}>{k}: {String(n)}</Badge>)}</div>
        <div className="table-wrap"><table><thead><tr><th>Task</th><th>Personal Manager</th><th>Attempt</th><th>Status</th><th>Sent</th><th>Answered</th></tr></thead>
          <tbody>{(ov?.recent || []).map((o: any) => (
            <tr key={o.offer_id}><td><a href={`#tasks/${o.task_id}`}>{o.title}</a></td><td>{o.worker}</td><td>{o.attempt}</td><td><Badge tone={o.status === 'accepted' ? 'success' : o.status === 'pending' ? 'brass' : 'neutral'}>{o.status}</Badge>{o.note ? <div className="small muted">{o.note}</div> : null}</td><td>{when(o.created_at)}</td><td>{o.responded_at ? when(o.responded_at) : o.status === 'pending' ? `by ${when(o.expires_at)}` : '—'}</td></tr>))}
            {ov && !(ov.recent || []).length && <tr><td colSpan={6} className="muted">No offers yet.</td></tr>}</tbody></table></div>
      </div>

      <div className="card stack" style={{ marginTop: 16 }}>
        <h2>Personal Manager readiness</h2>
        <div className="small muted">What each approved PM has told us. Blank means not stated, and is never assumed.</div>
        <div className="table-wrap"><table><thead><tr><th>Personal Manager</th><th>Vehicle</th><th>Regions</th><th>Working windows</th></tr></thead>
          <tbody>{(pms || []).map((p: any) => (
            <tr key={p.id}><td>{p.full_name}</td><td>{p.vehicles == null ? <span className="muted">Not stated</span> : p.vehicles.length ? p.vehicles.map((v: string) => v.replace('_', '-')).join(', ') : 'None'}</td>
              <td>{(p.region_codes || []).join(', ') || <span className="muted">None stated</span>}</td><td>{p.windows ? p.windows : <span className="muted">None set: not offered timed tasks</span>}</td></tr>))}
            {pms && !pms.length && <tr><td colSpan={4} className="muted">No approved Personal Managers.</td></tr>}</tbody></table></div>
      </div>
    </>
  );
}
