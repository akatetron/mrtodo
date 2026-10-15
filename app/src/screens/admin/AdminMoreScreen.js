// The admin tools menu. Rows that need a super admin say so and stay shut for
// support admins; the database refuses those actions regardless.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { colors, spacing, radius } from '../../theme';
import { Card, Badge, ErrorText } from '../../components/UI';
import { useAuth } from '../../lib/AuthContext';
import { useTasks, catMeta, shortId, runningTotal } from '../../data/store';
import { exportCsv } from '../../data/extras';
import { adminCounts, isSuperAdmin, adminLevel } from '../../data/adminData';

export default function AdminMoreScreen({ navigation }) {
  const tasks = useTasks();
  const { profile } = useAuth();
  const superAdmin = isSuperAdmin(profile);
  const [counts, setCounts] = useState({ applications: 0, reports: 0 });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => { adminCounts().then(setCounts).catch(() => {}); }, []);
  useEffect(() => {
    load();
    return navigation.addListener('focus', load);
  }, [load, navigation]);

  async function exportTasks() {
    setError(''); setMessage('');
    try {
      const name = await exportCsv('tasks', tasks.map((t) => ({
        id: shortId(t.id), title: t.title, category: catMeta(t.category).label, type: t.taskType, status: t.status,
        customer: t.customer?.name || '', customer_phone: t.customer?.phone || '', personal_manager: t.worker?.name || '',
        location: t.location, scheduled: t.scheduledFor || '', value_inr: runningTotal(t),
        posted: t.createdAt, completed: t.completedAt || '', customer_rating: t.customerRatingOfWorker ?? '',
      })));
      setMessage(`Exported ${tasks.length} tasks (${name}).`);
    } catch (e) { setError(e.message); }
  }

  const rows = [
    { icon: '🪪', title: 'Applications', sub: 'People applying to become Personal Managers', route: 'AdminApplications', badge: counts.applications },
    { icon: '⚠️', title: 'Reports', sub: 'Problems raised by customers and Personal Managers', route: 'AdminReports', badge: counts.reports },
    { icon: '👥', title: 'People', sub: 'Every customer and Personal Manager, with their history', route: 'AdminPeople' },
    { icon: '⭐', title: 'Reviews', sub: 'Ratings and comments, lowest first', route: 'AdminReviews' },
    { icon: '📈', title: 'Insights', sub: 'Demand by category and area, and where to recruit', route: 'AdminInsights' },
    { icon: '💰', title: 'Money', sub: 'Job value, platform share and what Personal Managers are owed', route: 'AdminMoney', superOnly: true },
    { icon: '📣', title: 'Broadcast', sub: 'Send a message to everyone, or just one group', route: 'AdminBroadcast', superOnly: true },
    { icon: '🛡', title: 'Admin team', sub: 'Who can do what', route: 'AdminTeam' },
  ];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60, gap: spacing.sm }}>
      <Text style={styles.level}>You are signed in as a <Text style={{ fontWeight: '800' }}>{adminLevel(profile)} admin</Text>.</Text>
      {rows.map((r) => {
        const locked = r.superOnly && !superAdmin;
        return (
          <Pressable key={r.route} disabled={locked} onPress={() => navigation.navigate(r.route)}>
            <Card style={[styles.row, locked && { opacity: 0.55 }]}>
              <Text style={{ fontSize: 22 }}>{r.icon}</Text>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.title}>{r.title}</Text>
                <Text style={styles.sub}>{locked ? 'Super admins only' : r.sub}</Text>
              </View>
              {!!r.badge && <Badge label={String(r.badge)} tone="brass" />}
              {!locked && <Text style={{ color: colors.faint, fontSize: 18 }}>›</Text>}
            </Card>
          </Pressable>
        );
      })}
      <Pressable onPress={exportTasks}>
        <Card style={styles.row}>
          <Text style={{ fontSize: 22 }}>⬇️</Text>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.title}>Export all tasks (CSV)</Text>
            <Text style={styles.sub}>For your accountant or a spreadsheet</Text>
          </View>
        </Card>
      </Pressable>
      {!!message && <Text style={styles.ok}>{message}</Text>}
      <ErrorText>{error}</ErrorText>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  level: { color: colors.muted, fontSize: 13, marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  title: { fontWeight: '700', fontSize: 15, color: colors.text },
  sub: { color: colors.muted, fontSize: 12.5, lineHeight: 17 },
  ok: { color: colors.success, fontWeight: '700', fontSize: 13, marginTop: spacing.sm },
});
