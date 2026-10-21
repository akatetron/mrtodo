import React, { useState } from 'react';
import { View, Text, Pressable, Switch, StyleSheet, Modal, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { colors, spacing, radius, typo } from '../../theme';
import { FieldLabel, Input, Button } from '../UI';
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

// Opens over the page, where the person already is. Saves who the booking is for, so the
// wizard never asks again and nothing scrolls away.
export function RecipientSheet({ visible, initial, onSave, onClose }) {
  const [v, setV] = useState({ recipientName: '', recipientRelation: '', recipientPhone: '', consent: false });
  const [errors, setErrors] = useState({});
  React.useEffect(() => {
    if (visible) { setV({ recipientName: initial.recipientName || '', recipientRelation: initial.recipientRelation || '', recipientPhone: initial.recipientPhone || '', consent: !!initial.consent }); setErrors({}); }
  }, [visible]);
  function save() {
    const e = {};
    if (!v.recipientName.trim()) e.recipientName = 'Add the name of the person you are booking for.';
    if (!v.consent) e.consent = 'Please confirm that they know and agree.';
    setErrors(e);
    if (Object.keys(e).length) return;
    onSave({ ...v, recipientName: v.recipientName.trim(), forWhom: 'other' });
  }
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.sheetWrap}>
        <Pressable style={s.sheetScrim} onPress={onClose} accessibilityLabel="Close" accessibilityRole="button" />
        <View style={s.sheet}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.lg }}>
            <Text style={s.sectionTitle} accessibilityRole="header">Who is this for?</Text>
            <Text style={s.note}>You are making the booking. They receive the help. We share only what the Personal Manager needs with them.</Text>
            <View>
              <FieldLabel>Their name</FieldLabel>
              <Input value={v.recipientName} onChangeText={(x) => setV({ ...v, recipientName: x })} placeholder="e.g. Kamala Bai" accessibilityLabel="Name of the person you are booking for" />
              <InlineValidationMessage>{errors.recipientName}</InlineValidationMessage>
            </View>
            <View>
              <FieldLabel>Your relationship (optional)</FieldLabel>
              <Input value={v.recipientRelation} onChangeText={(x) => setV({ ...v, recipientRelation: x })} placeholder="e.g. Mother" />
            </View>
            <View>
              <FieldLabel>Their phone (optional)</FieldLabel>
              <Input value={v.recipientPhone} onChangeText={(x) => setV({ ...v, recipientPhone: x })} keyboardType="phone-pad" placeholder="Optional" />
            </View>
            <Check checked={v.consent} onPress={() => setV({ ...v, consent: !v.consent })} label="They know about this booking and agree to a Personal Manager helping them." required />
            <InlineValidationMessage>{errors.consent}</InlineValidationMessage>
            <Button label="Save" onPress={save} />
            <Button label="Cancel" variant="secondary" onPress={onClose} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
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
  sheetWrap: { flex: 1, justifyContent: 'flex-end' },
  sheetScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(10,36,39,0.45)' },
  sheet: { backgroundColor: colors.card || '#FFFFFF', borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.xl, maxHeight: '88%', width: '100%', maxWidth: 640, alignSelf: 'center' },
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
