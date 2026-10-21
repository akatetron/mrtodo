import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { colors, spacing } from '../../theme';
import { Card, Badge, Chip, Input, ErrorText } from '../../components/UI';
import { useAuth } from '../../lib/AuthContext';
import { useTasks, formatRating } from '../../data/store';
import { expiryText, docExpiry } from '../../data/extras';
import { useLiveQuery, listPeople, listExpiringDocs, isSuperAdmin } from '../../data/adminData';

const FILTERS = [
  { id: 'all', label: 'Everyone' },
  { id: 'customer', label: 'Customers' },
  { id: 'worker', label: 'Personal Managers' },
];
const PM_STATUS = { approved: ['Approved', 'success'], pending: ['Pending', 'brass'], more_info: ['More info', 'brass'], draft: ['Not applied', 'neutral'], rejected: ['Rejected', 'danger'], suspended: ['Suspended', 'danger'] };

export default function AdminPeopleScreen({ navigation }) {
  const tasks = useTasks();
  const { profile } = useAuth();
  const superAdmin = isSuperAdmin(profile);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const { data: people, error } = useLiveQuery(listPeople, ['profiles'], navigation);
  const [expiring, setExpiring] = useState([]);
  useEffect(() => {
    if (superAdmin) listExpiringDocs(30).then(setExpiring).catch(() => {});
  }, [superAdmin]);

  const s = search.trim().toLowerCase();
  const list = (people || [])
    .filter((p) => filter === 'all' || p.role === filter)
    .filter((p) => !s || [p.full_name, p.service_area].some((v) => v && v.toLowerCase().includes(s)));

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60, gap: spacing.sm }}>
      <Input placeholder="Search name or area" value={search} onChangeText={setSearch} autoCapitalize="none" />
      <View style={styles.chips}>
        {FILTERS.map((f) => <Chip key={f.id} label={f.label} selected={filter === f.id} onPress={() => setFilter(f.id)} />)}
      </View>

      {expiring.length > 0 && (
        <Card style={{ gap: 8, backgroundColor: colors.brassLight, borderColor: 'transparent' }}>
          <Text style={styles.warn}>Documents expiring soon</Text>
          {expiring.map((d) => (
            <Pressable key={d.id} onPress={() => navigation.navigate('AdminPerson', { personId: d.worker?.id })}>
              <Text style={styles.warnLine}>
                {d.worker?.full_name || 'A PM'} · {d.label || 'document'} · <Text style={{ fontWeight: '800', color: docExpiry(d)?.state === 'expired' ? colors.danger : colors.brassDark }}>{expiryText(d)}</Text>
              </Text>
            </Pressable>
          ))}
        </Card>
      )}

      <ErrorText>{error}</ErrorText>
      {list.map((p) => {
        const mine = tasks.filter((t) => (p.role === 'customer' ? t.customerId : t.assignedWorkerId) === p.id);
        const done = mine.filter((t) => t.status === 'completed').length;
        const [label, tone] = PM_STATUS[p.worker_status] || [];
        return (
          <Pressable key={p.id} onPress={() => navigation.navigate('AdminPerson', { personId: p.id })}>
            <Card style={{ gap: 6 }}>
              <View style={styles.top}>
                <Text style={styles.name} numberOfLines={1}>{p.full_name}</Text>
                {p.role === 'worker' ? <Badge label={label || 'PM'} tone={tone} /> : <Badge label="Customer" />}
              </View>
              <Text style={styles.meta}>
                {formatRating(p.rating, p.rating_count)} · {p.role === 'customer' ? `${mine.length} posted, ${done} done` : `${done} done${p.service_area ? ` · ${p.service_area}` : ''}`}
              </Text>
            </Card>
          </Pressable>
        );
      })}
      {people && !list.length && <Text style={styles.empty}>No one matches.</Text>}
      {!people && !error && <Text style={styles.empty}>Loading…</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.sm },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  name: { fontWeight: '700', fontSize: 15, color: colors.text, flexShrink: 1 },
  meta: { color: colors.muted, fontSize: 13 },
  warn: { fontWeight: '800', fontSize: 14, color: colors.brassDark },
  warnLine: { fontSize: 13, color: colors.text, lineHeight: 19 },
  empty: { color: colors.muted, textAlign: 'center', padding: 28, fontSize: 13.5 },
});
