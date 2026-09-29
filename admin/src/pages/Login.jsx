import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { ErrorBox, Field } from '../components/ui';

export default function Login({ notice }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (err) setError(err.message);
  }

  return (
    <div className="login">
      <form className="card stack" onSubmit={submit} style={{ gap: 14 }}>
        <div>
          <h1 style={{ color: 'var(--teal)' }}>Mr. Todo</h1>
          <div className="muted">Admin console — staff only</div>
        </div>
        <ErrorBox>{notice}</ErrorBox>
        <Field label="Email">
          <input className="field" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Password">
          <input className="field" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <ErrorBox>{error}</ErrorBox>
        <button className="btn" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  );
}
