// Offers made to this Personal Manager by the matching system. Accepting assigns the task; until then it is
// only an offer. The deadline comes from the server, and the server checks again when the PM accepts.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, typo } from '../theme';
import { Card, Badge, Button, ErrorText } from './UI';
import { listMyOffers, respondToOffer } from '../data/operations';
import { formatMoney } from '../lib/money';
import { refreshAll } from '../data/store';

function Countdown({ endsAt }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i); }, []);
  const left = Math.max(0, Math.floor((new Date(endsAt).getTime() - now) / 1000));
  return <Badge label={left ? `Respond within ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : 'Time is up'} tone={left && left < 120 ? 'danger' : 'brass'} />;
}

const PRICE_WORD = { estimated: 'Estimated price', approved: 'Approved price', final: 'Final charge', quote_pending: 'Quote awaiting approval' };
const VEHICLE = { two_wheeler: 'a two-wheeler', four_wheeler: 'a four-wheeler' };

export default function PmOffers({ onAccepted }) {
  const [offers, setOffers] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const load = useCallback(async () => setOffers(await listMyOffers()), []);
  useEffect(() => { load(); const i = setInterval(load, 15000); return () => clearInterval(i); }, [load]);
  const pending = (offers || []).filter((o) => o.status === 'pending');
  if (!pending.length) return null;

  async function answer(o, accept) {
    setBusy(o.offer_id); setError(''); setNote('');
    try {
      const r = await respondToOffer(o.offer_id, accept);
      if (r === 'accepted') { await refreshAll(); onAccepted && onAccepted(o); }
      else if (r === 'ineligible') setNote('This task no longer fits your schedule or details, so it was passed on.');
      else if (r === 'expired') setNote('That offer had already expired.');
      else if (r === 'cancelled') setNote('That task is no longer open.');
      await load();
    } catch (e) { setError(e.message); await load(); } finally { setBusy(null); }
  }

  return (
    <View style={{ gap: spacing.md, marginBottom: spacing.lg }}>
      <Text style={styles.h}>Offered to you</Text>
      {pending.map((o) => (
        <Card key={o.offer_id} style={{ gap: 8 }}>
          <Countdown endsAt={o.expires_at} />
          <Text style={styles.title}>{o.title}</Text>
          {!!o.description && <Text style={styles.muted} numberOfLines={3}>{o.description}</Text>}
          <Text style={styles.line}>{o.area} · {o.scheduled_for || 'Time to be agreed'}</Text>
          {o.est_minutes ? <Text style={styles.line}>About {o.est_minutes} minutes{o.quantity > 1 ? ` · ${o.quantity} units` : ''}</Text> : null}
          {o.est_cost != null && <Text style={styles.line}>{PRICE_WORD[o.pricing_state] || 'Price'}: {formatMoney(o.est_cost, o.currency)} ({o.currency})</Text>}
          {o.vehicle_ok?.length > 0 && <Text style={styles.line}>Needs {o.vehicle_ok.map((v) => VEHICLE[v]).join(' or ')}</Text>}
          <Text style={styles.muted}>The task is only yours once you accept. We check your schedule again then.</Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button label={busy === o.offer_id ? 'One moment…' : 'Accept'} onPress={() => answer(o, true)} disabled={!!busy} style={{ flex: 1 }} />
            <Button label="Decline" variant="ghost" onPress={() => answer(o, false)} disabled={!!busy} style={{ flex: 1 }} />
          </View>
        </Card>
      ))}
      {!!note && <Text style={styles.muted} accessibilityLiveRegion="polite">{note}</Text>}
      <ErrorText>{error}</ErrorText>
    </View>
  );
}

const styles = StyleSheet.create({
  h: { ...typo.h2, color: colors.text },
  title: { ...typo.service, color: colors.text },
  line: { ...typo.body, color: colors.text },
  muted: { ...typo.body, color: colors.muted },
});
