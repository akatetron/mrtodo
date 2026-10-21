// Standards: the specialists we can arrange, and the short tests Personal
// Managers can take to be verified for a skill. Super admins edit; everyone can read.
import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { colors, spacing } from '../../theme';
import { Card, Badge, Button, FieldLabel, Input, ErrorText, Chip } from '../../components/UI';
import { useAuth } from '../../lib/AuthContext';
import { listSkills } from '../../data/store';
import { listSpecialists, saveSpecialist, listAssessmentsAdmin, saveAssessment, isSuperAdmin, useLiveQuery } from '../../data/adminData';

const slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

export default function AdminStandardsScreen({ navigation }) {
  const { profile } = useAuth();
  const superAdmin = isSuperAdmin(profile);
  const { data: specialists } = useLiveQuery(listSpecialists, ['specialists'], navigation);
  const { data: assessments } = useLiveQuery(listAssessmentsAdmin, ['assessments'], navigation);
  const { data: skills } = useLiveQuery(listSkills, ['skills'], navigation);
  const [sp, setSp] = useState({ name: '', skill: 'home-repair-coordination', verified: false, note: '', phone: '' });
  const [as, setAs] = useState({ name: '', skill: 'tech-support', passPercent: '80', questions: [{ text: '', options: ['', ''], correct: 0 }] });
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const act = async (fn, ok) => { setError(''); setMsg(''); try { await fn(); setMsg(ok); } catch (e) { setError(e.message); } };
  const setQ = (i, patch) => setAs({ ...as, questions: as.questions.map((q, j) => (j === i ? { ...q, ...patch } : q)) });

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, paddingBottom: 80, gap: spacing.lg }}>
      {!superAdmin && <Text style={styles.hint}>Only super admins can change these. You can look.</Text>}
      <ErrorText>{error}</ErrorText>
      {!!msg && <Text style={styles.ok}>{msg}</Text>}

      <Text style={styles.h1}>Specialists</Text>
      {(specialists || []).map((s) => (
        <Card key={s.id} style={styles.row}>
          <View style={{ flex: 1 }}><Text style={styles.name}>{s.name}</Text><Text style={styles.hint}>{s.skill_key}{s.verification_note ? ` · ${s.verification_note}` : ''}</Text></View>
          <Badge label={s.verified ? 'Verified' : 'Not verified'} tone={s.verified ? 'success' : 'brass'} />
          {superAdmin && <Button size="sm" variant="ghost" label={s.active ? 'Pause' : 'Resume'}
            onPress={() => act(() => saveSpecialist({ id: s.id, name: s.name, skill: s.skill_key, verified: s.verified, note: s.verification_note, active: !s.active }), 'Saved.')} />}
        </Card>
      ))}
      {superAdmin && (
        <Card style={{ gap: spacing.md }}>
          <Text style={styles.h2}>Add a specialist</Text>
          <View><FieldLabel>Name or business</FieldLabel><Input value={sp.name} onChangeText={(v) => setSp({ ...sp, name: v })} /></View>
          <View><FieldLabel>Trade</FieldLabel><View style={styles.wrap}>{(skills || []).map((s) => <Chip key={s.key} label={s.name} selected={sp.skill === s.key} onPress={() => setSp({ ...sp, skill: s.key })} />)}</View></View>
          <View><FieldLabel>Phone (private to super admins)</FieldLabel><Input keyboardType="phone-pad" value={sp.phone} onChangeText={(v) => setSp({ ...sp, phone: v })} /></View>
          <View><FieldLabel>How you checked them (licence, references)</FieldLabel><Input value={sp.note} onChangeText={(v) => setSp({ ...sp, note: v })} /></View>
          <Chip label="Credentials checked and verified" selected={sp.verified} onPress={() => setSp({ ...sp, verified: !sp.verified })} />
          <Button label="Save specialist" disabled={sp.name.trim().length < 2} onPress={() => act(async () => { await saveSpecialist(sp); setSp({ ...sp, name: '', phone: '', note: '', verified: false }); }, 'Specialist saved.')} />
        </Card>
      )}

      <Text style={styles.h1}>Assessments</Text>
      <Text style={styles.hint}>Short multiple-choice tests. Passing verifies one skill. They are free for now; paid assessments are not switched on.</Text>
      {(assessments || []).map((a) => (
        <Card key={a.id} style={styles.row}>
          <View style={{ flex: 1 }}><Text style={styles.name}>{a.name}</Text><Text style={styles.hint}>{a.skill_key} · pass at {a.pass_percent}% · {a.questions.length} questions</Text></View>
          <Badge label={a.active ? 'Live' : 'Off'} tone={a.active ? 'success' : 'neutral'} />
        </Card>
      ))}
      {superAdmin && (
        <Card style={{ gap: spacing.md }}>
          <Text style={styles.h2}>New assessment</Text>
          <View><FieldLabel>Title</FieldLabel><Input value={as.name} onChangeText={(v) => setAs({ ...as, name: v })} /></View>
          <View><FieldLabel>Skill it verifies</FieldLabel><View style={styles.wrap}>{(skills || []).filter((s) => !s.regulated).map((s) => <Chip key={s.key} label={s.name} selected={as.skill === s.key} onPress={() => setAs({ ...as, skill: s.key })} />)}</View></View>
          <View><FieldLabel>Pass mark (%)</FieldLabel><Input keyboardType="numeric" value={as.passPercent} onChangeText={(v) => setAs({ ...as, passPercent: v })} /></View>
          {as.questions.map((q, i) => (
            <View key={i} style={styles.q}>
              <Input placeholder={`Question ${i + 1}`} value={q.text} onChangeText={(v) => setQ(i, { text: v })} />
              {q.options.map((o, oi) => (
                <View key={oi} style={styles.row}>
                  <View style={{ flex: 1 }}><Input placeholder={`Option ${oi + 1}`} value={o} onChangeText={(v) => setQ(i, { options: q.options.map((x, k) => (k === oi ? v : x)) })} /></View>
                  <Chip label={q.correct === oi ? '✓ Correct' : 'Mark correct'} selected={q.correct === oi} onPress={() => setQ(i, { correct: oi })} />
                </View>
              ))}
              <Button size="sm" variant="ghost" label="Add an option" onPress={() => setQ(i, { options: [...q.options, ''] })} />
            </View>
          ))}
          <Button size="sm" variant="ghost" label="Add a question" onPress={() => setAs({ ...as, questions: [...as.questions, { text: '', options: ['', ''], correct: 0 }] })} />
          <Button label="Save and switch on" disabled={as.name.trim().length < 3}
            onPress={() => act(() => saveAssessment({ key: slug(as.name), name: as.name.trim(), skill: as.skill, passPercent: parseInt(as.passPercent, 10) || 80, active: true,
              questions: as.questions.map((q) => ({ text: q.text.trim(), options: q.options.map((o) => o.trim()).filter(Boolean), correct: q.correct })) }), 'Assessment saved and live.')} />
        </Card>
      )}
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  h1: { fontSize: 22, fontWeight: '800', color: colors.text },
  h2: { fontSize: 18, fontWeight: '800', color: colors.text },
  name: { fontSize: 16, fontWeight: '700', color: colors.text },
  hint: { fontSize: 14, color: colors.muted, lineHeight: 20 },
  ok: { fontSize: 15, color: colors.success, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  q: { gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm },
});
