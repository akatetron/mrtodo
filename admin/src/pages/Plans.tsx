import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useLive, q } from '../lib/useLive';
import { Badge, ErrorBox, Field, useAction } from '../components/ui';

// Todo+ plan and subscribers. Price, visits and the Razorpay plan id are your decisions: nothing is pre-filled.
export default function Plans({ profile }: { profile: any }) {
  const superAdmin = (profile?.admin_level || 'super') === 'super';
  const { data: plans } = useLive(() => q(supabase.from('subscription_plans').select('*').order('name')), ['subscription_plans'], []);
  const { data: subs } = useLive(() => q(supabase.from('subscriptions').select('*, customer:customer_id(full_name)').order('created_at', { ascending: false }).limit(100)), ['subscriptions'], []);
  const [f, setF] = useState<any>(null);
  const [run, busy, error] = useAction();
  const [msg, setMsg] = useState('');
  useEffect(() => {
    if (plans?.[0] && !f) { const p = plans[0]; setF({ code: p.code, name: p.name, price: p.price_amount ?? '', visits: p.included_visits, description: p.description || '', terms: p.terms || '', provider: p.provider_plan_id || '', active: p.active }); }
  }, [plans]);
  const save = () => run(async () => {
    await q(supabase.rpc('save_plan', { p_code: f.code, p_name: f.name, p_price: f.price === '' ? null : Number(f.price), p_visits: Number(f.visits) || 1, p_categories: [], p_description: f.description, p_terms: f.terms, p_provider_plan: f.provider || null, p_active: f.active }));
    setMsg('Saved.');
  });
  return (
    <>
      <div className="page-head"><div><h1>Todo+ plans</h1><p>A plan can go live only with a price and the plan id from Razorpay.</p></div></div>
      <ErrorBox>{error}</ErrorBox>
      {msg && <div className="card small" role="status">{msg}</div>}
      {f && (
        <div className="card stack">
          <Field label="Name"><input className="field" value={f.name} disabled={!superAdmin} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Monthly price (₹) — your decision"><input className="field" inputMode="numeric" value={f.price} disabled={!superAdmin} onChange={(e) => setF({ ...f, price: e.target.value })} /></Field>
          <Field label="Visits included each month"><input className="field" inputMode="numeric" value={f.visits} disabled={!superAdmin} onChange={(e) => setF({ ...f, visits: e.target.value })} /></Field>
          <Field label="Description"><textarea className="field" value={f.description} disabled={!superAdmin} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <Field label="Terms customers see"><textarea className="field" value={f.terms} disabled={!superAdmin} onChange={(e) => setF({ ...f, terms: e.target.value })} /></Field>
          <Field label="Razorpay plan id"><input className="field" value={f.provider} disabled={!superAdmin} onChange={(e) => setF({ ...f, provider: e.target.value })} /></Field>
          <label className="row"><input type="checkbox" checked={f.active} disabled={!superAdmin} onChange={(e) => setF({ ...f, active: e.target.checked })} style={{ width: 24, height: 24 }} /> Live: customers can subscribe</label>
          {superAdmin && <button className="btn" disabled={busy} onClick={save}>Save plan</button>}
        </div>
      )}
      <div className="card stack" style={{ marginTop: 16 }}>
        <h2>Subscribers</h2>
        {(subs || []).map((s: any) => (
          <div key={s.id} className="row spread"><span>{s.customer?.full_name} <span className="small muted">{s.plan_code} · {s.visits_remaining} visits left{s.cancel_at_period_end ? ' · cancelling' : ''}</span></span>
            <Badge tone={s.status === 'active' ? 'success' : s.status === 'past_due' ? 'danger' : 'brass'}>{s.status}</Badge></div>
        ))}
        {subs && !subs.length && <div className="muted">No subscribers yet.</div>}
      </div>
    </>
  );
}
