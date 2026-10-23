// A Personal Manager's working hours, time off, vehicle and regions. These decide which tasks they can be offered.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { colors, spacing, radius, typo } from '../theme';
import { Card, Button, FieldLabel, Input, ErrorText } from '../components/UI';
import AppIcon from '../components/AppIcon';
import { useAuth } from '../lib/AuthContext';
import { useRegions } from '../data/pricing';
import { mySchedule, saveWorkingHours, addTimeOff, removeTimeOff, saveVehicles, saveRegions } from '../data/operations';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export default function PmAvailabilityScreen() {
  const { profile, refreshProfile } = useAuth();
  const { regions } = useRegions();
  const [sched, setSched] = useState({ hours: [], blocks: [] });
  const [day, setDay] = useState(1);
  const [from, setFrom] = useState('09:00');
  const [to, setTo] = useState('18:00');
  const [offFrom, setOffFrom] = useState('');
  const [offTo, setOffTo] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const load = useCallback(() => mySchedule().then(setSched).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);
  const vehicles = profile?.vehicles ?? null;
  const myRegions = profile?.region_codes || [];

  async function run(fn, msg) {
    setError(''); setSaved('');
    try { await fn(); await load(); await refreshProfile(); setSaved(msg); } catch (e) { setError(e.message); }
  }
  const addWindow = () => {
    if (!TIME.test(from) || !TIME.test(to) || from >= to) { setError('Enter a start and an end like 09:00 and 13:00, with the end after the start.'); return; }
    run(() => saveWorkingHours([...sched.hours, { weekday: day, start: from, end: to }]), 'Working hours saved.');
  };
  const removeWindow = (i) => run(() => saveWorkingHours(sched.hours.filter((_, j) => j !== i)), 'Working hours saved.');
  const toggleVehicle = (v) => {
    const cur = vehicles || [];
    const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
    run(() => saveVehicles(next, profile?.travel_available ?? null), 'Vehicle details saved.');
  };
  const toggleRegion = (c) => run(() => saveRegions(myRegions.includes(c) ? myRegions.filter((x) => x !== c) : [...myRegions, c]), 'Regions saved.');

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: 60 }}>
      <Text style={s.h1} accessibilityRole="header">Availability</Text>
      <Text style={s.muted}>We only offer you tasks that fit these details. Nothing here is assumed: if you leave something empty, we do not guess it.</Text>
      {!!saved && <Text style={s.saved} accessibilityLiveRegion="polite">{saved}</Text>}
      <ErrorText>{error}</ErrorText>

      <Card style={{ gap: 10 }}>
        <Text style={s.h2}>Working hours</Text>
        <Text style={s.muted}>Times are in your region’s local time. A gap between two windows is a break. With no hours set, you are not offered timed tasks.</Text>
        {sched.hours.length === 0 && <Text style={s.muted}>No working hours set yet.</Text>}
        {sched.hours.map((h, i) => (
          <View key={`${h.weekday}${h.start}`} style={s.row}>
            <Text style={s.rowText}>{DAYS[h.weekday]}  {h.start} to {h.end}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${DAYS[h.weekday]} ${h.start} to ${h.end}`} onPress={() => removeWindow(i)} style={s.remove}><AppIcon name="x" size={20} color={colors.muted} /></Pressable>
          </View>
        ))}
        <FieldLabel>Add a window</FieldLabel>
        <View style={s.chips}>{DAYS.map((d, i) => (
          <Pressable key={d} accessibilityRole="radio" accessibilityState={{ selected: day === i }} onPress={() => setDay(i)} style={[s.chip, day === i && s.chipOn]}><Text style={[s.chipText, day === i && { color: colors.accent }]}>{d.slice(0, 3)}</Text></Pressable>))}</View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}><Input value={from} onChangeText={setFrom} placeholder="09:00" autoCapitalize="none" accessibilityLabel="Start time" /></View>
          <View style={{ flex: 1 }}><Input value={to} onChangeText={setTo} placeholder="18:00" autoCapitalize="none" accessibilityLabel="End time" /></View>
        </View>
        <Button label="Add working window" variant="ghost" onPress={addWindow} />
      </Card>

      <Card style={{ gap: 10 }}>
        <Text style={s.h2}>Time off</Text>
        {sched.blocks.length === 0 && <Text style={s.muted}>No upcoming time off.</Text>}
        {sched.blocks.map((b) => (
          <View key={b.id} style={s.row}>
            <Text style={s.rowText}>{new Date(b.starts_at).toLocaleString()} to {new Date(b.ends_at).toLocaleString()}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Remove time off" onPress={() => run(() => removeTimeOff(b.id), 'Time off removed.')} style={s.remove}><AppIcon name="x" size={20} color={colors.muted} /></Pressable>
          </View>
        ))}
        <FieldLabel>Block some time</FieldLabel>
        <Input value={offFrom} onChangeText={setOffFrom} placeholder="From, like 2026-11-09 09:00" autoCapitalize="none" accessibilityLabel="Time off from" />
        <Input value={offTo} onChangeText={setOffTo} placeholder="Until, like 2026-11-09 17:00" autoCapitalize="none" accessibilityLabel="Time off until" />
        <Button label="Add time off" variant="ghost" onPress={() => run(async () => { await addTimeOff(offFrom.trim(), offTo.trim()); setOffFrom(''); setOffTo(''); }, 'Time off added.')} />
      </Card>

      <Card style={{ gap: 10 }}>
        <Text style={s.h2}>Vehicle</Text>
        <Text style={s.muted}>Some tasks need a two-wheeler or a four-wheeler. Tell us what you can use. A vehicle does not replace any qualification.</Text>
        <View style={s.chips}>
          {[['two_wheeler', 'Two-wheeler'], ['four_wheeler', 'Four-wheeler']].map(([v, label]) => (
            <Pressable key={v} accessibilityRole="checkbox" accessibilityState={{ checked: !!vehicles?.includes(v) }} onPress={() => toggleVehicle(v)} style={[s.chip, vehicles?.includes(v) && s.chipOn]}>
              {vehicles?.includes(v) && <AppIcon name="check" size={16} />}<Text style={[s.chipText, vehicles?.includes(v) && { color: colors.accent }]}>{label}</Text></Pressable>))}
        </View>
        <Pressable accessibilityRole="button" onPress={() => run(() => saveVehicles([], profile?.travel_available ?? null), 'Saved: no vehicle.')} style={s.link}>
          <Text style={s.linkText}>{vehicles && vehicles.length === 0 ? 'You told us you have no vehicle' : 'I have no vehicle'}</Text></Pressable>
        {vehicles == null && <Text style={s.muted}>Not stated yet.</Text>}
      </Card>

      {regions.length > 0 && (
        <Card style={{ gap: 10 }}>
          <Text style={s.h2}>Regions you serve</Text>
          <View style={s.chips}>{regions.map((r) => (
            <Pressable key={r.code} accessibilityRole="checkbox" accessibilityState={{ checked: myRegions.includes(r.code) }} onPress={() => toggleRegion(r.code)} style={[s.chip, myRegions.includes(r.code) && s.chipOn]}>
              {myRegions.includes(r.code) && <AppIcon name="check" size={16} />}<Text style={[s.chipText, myRegions.includes(r.code) && { color: colors.accent }]}>{r.name}</Text></Pressable>))}</View>
        </Card>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  h1: { ...typo.h1, color: colors.text },
  h2: { ...typo.h2, color: colors.text },
  muted: { ...typo.body, color: colors.muted },
  saved: { ...typo.body, color: colors.successText, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowText: { ...typo.body, color: colors.text, flex: 1 },
  remove: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 48, minWidth: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chipOn: { borderColor: colors.accent, backgroundColor: colors.accentLight },
  chipText: { ...typo.body, fontWeight: '600', color: colors.text },
  link: { minHeight: 48, justifyContent: 'center' },
  linkText: { ...typo.body, color: colors.accent, fontWeight: '700' },
});
