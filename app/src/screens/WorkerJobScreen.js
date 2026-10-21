import React, { useState } from 'react';
import { View, Text, ScrollView, TextInput, StyleSheet } from 'react-native';
import { colors, spacing, radius } from '../theme';
import { Card, Badge, Button, FieldLabel, ErrorText, Input, Stars } from '../components/UI';
import TaskPhotos from '../components/TaskPhotos';
import { PmScopeChange } from '../components/ScopeChange';
import {
  useTasks, getTask, catMeta, acceptTask, declineTask, startTask, logVisit, completeWithOtp, rateTask, COMPLETION_MESSAGES,
  visitsDone, STATUS_META, PM_SHARE, formatRating, initials,
} from '../data/store';

export default function WorkerJobScreen({ route, navigation }) {
  useTasks();
  const { taskId } = route.params;
  const t = getTask(taskId);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!t) return <Text style={{ padding: 20, color: colors.muted }}>This task is no longer assigned to you.</Text>;
  const meta = STATUS_META[t.status];
  const c = t.customer;
  const revealContact = ['assigned', 'in_progress'].includes(t.status);

  async function run(fn, after) {
    setError(''); setBusy(true);
    try { await fn(); if (after) after(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }}>
      <Card style={{ marginBottom: spacing.md }}>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <Badge label={`${catMeta(t.category).emoji} ${catMeta(t.category).label}`} />
          <Badge label={meta.pmLabel} tone={meta.tone} />
          {t.taskType === 'ongoing' && <Badge label="↻ Ongoing" tone="brass" />}
        </View>
        <Text style={styles.title}>{t.title}</Text>
        {!!t.description && <Text style={styles.desc}>{t.description}</Text>}
      </Card>

      <Card style={{ marginBottom: spacing.md, gap: 12 }}>
        <Row label="Scheduled" value={t.scheduledFor || 'Flexible'} />
        <Divider />
        <Row label="📍 Location" value={t.location} />
        {t.taskType === 'ongoing' ? (
          <>
            <Divider />
            <Row label="You earn" value={`₹${Math.round((t.ratePerDay || 0) * PM_SHARE)}/day`} sub={`₹${t.ratePerDay || 0}/day · ${visitsDone(t)} visit(s) so far`} />
          </>
        ) : t.estCost ? (
          <>
            <Divider />
            <Row label="You earn" value={`₹${Math.round(t.estCost * PM_SHARE)}`} sub={`Job value ₹${t.estCost} · platform fee ₹${Math.round(t.estCost * (1 - PM_SHARE))}`} />
          </>
        ) : null}
      </Card>

      {c && (
        <Card style={{ marginBottom: spacing.md, flexDirection: 'row', alignItems: 'center', gap: 13 }}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials(c.name)}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: '700', fontSize: 14, color: colors.text }}>{c.name}</Text>
            <Badge
              label={`${formatRating(c.rating, c.ratingCount)} customer${c.rating != null && c.rating < 4 ? ' · caution' : ''}`}
              tone={c.rating != null && c.rating < 4 ? 'danger' : 'neutral'}
              style={{ marginTop: 4 }}
            />
          </View>
        </Card>
      )}

      {t.forWhom === 'other' && (
        <Card style={{ marginBottom: spacing.md }}>
          <Text style={{ fontSize: 13, color: colors.muted, lineHeight: 19 }}>
            <Text style={{ fontWeight: '700', color: colors.text }}>Meeting on arrival: </Text>
            {t.recipientName}{t.recipientRelation ? ` (${t.recipientRelation})` : ''}
          </Text>
        </Card>
      )}

      {t.taskType === 'ongoing' && ['in_progress', 'completed'].includes(t.status) && (
        <Card style={{ marginBottom: spacing.md }}>
          <Text style={{ fontWeight: '700', fontSize: 14, marginBottom: 10, color: colors.text }}>Visit log</Text>
          <View style={{ gap: 8, marginBottom: 12 }}>
            {t.visits.length ? (
              t.visits.map((v) => (
                <Text key={v.id} style={{ fontSize: 13 }}>
                  <Text style={{ fontWeight: '700', color: colors.text }}>{v.date}: </Text>
                  <Text style={{ color: colors.muted }}>{v.note}</Text>
                </Text>
              ))
            ) : (
              <Text style={{ color: colors.faint, fontSize: 13 }}>No visits logged yet.</Text>
            )}
          </View>
          {t.status === 'in_progress' && <LogVisit t={t} />}
        </Card>
      )}

      {['assigned', 'in_progress', 'completed'].includes(t.status) && (
        <View style={{ marginBottom: spacing.md }}>
          <TaskPhotos taskId={t.id} canAdd={['assigned', 'in_progress'].includes(t.status)} hideIfEmpty />
        </View>
      )}

      <PmScopeChange t={t} />
      {t.status === 'in_progress' && <FinishTask t={t} />}

      {t.status === 'matched' && (
        <>
          <Text style={styles.hint}>Review the details, then accept to confirm you'll do this task. Declining sends it back to the team to find someone else.</Text>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Button label="Decline" variant="ghost" style={{ flex: 1 }} disabled={busy}
              onPress={() => run(() => declineTask(t.id), () => navigation.goBack())} />
            <Button label={busy ? 'Working…' : 'Accept task'} style={{ flex: 2 }} disabled={busy} onPress={() => run(() => acceptTask(t.id))} />
          </View>
        </>
      )}

      {t.status === 'assigned' && (
        <>
          <Text style={styles.hint}>When you arrive and begin, tap Start. The customer is notified.</Text>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Button label="Can't make it" variant="ghost" style={{ flex: 1 }} disabled={busy}
              onPress={() => run(() => declineTask(t.id, 'Withdrew after accepting'), () => navigation.goBack())} />
            <Button label={busy ? 'Working…' : '▶ Start task'} style={{ flex: 2 }} disabled={busy} onPress={() => run(() => startTask(t.id))} />
          </View>
        </>
      )}

      <ErrorText>{error}</ErrorText>

      {t.status === 'completed' && <RateCustomer t={t} />}

      {['assigned', 'in_progress', 'completed'].includes(t.status) && (
        <Button label="Report a problem" variant="ghost" style={{ marginTop: spacing.md }} onPress={() => navigation.navigate('ReportProblem', { taskId: t.id })} />
      )}
    </ScrollView>
  );
}

function LogVisit({ t }) {
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit() {
    setError(''); setBusy(true);
    try { await logVisit(t.id, note.trim()); setNote(''); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return (
    <View style={{ gap: 8 }}>
      <Input placeholder="What did you do today? (optional)" value={note} onChangeText={setNote} />
      <ErrorText>{error}</ErrorText>
      <Button label={busy ? 'Saving…' : "+ Log today's visit"} variant="ghost" size="sm" onPress={submit} disabled={busy} />
    </View>
  );
}

function FinishTask({ t }) {
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function confirmComplete() {
    setError(''); setBusy(true);
    try {
      const result = await completeWithOtp(t.id, otp.trim());
      if (result === 'ok' || result === true) setOtp('');
      else setError(COMPLETION_MESSAGES[result] || 'Could not complete the task. Try again.');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{ marginBottom: spacing.md }}>
      <Text style={{ fontWeight: '700', fontSize: 14, marginBottom: 4, color: colors.text }}>Finish the task</Text>
      <Text style={{ color: colors.muted, fontSize: 12.5, marginBottom: 12, lineHeight: 18 }}>
        Once the customer is happy, ask for the 4-digit completion code in their app and enter it below.
      </Text>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <TextInput
          style={styles.otpInput}
          placeholder="0000"
          placeholderTextColor={colors.faint}
          keyboardType="numeric"
          maxLength={4}
          value={otp}
          onChangeText={setOtp}
        />
        <Button label={busy ? 'Checking…' : 'Confirm & complete'} onPress={confirmComplete} style={{ flex: 1 }} disabled={busy || otp.trim().length !== 4} />
      </View>
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}

function RateCustomer({ t }) {
  const [stars, setStars] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (t.workerRatingOfCustomer != null) {
    return <Text style={{ textAlign: 'center', color: colors.muted, padding: 12 }}>Task completed ✓ · you rated the customer {t.workerRatingOfCustomer}★</Text>;
  }
  async function submit() {
    setError(''); setBusy(true);
    try { await rateTask(t.id, stars); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return (
    <Card style={{ gap: spacing.md, alignItems: 'flex-start' }}>
      <Text style={{ fontWeight: '700', color: colors.text }}>Task completed ✓ — how was the customer?</Text>
      <Stars value={stars} onChange={setStars} />
      <ErrorText>{error}</ErrorText>
      <Button label={busy ? 'Saving…' : 'Submit rating'} size="sm" onPress={submit} disabled={busy || !stars} />
    </Card>
  );
}

function Row({ label, value, sub }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ flex: 1 }}>
        <FieldLabel>{label}</FieldLabel>
        <Text style={{ fontWeight: '700', fontSize: 13.5, color: colors.text }}>{value}</Text>
        {!!sub && <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>{sub}</Text>}
      </View>
    </View>
  );
}
function Divider() {
  return <View style={{ height: 1, backgroundColor: colors.border }} />;
}

const styles = StyleSheet.create({
  title: { fontWeight: '800', fontSize: 17, marginBottom: 6, color: colors.text },
  desc: { color: colors.muted, fontSize: 13.5, lineHeight: 20 },
  hint: { color: colors.muted, fontSize: 12.5, lineHeight: 18, marginBottom: 10 },
  phone: { color: colors.accent, fontSize: 13, marginTop: 4, fontWeight: '700' },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.accentLight, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontWeight: '800', color: colors.accentDark },
  otpInput: {
    width: 100, textAlign: 'center', fontWeight: '700', fontSize: 16, letterSpacing: 4, color: colors.text,
    borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.sm, paddingVertical: 11,
  },
});
