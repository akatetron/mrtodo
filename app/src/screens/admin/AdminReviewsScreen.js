// Ratings left after completed tasks. Low ones first, so problems show up before complaints do.
import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { colors, spacing } from '../../theme';
import { Card, Chip, Stars } from '../../components/UI';
import { useTasks, catMeta, timeAgo } from '../../data/store';

export default function AdminReviewsScreen({ navigation }) {
  const tasks = useTasks();
  const [filter, setFilter] = useState('low');

  const rated = tasks.filter((t) => t.status === 'completed' && t.customerRatingOfWorker != null);
  const low = rated.filter((t) => t.customerRatingOfWorker <= 2);
  const list = (filter === 'low' ? low : rated)
    .slice()
    .sort((a, b) => a.customerRatingOfWorker - b.customerRatingOfWorker || new Date(b.completedAt || 0) - new Date(a.completedAt || 0));
  const avg = rated.length ? (rated.reduce((s, t) => s + t.customerRatingOfWorker, 0) / rated.length).toFixed(1) : '—';

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60, gap: spacing.sm }}>
      <View style={styles.summary}>
        <Card style={{ flex: 1 }}><Text style={styles.label}>Average</Text><Text style={styles.val}>★ {avg}</Text></Card>
        <Card style={{ flex: 1 }}><Text style={styles.label}>Rated tasks</Text><Text style={styles.val}>{rated.length}</Text></Card>
        <Card style={{ flex: 1 }}><Text style={styles.label}>2★ or lower</Text><Text style={[styles.val, low.length > 0 && { color: colors.danger }]}>{low.length}</Text></Card>
      </View>
      <View style={styles.chips}>
        <Chip label={`Low ratings · ${low.length}`} selected={filter === 'low'} tone="danger" onPress={() => setFilter('low')} />
        <Chip label={`All · ${rated.length}`} selected={filter === 'all'} onPress={() => setFilter('all')} />
      </View>
      {list.map((t) => (
        <Pressable key={t.id} onPress={() => navigation.navigate('AdminTask', { taskId: t.id })}>
          <Card style={[{ gap: 6 }, t.customerRatingOfWorker <= 2 && { borderColor: colors.danger }]}>
            <View style={styles.top}>
              <Stars value={t.customerRatingOfWorker} size={18} />
              <Text style={styles.time}>{timeAgo(t.completedAt)}</Text>
            </View>
            <Text style={styles.title} numberOfLines={1}>{catMeta(t.category).emoji} {t.title}</Text>
            {!!t.customerReview && <Text style={styles.review}>“{t.customerReview}”</Text>}
            <Text style={styles.meta}>{t.customer?.name || 'Customer'} rated {t.worker?.name || 'the Personal Manager'}</Text>
            {t.workerRatingOfCustomer != null && <Text style={styles.meta}>{t.worker?.name || 'The PM'} rated the customer {t.workerRatingOfCustomer}★</Text>}
          </Card>
        </Pressable>
      ))}
      {!list.length && <Text style={styles.empty}>{filter === 'low' ? 'No low ratings. 🎉' : 'No ratings yet.'}</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  summary: { flexDirection: 'row', gap: 10 },
  label: { fontSize: 12, color: colors.muted, fontWeight: '600' },
  val: { fontWeight: '800', fontSize: 19, marginTop: 2, color: colors.text },
  chips: { flexDirection: 'row', gap: 8, marginVertical: spacing.sm },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  time: { color: colors.muted, fontSize: 12 },
  title: { fontWeight: '700', fontSize: 14.5, color: colors.text },
  review: { color: colors.text, fontSize: 13.5, lineHeight: 20, fontStyle: 'italic' },
  meta: { color: colors.muted, fontSize: 12.5 },
  empty: { color: colors.muted, textAlign: 'center', padding: 28, fontSize: 13.5 },
});
