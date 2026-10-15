import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { colors, spacing, radius } from '../theme';
import { Card, Button, ErrorText } from '../components/UI';
import { useNotifications, markNotificationsRead } from '../data/extras';
import { timeAgo } from '../data/store';

const ICON = { task: '📋', application: '🪪', report: '⚠️', payout: '💸', announcement: '📣', info: 'ℹ️' };

export default function NotificationsScreen({ navigation }) {
  const { items, unread, unavailable, loaded } = useNotifications();
  const [error, setError] = useState('');

  // Open the right screen for whoever is looking: each role's navigator names its task screen differently.
  const taskScreen = (() => {
    const names = navigation.getState()?.routeNames || [];
    return names.includes('AdminTask') ? 'AdminTask' : names.includes('WorkerJob') ? 'WorkerJob' : names.includes('TrackTask') ? 'TrackTask' : null;
  })();

  async function open(n) {
    setError('');
    try { if (!n.read_at) await markNotificationsRead([n.id]); } catch (e) { setError(e.message); }
    if (n.task_id && taskScreen) navigation.navigate(taskScreen, { taskId: n.task_id });
  }

  async function readAll() {
    setError('');
    try { await markNotificationsRead(null); } catch (e) { setError(e.message); }
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60, gap: spacing.sm }}>
      <View style={styles.head}>
        <Text style={styles.sub}>{unread ? `${unread} unread` : 'All caught up'}</Text>
        {unread > 0 && <Button label="Mark all read" size="sm" variant="ghost" onPress={readAll} />}
      </View>
      <ErrorText>{error}</ErrorText>
      {unavailable && <Text style={styles.empty}>Notifications are not switched on for this project yet.</Text>}
      {loaded && !unavailable && !items.length && <Text style={styles.empty}>Nothing yet. Updates about your tasks will show up here.</Text>}
      {items.map((n) => (
        <Pressable key={n.id} onPress={() => open(n)}>
          <Card style={[styles.row, !n.read_at && styles.unread]}>
            <Text style={{ fontSize: 20 }}>{ICON[n.kind] || ICON.info}</Text>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[styles.title, !n.read_at && { fontWeight: '800' }]}>{n.title}</Text>
              {!!n.body && <Text style={styles.body} numberOfLines={3}>{n.body}</Text>}
              <Text style={styles.time}>{timeAgo(n.created_at)}</Text>
            </View>
            {!n.read_at && <View style={styles.dot} />}
          </Card>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  sub: { color: colors.muted, fontWeight: '700', fontSize: 13 },
  row: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  unread: { borderColor: colors.accent, backgroundColor: colors.accentLight },
  title: { fontWeight: '700', fontSize: 14, color: colors.text },
  body: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  time: { color: colors.faint, fontSize: 12, marginTop: 2 },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.accent, marginTop: 6 },
  empty: { color: colors.faint, textAlign: 'center', padding: 28, fontSize: 13.5, lineHeight: 20 },
});
