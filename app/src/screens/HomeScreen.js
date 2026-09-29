import React, { useState } from 'react';
import { View, Text, TextInput, ScrollView, Pressable, StyleSheet } from 'react-native';
import { colors, spacing, radius } from '../theme';
import { Card, Button, FieldLabel, Badge } from '../components/UI';
import { CATEGORIES, TEMPLATES, createTask, myTasks, useTasks, STATUS_META, catMeta } from '../data/store';
import { useAuth } from '../lib/AuthContext';

export default function HomeScreen({ navigation }) {
  useTasks();
  const { user, profile } = useAuth();
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0].id);
  const [desc, setDesc] = useState('');
  const [taskType, setTaskType] = useState('one-time');
  const [location, setLocation] = useState('');
  const [forWhom, setForWhom] = useState('self');
  const [recipientName, setRecipientName] = useState('');
  const [recipientRelation, setRecipientRelation] = useState('');
  const [cost, setCost] = useState('');
  const [rate, setRate] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState(null);

  const mine = myTasks(user?.id);

  function applyTemplate(t, i) {
    setSelectedTemplate(i);
    setTitle(t.title);
    setDesc(t.desc);
    setCategory(t.category);
    setTaskType(t.taskType);
  }

  async function submit() {
    if (!title.trim() || !location.trim()) return;
    const task = await createTask({
      title: title.trim(),
      category,
      description: desc.trim(),
      taskType,
      scheduledFor: 'Date TBC',
      location: location.trim(),
      estCost: taskType === 'one-time' && cost ? parseInt(cost, 10) : null,
      ratePerDay: taskType === 'ongoing' && rate ? parseInt(rate, 10) : null,
      forWhom,
      recipientName: forWhom === 'other' ? recipientName || 'Recipient' : undefined,
      recipientRelation: forWhom === 'other' ? recipientRelation || 'Relative' : undefined,
    }, user.id);
    navigation.navigate('TrackTask', { taskId: task.id });
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }}>
      <Badge label="★ Trusted by 12,000+ households" tone="accent" style={{ marginBottom: 14 }} />
      <Text style={styles.h1}>
        Get your task done by a <Text style={{ color: colors.accent }}>verified Personal Manager</Text>
      </Text>
      <Text style={styles.sub}>
        Tell us what you need. We match you with a qualified, background-checked Personal Manager who looks after it from start to finish.
      </Text>

      <FieldLabel>Not sure how to describe it? Start from a common request</FieldLabel>
      <View style={styles.templateGrid}>
        {TEMPLATES.map((t, i) => (
          <Pressable
            key={t.label}
            onPress={() => applyTemplate(t, i)}
            style={[styles.templateCard, selectedTemplate === i && { borderColor: colors.accent, backgroundColor: colors.accentLight }]}
          >
            <Text style={{ fontSize: 18 }}>{t.emoji}</Text>
            <Text style={styles.templateLabel}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      <Card style={{ marginTop: spacing.lg, gap: spacing.md }}>
        <View>
          <FieldLabel>What do you need done? — pick one above, or write your own</FieldLabel>
          <TextInput style={styles.input} placeholder='e.g. "Fix a leaking kitchen tap"' value={title} onChangeText={setTitle} />
        </View>

        <View>
          <FieldLabel>Category</FieldLabel>
          <View style={styles.chipRow}>
            {CATEGORIES.map((c) => (
              <Pressable
                key={c.id}
                onPress={() => setCategory(c.id)}
                style={[styles.chip, category === c.id && { borderColor: colors.accent, backgroundColor: colors.accentLight }]}
              >
                <Text style={[styles.chipText, category === c.id && { color: colors.accentDark }]}>
                  {c.emoji} {c.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View>
          <FieldLabel>Details</FieldLabel>
          <TextInput
            style={[styles.input, { height: 84, textAlignVertical: 'top' }]}
            placeholder="A little more detail helps us match the right person"
            value={desc}
            onChangeText={setDesc}
            multiline
          />
        </View>

        <View>
          <FieldLabel>How long will this take?</FieldLabel>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button label="One-time task" size="sm" variant={taskType === 'one-time' ? 'primary' : 'ghost'} onPress={() => setTaskType('one-time')} style={{ flex: 1 }} />
            <Button label="↻ Ongoing (multi-day)" size="sm" variant={taskType === 'ongoing' ? 'primary' : 'ghost'} onPress={() => setTaskType('ongoing')} style={{ flex: 1 }} />
          </View>
        </View>

        {taskType === 'one-time' ? (
          <View>
            <FieldLabel>Estimated cost (₹, optional)</FieldLabel>
            <TextInput style={styles.input} placeholder="e.g. 650" keyboardType="numeric" value={cost} onChangeText={setCost} />
          </View>
        ) : (
          <View>
            <FieldLabel>Price per day (₹)</FieldLabel>
            <TextInput style={styles.input} placeholder="e.g. 400" keyboardType="numeric" value={rate} onChangeText={setRate} />
            <Text style={styles.hint}>Charged for each day/visit your Personal Manager comes.</Text>
          </View>
        )}

        <View>
          <FieldLabel>📍 Where does the task need to be done?</FieldLabel>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TextInput style={[styles.input, { flex: 1 }]} placeholder="Flat / area, e.g. Flat 4B, Kandivali West" value={location} onChangeText={setLocation} />
            <Button label="📍 Use current" size="sm" variant="ghost" onPress={() => setLocation('Current location (auto-detected)')} />
          </View>
        </View>

        <View>
          <FieldLabel>Who is this task for?</FieldLabel>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button label="Myself" size="sm" variant={forWhom === 'self' ? 'primary' : 'ghost'} onPress={() => setForWhom('self')} style={{ flex: 1 }} />
            <Button label="Someone else" size="sm" variant={forWhom === 'other' ? 'primary' : 'ghost'} onPress={() => setForWhom('other')} style={{ flex: 1 }} />
          </View>
        </View>

        {forWhom === 'other' && (
          <View style={{ backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm }}>
            <View>
              <FieldLabel>Their name</FieldLabel>
              <TextInput style={styles.input} placeholder="e.g. Kamala Bai" value={recipientName} onChangeText={setRecipientName} />
            </View>
            <View>
              <FieldLabel>Relationship to you</FieldLabel>
              <TextInput style={styles.input} placeholder="e.g. Mother" value={recipientRelation} onChangeText={setRecipientRelation} />
            </View>
          </View>
        )}

        <Button label="Post your task — it's free" onPress={submit} />
      </Card>

      <Text style={[styles.h2, { marginTop: spacing.xl }]}>Your recent tasks</Text>
      <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
        {mine.map((t) => (
          <Pressable key={t.id} onPress={() => navigation.navigate('TrackTask', { taskId: t.id })}>
            <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Text style={{ fontSize: 18 }}>{catMeta(t.category).emoji}</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '700', fontSize: 14 }}>{t.title}</Text>
                <Text style={{ color: colors.muted, fontSize: 12.5, marginTop: 2 }}>{t.scheduledFor}</Text>
              </View>
              <Badge label={STATUS_META[t.status].label} tone={t.status === 'completed' ? 'success' : 'accent'} />
            </Card>
          </Pressable>
        ))}
        {!mine.length && <Text style={{ color: colors.muted, textAlign: 'center', padding: 20 }}>No tasks yet — post one above.</Text>}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  h1: { fontSize: 26, fontWeight: '800', color: colors.text, lineHeight: 32, marginBottom: 8 },
  h2: { fontSize: 17, fontWeight: '700', color: colors.text },
  sub: { color: colors.muted, fontSize: 14.5, lineHeight: 21, marginBottom: 18 },
  templateGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  templateCard: {
    width: '48%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 13,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  templateLabel: { fontSize: 13, fontWeight: '700', color: colors.text, flexShrink: 1 },
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
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipText: { fontSize: 13, fontWeight: '700', color: colors.muted },
  hint: { fontSize: 12, color: colors.faint, marginTop: 6 },
});
