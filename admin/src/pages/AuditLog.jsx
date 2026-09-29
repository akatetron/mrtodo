import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useLive, q } from '../lib/useLive';
import { shortId } from '../lib/constants';
import { Badge, ErrorBox } from '../components/ui';

const GROUPS = [
  { id: 'all', label: 'Everything', prefix: '' },
  { id: 'task', label: 'Tasks', prefix: 'task.' },
  { id: 'pm', label: 'PM verification', prefix: 'pm.' },
];

const TONE = { completed: 'success', approved: 'success', cancelled: 'danger', rejected: 'danger', suspended: 'danger', declined: 'brass', wrong_code: 'brass', more_info: 'brass' };

export default function AuditLog({ go }) {
  const [group, setGroup] = useState('all');
  const [limit, setLimit] = useState(100);
  const prefix = GROUPS.find((g) => g.id === group).prefix;
  const { data, error } = useLive(() => {
    let query = supabase.from('audit_log').select('*, actor:actor_id(full_name, role)').order('created_at', { ascending: false }).limit(limit);
    if (prefix) query = query.like('action', `${prefix}%`);
    return q(query);
  }, ['audit_log'], [prefix, limit]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Audit log</h1>
          <p>A permanent, timestamped record of every action on the platform. Entries can't be edited or deleted from the app.</p>
        </div>
      </div>
      <div className="tabs">
        {GROUPS.map((g) => <button key={g.id} className={`tab ${group === g.id ? 'active' : ''}`} onClick={() => setGroup(g.id)}>{g.label}</button>)}
      </div>
      <ErrorBox>{error}</ErrorBox>
      <div className="table-wrap">
        <table>
          <thead><tr><th>When</th><th>Who</th><th>Action</th><th>About</th><th>Details</th></tr></thead>
          <tbody>
            {(data || []).map((e) => {
              const verb = e.action.split('.')[1];
              return (
                <tr key={e.id}>
                  <td className="small muted" style={{ whiteSpace: 'nowrap' }}>{new Date(e.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', second: '2-digit' })}</td>
                  <td>{e.actor?.full_name || <span className="faint">system</span>}{e.actor?.role === 'admin' && <span className="faint small"> · admin</span>}</td>
                  <td><Badge tone={TONE[verb] || 'accent'}>{e.action}</Badge></td>
                  <td>
                    {e.entity === 'task'
                      ? <a href={`#tasks/${e.entity_id}`} onClick={(ev) => { ev.preventDefault(); go('tasks', e.entity_id); }}>{e.details?.title || shortId(e.entity_id)}</a>
                      : <span>{e.details?.name || shortId(e.entity_id)}</span>}
                  </td>
                  <td className="small muted">{describe(e.details)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {data && !data.length && <div className="empty">No entries yet.</div>}
        {!data && !error && <div className="empty">Loading…</div>}
      </div>
      {data?.length === limit && <button className="btn ghost" style={{ marginTop: 12 }} onClick={() => setLimit((l) => l + 200)}>Load older entries</button>}
    </>
  );
}

function describe(d) {
  if (!d) return '';
  const parts = [];
  if (d.worker_name) parts.push(`→ ${d.worker_name}`);
  if (d.from) parts.push(`was ${d.from}`);
  if (d.rating) parts.push(`${d.rating}★`);
  if (d.categories) parts.push(d.categories.join(', '));
  if (d.attempt) parts.push(`attempt ${d.attempt}/5`);
  if (d.reason) parts.push(`“${d.reason}”`);
  if (d.note) parts.push(`“${d.note}”`);
  return parts.join(' · ');
}
