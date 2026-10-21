// Job value, the platform's share, and what each Personal Manager is owed.
// "Owed" counts completed tasks only, minus payouts already recorded. No money
// moves through the app; recording a payout is how you keep the books straight.
import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { colors, spacing } from '../../theme';
import { Card, Button, Input, ErrorText } from '../../components/UI';
import { useTasks, runningTotal, PM_SHARE, timeAgo } from '../../data/store';
import { exportCsv } from '../../data/extras';
import { useLiveQuery, listPayouts, recordPayout, DAY_MS } from '../../data/adminData';

const inr = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`;

export default function AdminMoneyScreen({ navigation }) {
  const tasks = useTasks();
  const { data: payouts, error, reload } = useLiveQuery(listPayouts, ['payouts'], navigation);
  const [message, setMessage] = useState('');
  const [exportError, setExportError] = useState('');

  const fig = useMemo(() => {
    const done = tasks.filter((t) => t.status === 'completed');
    const within = (days) => done.filter((t) => t.completedAt && Date.now() - new Date(t.completedAt).getTime() < days * DAY_MS);
    const sum = (list) => list.reduce((s, t) => s + runningTotal(t), 0);
    const perPm = {};
    done.forEach((t) => {
      if (!t.assignedWorkerId) return;
      const e = (perPm[t.assignedWorkerId] ||= { id: t.assignedWorkerId, name: t.worker?.name || 'Personal Manager', earned: 0, tasks: 0 });
      e.earned += Math.round(runningTotal(t) * PM_SHARE); e.tasks += 1;
    });
    (payouts || []).forEach((p) => {
      const e = (perPm[p.worker_id] ||= { id: p.worker_id, name: 'Personal Manager', earned: 0, tasks: 0 });
      e.paid = (e.paid || 0) + Number(p.amount);
    });
    const pms = Object.values(perPm).map((e) => ({ ...e, paid: e.paid || 0, owed: e.earned - (e.paid || 0) })).sort((a, b) => b.owed - a.owed);
    return {
      w7: sum(within(7)), d30: sum(within(30)), all: sum(done), n7: within(7).length,
      owedTotal: pms.reduce((s, e) => s + Math.max(e.owed, 0), 0), pms,
    };
  }, [tasks, payouts]);

  async function exportEarnings() {
    setExportError(''); setMessage('');
    try {
      const name = await exportCsv('personal-manager-earnings', fig.pms.map((e) => ({
        personal_manager: e.name, tasks_completed: e.tasks, earned_inr: e.earned, paid_out_inr: e.paid, owed_inr: e.owed,
      })));
      setMessage(`Exported (${name}).`);
    } catch (e) { setExportError(e.message); }
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60, gap: spacing.md }}>
      <View style={styles.grid}>
        <Stat label="Job value, 7 days" value={inr(fig.w7)} sub={`${fig.n7} completed`} />
        <Stat label="Platform share, 7 days" value={inr(fig.w7 * (1 - PM_SHARE))} sub={`${Math.round((1 - PM_SHARE) * 100)}% of value`} />
        <Stat label="Job value, 30 days" value={inr(fig.d30)} sub={`platform ${inr(fig.d30 * (1 - PM_SHARE))}`} />
        <Stat label="Owed to PMs now" value={inr(fig.owedTotal)} sub="completed, not yet paid" alert={fig.owedTotal > 0} />
      </View>
      <Text style={styles.note}>Values come from task prices. Ongoing tasks count each logged visit. Payments are not processed in the app.</Text>

      <Text style={styles.h2}>Personal Managers</Text>
      <ErrorText>{error}</ErrorText>
      {fig.pms.map((e) => <PmRow key={e.id} e={e} onPaid={reload} />)}
      {!fig.pms.length && <Text style={styles.empty}>No completed tasks yet, so nothing is owed.</Text>}

      <Button label="⬇ Export earnings (CSV)" variant="ghost" onPress={exportEarnings} />
      {!!message && <Text style={styles.ok}>{message}</Text>}
      <ErrorText>{exportError}</ErrorText>

      {(payouts || []).length > 0 && (
        <View style={{ gap: spacing.sm }}>
          <Text style={styles.h2}>Recent payouts</Text>
          {payouts.slice(0, 15).map((p) => (
            <Card key={p.id} style={styles.payout}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{(fig.pms.find((e) => e.id === p.worker_id) || {}).name || 'Personal Manager'}</Text>
                <Text style={styles.sub}>{timeAgo(p.paid_at)}{p.note ? ` · ${p.note}` : ''}</Text>
              </View>
              <Text style={styles.amount}>{inr(p.amount)}</Text>
            </Card>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function PmRow({ e, onPaid }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function pay() {
    setError('');
    const n = Number(amount);
    if (!n || n <= 0) return setError('Enter an amount above zero.');
    setBusy(true);
    try { await recordPayout(e.id, n, note.trim()); setOpen(false); setAmount(''); setNote(''); onPaid(); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <Card style={{ gap: spacing.sm }}>
      <View style={styles.payout}>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{e.name}</Text>
          <Text style={styles.sub}>{e.tasks} tasks · earned {inr(e.earned)} · paid {inr(e.paid)}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[styles.amount, e.owed > 0 && { color: colors.brassDark }]}>{inr(e.owed)}</Text>
          <Text style={styles.sub}>owed</Text>
        </View>
      </View>
      {!open && <Button label="Record a payout" variant="ghost" size="sm" onPress={() => { setAmount(e.owed > 0 ? String(Math.round(e.owed)) : ''); setOpen(true); }} />}
      {open && (
        <View style={{ gap: spacing.sm }}>
          <Input keyboardType="numeric" placeholder="Amount paid (₹)" value={amount} onChangeText={setAmount} />
          <Input placeholder="Note, e.g. UPI reference" value={note} onChangeText={setNote} />
          <ErrorText>{error}</ErrorText>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button label="Cancel" variant="ghost" size="sm" style={{ flex: 1 }} onPress={() => setOpen(false)} />
            <Button label={busy ? 'Saving…' : 'Save payout'} size="sm" style={{ flex: 1 }} disabled={busy} onPress={pay} />
          </View>
        </View>
      )}
    </Card>
  );
}

function Stat({ label, value, sub, alert }) {
  return (
    <Card style={[{ width: '48%' }, alert && { borderColor: colors.brass }]}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.val, alert && { color: colors.brassDark }]}>{value}</Text>
      {!!sub && <Text style={styles.sub}>{sub}</Text>}
    </Card>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  label: { fontSize: 12, color: colors.muted, fontWeight: '600' },
  val: { fontWeight: '800', fontSize: 20, marginTop: 2, color: colors.text },
  sub: { color: colors.muted, fontSize: 12.5, lineHeight: 17 },
  note: { color: colors.muted, fontSize: 12.5, lineHeight: 18 },
  h2: { fontSize: 15, fontWeight: '700', color: colors.text },
  payout: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  name: { fontWeight: '700', fontSize: 14.5, color: colors.text },
  amount: { fontWeight: '800', fontSize: 16, color: colors.text },
  ok: { color: colors.successText, fontWeight: '700', fontSize: 13 },
  empty: { color: colors.muted, textAlign: 'center', padding: 24, fontSize: 13.5 },
});
