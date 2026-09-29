import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { colors, spacing, radius } from '../theme';
import { Card, Badge, StatusTracker, FieldLabel } from '../components/UI';
import { useTasks, getTask, worker, catMeta, visitsDone, runningTotal, STATUS_META } from '../data/store';

export default function TrackTaskScreen({ route }) {
  useTasks(); // subscribe so this screen re-renders when admin/worker actions change the task
  const { taskId } = route.params;
  const t = getTask(taskId);
  if (!t) return <Text style={{ padding: 20 }}>Task not found.</Text>;
  const w = t.assignedWorkerId ? worker(t.assignedWorkerId) : null;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }}>
      <View style={styles.headerRow}>
        <Text style={styles.h1}>Task #MT-{taskId.slice(1).padStart(5, '0')}</Text>
        <Badge label={STATUS_META[t.status].label} tone={t.status === 'completed' ? 'success' : 'accent'} />
      </View>

      <Card style={{ marginBottom: spacing.lg }}>
        <StatusTracker status={t.status} />
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
              {t.recipientName} ({t.recipientRelation})
            </Text>
          </View>
        )}
        <View style={{ flexDirection: 'row', gap: 24, flexWrap: 'wrap' }}>
          <View>
            <FieldLabel>Scheduled</FieldLabel>
            <Text style={styles.metaVal}>{t.scheduledFor}</Text>
          </View>
          <View>
            <FieldLabel>📍 Location</FieldLabel>
            <Text style={styles.metaVal}>{t.location}</Text>
          </View>
          <View>
            <FieldLabel>{t.taskType === 'ongoing' ? 'Price per day' : 'Est. cost'}</FieldLabel>
            <Text style={styles.metaVal}>{t.taskType === 'ongoing' ? `₹${t.ratePerDay || 0}/day` : t.estCost ? `₹${t.estCost}` : '—'}</Text>
          </View>
        </View>
      </Card>

      {t.taskType === 'ongoing' && (
        <Card style={{ marginBottom: spacing.lg }}>
          <View style={styles.headerRow}>
            <Text style={styles.h2}>Visit log</Text>
            <Text style={styles.mutedSmall}>
              {visitsDone(t)} visit{visitsDone(t) === 1 ? '' : 's'} · ₹{runningTotal(t)} so far
            </Text>
          </View>
          <View style={{ gap: 10, marginTop: 10 }}>
            {t.visits.length ? (
              t.visits.map((v, i) => (
                <View key={i} style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={[styles.visitDot, v.done && { backgroundColor: colors.success, borderColor: colors.success }]}>
                    {v.done && <Text style={{ color: 'white', fontSize: 10, fontWeight: '700' }}>✓</Text>}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: '700', fontSize: 13.5 }}>
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

      {(t.status === 'assigned' || t.status === 'in_progress') && t.otp && (
        <Card style={{ marginBottom: spacing.lg, backgroundColor: colors.accentLight, borderColor: 'transparent' }}>
          <FieldLabel>
            <Text style={{ color: colors.accentDark }}>Completion code</Text>
          </FieldLabel>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <Text style={{ color: colors.accentDark, fontSize: 12.5, flex: 1, lineHeight: 18 }}>
              Share this code with your Personal Manager only once {t.taskType === 'ongoing' ? 'the final visit is' : 'the task is'} actually done.
            </Text>
            <Text style={styles.otp}>{t.otp}</Text>
          </View>
        </Card>
      )}

      {w ? (
        <Card>
          <FieldLabel>Your Personal Manager</FieldLabel>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{w.initials}</Text>
            </View>
            <View>
              <Text style={{ fontWeight: '700', fontSize: 15.5 }}>{w.name}</Text>
              <Text style={{ color: colors.muted, fontSize: 13, marginTop: 2 }}>★ {w.rating.toFixed(1)} · {w.jobsDone} tasks</Text>
            </View>
          </View>
        </Card>
      ) : (
        <Card>
          <Text style={{ color: colors.muted, textAlign: 'center', fontSize: 13.5 }}>
            We're finding you a qualified Personal Manager — this usually takes a few minutes.
          </Text>
        </Card>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 8 },
  h1: { fontSize: 21, fontWeight: '800', color: colors.text },
  h2: { fontSize: 15, fontWeight: '700', color: colors.text },
  title: { fontWeight: '700', fontSize: 16.5, color: colors.text },
  desc: { color: colors.muted, fontSize: 13.5, lineHeight: 20 },
  metaVal: { fontWeight: '700', fontSize: 13.5, color: colors.text },
  mutedSmall: { fontSize: 12.5, color: colors.muted, fontWeight: '700' },
  subtleBox: { backgroundColor: colors.surfaceAlt, borderRadius: radius.sm, padding: 12 },
  subtleText: { fontSize: 13, color: colors.muted },
  visitDot: {
    width: 20, height: 20, borderRadius: 10, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  footnote: { fontSize: 12, color: colors.faint, marginTop: 12 },
  otp: { fontWeight: '800', fontSize: 24, letterSpacing: 3, color: colors.accentDark },
  avatar: { width: 50, height: 50, borderRadius: 25, backgroundColor: colors.accentLight, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontWeight: '800', color: colors.accentDark, fontSize: 16 },
});
