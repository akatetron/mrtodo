import React from 'react';
import { supabase } from '../lib/supabase';
import { useLive, q } from '../lib/useLive';
import { ErrorBox } from '../components/ui';

export default function Operations(_props: any) {
  const { data: ops, error } = useLive(() => q(supabase.rpc('ops_summary')), ['ops_events', 'escalations', 'outbox'], []);
  const { data: gold } = useLive(() => q(supabase.rpc('gold_overview')), ['profiles'], []);
  const list = (o: any): [string, any][] => Object.entries(o || {});
  return (
    <>
      <div className="page-head"><div><h1>Operations</h1><p>Routing, notifications, payment webhooks and Gold Tier. Numbers come from the database.</p></div></div>
      <ErrorBox>{error}</ErrorBox>
      {ops && (
        <div className="stack">
          <div className="row">
            <div className="card" style={ops.open_escalations ? { border: '2px solid #C0392B' } : null}><div className="label">Open escalations</div><h2>{ops.open_escalations}</h2></div>
            <div className="card" style={ops.unassigned_over_sla ? { border: '2px solid #C9963B' } : null}><div className="label">Waiting over the SLA</div><h2>{ops.unassigned_over_sla}</h2></div>
          </div>
          <div className="card stack"><h3>Last 24 hours</h3>{list(ops.events_24h).length ? list(ops.events_24h).map(([k, n]) => <div key={k}>{k}: {n}</div>) : <div className="muted">Nothing logged.</div>}</div>
          <div className="card stack"><h3>Notification delivery</h3>{list(ops.outbox).length ? list(ops.outbox).map(([k, n]) => <div key={k}>{k}: {n}</div>) : <div className="muted">Nothing queued.</div>}</div>
          <div className="card stack"><h3>Payment webhooks (24h)</h3>{list(ops.webhooks_24h).length ? list(ops.webhooks_24h).map(([k, n]) => <div key={k}>{k}: {n}</div>) : <div className="muted">None received.</div>}</div>
        </div>
      )}
      <div className="card stack" style={{ marginTop: 16 }}>
        <h3>Gold Tier Personal Managers</h3>
        {(gold || []).map((g) => <div key={g.id}>{g.full_name} · {g.verified_jobs} jobs · ★ {g.rating ? Number(g.rating).toFixed(1) : '—'} ({g.rating_count})</div>)}
        {gold && !gold.length && <div className="muted">None yet. Gold needs more than 50 verified jobs and an average rating above 4.8.</div>}
      </div>
    </>
  );
}
