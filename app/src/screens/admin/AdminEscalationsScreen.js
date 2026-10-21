// Customers who said their Personal Manager is late. Newest first; open ones stay on top.
import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { colors, spacing } from '../../theme';
import { Card, Badge, Button, Input, ErrorText } from '../../components/UI';
import { listEscalations, resolveEscalation, unassignTask, useLiveQuery } from '../../data/adminData';
import { shortId, timeAgo } from '../../data/store';

export default function AdminEscalationsScreen({ navigation }) {
  const { data, error } = useLiveQuery(listEscalations, ['escalations', 'tasks'], navigation);
  const [notes, setNotes] = useState({});
  const [err, setErr] = useState('');
  const act = async (fn) => { setErr(''); try { await fn(); } catch (e) { setErr(e.message); } };
  const rows = [...(data || [])].sort((a, b) => (a.status === b.status ? 0 : a.status === 'open' ? -1 : 1));
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60, gap: spacing.md }}>
      <ErrorText>{error || err}</ErrorText>
      {data && !rows.length && <Text style={styles.hint}>No escalations. A customer can escalate once their Personal Manager is more than 15 minutes late.</Text>}
      {rows.map((e) => (
        <Card key={e.id} style={[{ gap: spacing.sm }, e.status === 'open' && { borderColor: colors.danger, borderWidth: 3 }]}>
          <View style={styles.row}>
            <Badge label={e.status === 'open' ? 'Escalated' : 'Resolved'} tone={e.status === 'open' ? 'danger' : 'success'} />
            <Text style={styles.hint}>{timeAgo(e.created_at)} · {e.minutes_late} min late when raised</Text>
          </View>
          <Text style={styles.title}>#{shortId(e.task_id)} {e.task?.title}</Text>
          <Text style={styles.hint}>Scheduled {e.task?.scheduled_at ? new Date(e.task.scheduled_at).toLocaleString() : '—'} · task is {e.task?.status}</Text>
          {!!e.reason && <Text style={styles.line}>Customer says: “{e.reason}”</Text>}
          {e.status === 'resolved' && <Text style={styles.line}>Resolution: {e.resolution}</Text>}
          <Button size="sm" variant="ghost" label="Open the task" onPress={() => navigation.navigate('AdminTask', { taskId: e.task_id })} />
          {e.status === 'open' && (
            <>
              <Input placeholder="What did you do? (required)" value={notes[e.id] || ''} onChangeText={(v) => setNotes({ ...notes, [e.id]: v })} />
              <View style={styles.row}>
                <Button size="sm" label="Mark resolved" onPress={() => act(() => resolveEscalation(e.id, notes[e.id] || ''))} />
                {e.task?.status === 'assigned' && <Button size="sm" variant="danger" label="Take the task back" onPress={() => act(() => unassignTask(e.task_id, notes[e.id] || ''))} />}
              </View>
              <Text style={styles.hint}>Taking the task back sends it to be offered again. A single escalation does not suspend the Personal Manager.</Text>
            </>
          )}
        </Card>
      ))}
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  title: { fontSize: 17, fontWeight: '800', color: colors.text },
  line: { fontSize: 15, lineHeight: 22, color: colors.text },
  hint: { fontSize: 14, color: colors.muted, lineHeight: 20 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
});
