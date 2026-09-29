import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { colors, spacing, radius } from '../theme';
import { Card, Badge } from '../components/UI';
import { useTasks, assignedTasksFor, catMeta, STATUS_META } from '../data/store';
import { useAuth } from '../lib/AuthContext';

export default function WorkerHomeScreen({ navigation }) {
  useTasks();
  const { profile, signOut } = useAuth();
  const me = profile;
  if (!me) return <Text style={{ padding: 20 }}>Loading your profile…</Text>;
  const initials = (me.full_name || '?').split(' ').map((s) => s[0]).join('').slice(0, 2).toUpperCase();
  const mine = assignedTasksFor(me.id);
  const assigned = mine.filter((t) => t.status === 'assigned');
  const active = mine.filter((t) => t.status === 'in_progress');
  const done = mine.filter((t) => t.status === 'completed');

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.small}>Signed in as</Text>
          <Text style={{ fontWeight: '800', fontSize: 15, color: colors.text }}>{me.full_name}</Text>
        </View>
        <Pressable onPress={signOut} style={styles.avatar}>
          <Text style={styles.avatarText}>{initials}</Text>
        </Pressable>
      </View>

      {assigned.map((t) => (
        <Pressable key={t.id} onPress={() => navigation.navigate('WorkerJob', { taskId: t.id })}>
          <View style={styles.newAssignment}>
            <Text style={{ fontSize: 20 }}>🔔</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ color: 'white', fontWeight: '700', fontSize: 14 }}>New task assigned</Text>
              <Text style={{ color: 'white', opacity: 0.9, fontSize: 12.5 }}>{t.title}</Text>
            </View>
            <Text style={{ color: 'white', fontSize: 16 }}>›</Text>
          </View>
        </Pressable>
      ))}

      <View style={styles.statRow}>
        <Card style={{ flex: 1 }}>
          <Text style={styles.statLabel}>This week</Text>
          <Text style={styles.statVal}>₹6,240</Text>
        </Card>
        <Card style={{ flex: 1 }}>
          <Text style={styles.statLabel}>Rating</Text>
          <Text style={styles.statVal}>★ {(me.rating || 0).toFixed(1)}</Text>
        </Card>
      </View>

      <Text style={styles.h2}>In progress</Text>
      <View style={{ gap: spacing.sm, marginBottom: spacing.lg }}>
        {active.length ? active.map((t) => <TaskRow key={t.id} t={t} onPress={() => navigation.navigate('WorkerJob', { taskId: t.id })} />) : <Text style={styles.emptyText}>Nothing in progress right now.</Text>}
      </View>

      <Text style={styles.h2}>Completed</Text>
      <View style={{ gap: spacing.sm }}>
        {done.length ? done.map((t) => <TaskRow key={t.id} t={t} onPress={() => navigation.navigate('WorkerJob', { taskId: t.id })} />) : <Text style={styles.emptyText}>No completed tasks yet.</Text>}
      </View>
    </ScrollView>
  );
}

function TaskRow({ t, onPress }) {
  return (
    <Pressable onPress={onPress}>
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Text style={{ fontSize: 16 }}>{catMeta(t.category).emoji}</Text>
        <View style={{ flex: 1 }}>
          <Text style={{ fontWeight: '700', fontSize: 13.5 }} numberOfLines={1}>{t.title}</Text>
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>{t.location}</Text>
        </View>
        <Badge label={STATUS_META[t.status].label} tone={t.status === 'completed' ? 'success' : 'accent'} />
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.lg },
  small: { color: colors.muted, fontSize: 13, fontWeight: '600', marginBottom: 6 },
  pickerRow: { flexDirection: 'row', gap: 6 },
  pickChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt },
  pickChipText: { fontSize: 12.5, fontWeight: '700', color: colors.text },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.accentLight, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontWeight: '800', color: colors.accentDark },
  newAssignment: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 15, borderRadius: radius.lg,
    backgroundColor: colors.accent, marginBottom: spacing.md,
  },
  statRow: { flexDirection: 'row', gap: 10, marginBottom: spacing.lg },
  statLabel: { fontSize: 12, color: colors.muted, fontWeight: '600' },
  statVal: { fontWeight: '800', fontSize: 17, marginTop: 3, color: colors.text },
  h2: { fontSize: 14.5, fontWeight: '700', marginBottom: 10, color: colors.text },
  emptyText: { color: colors.faint, fontSize: 13.5 },
});
