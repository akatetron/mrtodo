// Revised quotes: a Personal Manager (or admin) proposes new price lines, an
// admin reviews, and the customer must agree. The agreed price changes only then,
// and every earlier quote stays in the history.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing } from '../theme';
import { Card, Badge, Button, FieldLabel, Input, ErrorText, Chip } from './UI';
import { listQuotes, proposeQuote, decideQuoteAdmin, decideQuoteCustomer } from '../data/store';
import { formatMoney } from '../lib/money';

const KINDS = [['management_fee', 'Management fee'], ['specialist', 'Specialist'], ['extra_work', 'Extra work'], ['tax', 'Tax'], ['discount', 'Discount']];
const STATUS = {
  proposed: ['Waiting for our team', 'brass'], admin_approved: ['Waiting for the customer', 'brass'], customer_approved: ['Agreed', 'success'],
  rejected: ['Not agreed', 'danger'], superseded: ['Replaced', 'neutral'], withdrawn: ['Withdrawn', 'neutral'],
};

function useQuotes(taskId, deps) {
  const [quotes, setQuotes] = useState([]);
  const reload = useCallback(() => listQuotes(taskId).then(setQuotes), [taskId]);
  useEffect(() => { reload(); }, [reload, deps]);
  return [quotes, reload];
}

function Lines({ q }) {
  return (
    <View style={{ gap: 2 }}>
      {(q.components || []).map((c, i) => <Text key={i} style={styles.line}>{c.label}: {formatMoney(c.amount, q.currency)}</Text>)}
      <Text style={[styles.line, { fontWeight: '800' }]}>Total: {formatMoney(q.total, q.currency)}{q.base_total != null ? ` (was ${formatMoney(q.base_total, q.currency)})` : ''}</Text>
    </View>
  );
}

export function QuoteHistory({ t }) {
  const [quotes] = useQuotes(t.id, t.estCost);
  const past = quotes.filter((q) => ['customer_approved', 'rejected', 'superseded'].includes(q.status));
  if (!past.length) return null;
  return (
    <Card style={{ gap: spacing.sm }}>
      <Text style={styles.h2}>Price history</Text>
      {past.map((q) => (
        <View key={q.id} style={{ gap: 2 }}>
          <Text style={styles.line}>Version {q.version} · {STATUS[q.status][0]} · {formatMoney(q.total, q.currency)}</Text>
        </View>
      ))}
    </Card>
  );
}

export function PmQuote({ t }) {
  const [quotes, reload] = useQuotes(t.id, t.estCost);
  const [form, setForm] = useState(false);
  const [lines, setLines] = useState([{ label: '', kind: 'specialist', amount: '' }]);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!['assigned', 'in_progress'].includes(t.status)) return null;
  const open = quotes.find((q) => ['proposed', 'admin_approved'].includes(q.status));
  const setLine = (i, patch) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  async function send() {
    setBusy(true); setError('');
    try {
      const components = lines.filter((l) => l.label.trim()).map((l) => ({ label: l.label.trim(), kind: l.kind, amount: l.kind === 'discount' ? -Math.abs(Number(l.amount)) : Number(l.amount) }));
      await proposeQuote(t.id, components, reason.trim());
      setForm(false); setReason(''); setLines([{ label: '', kind: 'specialist', amount: '' }]); await reload();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return (
    <Card style={{ marginBottom: spacing.md, gap: spacing.sm }}>
      <Text style={styles.h2}>Found something unexpected?</Text>
      {open ? (
        <>
          <Badge label={STATUS[open.status][0]} tone={STATUS[open.status][1]} />
          <Lines q={open} />
          <Text style={styles.line}>The agreed price stays the same until the customer approves.</Text>
        </>
      ) : !form ? (
        <Button label="Propose a revised price" variant="ghost" onPress={() => setForm(true)} />
      ) : (
        <View style={{ gap: spacing.md }}>
          <View><FieldLabel>What did you find, and why does the price change?</FieldLabel><Input multiline value={reason} onChangeText={setReason} /></View>
          {lines.map((l, i) => (
            <View key={i} style={{ gap: spacing.sm }}>
              <Input placeholder="Line (e.g. Plumber: replace pipe)" value={l.label} onChangeText={(v) => setLine(i, { label: v })} />
              <View style={styles.row}>{KINDS.map(([k, label]) => <Chip key={k} label={label} selected={l.kind === k} onPress={() => setLine(i, { kind: k })} />)}</View>
              <Input placeholder="Amount (₹)" keyboardType="numeric" value={l.amount} onChangeText={(v) => setLine(i, { amount: v })} />
            </View>
          ))}
          <Button label="Add a line" variant="ghost" size="sm" onPress={() => setLines([...lines, { label: '', kind: 'extra_work', amount: '' }])} />
          <Text style={styles.line}>List the full new price, including the original work. The customer sees the total.</Text>
          <Button label={busy ? 'Sending…' : 'Send for review'} onPress={send} disabled={busy} />
          <Button label="Cancel" variant="ghost" onPress={() => setForm(false)} />
        </View>
      )}
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}

export function CustomerQuote({ t }) {
  const [quotes, reload] = useQuotes(t.id, t.estCost);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const open = quotes.find((q) => q.status === 'admin_approved');
  if (!open) return null;
  async function decide(ok) {
    setBusy(true); setError('');
    try { await decideQuoteCustomer(open.id, ok); await reload(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return (
    <Card style={{ marginBottom: spacing.lg, gap: spacing.sm, borderColor: colors.brass, borderWidth: 2 }}>
      <Text style={styles.h2}>A revised price needs your approval</Text>
      <Text style={styles.line}>{open.reason}</Text>
      <Lines q={open} />
      <Text style={styles.line}>Our team has checked this. Your current price stays unless you agree.</Text>
      <Button label="Agree to the new price" onPress={() => decide(true)} disabled={busy} />
      <Button label="No, keep the current price" variant="ghost" onPress={() => decide(false)} disabled={busy} />
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}

export function AdminQuote({ t }) {
  const [quotes, reload] = useQuotes(t.id, t.estCost);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const open = quotes.find((q) => q.status === 'proposed');
  const waiting = quotes.find((q) => q.status === 'admin_approved');
  const q = open || waiting;
  if (!q) return null;
  async function decide(ok) {
    setBusy(true); setError('');
    try { await decideQuoteAdmin(q.id, ok, note.trim()); await reload(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return (
    <Card style={{ gap: spacing.sm, borderColor: colors.brass, borderWidth: 2 }}>
      <Text style={styles.h2}>Revised quote (version {q.version})</Text>
      <Badge label={STATUS[q.status][0]} tone={STATUS[q.status][1]} />
      <Text style={styles.line}>{q.reason}</Text>
      <Lines q={q} />
      {open ? (
        <>
          <View><FieldLabel>Note (optional)</FieldLabel><Input value={note} onChangeText={setNote} /></View>
          <Button label="Approve and send to the customer" onPress={() => decide(true)} disabled={busy} />
          <Button label="Reject" variant="danger" onPress={() => decide(false)} disabled={busy} />
        </>
      ) : <Text style={styles.line}>Approved by an admin. The price changes only if the customer agrees.</Text>}
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}

const styles = StyleSheet.create({
  h2: { fontSize: 18, fontWeight: '800', color: colors.text },
  line: { fontSize: 15, lineHeight: 22, color: colors.text },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
