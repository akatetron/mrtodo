import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { colors, spacing, radius } from '../theme';
import { Card, Badge, Button, StatusTracker, FieldLabel, Stars, Input, ErrorText } from '../components/UI';
import TaskPhotos from '../components/TaskPhotos';
import { CustomerScopeChange } from '../components/ScopeChange';
import { CustomerQuote } from '../components/QuoteFlow';
import PmProfileCard from '../components/PmProfileCard';
import EscalateCard from '../components/EscalateCard';
import InAppCallButton from '../components/InAppCallButton';
import {
  useTasks, getTask, catMeta, visitsDone, runningTotal, STATUS_META, shortId, formatRating, cancelTask, rateTask,
  priceSummary, confirmTaskPrice, issueCompletionCode, tasksNow as useTasksNow,
} from '../data/store';

const STATUS_COPY = {
  requested: "We're finding you a qualified Personal Manager — this usually takes a few minutes.",
  matched: 'A Personal Manager has been matched and is confirming they can take it.',
  assigned: 'Your Personal Manager has accepted and will arrive at the scheduled time.',
  in_progress: 'Your Personal Manager is working on it.',
};

export default function TrackTaskScreen({ route, navigation }) {
  useTasks(); // subscribe so this screen re-renders when admin/PM actions change the task
  const { taskId } = route.params;
  const t = getTask(taskId);
  if (!t) return <Text style={{ padding: 20, color: colors.muted }}>Loading task…</Text>;
  const w = t.worker;
  const meta = STATUS_META[t.status];
  // A PM is only shown once they have accepted.
  const showPm = w && ['assigned', 'in_progress', 'completed'].includes(t.status);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }}>
      <View style={styles.headerRow}>
        <Text style={styles.h1}>Task #{shortId(t.id)}</Text>
        <Badge label={meta.label} tone={meta.tone} />
      </View>

      <Card style={{ marginBottom: spacing.lg, gap: spacing.md }}>
        <StatusTracker status={t.status} />
        {!!STATUS_COPY[t.status] && <Text style={styles.statusCopy}>{STATUS_COPY[t.status]}</Text>}
        {t.status === 'cancelled' && !!t.cancelReason && <Text style={styles.statusCopy}>Reason: {t.cancelReason}</Text>}
      </Card>

      <Card style={{ marginBottom: spacing.lg, gap: spacing.md }}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Badge label={`${catMeta(t.category).emoji} ${catMeta(t.category).label}`} />
          {t.taskType === 'ongoing' && <Badge label="↻ Ongoing" tone="brass" />}
        </View>
        <Text style={styles.title}>{t.title}</Text>
        {!!t.description && <Text style={styles.desc}>{t.description}</Text>}
        {t.forWhom === 'other' && (
          <View style={styles.subtleBox}>
            <Text style={styles.subtleText}>
              <Text style={{ fontWeight: '700', color: colors.text }}>Booked for: </Text>
              {t.recipientName}{t.recipientRelation ? ` (${t.recipientRelation})` : ''}
            </Text>
          </View>
        )}
        <View style={{ flexDirection: 'row', gap: 24, flexWrap: 'wrap' }}>
          <View>
            <FieldLabel>Scheduled</FieldLabel>
            <Text style={styles.metaVal}>{t.scheduledFor || 'Flexible'}</Text>
          </View>
          <View style={{ flexShrink: 1 }}>
            <FieldLabel>📍 Location</FieldLabel>
            <Text style={styles.metaVal}>{t.location}</Text>
          </View>
          <View>
            <FieldLabel>Price</FieldLabel>
            <Text style={styles.metaVal}>{priceSummary(t).label}</Text>
          </View>
        </View>
      </Card>

      {t.reviewState === 'needs_review' && ['requested', 'matched'].includes(t.status) && (
        <Card style={{ marginBottom: spacing.lg, gap: 4 }}>
          <FieldLabel>Being reviewed</FieldLabel>
          <Text style={styles.statusCopy}>Our team is looking at your request. This is not booked yet: we will set a price for you to confirm, or ask for anything we are missing.</Text>
        </Card>
      )}
      {t.reviewState === 'clarification_needed' && (
        <Card style={{ marginBottom: spacing.lg, gap: 4, borderColor: colors.brass, borderWidth: 2 }}>
          <FieldLabel>We need a little more information</FieldLabel>
          <Text style={styles.statusCopy}>Check your notifications for our question.</Text>
        </Card>
      )}
      {!!t.bookingId && (() => {
        const siblings = useTasksNow().filter((x) => x.bookingId === t.bookingId);
        return siblings.length > 1 ? (
          <Card style={{ marginBottom: spacing.lg, gap: spacing.sm }}>
            <FieldLabel>Part of a booking with {siblings.length} tasks</FieldLabel>
            {siblings.map((s) => (
              <Pressable key={s.id} accessibilityRole="button" onPress={() => navigation.navigate('TrackTask', { taskId: s.id })} style={styles.sibling}>
                <Text style={{ flex: 1, fontSize: 15, fontWeight: s.id === t.id ? '800' : '600', color: colors.text }}>{s.title}</Text>
                <Badge label={STATUS_META[s.status].label} tone={STATUS_META[s.status].tone} />
              </Pressable>
            ))}
            <Text style={styles.statusCopy}>{siblings.filter((s) => s.status === 'completed').length} of {siblings.length} completed. Each task has its own price and status.</Text>
          </Card>
        ) : null;
      })()}
      {t.scheduleKind === 'multi_day' && <Badge label="Runs over several days" tone="brass" style={{ marginBottom: spacing.md }} />}
      <EscalateCard t={t} />
      <CustomerScopeChange t={t} />
      <CustomerQuote t={t} />
      <PriceCard t={t} />

      {t.taskType === 'ongoing' && t.status !== 'requested' && (
        <Card style={{ marginBottom: spacing.lg }}>
          <View style={styles.headerRow}>
            <Text style={styles.h2}>Visit log</Text>
            <Text style={styles.mutedSmall}>
              {visitsDone(t)} visit{visitsDone(t) === 1 ? '' : 's'} · ₹{runningTotal(t)} so far
            </Text>
          </View>
          <View style={{ gap: 10 }}>
            {t.visits.length ? (
              t.visits.map((v) => (
                <View key={v.id} style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={[styles.visitDot, v.done && { backgroundColor: colors.success, borderColor: colors.success }]}>
                    {v.done && <Text style={{ color: 'white', fontSize: 10, fontWeight: '700' }}>✓</Text>}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: '700', fontSize: 13.5, color: colors.text }}>
                      {v.date}
                      {v.done ? ` · ₹${t.ratePerDay || 0}` : ''}
                    </Text>
                    <Text style={{ color: colors.muted, fontSize: 13 }}>{v.note}</Text>
                  </View>
                </View>
              ))
            ) : (
              <Text style={{ color: colors.muted, fontSize: 13.5 }}>No visits logged yet.</Text>
            )}
          </View>
          <Text style={styles.footnote}>The same Personal Manager stays assigned across every visit of this task.</Text>
        </Card>
      )}

      {(t.status === 'assigned' || t.status === 'in_progress') && <CompletionCode t={t} />}

      {showPm && (
        <Card style={{ marginBottom: spacing.lg }}>
          <FieldLabel>Your Personal Manager</FieldLabel>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{w.initials}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '700', fontSize: 15.5, color: colors.text }}>{w.name}</Text>
              <Text style={{ color: colors.muted, fontSize: 13, marginTop: 2 }}>
                {formatRating(w.rating, w.ratingCount)} · {w.jobsDone} task{w.jobsDone === 1 ? '' : 's'} done
              </Text>
            </View>
          </View>
          <InAppCallButton t={t} />
          <PmProfileCard workerId={t.assignedWorkerId} />
        </Card>
      )}

      {['assigned', 'in_progress', 'completed'].includes(t.status) && (
        <View style={{ marginBottom: spacing.lg }}><TaskPhotos taskId={t.id} canAdd={false} hideIfEmpty /></View>
      )}

      {t.status === 'completed' && <RatePm t={t} />}
      {['requested', 'matched', 'assigned'].includes(t.status) && <CancelTask t={t} />}

      <View style={{ gap: spacing.sm, marginTop: spacing.lg }}>
        {['completed', 'cancelled'].includes(t.status) && (
          <Button
            label="Book again"
            variant="ghost"
            onPress={() => navigation.navigate('Booking', {
              prefillKey: Date.now(),
              prefill: {
                serviceId: t.serviceId, title: t.title, description: t.description, category: t.category, taskType: t.taskType,
                location: t.location, forWhom: t.forWhom,
                recipientName: t.recipientName, recipientRelation: t.recipientRelation, recipientPhone: t.recipientPhone,
              },
            })}
          />
        )}
        {['assigned', 'in_progress', 'completed'].includes(t.status) && (
          <Button label="Report a problem" variant="ghost" onPress={() => navigation.navigate('ReportProblem', { taskId: t.id })} />
        )}
      </View>
    </ScrollView>
  );
}

function RatePm({ t }) {
  const [stars, setStars] = useState(0);
  const [review, setReview] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (t.customerRatingOfWorker != null) {
    return (
      <Card style={{ alignItems: 'center', gap: 6 }}>
        <Text style={{ fontWeight: '700', color: colors.text }}>You rated this task</Text>
        <Stars value={t.customerRatingOfWorker} size={22} />
      </Card>
    );
  }

  async function submit() {
    setError(''); setBusy(true);
    try { await rateTask(t.id, stars, review.trim()); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <Card style={{ gap: spacing.md }}>
      <Text style={{ fontWeight: '700', fontSize: 15, color: colors.text }}>How did {t.worker?.name?.split(' ')[0] || 'your Personal Manager'} do?</Text>
      <Stars value={stars} onChange={setStars} />
      <Input placeholder="Anything you'd like to add? (optional)" value={review} onChangeText={setReview} multiline />
      <ErrorText>{error}</ErrorText>
      <Button label={busy ? 'Saving…' : 'Submit rating'} onPress={submit} disabled={busy || !stars} />
    </Card>
  );
}

function CancelTask({ t }) {
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!confirming) {
    return <Button label="Cancel this task" variant="ghost" onPress={() => setConfirming(true)} />;
  }

  async function confirm() {
    setError(''); setBusy(true);
    try { await cancelTask(t.id, reason.trim()); } catch (e) { setError(e.message); setBusy(false); }
  }

  return (
    <Card style={{ gap: spacing.md, borderColor: colors.danger }}>
      <Text style={{ fontWeight: '700', color: colors.text }}>Cancel this task?</Text>
      <Input placeholder="Reason (optional)" value={reason} onChangeText={setReason} />
      <ErrorText>{error}</ErrorText>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Button label="Keep it" variant="ghost" style={{ flex: 1 }} onPress={() => setConfirming(false)} />
        <Button label={busy ? 'Cancelling…' : 'Yes, cancel'} variant="danger" style={{ flex: 1 }} onPress={confirm} disabled={busy} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  sibling: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 8 },
  h1: { fontSize: 21, fontWeight: '800', color: colors.text },
  h2: { fontSize: 15, fontWeight: '700', color: colors.text },
  title: { fontWeight: '700', fontSize: 16.5, color: colors.text },
  desc: { color: colors.muted, fontSize: 13.5, lineHeight: 20 },
  statusCopy: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  metaVal: { fontWeight: '700', fontSize: 13.5, color: colors.text },
  mutedSmall: { fontSize: 12.5, color: colors.muted, fontWeight: '700' },
  subtleBox: { backgroundColor: colors.surfaceAlt, borderRadius: radius.sm, padding: 12 },
  subtleText: { fontSize: 13, color: colors.muted },
  visitDot: {
    width: 20, height: 20, borderRadius: 10, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  footnote: { fontSize: 12, color: colors.muted, marginTop: 12 },
  otp: { fontWeight: '800', fontSize: 24, letterSpacing: 3, color: colors.accentDark },
  avatar: { width: 50, height: 50, borderRadius: 25, backgroundColor: colors.accentLight, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontWeight: '800', color: colors.accentDark, fontSize: 16 },
});

function PriceCard({ t }) {
  const p = priceSummary(t);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (['cancelled', 'completed'].includes(t.status)) return null;
  async function confirm() {
    setBusy(true); setError('');
    try { await confirmTaskPrice(t.id); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return (
    <Card style={{ marginBottom: spacing.lg, gap: spacing.sm }}>
      <FieldLabel>Price</FieldLabel>
      <Text style={styles.h2}>{p.label}</Text>
      <Text style={styles.mutedSmall}>{p.detail}</Text>
      {t.priceStatus === 'awaiting_confirmation' && <Button label="Confirm this price" onPress={confirm} disabled={busy} />}
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}

// The code is only returned once, when the customer asks for it. It is never stored readable.
function CompletionCode({ t }) {
  const [code, setCode] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function show() {
    setBusy(true); setError('');
    try { setCode(await issueCompletionCode(t.id)); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return (
    <Card style={{ marginBottom: spacing.lg, backgroundColor: colors.accentLight, borderColor: 'transparent', gap: spacing.sm }}>
      <FieldLabel><Text style={{ color: colors.accentDark }}>Completion code</Text></FieldLabel>
      <Text style={{ color: colors.accentDark, fontSize: 14, lineHeight: 20 }}>
        Show the code to your Personal Manager only once {t.taskType === 'ongoing' ? 'the final visit is' : 'the task is'} actually done.
      </Text>
      {code && <Text style={styles.otp}>{code.code}</Text>}
      <Button label={code ? 'Show a new code' : 'Show my completion code'} onPress={show} disabled={busy} />
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}
