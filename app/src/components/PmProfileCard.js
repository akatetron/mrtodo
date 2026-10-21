// What a customer may know about their Personal Manager. Verified things are
// kept apart from things the PM said about themselves.
import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing } from '../theme';
import { Card, Badge, Button, FieldLabel, ErrorText } from './UI';
import { pmPublicProfile, formatRating } from '../data/store';

export default function PmProfileCard({ workerId }) {
  const [p, setP] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function load() {
    setBusy(true); setError('');
    try { setP(await pmPublicProfile(workerId)); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  if (!p) return (
    <View style={{ gap: spacing.sm }}>
      <Button label={busy ? 'Loading…' : 'View profile and reviews'} variant="ghost" size="sm" onPress={load} disabled={busy} />
      <ErrorText>{error}</ErrorText>
    </View>
  );
  return (
    <View style={{ gap: spacing.md, marginTop: spacing.sm }}>
      {p.tier === 'gold' && <Badge label="Gold Tier" tone="brass" />}
      {!!p.bio && <Text style={styles.line}>{p.bio}</Text>}
      <View style={styles.row}>
        <Badge label={formatRating(p.rating, p.rating_count)} />
        <Badge label={`${p.completed_jobs} job${p.completed_jobs === 1 ? '' : 's'} completed`} />
        {!!p.service_area && <Badge label={`📍 ${p.service_area}`} />}
      </View>
      <View>
        <FieldLabel>Verified by Mr. Todo</FieldLabel>
        {p.verified_skills.length ? p.verified_skills.map((s) => (
          <Text key={s.skill} style={styles.line}>✓ {s.skill} <Text style={styles.muted}>({s.basis === 'assessment' ? 'passed a test' : s.basis === 'document' ? 'documents checked' : 'interview'})</Text></Text>
        )) : <Text style={styles.muted}>Nothing verified yet.</Text>}
      </View>
      {p.claimed_skills.length > 0 && (
        <View><FieldLabel>Says they can help with (not verified)</FieldLabel><Text style={styles.line}>{p.claimed_skills.join(', ')}</Text></View>
      )}
      {p.experience_years_self_reported != null && <Text style={styles.line}>Experience: {p.experience_years_self_reported} years <Text style={styles.muted}>(their own words)</Text></Text>}
      {p.languages?.length > 0 && <Text style={styles.line}>Languages: {p.languages.join(', ')}</Text>}
      <View>
        <FieldLabel>Reviews</FieldLabel>
        {p.reviews.length ? p.reviews.map((r, i) => (
          <Text key={i} style={styles.line}>{'★'.repeat(Math.round(r.rating))} “{r.text}” — {r.by}</Text>
        )) : <Text style={styles.muted}>No written reviews yet.</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  line: { fontSize: 15, lineHeight: 22, color: colors.text },
  muted: { fontSize: 14, color: colors.muted },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
