// Admin: arrange a specialist (plumber, electrician...) for a task and follow
// their visits. A specialist finishing a visit never completes the customer's
// task; only the Personal Manager's completion with the customer's code does.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing } from '../theme';
import { Card, Badge, Button, Input, ErrorText } from './UI';
import { listSpecialists, listSpecialistJobs, assignSpecialist, setSpecialistJob } from '../data/adminData';

const NEXT = { requested: 'quoted', quoted: 'scheduled', scheduled: 'visited', visited: 'completed' };

export default function SpecialistPanel({ t }) {
  const [specialists, setSpecialists] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setSpecialists(await listSpecialists()); setJobs(await listSpecialistJobs(t.id)); } catch (e) { setError(e.message); }
  }, [t.id]);
  useEffect(() => { load(); }, [load]);
  const act = async (fn) => { setBusy(true); setError(''); try { await fn(); await load(); } catch (e) { setError(e.message); } finally { setBusy(false); } };

  const needs = t.serviceSnapshot?.requires_specialist;
  if (!needs && !jobs.length) return null;
  return (
    <Card style={{ gap: spacing.sm }}>
      <Text style={styles.h2}>Specialist</Text>
      {jobs.map((j) => (
        <View key={j.id} style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{j.specialist?.name}</Text>
            <Text style={styles.hint}>{j.specialist?.skill_key}{j.specialist?.verified ? ' · verified' : ' · not verified'}</Text>
          </View>
          <Badge label={j.status} tone={j.status === 'failed' ? 'danger' : j.status === 'completed' ? 'success' : 'brass'} />
          {NEXT[j.status] && <Button size="sm" variant="ghost" label={`Mark ${NEXT[j.status]}`} disabled={busy} onPress={() => act(() => setSpecialistJob(j.id, NEXT[j.status]))} />}
          {!['completed', 'failed'].includes(j.status) && <Button size="sm" variant="danger" label="Failed" disabled={busy} onPress={() => act(() => setSpecialistJob(j.id, 'failed'))} />}
        </View>
      ))}
      <Input placeholder="Note for the specialist visit (optional)" value={note} onChangeText={setNote} />
      {specialists.filter((s) => s.active).map((s) => (
        <View key={s.id} style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{s.name}</Text>
            <Text style={styles.hint}>{s.skill_key} · {s.verified ? 'verified' : 'not verified'}</Text>
          </View>
          <Button size="sm" label="Arrange" disabled={busy} onPress={() => act(() => assignSpecialist(t.id, s.id, note.trim()))} />
        </View>
      ))}
      {!specialists.length && <Text style={styles.hint}>No specialists yet. Add them in More → Standards and specialists.</Text>}
      <Text style={styles.hint}>Regulated work (electrical, plumbing) can only go to a verified specialist.</Text>
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}
const styles = StyleSheet.create({
  h2: { fontSize: 18, fontWeight: '800', color: colors.text },
  name: { fontSize: 16, fontWeight: '700', color: colors.text },
  hint: { fontSize: 14, color: colors.muted },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
});
