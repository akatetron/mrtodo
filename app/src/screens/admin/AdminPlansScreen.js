// Todo+ plans and who is subscribed. The price, visits and what is covered are
// yours to set; nothing is pre-filled. A plan can go live only with a price and
// the plan id created at the payment provider (Razorpay).
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { colors, spacing } from '../../theme';
import { Card, Badge, Button, Input, FieldLabel, ErrorText, Chip } from '../../components/UI';
import { useAuth } from '../../lib/AuthContext';
import { listPlansAdmin, savePlan, listSubscriptionsAdmin, isSuperAdmin, useLiveQuery } from '../../data/adminData';
import { CATEGORIES } from '../../data/store';

const TONE = { pending: 'brass', active: 'success', past_due: 'danger', cancelled: 'neutral', expired: 'neutral' };

export default function AdminPlansScreen({ navigation }) {
  const superAdmin = isSuperAdmin(useAuth().profile);
  const { data: plans } = useLiveQuery(listPlansAdmin, ['subscription_plans'], navigation);
  const { data: subs } = useLiveQuery(listSubscriptionsAdmin, ['subscriptions'], navigation);
  const [f, setF] = useState(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  useEffect(() => { if (plans && !f && plans[0]) setF(toForm(plans[0])); }, [plans]); // eslint-disable-line react-hooks/exhaustive-deps
  const toForm = (p) => ({ code: p.code, name: p.name, price: p.price_amount == null ? '' : String(p.price_amount), visits: String(p.included_visits), categories: p.eligible_categories || [], description: p.description || '', terms: p.terms || '', providerPlan: p.provider_plan_id || '', active: p.active });
  async function save() { setError(''); setMsg(''); try { await savePlan(f); setMsg('Saved.'); } catch (e) { setError(e.message); } }
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, paddingBottom: 80, gap: spacing.lg }}>
      {!superAdmin && <Text style={styles.hint}>Only super admins can change plans.</Text>}
      {f && (
        <Card style={{ gap: spacing.md }}>
          <Text style={styles.h2}>{f.name}</Text>
          <View><FieldLabel>Name</FieldLabel><Input value={f.name} onChangeText={(v) => setF({ ...f, name: v })} editable={superAdmin} /></View>
          <View><FieldLabel>Monthly price (₹) — your decision</FieldLabel><Input keyboardType="numeric" value={f.price} onChangeText={(v) => setF({ ...f, price: v })} editable={superAdmin} /></View>
          <View><FieldLabel>Visits included each month</FieldLabel><Input keyboardType="numeric" value={f.visits} onChangeText={(v) => setF({ ...f, visits: v })} editable={superAdmin} /></View>
          <View><FieldLabel>Services covered (none selected = all)</FieldLabel>
            <View style={styles.wrap}>{[...CATEGORIES, { id: 'general', label: 'Something else' }].map((c) => <Chip key={c.id} label={c.label} selected={f.categories.includes(c.id)} onPress={() => superAdmin && setF({ ...f, categories: f.categories.includes(c.id) ? f.categories.filter((x) => x !== c.id) : [...f.categories, c.id] })} />)}</View></View>
          <View><FieldLabel>Description</FieldLabel><Input multiline value={f.description} onChangeText={(v) => setF({ ...f, description: v })} editable={superAdmin} /></View>
          <View><FieldLabel>Renewal and cancellation terms customers see</FieldLabel><Input multiline value={f.terms} onChangeText={(v) => setF({ ...f, terms: v })} editable={superAdmin} /></View>
          <View><FieldLabel>Razorpay plan id (create the plan in your Razorpay dashboard)</FieldLabel><Input autoCapitalize="none" value={f.providerPlan} onChangeText={(v) => setF({ ...f, providerPlan: v })} editable={superAdmin} /></View>
          <Chip label={f.active ? '✓ Live: customers can subscribe' : 'Switched off'} selected={f.active} onPress={() => superAdmin && setF({ ...f, active: !f.active })} />
          <ErrorText>{error}</ErrorText>
          {!!msg && <Text style={styles.ok}>{msg}</Text>}
          {superAdmin && <Button label="Save plan" onPress={save} />}
        </Card>
      )}
      <Text style={styles.h2}>Subscribers</Text>
      {(subs || []).map((s) => (
        <Card key={s.id} style={styles.row}>
          <View style={{ flex: 1 }}><Text style={styles.name}>{s.customer?.full_name}</Text><Text style={styles.hint}>{s.plan_code} · {s.visits_remaining} visits left{s.cancel_at_period_end ? ' · cancelling' : ''}</Text></View>
          <Badge label={s.status} tone={TONE[s.status]} />
        </Card>
      ))}
      {subs && !subs.length && <Text style={styles.hint}>No subscribers yet.</Text>}
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  h2: { fontSize: 19, fontWeight: '800', color: colors.text }, name: { fontSize: 16, fontWeight: '700', color: colors.text },
  hint: { fontSize: 14, color: colors.muted, lineHeight: 20 }, ok: { fontSize: 15, color: colors.successText, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 }, wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
