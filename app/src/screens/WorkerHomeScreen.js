import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Switch } from 'react-native';
import { colors, spacing, radius } from '../theme';
import { Card, Badge, ErrorText } from '../components/UI';
import {
  useTasks, assignedTasksFor, catMeta, STATUS_META, initials, pmEarning, formatRating, updateMyProfile,
} from '../data/store';
import { useAuth } from '../lib/AuthContext';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export default function WorkerHomeScreen({ navigation }) {
  useTasks();
  const { profile: me, refreshProfile } = useAuth();
  const [error, setError] = useState('');
  if (!me) return <Text style={{ padding: 20 }}>Loading your profile…</Text>;

  const mine = assignedTasksFor(me.id);
  const offers = mine.filter((t) => t.status === 'matched');
  const upcoming = mine.filter((t) => t.status === 'assigned');
  const active = mine.filter((t) => t.status === 'in_progress');
  const done = mine.filter((t) => t.status === 'completed');
  const weekEarnings = done
    .filter((t) => t.completedAt && Date.now() - new Date(t.completedAt).getTime() < WEEK_MS)
    .reduce((sum, t) => sum + pmEarning(t), 0);
  const open = (t) => navigation.navigate('WorkerJob', { taskId: t.id });

  async function toggleOnline(value) {
    setError('');
    try { await updateMyProfile(me.id, { online: value }); await refreshProfile(); } catch (e) { setError(e.message); }
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.small}>Signed in as</Text>
          <Text style={{ fontWeight: '800', fontSize: 15, color: colors.text }}>{me.full_name}</Text>
        </View>
        <Pressable onPress={() => navigation.navigate('Account')} style={styles.avatar} accessibilityLabel="Account">
          <Text style={styles.avatarText}>{initials(me.full_name)}</Text>
        </Pressable>
      </View>

      <Card style={styles.onlineCard}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontWeight: '700', color: colors.text }}>{me.online ? 'Available for new tasks' : 'Not taking new tasks'}</Text>
          <Text style={{ fontSize: 12.5, color: colors.muted, marginTop: 2 }}>
            {me.online ? 'Admins can offer you tasks.' : 'Admins will see you as unavailable.'}
          </Text>
        </View>
        <Switch value={!!me.online} onValueChange={toggleOnline} trackColor={{ true: colors.accent }} />
      </Card>
      <ErrorText>{error}</ErrorText>

      {offers.map((t) => (
        <Pressable key={t.id} onPress={() => open(t)}>
          <View style={styles.newAssignment}>
            <Text style={{ fontSize: 20 }}>🔔</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ color: 'white', fontWeight: '700', fontSize: 14 }}>New task offered to you</Text>
              <Text style={{ color: 'white', opacity: 0.9, fontSize: 12.5 }}>{t.title} · tap to accept or decline</Text>
            </View>
            <Text style={{ color: 'white', fontSize: 16 }}>›</Text>
          </View>
        </Pressable>
      ))}

      <View style={styles.statRow}>
        <Card style={{ flex: 1 }}>
          <Text style={styles.statLabel}>Earned this week</Text>
          <Text style={styles.statVal}>₹{weekEarnings.toLocaleString('en-IN')}</Text>
        </Card>
        <Card style={{ flex: 1 }}>
          <Text style={styles.statLabel}>Rating</Text>
          <Text style={styles.statVal}>{formatRating(me.rating, me.rating_count)}</Text>
        </Card>
        <Card style={{ flex: 1 }}>
          <Text style={styles.statLabel}>Tasks done</Text>
          <Text style={styles.statVal}>{me.jobs_done || 0}</Text>
        </Card>
      </View>

      <Section title="In progress" items={active} onOpen={open} empty="Nothing in progress right now." />
      <Section title="Accepted — coming up" items={upcoming} onOpen={open} empty="No upcoming tasks." />
      <Section title="Completed" items={done} onOpen={open} empty="No completed tasks yet." />
    </ScrollView>
  );
}

function Section({ title, items, onOpen, empty }) {
  return (
    <>
      <Text style={styles.h2}>{title}</Text>
      <View style={{ gap: spacing.sm, marginBottom: spacing.lg }}>
        {items.length ? items.map((t) => <TaskRow key={t.id} t={t} onPress={() => onOpen(t)} />) : <Text style={styles.emptyText}>{empty}</Text>}
      </View>
    </>
  );
}

function TaskRow({ t, onPress }) {
  const meta = STATUS_META[t.status];
  return (
    <Pressable onPress={onPress}>
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Text style={{ fontSize: 16 }}>{catMeta(t.category).emoji}</Text>
        <View style={{ flex: 1 }}>
          <Text style={{ fontWeight: '700', fontSize: 13.5, color: colors.text }} numberOfLines={1}>{t.title}</Text>
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>{t.scheduledFor || 'Flexible'} · {t.location}</Text>
        </View>
        <Badge label={meta.pmLabel} tone={meta.tone} />
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.lg },
  small: { color: colors.muted, fontSize: 13, fontWeight: '600', marginBottom: 6 },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.accentLight, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontWeight: '800', color: colors.accentDark },
  onlineCard: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: spacing.md },
  newAssignment: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 15, borderRadius: radius.lg,
    backgroundColor: colors.accent, marginBottom: spacing.md,
  },
  statRow: { flexDirection: 'row', gap: 10, marginBottom: spacing.lg },
  statLabel: { fontSize: 12, color: colors.muted, fontWeight: '600' },
  statVal: { fontWeight: '800', fontSize: 16, marginTop: 3, color: colors.text },
  h2: { fontSize: 14.5, fontWeight: '700', marginBottom: 10, color: colors.text },
  emptyText: { color: colors.faint, fontSize: 13.5 },
});
