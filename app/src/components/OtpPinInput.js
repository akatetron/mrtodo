// Four big boxes for the customer's completion code. One hidden numeric field
// does the typing, so the phone shows its numeric keypad. The code is never logged
// or stored by the app.
import React, { useRef } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { colors, radius } from '../theme';

export default function OtpPinInput({ value, onChange, length = 4, label = 'Completion code from the customer' }) {
  const ref = useRef(null);
  return (
    <Pressable onPress={() => ref.current?.focus()} accessibilityRole="none">
      <Text style={styles.label}>{label}</Text>
      <View style={styles.row}>
        {Array.from({ length }).map((_, i) => (
          <View key={i} style={[styles.box, i === value.length && styles.boxOn]}>
            <Text style={styles.digit}>{value[i] || ''}</Text>
          </View>
        ))}
      </View>
      <TextInput
        ref={ref} value={value} onChangeText={(v) => onChange(v.replace(/\D/g, '').slice(0, length))}
        keyboardType="number-pad" maxLength={length} autoComplete="off" importantForAutofill="no" textContentType="oneTimeCode"
        accessibilityLabel={`${label}, ${length} digits`} style={styles.hidden}
      />
    </Pressable>
  );
}
const styles = StyleSheet.create({
  label: { fontSize: 14, fontWeight: '700', color: colors.muted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.4 },
  row: { flexDirection: 'row', gap: 12, justifyContent: 'center' },
  box: { width: 64, height: 76, borderRadius: radius.md, borderWidth: 2, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  boxOn: { borderColor: colors.accent, backgroundColor: colors.accentLight },
  digit: { fontSize: 34, fontWeight: '800', color: colors.text },
  hidden: { position: 'absolute', opacity: 0.02, height: 76, left: 0, right: 0 },
});
