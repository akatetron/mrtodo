// What is happening behind the scenes: routing, escalations, notifications,
// payment webhooks, and the Gold Tier list. Numbers come from the database.
import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { colors, spacing } from '../../theme';
import { Card, Badge, ErrorText } from '../../components/UI';
import { opsSummary, goldOverview, listDeadOutbox, useLiveQuery } from '../../data/adminData';
import { formatRating } from '../../data/store';

const EVENT_LABEL = { 'routing.claimed': 'Tasks claimed', 'routing.claim_lost': 'Claim conflicts (someone else was first)', 'escalation.refused': 'Escalations refused (too early)', 'outbox.dead': 'Notifications that failed for good', 'subscription.unknown': 'Payment events for unknown subscriptions' };

export default function AdminOpsScreen({ navigation }) {
  const { data: ops, error } = useLiveQuery(opsSummary, ['ops_events', 'escalations', 'outbox'], navigation);
  const { data: gold } = useLiveQuery(goldOverview, ['profiles'], navigation);
  const { data: dead } = useLiveQuery(listDeadOutbox, ['outbox'], navigation);
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60, gap: spacing.md }}>
      <ErrorText>{error}</ErrorText>
      {ops && (
        <>
          <View style={styles.stats}>
            <Stat label="Open escalations" value={ops.open_escalations} bad={ops.open_escalations > 0} />
            <Stat label="Waiting over the SLA" value={ops.unassigned_over_sla} bad={ops.unassigned_over_sla > 0} />
          </View>
          <Card style={{ gap: 6 }}>
            <Text style={styles.h2}>Last 24 hours</Text>
            {Object.entries(ops.events_24h).length ? Object.entries(ops.events_24h).map(([k, n]) => <Text key={k} style={styles.line}>{EVENT_LABEL[k] || k}: {n}</Text>) : <Text style={styles.hint}>Nothing logged.</Text>}
          </Card>
          <Card style={{ gap: 6 }}>
            <Text style={styles.h2}>Notifications</Text>
            {Object.entries(ops.outbox).length ? Object.entries(ops.outbox).map(([k, n]) => <Text key={k} style={styles.line}>{k}: {n}</Text>) : <Text style={styles.hint}>No push notifications queued.</Text>}
            {(dead || []).map((d) => <Text key={d.id} style={styles.hint}>Failed for good #{d.id}: {d.last_error}</Text>)}
          </Card>
          <Card style={{ gap: 6 }}>
            <Text style={styles.h2}>Payment webhooks (24h)</Text>
            {Object.entries(ops.webhooks_24h).length ? Object.entries(ops.webhooks_24h).map(([k, n]) => <Text key={k} style={styles.line}>{k}: {n}</Text>) : <Text style={styles.hint}>None received.</Text>}
          </Card>
        </>
      )}
      <Card style={{ gap: 6 }}>
        <Text style={styles.h2}>Gold Tier Personal Managers</Text>
        {(gold || []).map((g) => <Text key={g.id} style={styles.line}>{g.full_name} · {g.verified_jobs} jobs · {formatRating(g.rating, g.rating_count)}</Text>)}
        {gold && !gold.length && <Text style={styles.hint}>None yet. Gold needs more than 50 verified jobs and an average rating above 4.8.</Text>}
      </Card>
    </ScrollView>
  );
}
function Stat({ label, value, bad }) {
  return <Card style={[{ flex: 1, gap: 4 }, bad && { borderColor: colors.danger, borderWidth: 2 }]}><Text style={styles.hint}>{label}</Text><Text style={styles.big}>{value}</Text>{bad && <Badge label="Needs attention" tone="danger" />}</Card>;
}
const styles = StyleSheet.create({
  stats: { flexDirection: 'row', gap: spacing.md }, big: { fontSize: 30, fontWeight: '800', color: colors.text },
  h2: { fontSize: 18, fontWeight: '800', color: colors.text }, line: { fontSize: 15, color: colors.text }, hint: { fontSize: 14, color: colors.muted, lineHeight: 20 },
});
