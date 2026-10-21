// Problems raised by customers and Personal Managers. Any admin can resolve them.
import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { colors, spacing } from '../../theme';
import { Card, Badge, Button, Chip, Input, ErrorText } from '../../components/UI';
import { timeAgo } from '../../data/store';
import { REPORT_REASONS } from '../../data/extras';
import { useLiveQuery, listReports, resolveReport } from '../../data/adminData';

const reasonLabel = (id) => REPORT_REASONS.find((r) => r.id === id)?.label || id;

export default function AdminReportsScreen({ navigation }) {
  const [tab, setTab] = useState('open');
  const { data, error } = useLiveQuery(listReports, ['reports'], navigation);
  const list = (data || []).filter((r) => r.status === tab);
  const count = (s) => (data || []).filter((r) => r.status === s).length;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60, gap: spacing.md }}>
      <View style={styles.chips}>
        <Chip label={`Open · ${count('open')}`} selected={tab === 'open'} onPress={() => setTab('open')} tone={count('open') ? 'danger' : 'accent'} />
        <Chip label={`Resolved · ${count('resolved')}`} selected={tab === 'resolved'} onPress={() => setTab('resolved')} />
      </View>
      <ErrorText>{error}</ErrorText>
      {list.map((r) => <ReportCard key={r.id} r={r} navigation={navigation} />)}
      {data && !list.length && <Text style={styles.empty}>{tab === 'open' ? 'No open reports. 🎉' : 'Nothing resolved yet.'}</Text>}
      {!data && !error && <Text style={styles.empty}>Loading…</Text>}
    </ScrollView>
  );
}

function ReportCard({ r, navigation }) {
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function resolve() {
    setError(''); setBusy(true);
    try { await resolveReport(r.id, note.trim()); } catch (e) { setError(e.message); setBusy(false); }
  }

  return (
    <Card style={{ gap: spacing.sm }}>
      <View style={styles.top}>
        <Badge label={reasonLabel(r.reason)} tone={r.reason === 'safety' ? 'danger' : 'brass'} />
        <Text style={styles.time}>{timeAgo(r.created_at)}</Text>
      </View>
      <Text style={styles.title}>{r.task?.title || 'A task'}</Text>
      <Text style={styles.meta}>Reported by {r.reporter?.full_name || 'someone'} ({r.reporter?.role === 'worker' ? 'Personal Manager' : 'customer'})</Text>
      {!!r.details && <Text style={styles.details}>“{r.details}”</Text>}
      {r.task?.id && (
        <Button label="Open the task" variant="ghost" size="sm" onPress={() => navigation.navigate('AdminTask', { taskId: r.task.id })} />
      )}
      {r.status === 'open' ? (
        <View style={{ gap: spacing.sm }}>
          <Input multiline placeholder="What did you do about it? The reporter will see this." value={note} onChangeText={setNote} />
          <ErrorText>{error}</ErrorText>
          <Button label={busy ? 'Saving…' : 'Mark resolved'} disabled={busy || !note.trim()} onPress={resolve} />
        </View>
      ) : (
        <Text style={styles.resolved}>Resolved {timeAgo(r.resolved_at)}: “{r.resolution_note}”</Text>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', gap: 8 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  time: { color: colors.muted, fontSize: 12 },
  title: { fontWeight: '800', fontSize: 15.5, color: colors.text },
  meta: { color: colors.muted, fontSize: 13 },
  details: { color: colors.text, fontSize: 13.5, lineHeight: 20, fontStyle: 'italic' },
  resolved: { color: colors.successText, fontSize: 13, lineHeight: 19 },
  empty: { color: colors.muted, textAlign: 'center', padding: 28, fontSize: 13.5 },
});
