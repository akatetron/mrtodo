// Shown to the customer only when the server says the Personal Manager is more
// than the grace period late and has not arrived.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { colors, spacing } from '../theme';
import { Card, Button, Input, ErrorText } from './UI';
import { minutesLate, escalateTask } from '../data/store';

export default function EscalateCard({ t }) {
  const [late, setLate] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const check = useCallback(async () => { if (t.status === 'assigned' && t.scheduledAt && !t.escalatedAt) setLate(await minutesLate(t.id)); else setLate(null); }, [t.id, t.status, t.scheduledAt, t.escalatedAt]);
  useEffect(() => { check(); const i = setInterval(check, 60000); return () => clearInterval(i); }, [check]);

  if (t.escalatedAt || sent) {
    return (
      <Card style={{ marginBottom: spacing.lg, borderColor: colors.danger, borderWidth: 2, gap: 4 }}>
        <Text style={{ fontSize: 17, fontWeight: '800', color: colors.danger }}>Escalated</Text>
        <Text style={{ fontSize: 15, lineHeight: 22, color: colors.text }}>Our team has been told and is looking into it. You will get a notification as soon as we have an update.</Text>
      </Card>
    );
  }
  if (late == null) return null;
  async function go() {
    setBusy(true); setError('');
    try { await escalateTask(t.id, reason.trim()); setSent(true); } catch (e) { setError(e.message); await check(); } finally { setBusy(false); }
  }
  return (
    <Card style={{ marginBottom: spacing.lg, borderColor: colors.danger, borderWidth: 2, gap: spacing.sm }}>
      <Text style={{ fontSize: 17, fontWeight: '800', color: colors.text }}>Your Personal Manager is about {late} minutes late</Text>
      <Text style={{ fontSize: 15, lineHeight: 22, color: colors.text }}>If you have not heard from them, ask our team to step in.</Text>
      <Input placeholder="Anything we should know? (optional)" value={reason} onChangeText={setReason} />
      <Button label={busy ? 'Sending…' : 'Escalate'} variant="danger" onPress={go} disabled={busy} />
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}
