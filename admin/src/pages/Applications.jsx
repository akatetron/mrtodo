import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useLive, q } from '../lib/useLive';
import { PM_STATUS, catMeta, when } from '../lib/constants';
import { Badge, Avatar, ErrorBox, useAction } from '../components/ui';

const FILTERS = [
  { id: 'pending', label: 'Pending review', statuses: ['pending'] },
  { id: 'more_info', label: 'Waiting on applicant', statuses: ['more_info'] },
  { id: 'draft', label: 'Not submitted yet', statuses: ['draft'] },
  { id: 'rejected', label: 'Rejected', statuses: ['rejected'] },
];

export default function Applications() {
  const [filter, setFilter] = useState('pending');
  const [selectedId, setSelectedId] = useState(null);
  const { data: people, error } = useLive(
    () => q(supabase.from('profiles').select('*').eq('role', 'worker')
      .in('worker_status', ['pending', 'more_info', 'draft', 'rejected'])
      .order('applied_at', { ascending: true, nullsFirst: false })),
    ['profiles'],
  );
  const f = FILTERS.find((x) => x.id === filter);
  const list = useMemo(() => (people || []).filter((p) => f.statuses.includes(p.worker_status)), [people, f]);
  const selected = (people || []).find((p) => p.id === selectedId) || null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Applications</h1>
          <p>People applying to become Personal Managers. Check their ID and skills, then decide.</p>
        </div>
      </div>
      <div className="tabs">
        {FILTERS.map((x) => (
          <button key={x.id} className={`tab ${filter === x.id ? 'active' : ''}`} onClick={() => setFilter(x.id)}>
            {x.label} {people ? `· ${people.filter((p) => x.statuses.includes(p.worker_status)).length}` : ''}
          </button>
        ))}
      </div>
      <ErrorBox>{error}</ErrorBox>
      <div className="split">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Applicant</th><th>Skills</th><th>Area</th><th>Experience</th><th>{filter === 'draft' ? 'Signed up' : 'Applied'}</th></tr></thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id} className={`clickable ${p.id === selectedId ? 'selected' : ''}`} onClick={() => setSelectedId(p.id)}>
                  <td><div className="t-title">{p.full_name}</div><div className="faint small">{p.email}</div></td>
                  <td>{(p.categories || []).map((c) => catMeta(c).emoji).join(' ') || '—'}</td>
                  <td>{p.service_area || '—'}</td>
                  <td>{p.experience_years != null ? `${p.experience_years} yrs` : '—'}</td>
                  <td className="small muted">{when(p.applied_at || p.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {people && !list.length && <div className="empty">Nothing here.</div>}
          {!people && !error && <div className="empty">Loading…</div>}
        </div>
        <div className="panel">
          {selected ? <Applicant key={selected.id} p={selected} /> : <div className="card empty">Select an applicant to review.</div>}
        </div>
      </div>
    </>
  );
}

function Applicant({ p }) {
  const [note, setNote] = useState('');
  const [run, busy, error] = useAction();
  const decide = (decision) => run(() => q(supabase.rpc('review_pm_application', { p_worker: p.id, p_decision: decision, p_note: note.trim() || null })));
  const st = PM_STATUS[p.worker_status];

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="card stack">
        <div className="row">
          <Avatar name={p.full_name} />
          <div style={{ flex: 1 }}>
            <h2>{p.full_name}</h2>
            <div className="small muted">{[p.phone, p.email].filter(Boolean).join(' · ')}</div>
          </div>
          <Badge tone={st.tone}>{st.label}</Badge>
        </div>
        <div>
          <div className="label">Skills</div>
          <div className="row" style={{ gap: 6 }}>
            {(p.categories || []).length ? p.categories.map((c) => <Badge key={c} tone="accent">{catMeta(c).emoji} {catMeta(c).label}</Badge>) : <span className="faint">None given</span>}
          </div>
        </div>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div><div className="label">Service area</div>{p.service_area || '—'}</div>
          <div><div className="label">Experience</div>{p.experience_years != null ? `${p.experience_years} years` : '—'}</div>
        </div>
        {p.bio && <div><div className="label">About</div><div className="muted">{p.bio}</div></div>}
        {p.application_note && <div className="small muted"><strong>Last note to applicant:</strong> {p.application_note}</div>}
      </div>

      <Documents workerId={p.id} />

      {p.worker_status !== 'draft' && (
        <div className="card stack">
          <h3>Decision</h3>
          <textarea className="field" placeholder="Note to the applicant — required when asking for more info, e.g. “ID photo is blurry, please re-upload”" value={note} onChange={(e) => setNote(e.target.value)} />
          <ErrorBox>{error}</ErrorBox>
          <div className="row">
            <button className="btn" disabled={busy} onClick={() => decide('approved')}>✓ Approve</button>
            <button className="btn brass" disabled={busy || !note.trim()} onClick={() => decide('more_info')} title="Needs a note">Request more info</button>
            <button className="btn danger" disabled={busy} onClick={() => decide('rejected')}>Reject</button>
          </div>
          <div className="faint small">Approving lets them receive tasks immediately. The applicant's app updates on its own.</div>
        </div>
      )}
      {p.worker_status === 'draft' && <div className="card faint small">This person signed up but hasn't submitted their application yet.</div>}
    </div>
  );
}

function Documents({ workerId }) {
  const [docs, setDocs] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const rows = await q(supabase.from('pm_documents').select('*').eq('worker_id', workerId).order('created_at'));
        // Private bucket: generate short-lived links so only signed-in admins can view.
        const withUrls = await Promise.all(rows.map(async (d) => {
          const { data } = await supabase.storage.from('pm-documents').createSignedUrl(d.storage_path, 600);
          return { ...d, url: data?.signedUrl };
        }));
        if (alive) setDocs(withUrls);
      } catch (e) {
        if (alive) setError(e.message);
      }
    })();
    return () => { alive = false; };
  }, [workerId]);

  return (
    <div className="card stack">
      <h3>Documents</h3>
      <ErrorBox>{error}</ErrorBox>
      {!docs && !error && <div className="faint">Loading…</div>}
      {docs && !docs.length && <div className="faint">No documents uploaded.</div>}
      {docs?.map((d) => {
        const isImage = /\.(png|jpe?g|webp|gif|heic)$/i.test(d.storage_path);
        return (
          <div key={d.id} className="stack" style={{ gap: 6 }}>
            <div className="row spread">
              <span><Badge tone={d.doc_type === 'id' ? 'accent' : 'neutral'}>{d.doc_type === 'id' ? 'Government ID' : d.doc_type === 'qualification' ? 'Qualification' : 'Other'}</Badge> <span className="small">{d.label}</span></span>
              {d.url && <a className="small" href={d.url} target="_blank" rel="noreferrer">Open ↗</a>}
            </div>
            {isImage && d.url && <div className="doc"><img src={d.url} alt={d.label} /></div>}
          </div>
        );
      })}
    </div>
  );
}
