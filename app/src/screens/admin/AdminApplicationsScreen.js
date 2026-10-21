import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { colors, spacing } from '../../theme';
import { Card, Badge, Chip, ErrorText } from '../../components/UI';
import { catMeta, timeAgo } from '../../data/store';
import { useLiveQuery, listApplicants } from '../../data/adminData';

const TABS = [
  { id: 'pending', label: 'Pending review', empty: 'No applications waiting.' },
  { id: 'more_info', label: 'Waiting on applicant', empty: 'Nobody has been asked for more information.' },
  { id: 'draft', label: 'Not submitted', empty: 'Everyone who signed up has applied.' },
  { id: 'rejected', label: 'Rejected', empty: 'No rejected applications.' },
];
const TONE = { pending: 'brass', more_info: 'brass', draft: 'neutral', rejected: 'danger' };

export default function AdminApplicationsScreen({ navigation }) {
  const [tab, setTab] = useState('pending');
  const { data, error } = useLiveQuery(listApplicants, ['profiles'], navigation);
  const list = (data || []).filter((p) => p.worker_status === tab);
  const count = (id) => (data || []).filter((p) => p.worker_status === id).length;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60, gap: spacing.sm }}>
      <View style={styles.tabs}>
        {TABS.map((t) => <Chip key={t.id} label={`${t.label} · ${count(t.id)}`} selected={tab === t.id} onPress={() => setTab(t.id)} />)}
      </View>
      <ErrorText>{error}</ErrorText>
      {list.map((p) => (
        <Pressable key={p.id} onPress={() => navigation.navigate('AdminApplicant', { workerId: p.id })}>
          <Card style={{ gap: 6 }}>
            <View style={styles.top}>
              <Text style={styles.name}>{p.full_name}</Text>
              <Badge label={tab === 'pending' ? `applied ${timeAgo(p.applied_at)}` : tab === 'draft' ? `signed up ${timeAgo(p.created_at)}` : tab.replace('_', ' ')} tone={TONE[tab]} />
            </View>
            <Text style={styles.meta}>
              {(p.categories || []).map((c) => catMeta(c).emoji).join(' ') || 'No skills yet'} · {p.service_area || 'No area yet'}
              {p.experience_years != null ? ` · ${p.experience_years} yrs` : ''}
            </Text>
          </Card>
        </Pressable>
      ))}
      {data && !list.length && <Text style={styles.empty}>{TABS.find((t) => t.id === tab).empty}</Text>}
      {!data && !error && <Text style={styles.empty}>Loading…</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.sm },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  name: { fontWeight: '700', fontSize: 15, color: colors.text, flexShrink: 1 },
  meta: { color: colors.muted, fontSize: 13 },
  empty: { color: colors.muted, textAlign: 'center', padding: 28, fontSize: 13.5 },
});
