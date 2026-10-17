import React from 'react';
import { supabase } from '../lib/supabase';

export function Badge({ tone = 'neutral', children }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function Avatar({ name }) {
  const initials = (name || '?').split(' ').filter(Boolean).map((s) => s[0]).join('').slice(0, 2).toUpperCase();
  return <div className="avatar">{initials}</div>;
}

export function ErrorBox({ children }) {
  return children ? <div className="error">{children}</div> : null;
}

export function Field({ label, children }) {
  return (
    <label className="stack" style={{ gap: 4 }}>
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

// Runs an async action with busy + error state; returns [run, busy, error, setError].
export function useAction() {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const run = React.useCallback(async (fn) => {
    setBusy(true); setError('');
    try { return await fn(); } catch (e) { setError(e.message || String(e)); return undefined; } finally { setBusy(false); }
  }, []);
  return [run, busy, error, setError];
}

// Contact details are no longer part of a profile or task. An admin reveals them
// on demand, and the database records each lookup in the audit log.
export function Contact({ id }) {
  const [info, setInfo] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  if (!id) return null;
  async function reveal() {
    setBusy(true); setError('');
    const { data, error: err } = await supabase.rpc('admin_contacts', { p_ids: [id] });
    setBusy(false);
    if (err) return setError(err.message);
    setInfo((data || [])[0] || {});
  }
  if (info) return <div className="small muted">{[info.phone, info.email].filter(Boolean).join(' · ') || 'No contact details'}</div>;
  return (
    <div>
      <button type="button" className="btn sm" disabled={busy} onClick={reveal}>Show contact details (recorded)</button>
      {error && <div className="error">{error}</div>}
    </div>
  );
}
