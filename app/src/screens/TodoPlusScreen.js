// Todo+ Monthly Maintenance. Everything shown here comes from the server; the
// subscription only becomes active when the payment provider confirms payment.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, Linking, StyleSheet } from 'react-native';
import { colors, spacing } from '../theme';
import { Card, Badge, Button, ErrorText, FieldLabel } from '../components/UI';
import { listPlans, mySubscriptions, startSubscription, paymentLink, cancelSubscription } from '../data/store';

const STATUS = { pending: ['Waiting for payment', 'brass'], active: ['Active', 'success'], past_due: ['Payment failed', 'danger'], cancelled: ['Cancelled', 'neutral'], expired: ['Ended', 'neutral'] };

export default function TodoPlusScreen() {
  const [plans, setPlans] = useState({ plans: [], unavailable: false });
  const [subs, setSubs] = useState([]);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => { setPlans(await listPlans()); setSubs(await mySubscriptions()); }, []);
  useEffect(() => { load(); }, [load]);
  const act = async (fn) => { setBusy(true); setError(''); try { await fn(); await load(); } catch (e) { setError(e.message); } finally { setBusy(false); } };

  const live = subs.find((s) => ['pending', 'active', 'past_due'].includes(s.status));
  const plan = (code) => plans.plans.find((p) => p.code === code);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60, gap: spacing.lg }}>
      <View style={styles.hero}>
        <Text style={styles.heroTitle}>Todo+ Monthly Maintenance</Text>
        <Text style={styles.heroSub}>Regular help around the home on a monthly plan.</Text>
      </View>
      <ErrorText>{error}</ErrorText>

      {live ? (
        <Card style={{ gap: spacing.sm }}>
          <View style={styles.row}><Text style={styles.h2}>Your plan</Text><Badge label={STATUS[live.status][0]} tone={STATUS[live.status][1]} /></View>
          {live.status === 'active' && <>
            <Text style={styles.line}>Visits left this month: <Text style={{ fontWeight: '800' }}>{live.visits_remaining}</Text></Text>
            {live.current_period_end && <Text style={styles.line}>{live.cancel_at_period_end ? 'Ends on' : 'Next billing date'}: {new Date(live.current_period_end).toLocaleDateString()}</Text>}
            <Text style={styles.hint}>Your plan includes visits. Each visit is requested as a task and confirmed once we have checked availability. Having the plan does not book an appointment.</Text>
          </>}
          {live.status === 'pending' && <>
            <Text style={styles.line}>Complete the payment to start your plan.</Text>
            <Button label="Continue to payment" onPress={() => act(async () => Linking.openURL(await paymentLink(live.id)))} disabled={busy} />
          </>}
          {live.status === 'past_due' && <Text style={styles.line}>Your last payment did not go through. Update your payment method with the payment provider to keep your plan.</Text>}
          {live.cancel_at_period_end
            ? <Text style={styles.hint}>Cancellation requested. Your plan stays active until the end of this billing period.</Text>
            : <Button label="Cancel at the end of this period" variant="ghost" onPress={() => act(() => cancelSubscription(live.id))} disabled={busy} />}
        </Card>
      ) : plans.plans.length ? plans.plans.map((p) => (
        <Card key={p.code} style={{ gap: spacing.sm, borderColor: colors.brass, borderWidth: 2 }}>
          <Text style={styles.h2}>{p.name}</Text>
          <Text style={styles.price}>₹{Number(p.price_amount).toLocaleString('en-IN')} <Text style={styles.hint}>per month</Text></Text>
          <Text style={styles.line}>{p.included_visits} maintenance visit{p.included_visits === 1 ? '' : 's'} included each month.</Text>
          {!!p.description && <Text style={styles.line}>{p.description}</Text>}
          {p.eligible_categories?.length > 0 && <Text style={styles.hint}>Covers: {p.eligible_categories.join(', ')}.</Text>}
          <View><FieldLabel>Renewal and cancellation</FieldLabel><Text style={styles.hint}>{p.terms}</Text></View>
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: consent }} onPress={() => setConsent(!consent)} style={styles.check}>
            <Text style={styles.box}>{consent ? '☑' : '☐'}</Text>
            <Text style={[styles.line, { flex: 1 }]}>I agree to be charged ₹{Number(p.price_amount).toLocaleString('en-IN')} every month until I cancel.</Text>
          </Pressable>
          <Button label="Subscribe" disabled={!consent || busy} onPress={() => act(async () => { const id = await startSubscription(p.code, true); Linking.openURL(await paymentLink(id)); })} />
        </Card>
      )) : (
        <Card><Text style={styles.line}>{plans.unavailable ? 'Todo+ needs the latest database update.' : 'Todo+ is not available yet. We will let you know when it opens.'}</Text></Card>
      )}
      {subs.filter((s) => !['pending', 'active', 'past_due'].includes(s.status)).map((s) => (
        <Text key={s.id} style={styles.hint}>Past plan: {STATUS[s.status][0]} · {new Date(s.created_at).toLocaleDateString()}</Text>
      ))}
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  hero: { backgroundColor: colors.accent, borderRadius: 20, padding: spacing.lg, gap: 4 },
  heroTitle: { color: '#FFFFFF', fontSize: 24, fontWeight: '800' },
  heroSub: { color: '#E4EEEC', fontSize: 16, lineHeight: 22 },
  h2: { fontSize: 19, fontWeight: '800', color: colors.text },
  price: { fontSize: 28, fontWeight: '800', color: colors.brassDark },
  line: { fontSize: 16, lineHeight: 23, color: colors.text },
  hint: { fontSize: 15, lineHeight: 21, color: colors.muted },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  check: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', minHeight: 48 },
  box: { fontSize: 26, color: colors.accent },
});
