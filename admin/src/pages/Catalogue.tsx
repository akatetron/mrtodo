// Service catalogue: see every service, its status and price, and publish, pause or archive.
// The full guided builder (questions, preview) is in the Mr. Todo app: More > Service catalogue.
// Here a super admin can change a service's text and fixed price and publish a new version.
import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useLive, q } from '../lib/useLive';
import { Badge, ErrorBox, Field, useAction } from '../components/ui';

const TONE: any = { draft: 'neutral', published: 'success', paused: 'brass', archived: 'danger' };

export default function Catalogue({ profile }: { profile: any }) {
  const superAdmin = (profile?.admin_level || 'super') === 'super';
  const { data } = useLive(async () => ({
    families: await q(supabase.from('service_families').select('*').order('sort_order')),
    services: await q(supabase.from('catalogue_services').select('*').order('sort_order')),
  }), ['service_families', 'catalogue_services'], []);
  const [editing, setEditing] = useState<any>(null);
  const [run, busy, error] = useAction();
  const [msg, setMsg] = useState('');

  async function saveAndPublish() {
    const s = editing;
    const def = { ...(s.draft || {}), title: s.title, description: s.description,
      pricing: { ...(s.draft?.pricing || {}), approach: s.approach, price: s.approach === 'fixed' ? Number(s.price) : undefined, currency: 'INR' } };
    await q(supabase.rpc('save_service_draft', { p_key: s.key, p_family: s.family_id, p_category: s.category, p_definition: def }));
    const v = await q(supabase.rpc('publish_service', { p_service: s.id }));
    setMsg(`Published ${s.title} as version ${v}.`); setEditing(null);
  }

  return (
    <>
      <div className="page-head"><div><h1>Service catalogue</h1><p>What customers can book. Prices marked “sample” are placeholders: edit them.</p></div></div>
      <ErrorBox>{error}</ErrorBox>
      {msg && <div className="card small" role="status">{msg}</div>}
      {!superAdmin && <div className="card small muted">Only super admins can change the catalogue. You can look at it.</div>}
      <div className="stack">
        {(data?.families || []).map((f: any) => (
          <div key={f.id} className="card stack">
            <div className="row spread"><h2>{f.icon} {f.name}</h2><Badge tone={TONE[f.status]}>{f.status}</Badge></div>
            {(data.services || []).filter((s: any) => s.family_id === f.id).map((s: any) => {
              const pr = s.draft?.pricing || {};
              const isEditing = editing?.id === s.id;
              return (
                <div key={s.id} className="stack" style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                  <div className="row spread">
                    <div><strong>{s.draft?.title || s.key}</strong>
                      <div className="small muted">{pr.approach === 'fixed' ? `Fixed ₹${pr.price}` : pr.approach === 'manual_quote' ? 'Quote by our team' : pr.approach === 'estimate_approval' ? 'Estimate then approve' : 'No pricing yet'}{pr.explanation?.startsWith('Sample') ? ' · sample' : ''}{s.current_version ? ` · v${s.current_version}` : ''}</div></div>
                    <Badge tone={TONE[s.status]}>{s.status}</Badge>
                  </div>
                  {superAdmin && !isEditing && (
                    <div className="row">
                      <button className="btn sm ghost" onClick={() => setEditing({ ...s, title: s.draft?.title || '', description: s.draft?.description || '', approach: pr.approach || 'manual_quote', price: pr.price ?? '' })}>Edit</button>
                      {s.status === 'published' && <button className="btn sm ghost" disabled={busy} onClick={() => run(() => q(supabase.rpc('set_service_status', { p_service: s.id, p_status: 'paused' })))}>Pause</button>}
                      {s.status === 'paused' && <button className="btn sm ghost" disabled={busy} onClick={() => run(() => q(supabase.rpc('set_service_status', { p_service: s.id, p_status: 'published' })))}>Resume</button>}
                      {s.status !== 'archived' && <button className="btn sm danger" disabled={busy} onClick={() => run(() => q(supabase.rpc('set_service_status', { p_service: s.id, p_status: 'archived' })))}>Archive</button>}
                    </div>
                  )}
                  {isEditing && (
                    <div className="stack">
                      <Field label="Title"><input className="field" value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} /></Field>
                      <Field label="Description"><textarea className="field" value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></Field>
                      <Field label="Pricing">
                        <select className="field" value={editing.approach} onChange={(e) => setEditing({ ...editing, approach: e.target.value })}>
                          <option value="manual_quote">Quote by our team</option><option value="estimate_approval">Estimate, then approve</option><option value="fixed">Fixed price</option>
                        </select>
                      </Field>
                      {editing.approach === 'fixed' && <Field label="Fixed price (₹)"><input className="field" inputMode="numeric" value={editing.price} onChange={(e) => setEditing({ ...editing, price: e.target.value })} /></Field>}
                      <div className="row"><button className="btn ghost" onClick={() => setEditing(null)}>Cancel</button><button className="btn" disabled={busy} onClick={() => run(saveAndPublish)}>Save and publish</button></div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </>
  );
}
