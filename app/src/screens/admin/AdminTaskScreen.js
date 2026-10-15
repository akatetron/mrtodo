// Admin task detail: see everything about a task, pick a Personal Manager for
// it, and step in when something goes wrong.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { colors, spacing, radius } from '../../theme';
import { Card, Badge, Button, FieldLabel, Input, ErrorText, StatusTracker } from '../../components/UI';
import TaskPhotos from '../../components/TaskPhotos';
import {
  useTasks, getTask, catMeta, STATUS_META, shortId, initials, formatRating, timeAgo, visitsDone, runningTotal,
  PM_SHARE, assignTask, cancelTask, adminCompleteTask, listShortlist, taskHistory, catMeta as cat,
} from '../../data/store';

const ACTION_LABEL = {
  'task.created': 'Posted by customer',
  'task.assigned': 'Offered to a PM',
  'task.reassigned': 'Offered to a different PM',
  'task.accepted': 'Accepted by PM',
  'task.declined': 'Declined by PM',
  'task.started': 'Work started',
  'task.visit_logged': 'Visit logged',
  'task.wrong_code': 'Wrong completion code entered',
  'task.completed': 'Completed with code',
  'task.completed_by_admin': 'Completed by admin',
  'task.cancelled': 'Cancelled',
  'task.rated': 'Rated',
  'task.offer_expired': 'Offer lapsed with no answer',
  'task.reported': 'Problem reported',
  'report.resolved': 'Report resolved',
};

export default function AdminTaskScreen({ route }) {
  useTasks();
  const t = getTask(route.params.taskId);
  if (!t) return <Text style={{ padding: 20, color: colors.muted }}>Loading task…</Text>;

  const meta = STATUS_META[t.status];
  const canAssign = ['requested', 'matched'].includes(t.status);
  const value = t.taskType === 'ongoing'
    ? `₹${t.ratePerDay || 0}/day · ${visitsDone(t)} visit(s), ₹${runningTotal(t)} so far`
    : t.estCost ? `₹${t.estCost}` : '—';
  const base = t.taskType === 'ongoing' ? t.ratePerDay : t.estCost;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60, gap: spacing.md }}>
      <View style={styles.headerRow}>
        <Text style={styles.id}>{shortId(t.id)}</Text>
        <Badge label={meta.adminLabel} tone={meta.tone} />
      </View>

      <Card style={{ gap: spacing.md }}>
        <StatusTracker status={t.status} />
      </Card>

      <Card style={{ gap: spacing.md }}>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Badge label={`${catMeta(t.category).emoji} ${catMeta(t.category).label}`} />
          {t.taskType === 'ongoing' && <Badge label="↻ Ongoing" tone="brass" />}
        </View>
        <Text style={styles.title}>{t.title}</Text>
        {!!t.description && <Text style={styles.desc}>{t.description}</Text>}
        <Info label="Scheduled" value={t.scheduledFor || 'Flexible'} />
        <Info label="📍 Location" value={t.location} />
        <Info
          label="Value"
          value={value}
          sub={base ? `PM earns ₹${Math.round(base * PM_SHARE)}${t.taskType === 'ongoing' ? '/day' : ''} · platform ₹${Math.round(base * (1 - PM_SHARE))}` : null}
        />
        {t.forWhom === 'other' && (
          <Info label="Booked for" value={`${t.recipientName}${t.recipientRelation ? ` (${t.recipientRelation})` : ''}${t.recipientPhone ? ` · ${t.recipientPhone}` : ''}`} />
        )}
        {t.status === 'cancelled' && !!t.cancelReason && <Info label="Cancel reason" value={t.cancelReason} />}
      </Card>

      <PersonCard label="Customer" person={t.customer} />
      {t.worker && !canAssign && <PersonCard label="Personal Manager" person={t.worker} />}
      {t.status === 'completed' && (
        <Card style={{ gap: 4 }}>
          <FieldLabel>Ratings</FieldLabel>
          <Text style={styles.desc}>
            Customer rated PM: {t.customerRatingOfWorker != null ? `${t.customerRatingOfWorker}★` : 'not yet'} · PM rated customer: {t.workerRatingOfCustomer != null ? `${t.workerRatingOfCustomer}★` : 'not yet'}
          </Text>
        </Card>
      )}

      <TaskPhotos taskId={t.id} canAdd={false} hideIfEmpty />

      {canAssign && <Shortlist t={t} />}
      {['assigned', 'in_progress'].includes(t.status) && <CompleteWithoutCode t={t} />}
      {!['completed', 'cancelled'].includes(t.status) && <CancelBox t={t} />}
      <History taskId={t.id} status={t.status} />
    </ScrollView>
  );
}

function Shortlist({ t }) {
  const [list, setList] = useState(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [done, setDone] = useState('');

  const load = useCallback(async () => {
    try { setList(await listShortlist(t.id)); setError(''); } catch (e) { setError(e.message); }
  }, [t.id]);
  useEffect(() => { load(); }, [load, t.assignedWorkerId]);

  async function assign(w) {
    setError(''); setDone(''); setBusyId(w.id);
    try {
      await assignTask(t.id, w.id);
      setDone(`Offered to ${w.name}. They'll see it in their app.`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card style={{ gap: spacing.md }}>
      <View>
        <Text style={styles.h2}>{t.status === 'matched' ? 'Reassign to someone else' : 'Pick a Personal Manager'}</Text>
        <Text style={styles.hint}>Best match first: skill, availability, area, rating, workload.</Text>
      </View>
      {t.status === 'matched' && t.worker && (
        <Text style={styles.hint}>Currently offered to {t.worker.name}, waiting for them to accept.</Text>
      )}
      {!!done && <Text style={styles.ok}>{done}</Text>}
      <ErrorText>{error}</ErrorText>
      {!list && !error && <Text style={styles.hint}>Loading…</Text>}
      {list && !list.length && (
        <Text style={styles.hint}>No approved Personal Managers yet. Someone has to apply and be approved before they can be assigned.</Text>
      )}
      {(list || []).map((w, i) => {
        const current = w.id === t.assignedWorkerId;
        return (
          <View key={w.id} style={[styles.candidate, i === 0 && w.categoryMatch && !current && styles.candidateTop]}>
            <View style={styles.avatar}><Text style={styles.avatarText}>{w.initials}</Text></View>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={styles.cname}>{w.name}</Text>
              <Text style={styles.hint}>{formatRating(w.rating, w.ratingCount)} · {w.jobsDone} jobs{w.serviceArea ? ` · ${w.serviceArea}` : ''}</Text>
              <View style={styles.chips}>
                {w.categoryMatch
                  ? <Badge label={`✓ ${cat(t.category).label}`} tone="success" />
                  : <Badge label={`No ${cat(t.category).label} skill`} tone="danger" />}
                {w.areaMatch && <Badge label="📍 Same area" tone="success" />}
                {!w.online && <Badge label="Unavailable" tone="brass" />}
                {w.declined && <Badge label="Declined this" tone="danger" />}
                {w.activeJobs > 0 && <Badge label={`${w.activeJobs} active`} />}
              </View>
            </View>
            {current
              ? <Badge label="Offered" tone="accent" />
              : <Button label={busyId === w.id ? '…' : 'Assign'} size="sm" disabled={!!busyId} onPress={() => assign(w)} />}
          </View>
        );
      })}
    </Card>
  );
}

function CompleteWithoutCode({ t }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!open) return <Button label="Mark completed without the code…" variant="ghost" onPress={() => setOpen(true)} />;

  async function submit() {
    setError(''); setBusy(true);
    try { await adminCompleteTask(t.id, note.trim()); } catch (e) { setError(e.message); setBusy(false); }
  }
  return (
    <Card style={{ gap: spacing.md }}>
      <Text style={styles.h2}>Complete without the customer's code</Text>
      <Text style={styles.hint}>For when the customer confirmed another way, or the PM got locked out after wrong codes. This is recorded in the history.</Text>
      <Input multiline placeholder="How was completion confirmed?" value={note} onChangeText={setNote} />
      <ErrorText>{error}</ErrorText>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Button label="Back" variant="ghost" style={{ flex: 1 }} onPress={() => setOpen(false)} />
        <Button label={busy ? 'Saving…' : 'Mark completed'} style={{ flex: 1 }} disabled={busy || !note.trim()} onPress={submit} />
      </View>
    </Card>
  );
}

function CancelBox({ t }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!open) return <Button label="Cancel this task…" variant="danger" onPress={() => setOpen(true)} />;

  async function submit() {
    setError(''); setBusy(true);
    try { await cancelTask(t.id, reason.trim()); } catch (e) { setError(e.message); setBusy(false); }
  }
  return (
    <Card style={{ gap: spacing.md, borderColor: colors.danger }}>
      <Text style={styles.h2}>Cancel this task?</Text>
      <Input placeholder="Reason (shown to the customer)" value={reason} onChangeText={setReason} />
      <ErrorText>{error}</ErrorText>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Button label="Keep it" variant="ghost" style={{ flex: 1 }} onPress={() => setOpen(false)} />
        <Button label={busy ? 'Cancelling…' : 'Yes, cancel'} variant="danger" style={{ flex: 1 }} disabled={busy} onPress={submit} />
      </View>
    </Card>
  );
}

function History({ taskId, status }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    let alive = true;
    taskHistory(taskId).then((r) => alive && setRows(r)).catch(() => alive && setRows([]));
    return () => { alive = false; };
  }, [taskId, status]);
  if (!rows?.length) return null;
  return (
    <Card style={{ gap: 10 }}>
      <Text style={styles.h2}>History</Text>
      {rows.map((e) => (
        <View key={e.id} style={{ gap: 2 }}>
          <Text style={{ fontSize: 13.5, color: colors.text }}>
            <Text style={{ fontWeight: '700' }}>{ACTION_LABEL[e.action] || e.action}</Text>
            {e.details?.worker_name ? ` → ${e.details.worker_name}` : ''}
          </Text>
          <Text style={styles.hint}>
            {timeAgo(e.created_at)}{e.actor?.full_name ? ` · ${e.actor.full_name}` : ''}
            {e.details?.reason ? ` · “${e.details.reason}”` : ''}{e.details?.note ? ` · “${e.details.note}”` : ''}
          </Text>
        </View>
      ))}
    </Card>
  );
}

function PersonCard({ label, person }) {
  if (!person) return null;
  return (
    <Card>
      <FieldLabel>{label}</FieldLabel>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{initials(person.name)}</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cname}>{person.name}</Text>
          <Text style={styles.hint}>{formatRating(person.rating, person.ratingCount)}{person.phone ? ` · ${person.phone}` : ''}</Text>
        </View>
      </View>
    </Card>
  );
}

function Info({ label, value, sub }) {
  return (
    <View>
      <FieldLabel>{label}</FieldLabel>
      <Text style={{ fontWeight: '700', fontSize: 13.5, color: colors.text }}>{value}</Text>
      {!!sub && <Text style={styles.hint}>{sub}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  id: { fontSize: 13, fontWeight: '700', color: colors.muted },
  title: { fontWeight: '800', fontSize: 17, color: colors.text },
  desc: { color: colors.muted, fontSize: 13.5, lineHeight: 20 },
  h2: { fontSize: 15, fontWeight: '700', color: colors.text },
  hint: { color: colors.muted, fontSize: 12.5, lineHeight: 18 },
  ok: { color: colors.success, fontSize: 13, fontWeight: '700' },
  avatar: { width: 40, height: 40, borderRadius: 20, flexShrink: 0, backgroundColor: colors.accentLight, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontWeight: '800', color: colors.accentDark, fontSize: 13 },
  cname: { fontWeight: '700', fontSize: 14.5, color: colors.text },
  candidate: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  candidateTop: { borderColor: colors.accent, backgroundColor: colors.accentLight },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
});
