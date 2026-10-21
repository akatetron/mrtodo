import React from 'react';
import { supabase } from '../lib/supabase';
import { useLive, q } from '../lib/useLive';
import { CATEGORIES, money, when, PM_SHARE } from '../lib/constants';
import { ErrorBox, Badge } from '../components/ui';

const DAY = 24 * 60 * 60 * 1000;

function taskValue(t, visits) {
  if (t.task_type === 'ongoing') return Number(t.rate_per_day || 0) * (visits[t.id] || 0);
  return Number(t.est_cost || 0);
}

export default function Overview({ go }: { go: (id: string, sub?: string) => void }) {
  const { data, error } = useLive(async () => {
    const since30 = new Date(Date.now() - 30 * DAY).toISOString();
    const [tasks, pms, visits, recent] = await Promise.all([
      q(supabase.from('tasks').select('id, status, category, task_type, est_cost, rate_per_day, created_at, completed_at').gte('created_at', since30).limit(5000)),
      q(supabase.from('profiles').select('id, worker_status, online').eq('role', 'worker')),
      q(supabase.from('task_visits').select('task_id').gte('created_at', since30).limit(10000)),
      q(supabase.from('audit_log').select('*, actor:actor_id(full_name)').order('created_at', { ascending: false }).limit(8)),
    ]);
    // Open tasks older than 30 days still need attention, so fetch them too.
    const open = await q(supabase.from('tasks').select('id, status, created_at').in('status', ['requested', 'matched', 'assigned', 'in_progress']));
    return { tasks, pms, visits, recent, open };
  }, ['tasks', 'profiles', 'audit_log']);

  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!data) return <div className="empty">Loading…</div>;

  const visitCount = {};
  data.visits.forEach((v) => { visitCount[v.task_id] = (visitCount[v.task_id] || 0) + 1; });
  const queue = data.open.filter((t) => t.status === 'requested');
  const oldest = queue.reduce((m, t) => (!m || t.created_at < m ? t.created_at : m), null);
  const offered = data.open.filter((t) => t.status === 'matched').length;
  const active = data.open.filter((t) => ['assigned', 'in_progress'].includes(t.status)).length;
  const done7 = data.tasks.filter((t) => t.status === 'completed' && t.completed_at && Date.now() - new Date(t.completed_at).getTime() < 7 * DAY);
  const gmv7 = done7.reduce((s, t) => s + taskValue(t, visitCount), 0);
  const pending = data.pms.filter((p) => p.worker_status === 'pending').length;
  const approved = data.pms.filter((p) => p.worker_status === 'approved');
  const byCat = CATEGORIES.map((c) => ({ ...c, n: data.tasks.filter((t) => t.category === c.id).length }));
  const maxCat = Math.max(1, ...byCat.map((c) => c.n));
  const completed30 = data.tasks.filter((t) => t.status === 'completed').length;
  const cancelled30 = data.tasks.filter((t) => t.status === 'cancelled').length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Overview</h1>
          <p>What needs you right now, and how the last 30 days went.</p>
        </div>
      </div>

      <div className="grid stats">
        <Stat label="Tasks waiting for a PM" value={queue.length} sub={oldest ? `oldest posted ${when(oldest)}` : 'queue is clear'} onClick={() => go('tasks')} alert={queue.length > 0} />
        <Stat label="Offered, awaiting PM" value={offered} sub="PM hasn't accepted yet" onClick={() => go('tasks')} />
        <Stat label="Active tasks" value={active} sub="accepted or in progress" />
        <Stat label="Applications to review" value={pending} sub={`${approved.length} PMs approved · ${approved.filter((p) => p.online).length} available`} onClick={() => go('applications')} alert={pending > 0} />
      </div>
      <div className="grid stats">
        <Stat label="Completed (7 days)" value={done7.length} />
        <Stat label="Job value (7 days)" value={money(gmv7)} sub="estimated, from task prices" />
        <Stat label="Platform share (7 days)" value={money(Math.round(gmv7 * (1 - PM_SHARE)))} sub={`${Math.round((1 - PM_SHARE) * 100)}% of job value`} />
        <Stat label="Last 30 days" value={data.tasks.length} sub={`posted · ${completed30} done · ${cancelled30} cancelled`} />
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
        <div className="card stack">
          <h3>Demand by category (30 days)</h3>
          {byCat.map((c) => (
            <div key={c.id} className="row" style={{ flexWrap: 'nowrap' }}>
              <span style={{ width: 130 }}>{c.emoji} {c.label}</span>
              <div style={{ flex: 1, background: 'var(--surface-alt)', borderRadius: 6, height: 12 }}>
                <div style={{ width: `${(c.n / maxCat) * 100}%`, background: 'var(--teal)', height: 12, borderRadius: 6 }} />
              </div>
              <strong style={{ width: 28, textAlign: 'right' }}>{c.n}</strong>
            </div>
          ))}
        </div>
        <div className="card stack">
          <div className="row spread"><h3>Latest activity</h3><button className="btn ghost sm" onClick={() => go('audit')}>Full log</button></div>
          {data.recent.map((e) => (
            <div key={e.id} className="small">
              <span className="faint">{when(e.created_at)}</span> · <Badge tone="accent">{e.action}</Badge>{' '}
              {e.details?.title || e.details?.name || ''} <span className="muted">{e.actor?.full_name ? `by ${e.actor.full_name}` : ''}</span>
            </div>
          ))}
          {!data.recent.length && <div className="faint">Nothing yet.</div>}
        </div>
      </div>
    </>
  );
}

function Stat({ label, value, sub, onClick, alert }: { label: string; value: any; sub?: string; onClick?: () => void; alert?: boolean }) {
  return (
    <div className="card" onClick={onClick} style={{ cursor: onClick ? 'pointer' : 'default', borderColor: alert ? 'var(--brass)' : undefined }}>
      <div className="stat-label">{label}</div>
      <div className="stat-val" style={{ color: alert ? 'var(--brass-dark)' : undefined }}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}
