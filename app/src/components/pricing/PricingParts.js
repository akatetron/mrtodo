// Region choice, the live estimate with its itemised breakdown, and time slots.
// The server calculates everything shown here; nothing on this screen is a number we made up.
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors, spacing, radius, typo } from '../../theme';
import { FieldLabel, Input } from '../UI';
import AppIcon from '../AppIcon';
import { formatMoney } from '../../lib/money';
import { fetchSlots } from '../../data/pricing';

export function RegionPicker({ regions, value, onChange, error }) {
  return (
    <View>
      <FieldLabel>Where is the task?</FieldLabel>
      <View style={s.chips} accessibilityRole="radiogroup">
        {regions.map((r) => (
          <Pressable key={r.code} accessibilityRole="radio" accessibilityState={{ selected: value === r.code }} onPress={() => onChange(r.code)} style={[s.chip, value === r.code && s.chipOn]}>
            {value === r.code && <AppIcon name="check" size={16} />}
            <Text style={[s.chipText, value === r.code && { color: colors.accent }]}>{r.name}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={s.muted}>This sets your currency, local time and which Personal Managers can help.</Text>
      {!!error && <Text style={s.error}>{error}</Text>}
    </View>
  );
}

export function Stepper({ label, value, onChange, min = 1, max = 1000, unit }) {
  return (
    <View>
      <FieldLabel>{label}</FieldLabel>
      <View style={s.stepper}>
        <Pressable accessibilityRole="button" accessibilityLabel="Fewer" onPress={() => onChange(Math.max(min, value - 1))} style={s.stepBtn}><Text style={s.stepText}>−</Text></Pressable>
        <Text style={s.stepValue} accessibilityLiveRegion="polite">{value}{unit ? ` ${unit}` : ''}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="More" onPress={() => onChange(Math.min(max, value + 1))} style={s.stepBtn}><Text style={s.stepText}>+</Text></Pressable>
      </View>
    </View>
  );
}

export function DurationField({ value, onChange }) {
  return (
    <View>
      <FieldLabel>How long do you expect it to take? (minutes)</FieldLabel>
      <Input keyboardType="number-pad" value={value} onChangeText={(v) => onChange(v.replace(/[^0-9]/g, '').slice(0, 5))} placeholder="e.g. 60" accessibilityLabel="Expected duration in minutes" />
    </View>
  );
}

const STATE_TITLE = { estimated: 'Estimated price', quote_required: 'Quote required', approved: 'Approved price', final: 'Final charge', quote_pending: 'Quote awaiting approval' };

// `breakdown` is the object the server produced (estimate, or the stored one on a task).
export function PriceBreakdown({ breakdown, state, title }) {
  if (!breakdown || !breakdown.available) return null;
  const cur = breakdown.currency;
  const heading = title || STATE_TITLE[state] || STATE_TITLE[breakdown.status] || 'Price';
  const lines = breakdown.lines || [];
  const billable = breakdown.minutes?.billable;
  return (
    <View style={s.card} accessibilityRole="summary">
      <Text style={s.cardTitle}>{heading}</Text>
      {billable ? <Text style={s.muted}>Time priced: {billable} minutes{breakdown.minutes?.requested && breakdown.minutes.requested !== billable ? ` (you said ${breakdown.minutes.requested}; rounded to the billing step)` : ''}</Text> : null}
      {breakdown.quantity > 1 ? <Text style={s.muted}>Quantity: {breakdown.quantity}{breakdown.qty_unit ? ` ${breakdown.qty_unit}${breakdown.quantity === 1 ? '' : 's'}` : ''}</Text> : null}
      <View style={{ marginTop: 8, gap: 6 }}>
        {lines.map((l, i) => (
          <View key={i} style={s.line}>
            <View style={{ flex: 1 }}>
              <Text style={s.lineLabel}>{l.label}</Text>
              {l.kind === 'tier' || l.kind === 'duration' ? <Text style={s.lineSub}>{l.minutes} min × {formatMoney(l.rate, cur)} per minute</Text> : null}
              {l.kind === 'quantity_discount' && l.rate != null ? <Text style={s.lineSub}>{formatMoney(l.rate, cur)} off each, {l.quantity} in all</Text> : null}
            </View>
            <Text style={[s.lineAmount, l.amount < 0 && { color: colors.successText || colors.success }]}>{formatMoney(l.amount, cur)}</Text>
          </View>
        ))}
      </View>
      {breakdown.discount_total < 0 ? <Text style={[s.save]}>You save {formatMoney(-breakdown.discount_total, cur)}</Text> : null}
      <View style={s.totalRow}>
        <Text style={s.totalLabel}>{breakdown.status === 'quote_required' && !state ? 'Guide price' : 'Total'}</Text>
        <Text style={s.total}>{formatMoney(breakdown.total, cur)}</Text>
      </View>
      <Text style={s.fine}>{cur}</Text>
    </View>
  );
}

export function EstimateCard({ estimate, loading }) {
  if (loading && !estimate) return <View style={s.card}><Text style={s.muted}>Working out your estimate…</Text></View>;
  if (!estimate) return null;
  if (!estimate.available) {
    if (estimate.reason === 'duration_required') return <View style={s.card}><Text style={s.muted}>{estimate.message}</Text></View>;
    return (
      <View style={s.card}>
        <Text style={s.cardTitle}>We’ll price this for you</Text>
        <Text style={s.muted}>{estimate.message}</Text>
      </View>
    );
  }
  const quote = estimate.status === 'quote_required';
  return (
    <View style={{ gap: 10, opacity: loading ? 0.6 : 1 }}>
      <PriceBreakdown breakdown={estimate} title={quote ? 'Guide price, a quote is still needed' : 'Estimated price'} />
      {quote
        ? <View style={s.note}>{(estimate.messages || []).map((m, i) => <Text key={i} style={s.noteText}>{m}</Text>)}<Text style={s.noteText}>Nothing is charged until you approve the quote.</Text></View>
        : <View style={s.note}><Text style={s.noteText}>This is an estimate based on the time you expect, not a guaranteed price. The final charge is confirmed after the task is done.</Text></View>}
    </View>
  );
}

// Times the platform is open on a chosen date, computed by the server in the region's own time.
export function SlotPicker({ region, date, minutes, value, onPick }) {
  const [slots, setSlots] = useState(null);
  useEffect(() => {
    let live = true;
    if (!region || !/^\d{4}-\d{2}-\d{2}$/.test(date || '')) { setSlots(null); return undefined; }
    setSlots(undefined);
    fetchSlots({ region, date, minutes }).then((r) => { if (live) setSlots(r); });
    return () => { live = false; };
  }, [region, date, minutes]);
  if (slots === null) return <Text style={s.muted}>Enter a date to see the times we can take.</Text>;
  if (slots === undefined) return <Text style={s.muted}>Checking available times…</Text>;
  if (!slots.length) return <Text style={s.muted}>We have no times on that day. Please choose another date.</Text>;
  return (
    <View>
      <View style={s.chips}>
        {slots.map((x) => (
          <Pressable key={x.slot_start} accessibilityRole="radio" accessibilityLabel={`Start at ${x.local_time}`} accessibilityState={{ selected: value?.iso === x.slot_start }}
            onPress={() => onPick({ iso: x.slot_start, label: `${date} ${x.local_time}` })} style={[s.slot, value?.iso === x.slot_start && s.chipOn]}>
            <Text style={[s.chipText, value?.iso === x.slot_start && { color: colors.accent }]}>{x.local_time}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={[s.muted, { marginTop: 8 }]}>Times are in your region’s local time. We check a Personal Manager is free when one is offered your task.</Text>
    </View>
  );
}

const s = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  slot: { minHeight: 48, minWidth: 80, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chipOn: { borderColor: colors.accent, backgroundColor: colors.accentLight },
  chipText: { ...typo.body, fontWeight: '600', color: colors.text },
  muted: { ...typo.body, color: colors.muted, marginTop: 6 },
  error: { ...typo.body, color: colors.danger, marginTop: 6 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepBtn: { width: 48, height: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  stepText: { fontSize: 24, color: colors.accent, fontWeight: '700' },
  stepValue: { ...typo.service, minWidth: 80, textAlign: 'center', color: colors.text },
  card: { padding: 16, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  cardTitle: { ...typo.service, color: colors.text },
  line: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  lineLabel: { ...typo.body, color: colors.text },
  lineSub: { ...typo.meta, color: colors.muted },
  lineAmount: { ...typo.body, fontWeight: '700', color: colors.text },
  save: { ...typo.body, fontWeight: '700', color: colors.successText || colors.success, marginTop: 8 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border },
  totalLabel: { ...typo.service, color: colors.text },
  total: { ...typo.h2, color: colors.brassDark },
  fine: { ...typo.meta, color: colors.muted, marginTop: 2 },
  note: { padding: 12, borderRadius: radius.md, backgroundColor: colors.accentLight, gap: 4 },
  noteText: { ...typo.body, color: colors.text },
});
