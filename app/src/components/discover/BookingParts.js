import React from 'react';
import { View, Text, Pressable, Switch, StyleSheet } from 'react-native';
import { colors, spacing, radius, typo } from '../../theme';
import { FieldLabel, Input } from '../UI';
import AppIcon from '../AppIcon';

export function InlineValidationMessage({ children }) {
  if (!children) return null;
  return (
    <View style={s.invalid} accessibilityLiveRegion="polite" accessibilityRole="alert">
      <AppIcon name="help-circle" size={16} color={colors.danger} />
      <Text style={s.invalidText}>{children}</Text>
    </View>
  );
}

export function BookingStepHeader({ step, steps, title }) {
  return (
    <View style={{ gap: 10 }} accessible accessibilityRole="progressbar" accessibilityLabel={`Step ${step} of ${steps.length}: ${steps[step - 1]}`}>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {steps.map((label, i) => <View key={label} style={[s.seg, i < step && s.segOn]} />)}
      </View>
      <Text style={s.stepText}>Step {step} of {steps.length} · {steps[step - 1]}</Text>
      {!!title && <Text style={s.title} accessibilityRole="header">{title}</Text>}
    </View>
  );
}

// "Booking for someone else?" A switch, and the person's details when it is on.
export function BookForSomeoneElseSection({ value, onChange, errors = {} }) {
  const set = (patch) => onChange({ ...value, ...patch });
  const on = value.forWhom === 'other';
  return (
    <View style={s.section}>
      <View style={s.switchRow}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={s.sectionTitle} accessibilityRole="header">Booking for someone else?</Text>
          <Text style={s.sectionDesc}>Arrange help for a family member or someone you care about.</Text>
        </View>
        <Switch
          value={on} onValueChange={(v) => set({ forWhom: v ? 'other' : 'self' })} accessibilityLabel="Booking for someone else"
          trackColor={{ true: colors.accent, false: colors.border }} thumbColor="#FFFFFF"
        />
      </View>
      {on && (
        <View style={{ gap: spacing.lg, marginTop: spacing.lg }}>
          <Text style={s.note}>You are making the booking. They receive the help. We share only what the Personal Manager needs with them.</Text>
          <View>
            <FieldLabel>Their name</FieldLabel>
            <Input value={value.recipientName} onChangeText={(v) => set({ recipientName: v })} placeholder="e.g. Kamala Bai" accessibilityLabel="Name of the person you are booking for" />
            <InlineValidationMessage>{errors.recipientName}</InlineValidationMessage>
          </View>
          <View>
            <FieldLabel>Your relationship (optional)</FieldLabel>
            <Input value={value.recipientRelation} onChangeText={(v) => set({ recipientRelation: v })} placeholder="e.g. Mother" />
          </View>
          <View>
            <FieldLabel>Their phone (optional)</FieldLabel>
            <Input value={value.recipientPhone} onChangeText={(v) => set({ recipientPhone: v })} keyboardType="phone-pad" placeholder="Shared only with the assigned Personal Manager" />
          </View>
          <Check checked={value.consent} onPress={() => set({ consent: !value.consent })}
            label="They know about this booking and agree to a Personal Manager helping them." required />
          <InlineValidationMessage>{errors.consent}</InlineValidationMessage>
          <Check checked={value.shareUpdates} onPress={() => set({ shareUpdates: !value.shareUpdates })}
            label="Keep me updated on progress. Only you receive updates." />
          <View>
            <FieldLabel>Another person who may receive updates (optional)</FieldLabel>
            <Input value={value.contactName} onChangeText={(v) => set({ contactName: v })} placeholder="Name" />
          </View>
        </View>
      )}
    </View>
  );
}

function Check({ checked, onPress, label, required }) {
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked }} onPress={onPress} style={s.check}>
      <View style={[s.box, checked && s.boxOn]}>{checked && <AppIcon name="check" size={18} color="#FFFFFF" />}</View>
      <Text style={s.checkText}>{label}{required ? ' *' : ''}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  invalid: { flexDirection: 'row', gap: 6, alignItems: 'center', marginTop: 6 },
  invalidText: { ...typo.meta, fontSize: 14, color: colors.danger, flex: 1 },
  seg: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.border },
  segOn: { backgroundColor: colors.accent },
  stepText: { ...typo.meta, color: colors.muted },
  title: { ...typo.h1, color: colors.text },
  section: { marginTop: spacing.xl, paddingTop: spacing.xl, borderTopWidth: 1, borderTopColor: colors.border },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56 },
  sectionTitle: { ...typo.h2, color: colors.text },
  sectionDesc: { ...typo.body, color: colors.muted },
  note: { ...typo.body, color: colors.muted, backgroundColor: colors.accentLight, padding: 12, borderRadius: radius.md },
  check: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', minHeight: 48 },
  box: { width: 26, height: 26, borderRadius: 7, borderWidth: 2, borderColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  boxOn: { backgroundColor: colors.accent },
  checkText: { ...typo.body, color: colors.text, flex: 1 },
});
