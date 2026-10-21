// Admin: what a Personal Manager is verified for, and their interviews.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing } from '../theme';
import { Card, Badge, Button, Input, ErrorText } from './UI';
import { listSkills } from '../data/store';
import { setPmQualification, recordInterview, listInterviews } from '../data/adminData';
import { supabase } from '../lib/supabase';

export default function QualificationsPanel({ workerId, canEdit }) {
  const [skills, setSkills] = useState([]);
  const [quals, setQuals] = useState([]);
  const [interviews, setInterviews] = useState([]);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setSkills(await listSkills());
    const { data } = await supabase.from('pm_qualifications').select('*').eq('worker_id', workerId);
    setQuals(data || []);
    try { setInterviews(await listInterviews(workerId)); } catch (e) { /* older database */ }
  }, [workerId]);
  useEffect(() => { load(); }, [load]);
  const act = async (fn) => { setBusy(true); setError(''); try { await fn(); await load(); } catch (e) { setError(e.message); } finally { setBusy(false); } };

  if (!skills.length) return null;
  return (
    <Card style={{ gap: spacing.sm }}>
      <Text style={styles.h2}>Qualifications</Text>
      {skills.map((s) => {
        const q = quals.find((x) => x.skill_key === s.key);
        const expired = q?.expires_at && new Date(q.expires_at) < new Date();
        const tone = q?.status === 'verified' && !expired ? 'success' : q?.status === 'revoked' || expired ? 'danger' : 'neutral';
        const label = !q ? 'Not claimed' : expired ? 'Expired' : q.status === 'verified' ? `Verified (${q.source})` : q.status === 'claimed' ? 'Self-reported only' : 'Revoked';
        return (
          <View key={s.key} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{s.name}{s.regulated ? ' · regulated' : ''}</Text>
              {!!q?.note && <Text style={styles.hint}>{q.note}</Text>}
            </View>
            <Badge label={label} tone={tone} />
            {canEdit && q?.status !== 'verified' && <Button size="sm" label="Verify" disabled={busy}
              onPress={() => act(() => setPmQualification(workerId, s.key, 'verified', 1, s.regulated ? 'document' : 'interview', new Date(Date.now() + 365 * 864e5).toISOString()))} />}
            {canEdit && q?.status === 'verified' && <Button size="sm" variant="danger" label="Revoke" disabled={busy} onPress={() => act(() => setPmQualification(workerId, s.key, 'revoked'))} />}
          </View>
        );
      })}
      <Text style={styles.hint}>Verifying lasts a year. For regulated skills, only verify after checking the person's documents.</Text>
      <Text style={styles.h2}>Interviews</Text>
      {interviews.map((i) => <Text key={i.id} style={styles.hint}>{new Date(i.created_at).toLocaleDateString()} · {i.outcome}{i.notes ? ` — ${i.notes}` : ''}</Text>)}
      {!interviews.length && <Text style={styles.hint}>None recorded.</Text>}
      {canEdit && (
        <>
          <Input placeholder="Interview notes (optional)" value={notes} onChangeText={setNotes} />
          <View style={styles.row}>
            <Button size="sm" label="Record: passed" disabled={busy} onPress={() => act(async () => { await recordInterview(workerId, 'passed', notes.trim()); setNotes(''); })} />
            <Button size="sm" variant="ghost" label="Failed" disabled={busy} onPress={() => act(async () => { await recordInterview(workerId, 'failed', notes.trim()); setNotes(''); })} />
            <Button size="sm" variant="ghost" label="Scheduled" disabled={busy} onPress={() => act(async () => { await recordInterview(workerId, 'scheduled', notes.trim()); setNotes(''); })} />
          </View>
        </>
      )}
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}
const styles = StyleSheet.create({
  h2: { fontSize: 18, fontWeight: '800', color: colors.text },
  name: { fontSize: 15, fontWeight: '700', color: colors.text },
  hint: { fontSize: 14, color: colors.muted, lineHeight: 20 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
});
