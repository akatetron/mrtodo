// Renders a catalogue service's questions. The questions are plain data written
// by an admin (never code); the database validates the answers again on posting.
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors, spacing, radius } from '../theme';
import { FieldLabel, Input } from './UI';

// A question is shown when it has no condition, or when the earlier answer matches.
export function isShown(q, answers) {
  if (!q.show_if) return true;
  const dep = answers[q.show_if.question];
  if (dep == null) return false;
  return Array.isArray(dep) ? dep.includes(q.show_if.equals) : dep === q.show_if.equals;
}

// First problem with the answers so far, in words for the customer, or null.
export function firstProblem(questions, answers) {
  for (const q of questions || []) {
    if (!isShown(q, answers)) continue;
    const v = answers[q.id];
    const empty = v == null || v === '' || (Array.isArray(v) && !v.length);
    if (q.required && empty) return `Please answer: ${q.label}`;
  }
  return null;
}

export default function DynamicQuestions({ questions, answers, onChange }) {
  const set = (id, v) => onChange({ ...answers, [id]: v });
  return (
    <View style={{ gap: spacing.lg }}>
      {(questions || []).filter((q) => isShown(q, answers)).map((q) => (
        <View key={q.id}>
          <FieldLabel>{q.label}{q.required ? ' *' : ''}</FieldLabel>
          {(q.type === 'single_choice' || q.type === 'multiple_choice') ? (
            <View style={styles.row}>
              {q.options.map((opt) => {
                const multi = q.type === 'multiple_choice';
                const on = multi ? (answers[q.id] || []).includes(opt) : answers[q.id] === opt;
                return (
                  <Pressable key={opt} accessibilityRole={multi ? 'checkbox' : 'radio'} accessibilityState={{ selected: on, checked: on }}
                    onPress={() => set(q.id, multi ? (on ? answers[q.id].filter((x) => x !== opt) : [...(answers[q.id] || []), opt]) : opt)}
                    style={[styles.opt, on && styles.optOn]}>
                    <Text style={[styles.optText, on && { color: colors.accentDark }]}>{on ? '✓ ' : ''}{opt}</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <Input
              value={answers[q.id] || ''} onChangeText={(v) => set(q.id, v)} multiline={q.type === 'long_text'}
              placeholder={q.type === 'datetime' ? 'e.g. Sat 26 Aug, 11 AM' : q.type === 'address' ? 'Flat / building, area' : ''}
            />
          )}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  opt: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 16, borderRadius: radius.pill, borderWidth: 2, borderColor: colors.border, backgroundColor: colors.surface },
  optOn: { borderColor: colors.accent, backgroundColor: colors.accentLight },
  optText: { fontSize: 15, fontWeight: '700', color: colors.muted },
});
