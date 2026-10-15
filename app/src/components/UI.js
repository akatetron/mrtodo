import React from 'react';
import { View, Text, Pressable, StyleSheet, TextInput } from 'react-native';
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
  const isDanger = variant === 'danger';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.btn,
        size === 'sm' && styles.btnSm,
        isPrimary && { backgroundColor: colors.accent },
        isGhost && { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
        isDanger && { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.danger },
        disabled && { opacity: 0.5 },
        pressed && !disabled && { opacity: 0.85 },
        style,
      ]}
    >
      <Text style={[styles.btnText, isGhost && { color: colors.text }, isPrimary && { color: colors.accentText }, isDanger && { color: colors.danger }]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function FieldLabel({ children }) {
  return <Text style={styles.fieldLabel}>{children}</Text>;
}

// Selectable pill, for filters and single/multi choices.
export function Chip({ label, selected, onPress, tone = 'accent', style }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, selected && (tone === 'danger' ? styles.chipOnDanger : styles.chipOn), style]}
    >
      <Text style={[styles.chipText, selected && { color: tone === 'danger' ? colors.danger : colors.accentDark }]}>{label}</Text>
    </Pressable>
  );
}

export function Input({ style, ...props }) {
  return <TextInput placeholderTextColor={colors.faint} style={[styles.input, props.multiline && styles.inputMulti, style]} {...props} />;
}

export function ErrorText({ children }) {
  if (!children) return null;
  return <Text style={styles.error}>{children}</Text>;
}

// Tap-to-rate 1–5 stars. Read-only when onChange is omitted.
export function Stars({ value = 0, onChange, size = 28 }) {
  return (
    <View style={{ flexDirection: 'row', gap: 6 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable key={n} disabled={!onChange} onPress={() => onChange && onChange(n)} hitSlop={4} accessibilityLabel={`${n} star${n > 1 ? 's' : ''}`}>
          <Text style={{ fontSize: size, color: n <= value ? colors.brass : colors.border }}>★</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function StatusTracker({ status }) {
  if (status === 'cancelled') {
    return <Badge label="This task was cancelled" tone="danger" />;
  }
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
  input: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 13,
    paddingVertical: 11,
    fontSize: 14.5,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  chip: {
    paddingHorizontal: 13, paddingVertical: 8, borderRadius: radius.pill,
    borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface,
  },
  chipOn: { borderColor: colors.accent, backgroundColor: colors.accentLight },
  chipOnDanger: { borderColor: colors.danger, backgroundColor: colors.dangerLight },
  chipText: { fontSize: 13, fontWeight: '700', color: colors.muted },
  inputMulti: { height: 84, textAlignVertical: 'top' },
  error: { color: colors.danger, fontSize: 13, lineHeight: 18 },
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
