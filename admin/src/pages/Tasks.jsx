import React, { useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useLive, q } from '../lib/useLive';
import { TASK_STATUS, catMeta, shortId, money, when, rating, PM_SHARE } from '../lib/constants';
import { Badge, Avatar, ErrorBox, useAction } from '../components/ui';

const FILTERS = [
  { id: 'queue', label: 'Needs a PM', match: (t) => t.status === 'requested' },
  { id: 'offered', label: 'Offered', match: (t) => t.status === 'matched' },
  { id: 'active', label: 'Active', match: (t) => ['assigned', 'in_progress'].includes(t.status) },
  { id: 'completed', label: 'Completed', match: (t) => t.status === 'completed' },
  { id: 'cancelled', label: 'Cancelled', match: (t) => t.status === 'cancelled' },
  { id: 'all', label: 'All', match: () => true },
];

const TASK_SELECT = '*, customer:customer_id(id, full_name, phone, email, rating, rating_count), worker:assigned_worker_id(id, full_name, phone, rating, rating_count)';

export default function Tasks() {
  const initialSel = window.location.hash.split('/')[1] || null;
  const [filter, setFilter] = useState(initialSel ? 'all' : 'queue');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(initialSel);

  const { data: tasks, error } = useLive(
    () => q(supabase.from('tasks').select(TASK_SELECT).order('created_at', { ascending: false }).limit(500)),
    ['tasks'],
  );

  const f = FILTERS.find((x) => x.id === filter);
  const list = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (tasks || []).filter(f.match).filter((t) => !s
      || [t.title, t.location, t.customer?.full_name, t.worker?.full_name, shortId(t.id)].some((v) => v && v.toLowerCase().includes(s)));
  }, [tasks, f, search]);
  // Oldest first for the queue so nobody waits longest.
  const ordered = filter === 'queue' ? [...list].reverse() : list;
  const selected = (tasks || []).find((t) => t.id === selectedId) || null;

  function select(id) {
    setSelectedId(id);
    window.history.replaceState(null, '', `#tasks/${id}`);
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Task queue</h1>
          <p>Pick a task, review the suggested Personal Managers, assign one. Updates live.</p>
        </div>
        <input className="field" style={{ maxWidth: 280 }} placeholder="Search title, area, person, MT-…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className="tabs">
        {FILTERS.map((x) => (
          <button key={x.id} className={`tab ${filter === x.id ? 'active' : ''}`} onClick={() => setFilter(x.id)}>
            {x.label} {tasks ? `· ${tasks.filter(x.match).length}` : ''}
          </button>
        ))}
      </div>
      <ErrorBox>{error}</ErrorBox>

      <div className="split">
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Task</th><th>Customer</th><th>Where / when</th><th>Value</th><th>Status</th><th>Posted</th></tr>
            </thead>
            <tbody>
              {ordered.map((t) => (
                <tr key={t.id} className={`clickable ${t.id === selectedId ? 'selected' : ''}`} onClick={() => select(t.id)}>
                  <td>
                    <div className="t-title">{catMeta(t.category).emoji} {t.title}</div>
                    <div className="faint small">{shortId(t.id)} · {catMeta(t.category).label}{t.task_type === 'ongoing' ? ' · ongoing' : ''}</div>
                  </td>
                  <td>{t.customer?.full_name}</td>
                  <td><div>{t.location}</div><div className="faint small">{t.scheduled_for || 'Flexible'}</div></td>
                  <td>{t.task_type === 'ongoing' ? `${money(t.rate_per_day)}/day` : money(t.est_cost)}</td>
                  <td>
                    <Badge tone={TASK_STATUS[t.status].tone}>{TASK_STATUS[t.status].label}</Badge>
                    {t.worker && <div className="faint small" style={{ marginTop: 4 }}>{t.worker.full_name}</div>}
                  </td>
                  <td className="small muted">{when(t.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {tasks && !ordered.length && <div className="empty">{filter === 'queue' ? 'Queue is clear — every task has a Personal Manager. 🎉' : 'No tasks here.'}</div>}
          {!tasks && !error && <div className="empty">Loading…</div>}
        </div>

        <div className="panel">
          {selected ? <TaskDetail key={selected.id} t={selected} /> : <div className="card empty">Select a task to see details and assign a Personal Manager.</div>}
        </div>
      </div>
    </>
  );
}

function TaskDetail({ t }) {
  const st = TASK_STATUS[t.status];
  const canAssign = ['requested', 'matched'].includes(t.status);
  const value = t.task_type === 'ongoing' ? `${money(t.rate_per_day)}/day` : money(t.est_cost);

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="card stack">
        <div className="row spread">
          <span className="faint small">{shortId(t.id)}</span>
          <Badge tone={st.tone}>{st.label}</Badge>
        </div>
        <h2>{catMeta(t.category).emoji} {t.title}</h2>
        {t.description && <div className="muted">{t.description}</div>}
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <Info label="Where" value={t.location} />
          <Info label="When" value={t.scheduled_for || 'Flexible'} />
          <Info label="Value" value={value} sub={t.est_cost || t.rate_per_day ? `PM earns ${money(Math.round((t.est_cost || t.rate_per_day) * PM_SHARE))}${t.task_type === 'ongoing' ? '/day' : ''}` : null} />
          <Info label="Type" value={t.task_type === 'ongoing' ? 'Ongoing (multi-visit)' : 'One-time'} />
        </div>
        <div className="doc">
          <Avatar name={t.customer?.full_name} />
          <div style={{ flex: 1 }}>
            <div><strong>{t.customer?.full_name}</strong> <span className="faint small">{rating(t.customer?.rating, t.customer?.rating_count)}</span></div>
            <div className="small muted">{[t.customer?.phone, t.customer?.email].filter(Boolean).join(' · ')}</div>
          </div>
        </div>
        {t.for_whom === 'other' && (
          <div className="small muted">
            <strong>Booked for:</strong> {t.recipient_name}{t.recipient_relation ? ` (${t.recipient_relation})` : ''}{t.recipient_phone ? ` · ${t.recipient_phone}` : ''}
          </div>
        )}
        {t.status === 'cancelled' && t.cancel_reason && <div className="small muted"><strong>Cancel reason:</strong> {t.cancel_reason}</div>}
        {t.status === 'completed' && t.customer_rating_of_worker != null && (
          <div className="small muted"><strong>Customer rated PM:</strong> {'★'.repeat(t.customer_rating_of_worker)} {t.customer_review ? `“${t.customer_review}”` : ''}</div>
        )}
      </div>

      {t.worker && !canAssign && (
        <div className="card row">
          <Avatar name={t.worker.full_name} />
          <div style={{ flex: 1 }}>
            <div className="label">Personal Manager</div>
            <strong>{t.worker.full_name}</strong> <span className="faint small">{rating(t.worker.rating, t.worker.rating_count)}</span>
            <div className="small muted">{t.worker.phone}</div>
          </div>
        </div>
      )}

      {canAssign && <Shortlist t={t} />}
      {['assigned', 'in_progress'].includes(t.status) && <AdminComplete t={t} />}
      {!['completed', 'cancelled'].includes(t.status) && <CancelBox t={t} />}
      <History taskId={t.id} />
    </div>
  );
}

function Info({ label, value, sub }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div style={{ fontWeight: 600 }}>{value}</div>
      {sub && <div className="faint small">{sub}</div>}
    </div>
  );
}

function Shortlist({ t }) {
  const [showAll, setShowAll] = useState(false);
  const [run, busy, actionError] = useAction();
  const { data: candidates, error } = useLive(
    () => q(supabase.rpc('shortlist_workers', { p_task: t.id })),
    ['profiles', 'tasks'], [t.id],
  );
  const shown = (candidates || []).slice(0, showAll ? undefined : 6);

  return (
    <div className="card stack">
      <div className="row spread">
        <h3>{t.status === 'matched' ? 'Reassign to someone else' : 'Suggested Personal Managers'}</h3>
        <span className="faint small">ranked by skill, availability, area, rating</span>
      </div>
      {t.status === 'matched' && (
        <div className="small muted">Offered to <strong>{t.worker?.full_name}</strong> {when(t.assigned_at)} — waiting for them to accept.</div>
      )}
      <ErrorBox>{error || actionError}</ErrorBox>
      {!candidates && !error && <div className="faint">Loading…</div>}
      {candidates && !candidates.length && <div className="faint">No approved Personal Managers yet. Approve applicants under Applications.</div>}
      {shown.map((w, i) => {
        const isCurrent = w.id === t.assigned_worker_id;
        return (
          <div key={w.id} className={`candidate ${i === 0 && w.category_match && !isCurrent ? 'top' : ''}`}>
            <Avatar name={w.full_name} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div><strong>{w.full_name}</strong> <span className="faint small">{rating(w.rating, w.rating_count)} · {w.jobs_done || 0} jobs</span></div>
              <div className="row" style={{ gap: 4, marginTop: 4 }}>
                {w.category_match ? <Badge tone="success">✓ {catMeta(t.category).label}</Badge> : <Badge tone="danger">No {catMeta(t.category).label} skill</Badge>}
                {w.area_match && <Badge tone="success">📍 {w.service_area}</Badge>}
                {!w.area_match && w.service_area && <Badge>📍 {w.service_area}</Badge>}
                {!w.online && <Badge tone="brass">Unavailable</Badge>}
                {w.declined && <Badge tone="danger">Declined this</Badge>}
                {w.active_jobs > 0 && <Badge>{w.active_jobs} active</Badge>}
              </div>
            </div>
            {isCurrent
              ? <Badge tone="accent">Offered</Badge>
              : <button className="btn sm" disabled={busy} onClick={() => run(() => q(supabase.rpc('assign_task', { p_task: t.id, p_worker: w.id })))}>Assign</button>}
          </div>
        );
      })}
      {candidates && candidates.length > 6 && (
        <button className="btn ghost sm" onClick={() => setShowAll((v) => !v)}>{showAll ? 'Show fewer' : `Show all ${candidates.length}`}</button>
      )}
    </div>
  );
}

function AdminComplete({ t }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [run, busy, error] = useAction();
  if (!open) return <button className="btn ghost" onClick={() => setOpen(true)}>Mark completed without code…</button>;
  return (
    <div className="card stack">
      <h3>Complete without the customer's code</h3>
      <div className="small muted">Use when the customer confirmed another way (e.g. by phone) or the PM got locked out after wrong codes. This is logged.</div>
      <textarea className="field" placeholder="How was completion confirmed?" value={note} onChange={(e) => setNote(e.target.value)} />
      <ErrorBox>{error}</ErrorBox>
      <div className="row">
        <button className="btn ghost" onClick={() => setOpen(false)}>Back</button>
        <button className="btn" disabled={busy || !note.trim()} onClick={() => run(() => q(supabase.rpc('admin_complete_task', { p_task: t.id, p_note: note.trim() })))}>Mark completed</button>
      </div>
    </div>
  );
}

function CancelBox({ t }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [run, busy, error] = useAction();
  if (!open) return <button className="btn danger" onClick={() => setOpen(true)}>Cancel task…</button>;
  return (
    <div className="card stack" style={{ borderColor: 'var(--danger)' }}>
      <h3>Cancel this task?</h3>
      <textarea className="field" placeholder="Reason (shown to the customer)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <ErrorBox>{error}</ErrorBox>
      <div className="row">
        <button className="btn ghost" onClick={() => setOpen(false)}>Keep it</button>
        <button className="btn danger" disabled={busy} onClick={() => run(() => q(supabase.rpc('cancel_task', { p_task: t.id, p_reason: reason.trim() || null })))}>Cancel task</button>
      </div>
    </div>
  );
}

const ACTION_LABEL = {
  'task.created': 'Posted by customer',
  'task.assigned': 'Assigned',
  'task.reassigned': 'Reassigned',
  'task.accepted': 'Accepted by PM',
  'task.declined': 'Declined by PM',
  'task.started': 'Work started',
  'task.visit_logged': 'Visit logged',
  'task.wrong_code': 'Wrong completion code entered',
  'task.completed': 'Completed with code',
  'task.completed_by_admin': 'Completed by admin',
  'task.cancelled': 'Cancelled',
  'task.rated': 'Rated',
};

function History({ taskId }) {
  const { data } = useLive(
    () => q(supabase.from('audit_log').select('*, actor:actor_id(full_name)').eq('entity_id', taskId).order('created_at')),
    ['audit_log'], [taskId],
  );
  if (!data?.length) return null;
  return (
    <div className="card stack">
      <h3>History</h3>
      {data.map((e) => (
        <div key={e.id} className="small">
          <span className="faint">{when(e.created_at)}</span> · <strong>{ACTION_LABEL[e.action] || e.action}</strong>
          {e.details?.worker_name ? ` → ${e.details.worker_name}` : ''}
          {e.actor?.full_name ? <span className="muted"> by {e.actor.full_name}</span> : ''}
          {e.details?.reason ? <span className="muted"> — “{e.details.reason}”</span> : ''}
          {e.details?.note ? <span className="muted"> — “{e.details.note}”</span> : ''}
        </div>
      ))}
    </div>
  );
}
