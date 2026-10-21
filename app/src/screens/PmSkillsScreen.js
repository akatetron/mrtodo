// A Personal Manager's skills: what they have said, what Mr. Todo has verified,
// and the short tests that can verify a skill.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { colors, spacing, radius } from '../theme';
import { Card, Badge, Button, ErrorText } from '../components/UI';
import { useAuth } from '../lib/AuthContext';
import { listSkills, myQualifications, claimSkill, availableAssessments, submitAssessment } from '../data/store';

export default function PmSkillsScreen() {
  const { user } = useAuth();
  const [skills, setSkills] = useState([]);
  const [quals, setQuals] = useState([]);
  const [tests, setTests] = useState([]);
  const [taking, setTaking] = useState(null);
  const [answers, setAnswers] = useState([]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setSkills(await listSkills()); setQuals(await myQualifications(user.id)); setTests(await availableAssessments());
  }, [user.id]);
  useEffect(() => { load(); }, [load]);
  const act = async (fn) => { setBusy(true); setError(''); try { await fn(); await load(); } catch (e) { setError(e.message); } finally { setBusy(false); } };

  if (taking) {
    const done = answers.length === taking.questions.length && answers.every((a) => a != null);
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60, gap: spacing.md }}>
        <Text style={styles.h2}>{taking.name}</Text>
        {taking.questions.map((q, qi) => (
          <Card key={qi} style={{ gap: spacing.sm }}>
            <Text style={styles.q}>{qi + 1}. {q.text}</Text>
            {q.options.map((o, oi) => {
              const on = answers[qi] === oi;
              return (
                <Pressable key={oi} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => { const a = [...answers]; a[qi] = oi; setAnswers(a); }} style={[styles.opt, on && styles.optOn]}>
                  <Text style={styles.optText}>{on ? '◉ ' : '○ '}{o}</Text>
                </Pressable>
              );
            })}
          </Card>
        ))}
        {result && <Card><Text style={[styles.q, { color: result.passed ? colors.success : colors.danger }]}>{result.passed ? `Passed with ${result.score_percent}%. This skill is now verified.` : `Scored ${result.score_percent}%. You need ${result.pass_percent}%. Try again.`}</Text></Card>}
        <ErrorText>{error}</ErrorText>
        {!result && <Button label={busy ? 'Submitting…' : 'Submit answers'} disabled={busy || !done} onPress={() => act(async () => setResult(await submitAssessment(taking.id, answers.map((a) => a ?? -1))))} />}
        <Button label="Back" variant="ghost" onPress={() => { setTaking(null); setResult(null); setAnswers([]); }} />
      </ScrollView>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60, gap: spacing.md }}>
      <Text style={styles.hint}>Tasks that need a skill can only be accepted by Personal Managers who are verified for it. Saying you have a skill does not verify it.</Text>
      <ErrorText>{error}</ErrorText>
      {skills.map((s) => {
        const q = quals.find((x) => x.skill_key === s.key);
        const expired = q?.expires_at && new Date(q.expires_at) < new Date();
        const label = !q ? 'Not added' : expired ? 'Expired' : q.status === 'verified' ? 'Verified' : q.status === 'claimed' ? 'Said by you · not verified' : 'Not currently verified';
        return (
          <Card key={s.key} style={{ gap: spacing.sm }}>
            <View style={styles.row}>
              <Text style={styles.q}>{s.name}</Text>
              <Badge label={label} tone={q?.status === 'verified' && !expired ? 'success' : q ? 'brass' : 'neutral'} />
            </View>
            {s.regulated && <Text style={styles.hint}>Regulated work: verified only by our team after checking your documents.</Text>}
            {!q && <Button size="sm" variant="ghost" label="I can help with this" disabled={busy} onPress={() => act(() => claimSkill(s.key))} />}
            {tests.filter((t) => t.skill_key === s.key).map((t) => (
              <Button key={t.id} size="sm" label={t.passed && q?.status === 'verified' ? `Retake: ${t.name}` : `Take test: ${t.name}`} onPress={() => { setTaking(t); setAnswers([]); setResult(null); }} />
            ))}
          </Card>
        );
      })}
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  h2: { fontSize: 20, fontWeight: '800', color: colors.text },
  q: { fontSize: 16, fontWeight: '700', color: colors.text, flexShrink: 1 },
  hint: { fontSize: 15, color: colors.muted, lineHeight: 22 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  opt: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 14, borderRadius: radius.md, borderWidth: 2, borderColor: colors.border },
  optOn: { borderColor: colors.accent, backgroundColor: colors.accentLight },
  optText: { fontSize: 16, color: colors.text },
});
