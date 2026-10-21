// Customer or Personal Manager reports a problem on a task they are part of.
// Admins see it in their Reports inbox.
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { colors, spacing } from '../theme';
import { Card, Button, Chip, Input, ErrorText, FieldLabel } from '../components/UI';
import { REPORT_REASONS, reportTask, myReportsFor } from '../data/extras';
import { useTasks, getTask } from '../data/store';

export default function ReportProblemScreen({ route, navigation }) {
  useTasks();
  const { taskId } = route.params;
  const t = getTask(taskId);
  const [reason, setReason] = useState(null);
  const [details, setDetails] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [earlier, setEarlier] = useState([]);

  useEffect(() => { myReportsFor(taskId).then(setEarlier); }, [taskId, sent]);

  if (!t) return <Text style={{ padding: 20, color: colors.muted }}>Loading…</Text>;
  const open = earlier.find((r) => r.status === 'open');

  async function submit() {
    setError(''); setBusy(true);
    try { await reportTask(taskId, reason, details.trim()); setSent(true); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  if (sent || open) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}>
        <Card style={{ gap: 8, alignItems: 'center' }}>
          <Text style={{ fontSize: 34 }}>✅</Text>
          <Text style={styles.h1}>{sent ? 'Report sent' : 'We have your report'}</Text>
          <Text style={styles.body}>Our team has been told and will look into "{t.title}". You will get a notification when it is resolved.</Text>
        </Card>
        <Button label="Back to task" variant="ghost" onPress={() => navigation.goBack()} />
      </ScrollView>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: 60 }}>
      <View>
        <Text style={styles.h1}>Report a problem</Text>
        <Text style={styles.body}>About: {t.title}</Text>
      </View>
      <Card style={{ gap: spacing.md }}>
        <View>
          <FieldLabel>What went wrong?</FieldLabel>
          <View style={styles.chips}>
            {REPORT_REASONS.map((r) => (
              <Chip key={r.id} label={r.label} selected={reason === r.id} tone={r.id === 'safety' ? 'danger' : 'accent'} onPress={() => setReason(r.id)} />
            ))}
          </View>
        </View>
        <View>
          <FieldLabel>Tell us more (optional)</FieldLabel>
          <Input multiline placeholder="What happened, and when?" value={details} onChangeText={setDetails} />
        </View>
        <ErrorText>{error}</ErrorText>
        <Button label={busy ? 'Sending…' : 'Send report'} onPress={submit} disabled={busy || !reason} />
      </Card>
      <Text style={styles.hint}>If anyone is in danger, call the emergency services first. This form is not monitored around the clock.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  h1: { fontSize: 21, fontWeight: '800', color: colors.text, marginBottom: 2 },
  body: { color: colors.muted, fontSize: 14, lineHeight: 20, textAlign: 'left' },
  hint: { color: colors.muted, fontSize: 12.5, lineHeight: 18 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
