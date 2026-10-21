// Panels in the task detail: review state, escalation, multi-day change, revised quote, specialist.
import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useLive, q } from '../lib/useLive';
import { money, when } from '../lib/constants';
import { Field, Badge, ErrorBox, useAction } from '../components/ui';

export function EscalationBanner({ t }: { t: any }) {
  const { data } = useLive(() => q(supabase.from('escalations').select('*').eq('task_id', t.id).order('created_at', { ascending: false }).limit(1)), ['escalations'], [t.id]);
  const e = data?.[0];
  const [note, setNote] = useState('');
  const [run, busy, error] = useAction();
  if (!e) return null;
  return (
    <div className="card stack" style={{ border: e.status === 'open' ? '3px solid var(--danger)' : undefined }}>
      <div className="row"><Badge tone={e.status === 'open' ? 'danger' : 'success'}>{e.status === 'open' ? 'Customer escalated' : 'Escalation resolved'}</Badge><span className="small muted">{when(e.created_at)} · {e.minutes_late} min late when raised</span></div>
      {e.reason && <div>Customer says: “{e.reason}”</div>}
      {e.status === 'resolved' && <div className="small muted">Resolution: {e.resolution}</div>}
      {e.status === 'open' && (
        <>
          <Field label="What did you do? (required)"><input className="field" value={note} onChange={(ev) => setNote(ev.target.value)} /></Field>
          <div className="row">
            <button className="btn" disabled={busy} onClick={() => run(() => q(supabase.rpc('resolve_escalation', { p_escalation: e.id, p_resolution: note })))}>Mark resolved</button>
            {t.status === 'assigned' && <button className="btn danger" disabled={busy} onClick={() => run(() => q(supabase.rpc('unassign_task', { p_task: t.id, p_reason: note })))}>Take the task back</button>}
          </div>
        </>
      )}
      <ErrorBox>{error}</ErrorBox>
    </div>
  );
}

export function ScopePanel({ t }: { t: any }) {
  const { data } = useLive(() => q(supabase.from('task_scope_changes').select('*').eq('task_id', t.id).order('created_at', { ascending: false })), ['task_scope_changes'], [t.id]);
  const [note, setNote] = useState('');
  const [price, setPrice] = useState('');
  const [run, busy, error] = useAction();
  const open = (data || []).find((c: any) => ['pending', 'approved_by_admin'].includes(c.status));
  const last = (data || [])[0];
  if (!open && !last) return null;
  const c = open || last;
  const label: any = { pending: 'Waiting for admin', approved_by_admin: 'Waiting for the customer', applied: 'Agreed by both', rejected: 'Not agreed', withdrawn: 'Withdrawn' };
  return (
    <div className="card stack">
      <div className="row spread"><h3>Request to run over several days</h3><Badge tone={c.status === 'applied' ? 'success' : c.status === 'rejected' ? 'danger' : 'brass'}>{label[c.status]}</Badge></div>
      <div>Reason: {c.reason}</div>
      <ul className="small" style={{ margin: 0 }}>{(c.proposed_visits || []).map((v: any, i: number) => <li key={i}>{v.date}{v.note ? ` — ${v.note}` : ''}</li>)}</ul>
      <div className="small muted">PM suggests extra cost: {c.price_impact != null ? money(c.price_impact) : 'none'}{c.approved_price_impact != null ? ` · approved: ${money(c.approved_price_impact)}` : ''}</div>
      {c.status === 'pending' && (
        <>
          <Field label="Extra cost the customer will be asked to approve (₹)"><input className="field" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} placeholder={c.price_impact != null ? String(c.price_impact) : '0'} /></Field>
          <Field label="Note (optional)"><input className="field" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <div className="row">
            <button className="btn" disabled={busy} onClick={() => run(() => q(supabase.rpc('decide_scope_change_admin', { p_change: c.id, p_approve: true, p_note: note || null, p_price_impact: price ? Number(price) : null })))}>Approve and send to the customer</button>
            <button className="btn danger" disabled={busy} onClick={() => run(() => q(supabase.rpc('decide_scope_change_admin', { p_change: c.id, p_approve: false, p_note: note || null, p_price_impact: null })))}>Reject</button>
          </div>
        </>
      )}
      {c.status === 'approved_by_admin' && <div className="small muted">It takes effect only if the customer agrees.</div>}
      <ErrorBox>{error}</ErrorBox>
    </div>
  );
}

export function QuotePanel({ t }: { t: any }) {
  const { data } = useLive(() => q(supabase.from('task_quotes').select('*').eq('task_id', t.id).order('version', { ascending: false })), ['task_quotes'], [t.id]);
  const [note, setNote] = useState('');
  const [run, busy, error] = useAction();
  if (!data?.length) return null;
  const open = data.find((x: any) => x.status === 'proposed');
  const label: any = { proposed: 'Needs your review', admin_approved: 'Waiting for the customer', customer_approved: 'Agreed', rejected: 'Not agreed', superseded: 'Replaced', withdrawn: 'Withdrawn' };
  return (
    <div className="card stack">
      <h3>Quotes and price history</h3>
      {data.map((x: any) => (
        <div key={x.id} className="stack" style={{ gap: 4, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
          <div className="row spread"><strong>Version {x.version} · {money(x.total)}</strong><Badge tone={x.status === 'customer_approved' ? 'success' : x.status === 'rejected' ? 'danger' : 'brass'}>{label[x.status]}</Badge></div>
          <div className="small muted">{x.reason}</div>
          <div className="small">{(x.components || []).map((c: any) => `${c.label}: ${money(c.amount)}`).join(' · ')}</div>
        </div>
      ))}
      {open && (
        <>
          <Field label="Note (optional)"><input className="field" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <div className="row">
            <button className="btn" disabled={busy} onClick={() => run(() => q(supabase.rpc('decide_quote_admin', { p_quote: open.id, p_approve: true, p_note: note || null })))}>Approve and send to the customer</button>
            <button className="btn danger" disabled={busy} onClick={() => run(() => q(supabase.rpc('decide_quote_admin', { p_quote: open.id, p_approve: false, p_note: note || null })))}>Reject</button>
          </div>
        </>
      )}
      <ErrorBox>{error}</ErrorBox>
    </div>
  );
}

export function SpecialistPanel({ t }: { t: any }) {
  const { data: specialists } = useLive(() => q(supabase.from('specialists').select('*').eq('active', true).order('name')), ['specialists'], []);
  const { data: jobs } = useLive(() => q(supabase.from('task_specialist_jobs').select('*, specialist:specialist_id(name, skill_key, verified)').eq('task_id', t.id).order('created_at')), ['task_specialist_jobs'], [t.id]);
  const [run, busy, error] = useAction();
  const needs = t.service_snapshot?.requires_specialist;
  if (!needs && !(jobs || []).length) return null;
  const next: any = { requested: 'quoted', quoted: 'scheduled', scheduled: 'visited', visited: 'completed' };
  return (
    <div className="card stack">
      <h3>Specialist</h3>
      {(jobs || []).map((j: any) => (
        <div key={j.id} className="row spread">
          <span><strong>{j.specialist?.name}</strong> <span className="small muted">{j.specialist?.skill_key} · {j.specialist?.verified ? 'verified' : 'not verified'}</span></span>
          <span className="row"><Badge tone={j.status === 'failed' ? 'danger' : j.status === 'completed' ? 'success' : 'brass'}>{j.status}</Badge>
            {next[j.status] && <button className="btn sm ghost" disabled={busy} onClick={() => run(() => q(supabase.rpc('set_specialist_job', { p_job: j.id, p_status: next[j.status] })))}>Mark {next[j.status]}</button>}
            {!['completed', 'failed'].includes(j.status) && <button className="btn sm danger" disabled={busy} onClick={() => run(() => q(supabase.rpc('set_specialist_job', { p_job: j.id, p_status: 'failed' })))}>Failed</button>}</span>
        </div>
      ))}
      {['assigned', 'in_progress'].includes(t.status) && (specialists || []).map((s: any) => (
        <div key={s.id} className="row spread"><span>{s.name} <span className="small muted">{s.skill_key} · {s.verified ? 'verified' : 'not verified'}</span></span>
          <button className="btn sm" disabled={busy} onClick={() => run(() => q(supabase.rpc('assign_specialist', { p_task: t.id, p_specialist: s.id, p_note: null })))}>Arrange</button></div>
      ))}
      <div className="small muted">A specialist finishing a visit never completes the customer's task. Regulated work only goes to a verified specialist.</div>
      <ErrorBox>{error}</ErrorBox>
    </div>
  );
}
