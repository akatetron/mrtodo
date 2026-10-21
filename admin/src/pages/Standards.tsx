// Qualifications per Personal Manager, interviews, specialists. Skill tests are written in the app (More > Standards and specialists).
import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useLive, q } from '../lib/useLive';
import { Badge, ErrorBox, Field, useAction } from '../components/ui';

export default function Standards({ profile }: { profile: any }) {
  const superAdmin = (profile?.admin_level || 'super') === 'super';
  const { data } = useLive(async () => ({
    skills: await q(supabase.from('skills').select('*').eq('active', true).order('name')),
    pms: await q(supabase.from('profiles').select('id, full_name, worker_status, tier').eq('role', 'worker').order('full_name')),
    quals: await q(supabase.from('pm_qualifications').select('*')),
    specialists: await q(supabase.from('specialists').select('*').order('name')),
  }), ['pm_qualifications', 'profiles', 'specialists'], []);
  const [run, busy, error] = useAction();
  const [pm, setPm] = useState<string>('');
  const [sp, setSp] = useState<any>({ name: '', skill: 'home-repair-coordination', verified: false, note: '', phone: '' });
  const [notes, setNotes] = useState('');
  const quals = (data?.quals || []).filter((x: any) => x.worker_id === pm);
  return (
    <>
      <div className="page-head"><div><h1>Standards and specialists</h1><p>Who is verified for what, and who we can arrange.</p></div></div>
      <ErrorBox>{error}</ErrorBox>
      <div className="card stack">
        <h2>Personal Manager qualifications</h2>
        <Field label="Choose a Personal Manager">
          <select className="field" value={pm} onChange={(e) => setPm(e.target.value)}>
            <option value="">Select…</option>
            {(data?.pms || []).map((p: any) => <option key={p.id} value={p.id}>{p.full_name} ({p.worker_status}{p.tier === 'gold' ? ', Gold' : ''})</option>)}
          </select>
        </Field>
        {pm && (data?.skills || []).map((s: any) => {
          const x = quals.find((y: any) => y.skill_key === s.key);
          const expired = x?.expires_at && new Date(x.expires_at) < new Date();
          return (
            <div key={s.key} className="row spread">
              <span><strong>{s.name}</strong>{s.regulated ? ' · regulated' : ''}</span>
              <span className="row">
                <Badge tone={x?.status === 'verified' && !expired ? 'success' : x ? 'brass' : 'neutral'}>{!x ? 'Not claimed' : expired ? 'Expired' : x.status === 'verified' ? `Verified (${x.source})` : x.status === 'claimed' ? 'Self-reported only' : 'Revoked'}</Badge>
                {superAdmin && x?.status !== 'verified' && <button className="btn sm" disabled={busy} onClick={() => run(() => q(supabase.rpc('set_pm_qualification', { p_worker: pm, p_skill: s.key, p_status: 'verified', p_level: 1, p_source: s.regulated ? 'document' : 'interview', p_expires_at: new Date(Date.now() + 365 * 864e5).toISOString(), p_note: null })))}>Verify</button>}
                {superAdmin && x?.status === 'verified' && <button className="btn sm danger" disabled={busy} onClick={() => run(() => q(supabase.rpc('set_pm_qualification', { p_worker: pm, p_skill: s.key, p_status: 'revoked', p_level: 1, p_source: 'interview', p_expires_at: null, p_note: null })))}>Revoke</button>}
              </span>
            </div>
          );
        })}
        {pm && superAdmin && (
          <>
            <Field label="Interview notes (optional)"><input className="field" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
            <div className="row">{['passed', 'failed', 'scheduled', 'no_show'].map((o) => <button key={o} className="btn sm ghost" disabled={busy} onClick={() => run(() => q(supabase.rpc('record_interview', { p_worker: pm, p_outcome: o, p_notes: notes || null })))}>Record interview: {o.replace('_', ' ')}</button>)}</div>
          </>
        )}
        <div className="small muted">Verifying lasts a year. For regulated skills, verify only after checking the person's documents.</div>
      </div>

      <div className="card stack" style={{ marginTop: 16 }}>
        <h2>Specialists</h2>
        {(data?.specialists || []).map((s: any) => <div key={s.id} className="row spread"><span>{s.name} <span className="small muted">{s.skill_key}{s.verification_note ? ` · ${s.verification_note}` : ''}</span></span><Badge tone={s.verified ? 'success' : 'brass'}>{s.verified ? 'Verified' : 'Not verified'}</Badge></div>)}
        {superAdmin && (
          <>
            <Field label="Add a specialist: name"><input className="field" value={sp.name} onChange={(e) => setSp({ ...sp, name: e.target.value })} /></Field>
            <Field label="Trade"><select className="field" value={sp.skill} onChange={(e) => setSp({ ...sp, skill: e.target.value })}>{(data?.skills || []).map((s: any) => <option key={s.key} value={s.key}>{s.name}</option>)}</select></Field>
            <Field label="Phone (private to super admins)"><input className="field" value={sp.phone} onChange={(e) => setSp({ ...sp, phone: e.target.value })} /></Field>
            <Field label="How you checked them"><input className="field" value={sp.note} onChange={(e) => setSp({ ...sp, note: e.target.value })} /></Field>
            <label className="row"><input type="checkbox" checked={sp.verified} onChange={(e) => setSp({ ...sp, verified: e.target.checked })} style={{ width: 24, height: 24 }} /> Credentials checked and verified</label>
            <button className="btn" disabled={busy || sp.name.trim().length < 2} onClick={() => run(async () => { await q(supabase.rpc('save_specialist', { p_id: null, p_name: sp.name, p_skill: sp.skill, p_verified: sp.verified, p_note: sp.note || null, p_phone: sp.phone || null, p_active: true })); setSp({ ...sp, name: '', phone: '', note: '', verified: false }); })}>Save specialist</button>
          </>
        )}
      </div>
    </>
  );
}
