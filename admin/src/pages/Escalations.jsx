import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useLive, q } from '../lib/useLive';
import { Badge, ErrorBox, useAction } from '../components/ui';
import { shortId, when } from '../lib/constants';

export default function Escalations() {
  const { data, error } = useLive(
    () => q(supabase.from('escalations').select('*, task:task_id(id, title, location, scheduled_at, status)').order('created_at', { ascending: false }).limit(100)),
    ['escalations', 'tasks'], [],
  );
  const [notes, setNotes] = useState({});
  const [run, busy, actionError] = useAction();
  const rows = [...(data || [])].sort((a, b) => (a.status === b.status ? 0 : a.status === 'open' ? -1 : 1));
  return (
    <>
      <div className="page-head"><div><h1>Escalations</h1><p>Customers who said their Personal Manager is late.</p></div></div>
      <ErrorBox>{error || actionError}</ErrorBox>
      <div className="stack">
        {data && !rows.length && <div className="card empty">No escalations.</div>}
        {rows.map((e) => (
          <div key={e.id} className={`card stack ${e.status === 'open' ? 'sla-red-card' : ''}`} style={e.status === 'open' ? { border: '3px solid #C0392B' } : null}>
            <div className="row">
              <Badge tone={e.status === 'open' ? 'danger' : 'success'}>{e.status === 'open' ? 'Escalated' : 'Resolved'}</Badge>
              <span className="small muted">{when(e.created_at)} · {e.minutes_late} min late when raised</span>
            </div>
            <strong>{shortId(e.task_id)} · {e.task?.title}</strong>
            <div className="small muted">Scheduled {e.task?.scheduled_at ? new Date(e.task.scheduled_at).toLocaleString() : '—'} · task is {e.task?.status}</div>
            {e.reason && <div>Customer says: “{e.reason}”</div>}
            {e.status === 'resolved' && <div>Resolution: {e.resolution}</div>}
            {e.status === 'open' && (
              <>
                <input className="field" placeholder="What did you do? (required)" value={notes[e.id] || ''} onChange={(ev) => setNotes({ ...notes, [e.id]: ev.target.value })} />
                <div className="row">
                  <button className="btn" disabled={busy} onClick={() => run(() => q(supabase.rpc('resolve_escalation', { p_escalation: e.id, p_resolution: notes[e.id] || '' })))}>Mark resolved</button>
                  {e.task?.status === 'assigned' && <button className="btn danger" disabled={busy} onClick={() => run(() => q(supabase.rpc('unassign_task', { p_task: e.task_id, p_reason: notes[e.id] || '' })))}>Take the task back</button>}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
