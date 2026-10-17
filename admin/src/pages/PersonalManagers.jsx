import React, { useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useLive, q } from '../lib/useLive';
import { PROFILE_COLUMNS, PM_STATUS, CATEGORIES, catMeta, rating, when } from '../lib/constants';
import { Badge, ErrorBox, useAction } from '../components/ui';

export default function PersonalManagers() {
  const [cat, setCat] = useState('all');
  const [search, setSearch] = useState('');
  const { data, error } = useLive(async () => {
    const [pms, active] = await Promise.all([
      q(supabase.from('profiles').select(PROFILE_COLUMNS).eq('role', 'worker').in('worker_status', ['approved', 'suspended']).order('full_name')),
      q(supabase.from('tasks').select('assigned_worker_id').in('status', ['matched', 'assigned', 'in_progress'])),
    ]);
    const load = {};
    active.forEach((t) => { load[t.assigned_worker_id] = (load[t.assigned_worker_id] || 0) + 1; });
    return pms.map((p) => ({ ...p, active: load[p.id] || 0 }));
  }, ['profiles', 'tasks']);

  const list = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (data || [])
      .filter((p) => cat === 'all' || (p.categories || []).includes(cat))
      .filter((p) => !s || [p.full_name, p.service_area].some((v) => v && v.toLowerCase().includes(s)));
  }, [data, cat, search]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Personal Managers</h1>
          <p>{data ? `${data.filter((p) => p.worker_status === 'approved').length} approved · ${data.filter((p) => p.worker_status === 'approved' && p.online).length} available now` : ' '}</p>
        </div>
        <input className="field" style={{ maxWidth: 260 }} placeholder="Search name or area…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className="tabs">
        <button className={`tab ${cat === 'all' ? 'active' : ''}`} onClick={() => setCat('all')}>All skills</button>
        {CATEGORIES.map((c) => (
          <button key={c.id} className={`tab ${cat === c.id ? 'active' : ''}`} onClick={() => setCat(c.id)}>{c.emoji} {c.label}</button>
        ))}
      </div>
      <ErrorBox>{error}</ErrorBox>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Skills</th><th>Area</th><th>Rating</th><th>Jobs</th><th>Now</th><th>Status</th><th /></tr></thead>
          <tbody>{list.map((p) => <PmRow key={p.id} p={p} />)}</tbody>
        </table>
        {data && !list.length && <div className="empty">No Personal Managers match.</div>}
        {!data && !error && <div className="empty">Loading…</div>}
      </div>
    </>
  );
}

function PmRow({ p }) {
  const [run, busy, error] = useAction();
  const st = PM_STATUS[p.worker_status];
  function toggle() {
    if (p.worker_status === 'approved') {
      const note = window.prompt(`Suspend ${p.full_name}? They will stop receiving tasks. Reason (shown to them):`);
      if (note === null) return;
      run(() => q(supabase.rpc('review_pm_application', { p_worker: p.id, p_decision: 'suspended', p_note: note || null })));
    } else {
      run(() => q(supabase.rpc('review_pm_application', { p_worker: p.id, p_decision: 'approved', p_note: null })));
    }
  }
  return (
    <tr>
      <td><div className="t-title">{p.full_name}</div><div className="faint small">since {when(p.reviewed_at || p.created_at)}</div></td>
      <td>{(p.categories || []).map((c) => <span key={c} title={catMeta(c).label}>{catMeta(c).emoji} </span>)}</td>
      <td>{p.service_area || '—'}</td>
      <td>{rating(p.rating, p.rating_count)}</td>
      <td>{p.jobs_done || 0}</td>
      <td>
        {p.worker_status === 'approved' && (p.online ? <Badge tone="success">Available</Badge> : <Badge>Off</Badge>)}
        {p.active > 0 && <div className="faint small" style={{ marginTop: 4 }}>{p.active} active task{p.active > 1 ? 's' : ''}</div>}
      </td>
      <td><Badge tone={st.tone}>{st.label}</Badge></td>
      <td>
        <button className={`btn sm ${p.worker_status === 'approved' ? 'danger' : ''}`} disabled={busy} onClick={toggle}>
          {p.worker_status === 'approved' ? 'Suspend' : 'Reinstate'}
        </button>
        {error && <div className="error small" style={{ marginTop: 6 }}>{error}</div>}
      </td>
    </tr>
  );
}
