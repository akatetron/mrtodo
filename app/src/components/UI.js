import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors, radius, spacing } from '../theme';

export function Card({ children, style }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Badge({ label, tone = 'neutral', style }) {
  const tones = {
    neutral: { bg: colors.surfaceAlt, fg: colors.muted },
    accent: { bg: colors.accentLight, fg: colors.accentDark },
    brass: { bg: colors.brassLight, fg: colors.brassDark },
    success: { bg: colors.successLight, fg: colors.success },
    danger: { bg: colors.dangerLight, fg: colors.danger },
  };
  const t = tones[tone] || tones.neutral;
  return (
    <View style={[styles.badge, { backgroundColor: t.bg }, style]}>
      <Text style={[styles.badgeText, { color: t.fg }]}>{label}</Text>
    </View>
  );
}

export function Button({ label, onPress, variant = 'primary', style, disabled, size = 'md' }) {
  const isPrimary = variant === 'primary';
  const isGhost = variant === 'ghost';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.btn,
        size === 'sm' && styles.btnSm,
        isPrimary && { backgroundColor: colors.accent },
        isGhost && { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
        disabled && { opacity: 0.5 },
        pressed && !disabled && { opacity: 0.85 },
        style,
      ]}
    >
      <Text style={[styles.btnText, isGhost && { color: colors.text }, isPrimary && { color: colors.accentText }]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function FieldLabel({ children }) {
  return <Text style={styles.fieldLabel}>{children}</Text>;
}

export function StatusTracker({ status }) {
  const idx = ['requested', 'matched', 'assigned', 'in_progress', 'completed'].indexOf(status);
  const labels = { requested: 'Requested', matched: 'Matched', assigned: 'Assigned', in_progress: 'In progress', completed: 'Completed' };
  return (
    <View style={styles.trackerRow}>
      {Object.keys(labels).map((key, i) => {
        const done = i < idx;
        const current = i === idx;
        const isLast = i === Object.keys(labels).length - 1;
        return (
          <View key={key} style={styles.trackStep}>
            <View style={styles.trackDotWrap}>
              <View
                style={[
                  styles.trackDot,
                  { borderColor: done || current ? colors.accent : colors.border },
                  done && { backgroundColor: colors.accent },
                ]}
              >
                {done ? <Text style={{ color: colors.accentText, fontSize: 12, fontWeight: '700' }}>✓</Text> : null}
                {current ? <View style={styles.trackDotInner} /> : null}
              </View>
              <Text style={[styles.trackLabel, { color: done || current ? colors.text : colors.faint }]}>{labels[key]}</Text>
            </View>
            {!isLast && <View style={[styles.trackLine, { backgroundColor: i < idx ? colors.accent : colors.border }]} />}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  badgeText: { fontSize: 12, fontWeight: '700' },
  btn: {
    paddingVertical: 13,
    paddingHorizontal: 18,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnSm: { paddingVertical: 9, paddingHorizontal: 13, borderRadius: radius.sm },
  btnText: { fontWeight: '700', fontSize: 14.5 },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 7,
  },
  trackerRow: { flexDirection: 'row', alignItems: 'flex-start' },
  trackStep: { flexDirection: 'row', alignItems: 'flex-start', flex: 1 },
  trackDotWrap: { alignItems: 'center', width: 64 },
  trackDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trackDotInner: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },
  trackLabel: { fontSize: 10.5, fontWeight: '700', marginTop: 6, textAlign: 'center' },
  trackLine: { height: 2, flex: 1, marginTop: 12, marginHorizontal: -4 },
});
