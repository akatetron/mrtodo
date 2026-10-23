import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useLive, q } from '../lib/useLive';
import { Badge, ErrorBox, Field, useAction } from '../components/ui';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const blank = { code: '', name: '', country: '', currency: '', minor_units: '2', timezone: '', status: 'draft', payments_enabled: false, allow_outside_hours_requests: true };

// Regions decide currency, time zone and opening hours. Nothing is pre-filled: you decide where Mr. Todo operates.
export default function Regions({ profile }: { profile: any }) {
  const superAdmin = (profile?.admin_level || 'super') === 'super';
  const { data: regions, reload } = useLive(() => q(supabase.from('regions').select('*').order('code')), ['regions'], []);
  const { data: hours, reload: reloadHours } = useLive(() => q(supabase.from('region_hours').select('*')), ['region_hours'], []);
  const { data: exceptions, reload: reloadEx } = useLive(() => q(supabase.from('region_exceptions').select('*').order('on_date', { ascending: false })), ['region_exceptions'], []);
  const { data: settings, reload: reloadSettings } = useLive(() => q(supabase.from('platform_settings').select('key, value').in('key', ['operating_start', 'operating_end', 'default_timezone'])), ['platform_settings'], []);
  const [f, setF] = useState<any>(null);
  const [sel, setSel] = useState('');
  const [rows, setRows] = useState<any[] | null>(null);
  const [ex, setEx] = useState<any>({ region_code: '', on_date: '', closed: true, open: '', close: '', reason: '' });
  const [def, setDef] = useState<any>(null);
  const [run, busy, error] = useAction();
  const [msg, setMsg] = useState('');
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const setting = (k: string) => (settings || []).find((s: any) => s.key === k)?.value;
  const dflt = def || { start: setting('operating_start') || '06:00', end: setting('operating_end') || '20:00', tz: setting('default_timezone') || 'UTC' };
  const zones: string[] = (Intl as any).supportedValuesOf ? (Intl as any).supportedValuesOf('timeZone') : [];

  const save = () => run(async () => {
    await q(supabase.rpc('save_region', { p: { ...f, minor_units: Number(f.minor_units) } }));
    setMsg(`Saved ${f.code}.`); setF(null); reload();
  });
  const chooseHours = (code: string) => {
    setSel(code);
    const mine = (hours || []).filter((h: any) => h.region_code === code);
    setRows(DAYS.map((_, d) => { const h = mine.find((x: any) => x.weekday === d); return { weekday: d, custom: !!h, closed: h?.closed ?? false, open: h?.open_time?.slice(0, 5) || dflt.start, close: h?.close_time?.slice(0, 5) || dflt.end }; }));
  };
  const saveHours = () => run(async () => {
    await q(supabase.rpc('save_region_hours', { p_region: sel, p_rows: (rows || []).filter((r) => r.custom).map((r) => ({ weekday: r.weekday, closed: r.closed, open: r.closed ? null : r.open, close: r.closed ? null : r.close })) }));
    setMsg(`Hours saved for ${sel}.`); reloadHours();
  });
  const saveDefaults = () => run(async () => {
    await q(supabase.rpc('set_setting', { p_key: 'operating_start', p_value: dflt.start }));
    await q(supabase.rpc('set_setting', { p_key: 'operating_end', p_value: dflt.end }));
    await q(supabase.rpc('set_setting', { p_key: 'default_timezone', p_value: dflt.tz }));
    setMsg('Default window saved.'); setDef(null); reloadSettings();
  });
  const addEx = () => run(async () => {
    await q(supabase.rpc('save_hours_exception', { p: { ...ex, region_code: ex.region_code || null, open: ex.closed ? null : ex.open, close: ex.closed ? null : ex.close } }));
    setEx({ region_code: '', on_date: '', closed: true, open: '', close: '', reason: '' }); setMsg('Closure saved.'); reloadEx();
  });

  return (
    <>
      <div className="page-head"><div><h1>Regions and hours</h1><p>Each region has one currency and one time zone. Opening hours are the platform’s: a Personal Manager’s own hours can only narrow them.</p></div>
        {superAdmin && <button className="btn" onClick={() => setF({ ...blank })}>Add a region</button>}</div>
      <ErrorBox>{error}</ErrorBox>
      {msg && <div className="card small" role="status">{msg}</div>}
      {!superAdmin && <div className="card small muted">Only a super admin can change regions and hours.</div>}

      {f && (
        <div className="card stack">
          <h2>{regions?.some((r: any) => r.code === f.code) ? `Edit ${f.code}` : 'New region'}</h2>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <Field label="Code (for example IN-MH)"><input className="field" value={f.code} onChange={set('code')} disabled={regions?.some((r: any) => r.code === f.code)} /></Field>
            <Field label="Name customers see"><input className="field" value={f.name} onChange={set('name')} /></Field>
            <Field label="Country (2 letters, optional)"><input className="field" maxLength={2} value={f.country || ''} onChange={set('country')} /></Field>
            <Field label="Currency (ISO 4217, for example INR)"><input className="field" maxLength={3} value={f.currency} onChange={set('currency')} /></Field>
            <Field label="Decimal places in this currency"><input className="field" inputMode="numeric" value={f.minor_units} onChange={set('minor_units')} /></Field>
            <Field label="Time zone (IANA name)"><input className="field" list="tz" value={f.timezone} onChange={set('timezone')} /><datalist id="tz">{zones.map((z) => <option key={z} value={z} />)}</datalist></Field>
            <Field label="Status"><select className="field" value={f.status} onChange={set('status')}><option value="draft">Draft: not bookable</option><option value="active">Active: customers can book</option><option value="paused">Paused</option></select></Field>
          </div>
          <label className="row"><input type="checkbox" checked={f.allow_outside_hours_requests} onChange={set('allow_outside_hours_requests')} style={{ width: 24, height: 24 }} /> Customers may send a request outside operating hours, for a time inside them</label>
          <label className="row"><input type="checkbox" checked={f.payments_enabled} onChange={set('payments_enabled')} style={{ width: 24, height: 24 }} /> Our payment account accepts this currency</label>
          <div className="small muted">Only tick the payment box after confirming it with the payment provider. Ticking it does not change what the provider supports.</div>
          <div className="row"><button className="btn" disabled={busy} onClick={save}>Save region</button><button className="btn ghost" onClick={() => setF(null)}>Cancel</button></div>
        </div>
      )}

      <div className="table-wrap" style={{ marginTop: 16 }}>
        <table><thead><tr><th>Region</th><th>Currency</th><th>Time zone</th><th>Status</th><th>Payments</th><th /></tr></thead>
          <tbody>{(regions || []).map((r: any) => (
            <tr key={r.code}><td><strong>{r.code}</strong> {r.name}</td><td>{r.currency}</td><td>{r.timezone}</td>
              <td><Badge tone={r.status === 'active' ? 'success' : r.status === 'paused' ? 'danger' : 'brass'}>{r.status}</Badge></td>
              <td>{r.payments_enabled ? 'Enabled' : <span className="muted">Not confirmed</span>}</td>
              <td className="row">{superAdmin && <button className="btn sm" onClick={() => setF({ ...r, minor_units: String(r.minor_units) })}>Edit</button>}<button className="btn sm ghost" onClick={() => chooseHours(r.code)}>Hours</button></td></tr>))}
            {regions && !regions.length && <tr><td colSpan={6} className="muted">No regions yet. Bookings work as before until you add one.</td></tr>}</tbody></table>
      </div>

      <div className="card stack" style={{ marginTop: 16 }}>
        <h2>Default operating window</h2>
        <p className="small muted">Used wherever a region has no hours of its own. Local time of the region (or of the default zone for a task with no region).</p>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
          <Field label="Opens"><input className="field" value={dflt.start} disabled={!superAdmin} onChange={(e) => setDef({ ...dflt, start: e.target.value })} /></Field>
          <Field label="Closes"><input className="field" value={dflt.end} disabled={!superAdmin} onChange={(e) => setDef({ ...dflt, end: e.target.value })} /></Field>
          <Field label="Default time zone"><input className="field" list="tz" value={dflt.tz} disabled={!superAdmin} onChange={(e) => setDef({ ...dflt, tz: e.target.value })} /></Field>
        </div>
        {superAdmin && <button className="btn" disabled={busy} onClick={saveDefaults}>Save default window</button>}
      </div>

      {sel && rows && (
        <div className="card stack" style={{ marginTop: 16 }}>
          <h2>Hours for {sel}</h2>
          <p className="small muted">Tick “Own hours” for a weekday that differs from the default window. Leave it unticked to use the default.</p>
          {rows.map((r, i) => (
            <div key={r.weekday} className="row" style={{ flexWrap: 'wrap' }}>
              <strong style={{ width: 100 }}>{DAYS[r.weekday]}</strong>
              <label className="row"><input type="checkbox" checked={r.custom} disabled={!superAdmin} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, custom: e.target.checked } : x)))} style={{ width: 22, height: 22 }} /> Own hours</label>
              {r.custom && <label className="row"><input type="checkbox" checked={r.closed} disabled={!superAdmin} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, closed: e.target.checked } : x)))} style={{ width: 22, height: 22 }} /> Closed</label>}
              {r.custom && !r.closed && <><input className="field" style={{ width: 90 }} value={r.open} disabled={!superAdmin} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, open: e.target.value } : x)))} aria-label={`${DAYS[r.weekday]} opens`} />
                <span>to</span><input className="field" style={{ width: 90 }} value={r.close} disabled={!superAdmin} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, close: e.target.value } : x)))} aria-label={`${DAYS[r.weekday]} closes`} /></>}
            </div>))}
          {superAdmin && <button className="btn" disabled={busy} onClick={saveHours}>Save hours for {sel}</button>}
        </div>
      )}

      <div className="card stack" style={{ marginTop: 16 }}>
        <h2>Closures and special hours</h2>
        {(exceptions || []).map((x: any) => (
          <div key={x.id} className="row spread"><span>{x.on_date} · {x.region_code || 'All regions'} · {x.closed ? 'Closed' : `${x.open_time?.slice(0, 5)} to ${x.close_time?.slice(0, 5)}`}{x.reason ? ` · ${x.reason}` : ''}</span>
            {superAdmin && <button className="btn sm danger" disabled={busy} onClick={() => run(async () => { await q(supabase.rpc('delete_hours_exception', { p_id: x.id })); reloadEx(); })}>Remove</button>}</div>))}
        {exceptions && !exceptions.length && <div className="muted">No closures.</div>}
        {superAdmin && (
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
            <Field label="Region (blank = all)"><select className="field" value={ex.region_code} onChange={(e) => setEx({ ...ex, region_code: e.target.value })}><option value="">All regions</option>{(regions || []).map((r: any) => <option key={r.code} value={r.code}>{r.code}</option>)}</select></Field>
            <Field label="Date"><input className="field" type="date" value={ex.on_date} onChange={(e) => setEx({ ...ex, on_date: e.target.value })} /></Field>
            <Field label="Reason"><input className="field" value={ex.reason} onChange={(e) => setEx({ ...ex, reason: e.target.value })} /></Field>
            <label className="row"><input type="checkbox" checked={ex.closed} onChange={(e) => setEx({ ...ex, closed: e.target.checked })} style={{ width: 22, height: 22 }} /> Closed all day</label>
            {!ex.closed && <><Field label="Opens"><input className="field" value={ex.open} onChange={(e) => setEx({ ...ex, open: e.target.value })} placeholder="10:00" /></Field><Field label="Closes"><input className="field" value={ex.close} onChange={(e) => setEx({ ...ex, close: e.target.value })} placeholder="12:00" /></Field></>}
            <div><button className="btn" disabled={busy || !ex.on_date} onClick={addEx}>Add closure</button></div>
          </div>)}
      </div>
    </>
  );
}
