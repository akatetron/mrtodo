// Shown only when an administrator has turned gender-based matching on. Says why it is asked, and is optional.
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors, spacing, radius, typo } from '../theme';
import { Card, ErrorText } from './UI';
import AppIcon from './AppIcon';
import { genderMatchingActive, myGenderStatus, saveGender } from '../data/operations';

const OPTIONS = [['female', 'Female'], ['male', 'Male'], ['non_binary', 'Non-binary'], ['self_described', 'I describe it differently'], ['undisclosed', 'Prefer not to say']];

export default function GenderCard() {
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState({ gender: null, consented: false });
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  useEffect(() => { genderMatchingActive().then(setActive); myGenderStatus().then(setStatus); }, []);
  if (!active) return null;
  async function pick(g) {
    setError(''); setDone('');
    try { await saveGender(g, consent); setStatus(await myGenderStatus()); setDone('Saved.'); } catch (e) { setError(e.message); }
  }
  async function clear() { setError(''); try { await saveGender(null, false); setStatus(await myGenderStatus()); setDone('Removed.'); setConsent(false); } catch (e) { setError(e.message); } }
  return (
    <Card style={{ gap: 10 }}>
      <Text style={s.h2} accessibilityRole="header">Gender (optional)</Text>
      <Text style={s.muted}>We use this only to match tasks with Personal Managers under our matching policy. It is never shown to customers, Personal Managers or other people, and you can remove it at any time. If you leave it empty, we do not guess.</Text>
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: consent }} onPress={() => setConsent(!consent)} style={s.check}>
        <View style={[s.box, consent && s.boxOn]}>{consent && <AppIcon name="check" size={18} color="#FFFFFF" />}</View>
        <Text style={s.checkText}>I agree that you may use this for matching.</Text>
      </Pressable>
      <View style={s.chips}>{OPTIONS.map(([v, label]) => (
        <Pressable key={v} accessibilityRole="radio" accessibilityState={{ selected: status.gender === v }} onPress={() => pick(v)} style={[s.chip, status.gender === v && s.chipOn]}>
          {status.gender === v && <AppIcon name="check" size={16} />}<Text style={[s.chipText, status.gender === v && { color: colors.accent }]}>{label}</Text></Pressable>))}</View>
      {status.gender && <Pressable accessibilityRole="button" onPress={clear} style={{ minHeight: 48, justifyContent: 'center' }}><Text style={s.link}>Remove what I told you</Text></Pressable>}
      {!!done && <Text style={s.ok} accessibilityLiveRegion="polite">{done}</Text>}
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}

const s = StyleSheet.create({
  h2: { ...typo.h2, color: colors.text },
  muted: { ...typo.body, color: colors.muted },
  check: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
  box: { width: 28, height: 28, borderRadius: 8, borderWidth: 2, borderColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: colors.accent },
  checkText: { ...typo.body, color: colors.text, flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chipOn: { borderColor: colors.accent, backgroundColor: colors.accentLight },
  chipText: { ...typo.body, fontWeight: '600', color: colors.text },
  link: { ...typo.body, color: colors.accent, fontWeight: '700' },
  ok: { ...typo.body, color: colors.successText, fontWeight: '700' },
});
