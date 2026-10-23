// Moving a task from one day to several needs the Personal Manager to ask, an
// admin to approve AND the customer to agree. Until both have, nothing changes.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing } from '../theme';
import { Card, Badge, Button, FieldLabel, Input, ErrorText } from './UI';
import { formatMoney } from '../lib/money';
import {
  listScopeChanges, requestMultidayChange, withdrawScopeChange, decideScopeChangeAdmin, decideScopeChangeCustomer,
} from '../data/store';

const STATUS = {
  pending: ['Waiting for our team', 'brass'], approved_by_admin: ['Waiting for the customer', 'brass'],
  applied: ['Agreed', 'success'], rejected: ['Not agreed', 'danger'], withdrawn: ['Withdrawn', 'neutral'],
};

function useChanges(taskId, scopeVersion) {
  const [changes, setChanges] = useState([]);
  const reload = useCallback(() => listScopeChanges(taskId).then(setChanges), [taskId]);
  useEffect(() => { reload(); }, [reload, scopeVersion]);
  return [changes, reload];
}

function Visits({ c }) {
  return (
    <View style={{ gap: 2 }}>
      {(c.proposed_visits || []).map((v, i) => <Text key={i} style={styles.line}>• {v.date || 'Date to be agreed'}{v.note ? ` — ${v.note}` : ''}</Text>)}
      {c.revised_duration_minutes ? <Text style={styles.line}>Expected time: about {c.revised_duration_minutes} minutes in total</Text> : null}
    </View>
  );
}

export function CustomerScopeChange({ t }) {
  const [changes, reload] = useChanges(t.id, t.scopeVersion);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const open = changes.find((c) => c.status === 'approved_by_admin');
  if (!open) return null;
  async function decide(ok) {
    setBusy(true); setError('');
    try { await decideScopeChangeCustomer(open.id, ok); await reload(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return (
    <Card style={{ marginBottom: spacing.lg, gap: spacing.sm, borderColor: colors.brass, borderWidth: 2 }}>
      <Text style={styles.h2}>Your Personal Manager asks to continue over several days</Text>
      <Text style={styles.line}>Reason: {open.reason}</Text>
      <Visits c={open} />
      <Text style={styles.line}>
        {open.approved_price_impact > 0 ? `Extra cost: ${formatMoney(open.approved_price_impact, t.currency)}. ` : 'No extra cost. '}
        Our team has checked this. Nothing changes unless you agree.
      </Text>
      <Button label="Agree to the change" onPress={() => decide(true)} disabled={busy} />
      <Button label="No, keep it as it is" variant="ghost" onPress={() => decide(false)} disabled={busy} />
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}

export function PmScopeChange({ t }) {
  const [changes, reload] = useChanges(t.id, t.scopeVersion);
  const [form, setForm] = useState(false);
  const [reason, setReason] = useState('');
  const [visits, setVisits] = useState('');
  const [minutes, setMinutes] = useState('');
  const [impact, setImpact] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!['assigned', 'in_progress'].includes(t.status)) return null;
  const open = changes.find((c) => ['pending', 'approved_by_admin'].includes(c.status));
  const last = changes[0];

  async function submit() {
    setBusy(true); setError('');
    try {
      const list = visits.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
        const [date, ...note] = l.split(' - ');
        return { date: date.trim(), note: note.join(' - ').trim() || undefined };
      });
      await requestMultidayChange(t.id, reason.trim(), list, minutes ? parseInt(minutes, 10) : null, impact ? Number(impact) : null);
      setForm(false); setReason(''); setVisits(''); setMinutes(''); setImpact(''); await reload();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  if (t.scheduleKind === 'multi_day') return <Card style={styles.card}><Badge label="Runs over several days" tone="success" /></Card>;
  return (
    <Card style={styles.card}>
      <Text style={styles.h2}>Needs more than one day?</Text>
      {open ? (
        <>
          <Badge label={STATUS[open.status][0]} tone={STATUS[open.status][1]} />
          <Text style={styles.line}>The current plan stays in force until our team and the customer both agree.</Text>
          <Button label="Withdraw this request" variant="ghost" onPress={async () => { setBusy(true); try { await withdrawScopeChange(open.id); await reload(); } catch (e) { setError(e.message); } finally { setBusy(false); } }} disabled={busy} />
        </>
      ) : (
        <>
          {last && <Text style={styles.line}>Last request: {STATUS[last.status][0]}{last.admin_note ? ` — ${last.admin_note}` : ''}</Text>}
          {!form ? <Button label="Ask to continue over several days" variant="ghost" onPress={() => setForm(true)} /> : (
            <View style={{ gap: spacing.md }}>
              <View><FieldLabel>Why more days are needed</FieldLabel><Input multiline value={reason} onChangeText={setReason} /></View>
              <View><FieldLabel>Proposed visits (one per line: date - what happens)</FieldLabel><Input multiline value={visits} onChangeText={setVisits} placeholder="Mon 2 Nov - finish the wiring" /></View>
              <View><FieldLabel>Total expected time in minutes (optional)</FieldLabel><Input keyboardType="numeric" value={minutes} onChangeText={setMinutes} /></View>
              <View><FieldLabel>Extra cost you expect, in ₹ (optional)</FieldLabel><Input keyboardType="numeric" value={impact} onChangeText={setImpact} /></View>
              <Button label={busy ? 'Sending…' : 'Send request'} onPress={submit} disabled={busy} />
              <Button label="Cancel" variant="ghost" onPress={() => setForm(false)} />
            </View>
          )}
        </>
      )}
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}

export function AdminScopeChange({ t }) {
  const [changes, reload] = useChanges(t.id, t.scopeVersion);
  const [note, setNote] = useState('');
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const open = changes.find((c) => c.status === 'pending');
  const waiting = changes.find((c) => c.status === 'approved_by_admin');
  if (!open && !waiting) return null;
  const c = open || waiting;
  async function decide(ok) {
    setBusy(true); setError('');
    try { await decideScopeChangeAdmin(c.id, ok, note.trim(), price ? Number(price) : null); await reload(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return (
    <Card style={{ gap: spacing.sm, borderColor: colors.brass, borderWidth: 2 }}>
      <Text style={styles.h2}>Request to extend over several days</Text>
      <Badge label={STATUS[c.status][0]} tone={STATUS[c.status][1]} />
      <Text style={styles.line}>Reason: {c.reason}</Text>
      <Visits c={c} />
      <Text style={styles.line}>PM suggests extra cost: {c.price_impact != null ? formatMoney(c.price_impact, t.currency) : 'none stated'}</Text>
      {open ? (
        <>
          <View><FieldLabel>Extra cost the customer will be asked to approve (₹)</FieldLabel><Input keyboardType="numeric" value={price} onChangeText={setPrice} placeholder={c.price_impact != null ? String(c.price_impact) : '0'} /></View>
          <View><FieldLabel>Note (optional)</FieldLabel><Input value={note} onChangeText={setNote} /></View>
          <Button label="Approve and send to the customer" onPress={() => decide(true)} disabled={busy} />
          <Button label="Reject" variant="danger" onPress={() => decide(false)} disabled={busy} />
        </>
      ) : <Text style={styles.line}>Approved by an admin. It takes effect only if the customer agrees.</Text>}
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.md, gap: spacing.sm },
  h2: { fontSize: 18, fontWeight: '800', color: colors.text },
  line: { fontSize: 15, lineHeight: 22, color: colors.text },
});
