// "What happens next", in plain words, from the task's real state. Only states the
// backend actually has are described; there is no tracking, ETA or availability claim.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, radius, typo } from '../../theme';
import AppIcon from '../AppIcon';
import { nextStep } from '../../lib/nextStep';

export default function TaskNextStep({ t }) {
  const n = nextStep(t);
  if (!n) return null;
  const action = n.tone === 'action';
  return (
    <View style={[s.box, action && s.action]} accessibilityRole="summary">
      <View style={[s.icon, action && { backgroundColor: colors.brassLight }]}><AppIcon name={n.icon} size={20} color={action ? colors.brassDark : colors.accent} /></View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.title}>{n.title}</Text>
        <Text style={s.body}>{n.body}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  box: { flexDirection: 'row', gap: 14, padding: 16, borderRadius: radius.lg, backgroundColor: colors.accentLight, marginBottom: spacing.lg },
  action: { backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.brass },
  icon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  title: { ...typo.service, color: colors.text },
  body: { fontSize: 15, lineHeight: 22, color: colors.text },
});
