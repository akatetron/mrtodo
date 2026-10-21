// Admin home: every task on the platform, split into what needs a Personal
// Manager, what is under way, and what is finished.
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { colors, spacing, radius } from '../../theme';
import { Card, Badge, Chip, Input } from '../../components/UI';
import NotificationBell from '../../components/NotificationBell';
import { useTasks, catMeta, STATUS_META, initials, timeAgo, refreshAll, CATEGORIES, shortId } from '../../data/store';
import { expireStaleOffers, adminCounts } from '../../data/adminData';
import { useAuth } from '../../lib/AuthContext';

const TABS = [
  {
    id: 'queue',
    label: 'Needs a PM',
    match: (t) => t.status === 'requested',
    empty: 'Nothing waiting. Every task has a Personal Manager.',
  },
  {
    id: 'active',
    label: 'In progress',
    match: (t) => ['matched', 'assigned', 'in_progress'].includes(t.status),
    empty: 'No tasks are under way right now.',
  },
  {
    id: 'history',
    label: 'History',
    match: (t) => ['completed', 'cancelled'].includes(t.status),
    empty: 'Finished and cancelled tasks will appear here.',
  },
];

export default function AdminHomeScreen({ navigation }) {
  const tasks = useTasks();
  const { profile } = useAuth();
  const [tab, setTab] = useState('queue');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [attention, setAttention] = useState(0);

  // An offer nobody answers should not block the task: every minute, put stale
  // ones back in the queue. (The database also does this every 5 minutes when it can.)
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      const n = await expireStaleOffers(15);
      if (!stop && n > 0) refreshAll();
    };
    tick();
    const id = setInterval(tick, 60000);
    return () => { stop = true; clearInterval(id); };
  }, []);

  // The badge on Tools: applications to review plus open reports.
  useEffect(() => {
    const load = () => adminCounts().then((c) => setAttention(c.applications + c.reports)).catch(() => {});
    load();
    return navigation.addListener('focus', load);
  }, [navigation]);

  const current = TABS.find((t) => t.id === tab);
  const counts = Object.fromEntries(TABS.map((t) => [t.id, tasks.filter(t.match).length]));
  // Oldest first in the queue so nobody waits longest; newest first elsewhere.
  const q = search.trim().toLowerCase();
  const list = tasks
    .filter(current.match)
    .filter((t) => category === 'all' || t.category === category)
    .filter((t) => !q || [t.title, t.location, t.customer?.name, t.worker?.name, shortId(t.id)].some((v) => v && v.toLowerCase().includes(q)));
  const shown = tab === 'queue' ? [...list].reverse() : list;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.small}>Admin</Text>
          <Text style={styles.name}>{profile?.full_name}</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
          <Pressable onPress={() => navigation.navigate('AdminMore')} style={styles.tools} accessibilityLabel="Admin tools">
            <Text style={styles.toolsText}>Tools</Text>
            {attention > 0 && <View style={styles.toolsBadge}><Text style={styles.toolsBadgeText}>{attention}</Text></View>}
          </Pressable>
          <NotificationBell navigation={navigation} />
          <Pressable onPress={() => navigation.navigate('Account')} style={styles.avatar} accessibilityLabel="Account">
            <Text style={styles.avatarText}>{initials(profile?.full_name)}</Text>
          </Pressable>
        </View>
      </View>

      <Input placeholder="Search title, customer, area, PM, MT-…" value={search} onChangeText={setSearch} autoCapitalize="none" style={{ marginBottom: spacing.sm }} />
      <View style={styles.cats}>
        <Chip label="All" selected={category === 'all'} onPress={() => setCategory('all')} />
        {CATEGORIES.map((c) => <Chip key={c.id} label={`${c.emoji} ${c.label}`} selected={category === c.id} onPress={() => setCategory(c.id)} />)}
      </View>

      <View style={styles.tabs}>
        {TABS.map((t) => {
          const on = t.id === tab;
          return (
            <Pressable key={t.id} onPress={() => setTab(t.id)} style={[styles.tab, on && styles.tabOn]}>
              <Text style={[styles.tabText, on && styles.tabTextOn]}>{t.label}</Text>
              <View style={[styles.count, on && styles.countOn, t.id === 'queue' && counts.queue > 0 && styles.countAlert]}>
                <Text style={[styles.countText, on && { color: colors.accentText }]}>{counts[t.id]}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      <View style={{ gap: spacing.sm }}>
        {shown.map((t) => <TaskRow key={t.id} t={t} onPress={() => navigation.navigate('AdminTask', { taskId: t.id })} />)}
        {!shown.length && <Text style={styles.empty}>{q || category !== 'all' ? 'No tasks match that search.' : current.empty}</Text>}
      </View>
    </ScrollView>
  );
}

function TaskRow({ t, onPress }) {
  const meta = STATUS_META[t.status];
  const when = t.status === 'completed' ? `done ${timeAgo(t.completedAt)}` : `posted ${timeAgo(t.createdAt)}`;
  const waited = t.status === 'matched' && t.assignedAt ? Math.round((Date.now() - new Date(t.assignedAt).getTime()) / 60000) : 0;
  // Traffic lights: a customer escalation is red (and wins); a task unassigned for over 15 minutes is brass.
  // The labels say it in words, so colour is never the only signal.
  const open = !['completed', 'cancelled'].includes(t.status);
  const escalated = open && !!t.escalatedAt;
  const unassignedMin = t.status === 'requested' ? Math.floor((Date.now() - new Date(t.createdAt).getTime()) / 60000) : 0;
  const slaWarn = !escalated && unassignedMin > 15;
  const border = escalated ? { borderColor: colors.danger, borderWidth: 3 } : slaWarn ? { borderColor: colors.brass, borderWidth: 3 } : null;
  return (
    <Pressable onPress={onPress} accessibilityLabel={`${t.title}. ${escalated ? 'Customer escalated.' : slaWarn ? `SLA warning, waiting ${unassignedMin} minutes.` : ''}`}>
      <Card style={[{ gap: 6 }, border]}>
        {escalated && <Badge label="Escalated" tone="danger" />}
        {slaWarn && <Badge label={`SLA warning · waiting ${unassignedMin} min`} tone="brass" />}
        {t.status === 'requested' && !escalated && !slaWarn && <Badge label="Waiting for assignment" tone="neutral" />}
        {t.reviewState === 'needs_review' && <Badge label="Needs review" tone="brass" />}
        <View style={styles.rowTop}>
          <Text style={{ fontSize: 17 }}>{catMeta(t.category).emoji}</Text>
          <Text style={styles.title} numberOfLines={2}>{t.title}</Text>
        </View>
        <Text style={styles.meta} numberOfLines={1}>
          {t.customer?.name || 'Customer'} · {t.location}
        </Text>
        <View style={styles.rowBottom}>
          <Badge label={meta.adminLabel} tone={meta.tone} />
          {!!t.worker && <Text style={styles.meta} numberOfLines={1}>→ {t.worker.name}{waited >= 5 ? ` · waiting ${waited} min` : ''}</Text>}
          <Text style={[styles.meta, { marginLeft: 'auto' }]}>{when}</Text>
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.lg },
  small: { color: colors.muted, fontSize: 13, fontWeight: '600', marginBottom: 2 },
  name: { fontWeight: '800', fontSize: 17, color: colors.text },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.accentLight, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontWeight: '800', color: colors.accentDark },
  tools: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, height: 42, borderRadius: 21, backgroundColor: colors.accent },
  toolsText: { color: colors.accentText, fontWeight: '800', fontSize: 13.5 },
  toolsBadge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, backgroundColor: colors.brass, alignItems: 'center', justifyContent: 'center' },
  toolsBadgeText: { color: colors.accentDark, fontSize: 11.5, fontWeight: '800' },
  cats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.md },
  tabs: { flexDirection: 'row', gap: 8, marginBottom: spacing.lg, flexWrap: 'wrap' },
  tab: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface,
  },
  tabOn: { borderColor: colors.accent, backgroundColor: colors.accent },
  tabText: { fontSize: 13, fontWeight: '700', color: colors.muted },
  tabTextOn: { color: colors.accentText },
  count: { minWidth: 22, paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt, alignItems: 'center' },
  countOn: { backgroundColor: 'rgba(255,255,255,0.22)' },
  countAlert: { backgroundColor: colors.brass },
  countText: { fontSize: 12, fontWeight: '800', color: colors.text },
  rowTop: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  title: { flex: 1, fontWeight: '700', fontSize: 14.5, color: colors.text },
  meta: { color: colors.muted, fontSize: 12.5, flexShrink: 1 },
  rowBottom: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  empty: { color: colors.faint, textAlign: 'center', padding: 28, fontSize: 13.5 },
});
