// Where the demand is, and whether there are enough Personal Managers for it.
// Areas are read from the last part of each task's address ("Flat 4B, Kandivali
// West" counts as Kandivali West), so they are only as tidy as what customers type.
import React, { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { colors, spacing } from '../../theme';
import { Card, Badge } from '../../components/UI';
import { useTasks, CATEGORIES } from '../../data/store';
import { useLiveQuery, listApprovedPms, areaOf, DAY_MS } from '../../data/adminData';

function Bar({ label, value, max, tone = colors.accent, right }) {
  return (
    <View style={styles.barRow}>
      <Text style={styles.barLabel} numberOfLines={1}>{label}</Text>
      <View style={styles.track}><View style={[styles.fill, { width: `${max ? Math.max((value / max) * 100, value ? 4 : 0) : 0}%`, backgroundColor: tone }]} /></View>
      <Text style={styles.barVal}>{right ?? value}</Text>
    </View>
  );
}

export default function AdminInsightsScreen({ navigation }) {
  const tasks = useTasks();
  const { data: pms } = useLiveQuery(listApprovedPms, ['profiles'], navigation);

  const f = useMemo(() => {
    const recent = tasks.filter((t) => Date.now() - new Date(t.createdAt).getTime() < 30 * DAY_MS);
    const byCat = CATEGORIES.map((c) => {
      const n = recent.filter((t) => t.category === c.id).length;
      const supply = (pms || []).filter((p) => (p.categories || []).includes(c.id)).length;
      return { ...c, n, supply, short: n > 0 && (supply === 0 || n / supply > 4) };
    });
    const areaCount = {};
    recent.forEach((t) => { const a = areaOf(t.location); areaCount[a] = (areaCount[a] || 0) + 1; });
    const byArea = Object.entries(areaCount).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const pmAreas = {};
    (pms || []).forEach((p) => { if (p.service_area) pmAreas[p.service_area.toLowerCase()] = (pmAreas[p.service_area.toLowerCase()] || 0) + 1; });
    const done = recent.filter((t) => t.status === 'completed').length;
    const cancelled = recent.filter((t) => t.status === 'cancelled').length;
    const open = tasks.filter((t) => t.status === 'requested');
    const oldestOpen = open.length ? Math.max(...open.map((t) => Date.now() - new Date(t.createdAt).getTime())) : 0;
    return { total: recent.length, byCat, byArea, pmAreas, done, cancelled, oldestOpenMin: Math.round(oldestOpen / 60000) };
  }, [tasks, pms]);

  const maxCat = Math.max(1, ...f.byCat.map((c) => c.n));
  const maxArea = Math.max(1, ...f.byArea.map(([, n]) => n));
  const shortCats = f.byCat.filter((c) => c.short);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60, gap: spacing.md }}>
      <View style={styles.stats}>
        <Card style={{ flex: 1 }}><Text style={styles.label}>Posted, 30 days</Text><Text style={styles.val}>{f.total}</Text></Card>
        <Card style={{ flex: 1 }}><Text style={styles.label}>Completed</Text><Text style={styles.val}>{f.done}</Text></Card>
        <Card style={{ flex: 1 }}><Text style={styles.label}>Cancelled</Text><Text style={styles.val}>{f.cancelled}</Text></Card>
      </View>

      {shortCats.length > 0 && (
        <Card style={{ backgroundColor: colors.brassLight, borderColor: 'transparent', gap: 4 }}>
          <Text style={styles.warn}>Time to recruit</Text>
          {shortCats.map((c) => (
            <Text key={c.id} style={styles.warnLine}>
              {c.emoji} {c.label}: {c.n} task{c.n === 1 ? '' : 's'} in 30 days, {c.supply === 0 ? 'no approved Personal Managers' : `only ${c.supply} approved`}.
            </Text>
          ))}
        </Card>
      )}

      <Card style={{ gap: spacing.sm }}>
        <Text style={styles.h2}>Demand by category</Text>
        {f.byCat.map((c) => <Bar key={c.id} label={`${c.emoji} ${c.label}`} value={c.n} max={maxCat} tone={c.short ? colors.brass : colors.accent} />)}
      </Card>

      <Card style={{ gap: spacing.sm }}>
        <Text style={styles.h2}>Personal Managers available</Text>
        {f.byCat.map((c) => (
          <View key={c.id} style={styles.supply}>
            <Text style={styles.barLabel}>{c.emoji} {c.label}</Text>
            <Badge label={`${c.supply} approved`} tone={c.supply === 0 && c.n > 0 ? 'danger' : c.short ? 'brass' : 'neutral'} />
          </View>
        ))}
      </Card>

      <Card style={{ gap: spacing.sm }}>
        <Text style={styles.h2}>Busiest areas</Text>
        {!f.byArea.length && <Text style={styles.meta}>No tasks in the last 30 days.</Text>}
        {f.byArea.map(([area, n]) => {
          const covered = Object.keys(f.pmAreas).some((a) => area.toLowerCase().includes(a) || a.includes(area.toLowerCase()));
          return <Bar key={area} label={area} value={n} max={maxArea} tone={covered ? colors.accent : colors.danger} right={`${n}${covered ? '' : ' · no PM'}`} />;
        })}
        {f.byArea.length > 0 && <Text style={styles.meta}>Red means no approved Personal Manager lists that area.</Text>}
      </Card>

      {f.oldestOpenMin > 0 && <Text style={styles.meta}>Longest wait in the queue right now: {f.oldestOpenMin} min.</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  stats: { flexDirection: 'row', gap: 10 },
  label: { fontSize: 12, color: colors.muted, fontWeight: '600' },
  val: { fontWeight: '800', fontSize: 20, marginTop: 2, color: colors.text },
  h2: { fontSize: 15, fontWeight: '700', color: colors.text },
  meta: { color: colors.muted, fontSize: 12.5, lineHeight: 18 },
  warn: { fontWeight: '800', fontSize: 14, color: colors.brassDark },
  warnLine: { fontSize: 13, color: colors.text, lineHeight: 19 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  barLabel: { width: 118, fontSize: 13, color: colors.text },
  track: { flex: 1, height: 12, borderRadius: 6, backgroundColor: colors.surfaceAlt, overflow: 'hidden' },
  fill: { height: 12, borderRadius: 6 },
  barVal: { minWidth: 56, textAlign: 'right', fontWeight: '800', fontSize: 13, color: colors.text },
  supply: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
