// One customer or Personal Manager: how they have behaved on the platform.
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { colors, spacing } from '../../theme';
import { Card, Badge, FieldLabel, ErrorText } from '../../components/UI';
import { useAuth } from '../../lib/AuthContext';
import AdminContact from '../../components/AdminContact';
import { useTasks, catMeta, STATUS_META, initials, formatRating, timeAgo } from '../../data/store';
import { expiryText, docExpiry } from '../../data/extras';
import { getProfile, listWorkerDocs, pmReliability, useLiveQuery, isSuperAdmin } from '../../data/adminData';

export default function AdminPersonScreen({ route, navigation }) {
  const { personId } = route.params;
  const tasks = useTasks();
  const { profile: me } = useAuth();
  const superAdmin = isSuperAdmin(me);
  const { data: p, error } = useLiveQuery(() => getProfile(personId), ['profiles'], navigation);
  const [rel, setRel] = useState(null);
  const [docs, setDocs] = useState([]);

  const isPm = p?.role === 'worker';
  useEffect(() => {
    if (!isPm) return;
    pmReliability().then((m) => setRel(m[personId] || null));
    if (superAdmin) listWorkerDocs(personId).then(setDocs).catch(() => {});
  }, [isPm, personId, superAdmin]);

  if (!p) return <Text style={{ padding: 20, color: colors.muted }}>{error || 'Loading…'}</Text>;

  const mine = tasks.filter((t) => (isPm ? t.assignedWorkerId : t.customerId) === personId);
  const done = mine.filter((t) => t.status === 'completed').length;
  const cancelled = mine.filter((t) => t.status === 'cancelled').length;
  const cancelRate = mine.length ? Math.round((cancelled / mine.length) * 100) : 0;

  const flags = [];
  if (p.rating != null && p.rating_count >= 3 && p.rating < 3.5) flags.push('Low rating');
  if (!isPm && mine.length >= 3 && cancelRate >= 40) flags.push(`Cancels often (${cancelRate}%)`);
  if (isPm && rel && rel.offers >= 3 && rel.accepted / rel.offers < 0.5) flags.push('Declines or ignores many offers');
  if (docs.some((d) => docExpiry(d)?.state === 'expired')) flags.push('Expired document');

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60, gap: spacing.md }}>
      <Card style={{ gap: spacing.md }}>
        <View style={styles.head}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{initials(p.full_name)}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{p.full_name}</Text>
            <Text style={styles.meta}>{isPm ? 'Personal Manager' : 'Customer'} · {formatRating(p.rating, p.rating_count)}</Text>
          </View>
        </View>
        <AdminContact personId={p.id} style={styles.meta} />
        {flags.length > 0 && <View style={styles.flags}>{flags.map((f) => <Badge key={f} label={`⚠ ${f}`} tone="danger" />)}</View>}
        {isPm && (
          <View style={{ gap: 4 }}>
            <Text style={styles.meta}>{(p.categories || []).map((c) => `${catMeta(c).emoji} ${catMeta(c).label}`).join('  ')}</Text>
            <Text style={styles.meta}>📍 {p.service_area || '—'} · {p.experience_years != null ? `${p.experience_years} yrs experience` : 'experience not given'} · {p.online ? 'available now' : 'not available'}</Text>
          </View>
        )}
      </Card>

      <View style={styles.stats}>
        <Stat label={isPm ? 'Assigned' : 'Posted'} value={mine.length} />
        <Stat label="Completed" value={done} />
        <Stat label="Cancelled" value={cancelled} />
      </View>

      {isPm && (
        <Card style={{ gap: 6 }}>
          <Text style={styles.h2}>Reliability</Text>
          {!rel && <Text style={styles.meta}>No offers recorded yet, or the database update has not been run.</Text>}
          {rel && (
            <>
              <Line label="Offers received" value={rel.offers} />
              <Line label="Accepted" value={`${rel.accepted}${rel.offers ? ` (${Math.round((rel.accepted / rel.offers) * 100)}%)` : ''}`} />
              <Line label="Declined" value={rel.declined} />
              <Line label="Lapsed without an answer" value={rel.expired} />
              <Line label="Tasks completed" value={rel.completed} />
              <Line label="Usually answers in" value={rel.avg_accept_minutes != null ? `${rel.avg_accept_minutes} min` : '—'} />
            </>
          )}
        </Card>
      )}

      {isPm && superAdmin && (
        <Card style={{ gap: 8 }}>
          <Text style={styles.h2}>Documents</Text>
          {!docs.length && <Text style={styles.meta}>None on file.</Text>}
          {docs.map((d) => {
            const e = docExpiry(d);
            return (
              <View key={d.id} style={styles.docRow}>
                <Text style={[styles.meta, { flex: 1 }]} numberOfLines={1}>📄 {d.label}</Text>
                {e ? <Badge label={expiryText(d)} tone={e.state === 'expired' ? 'danger' : e.state === 'soon' ? 'brass' : 'neutral'} /> : <Badge label={d.doc_type === 'id' ? 'ID' : 'No expiry'} />}
              </View>
            );
          })}
          {isPm && (
            <Pressable onPress={() => navigation.navigate('AdminApplicant', { workerId: personId })}>
              <Text style={styles.link}>Open application ›</Text>
            </Pressable>
          )}
        </Card>
      )}

      <View style={{ gap: spacing.sm }}>
        <Text style={styles.h2}>Recent tasks</Text>
        {mine.slice(0, 10).map((t) => (
          <Pressable key={t.id} onPress={() => navigation.navigate('AdminTask', { taskId: t.id })}>
            <Card style={{ gap: 4 }}>
              <Text style={styles.taskTitle} numberOfLines={1}>{catMeta(t.category).emoji} {t.title}</Text>
              <View style={styles.flags}>
                <Badge label={STATUS_META[t.status].adminLabel} tone={STATUS_META[t.status].tone} />
                <Text style={styles.meta}>{timeAgo(t.createdAt)}</Text>
              </View>
            </Card>
          </Pressable>
        ))}
        {!mine.length && <Text style={styles.meta}>No tasks yet.</Text>}
      </View>
      <ErrorText>{error}</ErrorText>
    </ScrollView>
  );
}

function Stat({ label, value }) {
  return (<Card style={{ flex: 1 }}><Text style={styles.statLabel}>{label}</Text><Text style={styles.statVal}>{value}</Text></Card>);
}
function Line({ label, value }) {
  return (<View style={styles.line}><Text style={styles.meta}>{label}</Text><Text style={styles.lineVal}>{value}</Text></View>);
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.accentLight, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontWeight: '800', color: colors.accentDark, fontSize: 15 },
  name: { fontWeight: '800', fontSize: 17, color: colors.text },
  meta: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  flags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  stats: { flexDirection: 'row', gap: 10 },
  statLabel: { fontSize: 12, color: colors.muted, fontWeight: '600' },
  statVal: { fontWeight: '800', fontSize: 20, marginTop: 2, color: colors.text },
  h2: { fontSize: 15, fontWeight: '700', color: colors.text },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  lineVal: { fontWeight: '700', color: colors.text, fontSize: 13 },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  link: { color: colors.accent, fontWeight: '700', fontSize: 13.5, marginTop: 4 },
  taskTitle: { fontWeight: '700', fontSize: 14, color: colors.text },
});
