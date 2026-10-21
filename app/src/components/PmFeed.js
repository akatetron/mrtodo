// Open tasks this Personal Manager may take. The database decides who sees what:
// Gold Tier PMs get first look at premium tasks for a few minutes, and only the
// area (never the street address) is shown before accepting.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing } from '../theme';
import { Card, Badge, Button, ErrorText } from './UI';
import { pmFeed, claimTask, declineFeedTask, catMeta } from '../data/store';

function Countdown({ endsAt }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i); }, []);
  const left = Math.max(0, Math.floor((new Date(endsAt).getTime() - now) / 1000));   // end time comes from the server
  if (!left) return null;
  return <Badge label={`Gold priority: ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} left`} tone="brass" />;
}

export default function PmFeed({ onClaimed, gold }) {
  const [state, setState] = useState({ items: [], unavailable: false, loaded: false });
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => { const r = await pmFeed(); setState({ ...r, loaded: true }); }, []);
  useEffect(() => { load(); const i = setInterval(load, 15000); return () => clearInterval(i); }, [load]);

  async function claim(t) {
    setBusy(t.id); setError('');
    try { await claimTask(t.id); await load(); onClaimed && onClaimed(t); }
    catch (e) { setError(e.message); await load(); } finally { setBusy(null); }
  }
  if (state.unavailable || !state.loaded) return null;
  return (
    <View style={{ marginBottom: spacing.lg, gap: spacing.sm }}>
      <Text style={styles.h2}>Open tasks near you</Text>
      {gold && <Text style={styles.hint}>As a Gold Tier Personal Manager you see premium tasks first.</Text>}
      <ErrorText>{error}</ErrorText>
      {!state.items.length && <Text style={styles.hint}>Nothing open right now. New tasks appear here as customers post them.</Text>}
      {state.items.map((t) => {
        const amount = t.est_cost ?? t.rate_per_day;
        const earn = amount != null && t.earn_share_bps != null ? Math.round((Number(amount) * t.earn_share_bps) / 10000) : null;
        return (
          <Card key={t.id} style={[{ gap: spacing.sm }, t.is_premium && { borderColor: colors.brass, borderWidth: 2 }]}>
            <View style={styles.row}>
              <Text style={styles.title}>{catMeta(t.category).emoji} {t.title}</Text>
            </View>
            <View style={styles.row}>
              {t.is_premium && <Badge label="Premium task" tone="brass" />}
              {t.premium_window_ends_at && <Countdown endsAt={t.premium_window_ends_at} />}
              <Badge label={`📍 ${t.area}${t.distance_km != null ? ` · ${t.distance_km} km` : ''}`} />
              {t.schedule_kind === 'multi_day' && <Badge label="Several days" tone="brass" />}
            </View>
            <Text style={styles.hint}>{t.scheduled_at ? new Date(t.scheduled_at).toLocaleString() : t.scheduled_for || 'Flexible'}{t.est_duration_minutes ? ` · about ${t.est_duration_minutes} min` : ''}</Text>
            {earn != null && <Text style={styles.earn}>You earn ₹{earn.toLocaleString('en-IN')}</Text>}
            <View style={styles.row}>
              <Button label="Not for me" variant="ghost" size="sm" onPress={async () => { await declineFeedTask(t.id); load(); }} />
              <Button label={busy === t.id ? 'Taking…' : 'Accept task'} size="sm" disabled={!!busy} onPress={() => claim(t)} />
            </View>
          </Card>
        );
      })}
    </View>
  );
}
const styles = StyleSheet.create({
  h2: { fontSize: 19, fontWeight: '800', color: colors.text },
  title: { fontSize: 17, fontWeight: '800', color: colors.text, flex: 1 },
  hint: { fontSize: 15, color: colors.muted, lineHeight: 21 },
  earn: { fontSize: 17, fontWeight: '800', color: colors.accentDark },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
});
