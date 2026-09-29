import React, { useState } from 'react';
import { View, Text, TextInput, ScrollView, Pressable, StyleSheet } from 'react-native';
import { colors, spacing, radius } from '../theme';
import { Card, Button, FieldLabel, Badge, ErrorText } from '../components/UI';
import { CATEGORIES, TEMPLATES, createTask, myTasks, useTasks, STATUS_META, catMeta, initials } from '../data/store';
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
  const [when, setWhen] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const mine = myTasks(user?.id);

  function applyTemplate(t, i) {
    setSelectedTemplate(i);
    setTitle(t.title);
    setDesc(t.desc);
    setCategory(t.category);
    setTaskType(t.taskType);
  }

  async function submit() {
    setError('');
    if (!title.trim()) return setError('Tell us what you need done.');
    if (!location.trim()) return setError('Add where the task needs to be done.');
    if (taskType === 'ongoing' && !parseInt(rate, 10)) return setError('Set a price per day for an ongoing task.');
    if (forWhom === 'other' && !recipientName.trim()) return setError("Add the name of the person you're booking for.");
    setBusy(true);
    try {
      const task = await createTask({
        title: title.trim(),
        category,
        description: desc.trim(),
        taskType,
        scheduledFor: when.trim() || 'Flexible',
        location: location.trim(),
        estCost: taskType === 'one-time' && cost ? parseInt(cost, 10) || null : null,
        ratePerDay: taskType === 'ongoing' ? parseInt(rate, 10) : null,
        forWhom,
        recipientName: forWhom === 'other' ? recipientName.trim() : null,
        recipientRelation: forWhom === 'other' ? recipientRelation.trim() || null : null,
        recipientPhone: forWhom === 'other' ? recipientPhone.trim() || null : null,
      }, user.id);
      setTitle(''); setDesc(''); setCost(''); setRate(''); setWhen(''); setSelectedTemplate(null);
      setRecipientName(''); setRecipientRelation(''); setRecipientPhone(''); setForWhom('self');
      navigation.navigate('TrackTask', { taskId: task.id });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }}>
      <View style={styles.topRow}>
        <Text style={styles.hello}>Hi {(profile?.full_name || '').split(' ')[0] || 'there'} 👋</Text>
        <Pressable onPress={() => navigation.navigate('Account')} style={styles.avatar} accessibilityLabel="Account">
          <Text style={styles.avatarText}>{initials(profile?.full_name)}</Text>
        </Pressable>
      </View>
      <Badge label="✓ Every Personal Manager is ID-verified" tone="accent" style={{ marginBottom: 14 }} />
      <Text style={styles.h1}>
        Get your task done by a <Text style={{ color: colors.accent }}>verified Personal Manager</Text>
      </Text>
      <Text style={styles.sub}>
        Tell us what you need. We match you with a qualified, ID-verified Personal Manager who looks after it from start to finish.
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
          <TextInput placeholderTextColor={colors.faint} style={styles.input} placeholder='e.g. "Fix a leaking kitchen tap"' value={title} onChangeText={setTitle} />
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
            <TextInput placeholderTextColor={colors.faint} style={styles.input} placeholder="e.g. 650" keyboardType="numeric" value={cost} onChangeText={setCost} />
          </View>
        ) : (
          <View>
            <FieldLabel>Price per day (₹)</FieldLabel>
            <TextInput placeholderTextColor={colors.faint} style={styles.input} placeholder="e.g. 400" keyboardType="numeric" value={rate} onChangeText={setRate} />
            <Text style={styles.hint}>Charged for each day/visit your Personal Manager comes.</Text>
          </View>
        )}

        <View>
          <FieldLabel>🗓 When?</FieldLabel>
          <TextInput placeholderTextColor={colors.faint} style={styles.input} placeholder='e.g. "Sat 26 Aug, 11 AM" or "Any weekday evening"' value={when} onChangeText={setWhen} />
        </View>

        <View>
          <FieldLabel>📍 Where does the task need to be done?</FieldLabel>
          <TextInput placeholderTextColor={colors.faint} style={styles.input} placeholder="Flat / building, area — e.g. Flat 4B, Kandivali West" value={location} onChangeText={setLocation} />
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
              <TextInput placeholderTextColor={colors.faint} style={styles.input} placeholder="e.g. Kamala Bai" value={recipientName} onChangeText={setRecipientName} />
            </View>
            <View>
              <FieldLabel>Relationship to you</FieldLabel>
              <TextInput placeholderTextColor={colors.faint} style={styles.input} placeholder="e.g. Mother" value={recipientRelation} onChangeText={setRecipientRelation} />
            </View>
            <View>
              <FieldLabel>Their phone (so your PM can reach them)</FieldLabel>
              <TextInput placeholderTextColor={colors.faint} style={styles.input} placeholder="e.g. 98200 12345" keyboardType="phone-pad" value={recipientPhone} onChangeText={setRecipientPhone} />
            </View>
          </View>
        )}

        <ErrorText>{error}</ErrorText>
        <Button label={busy ? 'Posting…' : "Post your task — it's free"} onPress={submit} disabled={busy} />
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
              <Badge label={STATUS_META[t.status].label} tone={STATUS_META[t.status].tone} />
            </Card>
          </Pressable>
        ))}
        {!mine.length && <Text style={{ color: colors.muted, textAlign: 'center', padding: 20 }}>No tasks yet — post one above.</Text>}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  hello: { fontSize: 15, fontWeight: '700', color: colors.muted },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.accentLight, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontWeight: '800', color: colors.accentDark },
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
