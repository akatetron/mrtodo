import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, ScrollView, Pressable, StyleSheet } from 'react-native';
import { colors, spacing, radius } from '../theme';
import { Card, Button, FieldLabel, Badge, ErrorText, Input } from '../components/UI';
import { CATEGORIES, TEMPLATES, createTask, myTasks, useTasks, STATUS_META, catMeta, initials } from '../data/store';
import { useAuth } from '../lib/AuthContext';
import NotificationBell from '../components/NotificationBell';

export default function HomeScreen({ navigation, route }) {
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
  const [step, setStep] = useState(1);
  const scroller = useRef(null);
  useEffect(() => { scroller.current?.scrollTo({ y: 0, animated: false }); }, [step]);

  const mine = myTasks(user?.id);
  // Places this person has used before, newest first, so they are one tap away.
  const recentPlaces = [...new Set(mine.map((t) => t.location).filter(Boolean))].slice(0, 4);

  // "Book again" on a finished task sends its details here to start a new one.
  const prefill = route?.params?.prefill;
  useEffect(() => {
    if (!prefill) return;
    setTitle(prefill.title || ''); setDesc(prefill.description || ''); setCategory(prefill.category || CATEGORIES[0].id);
    setTaskType(prefill.taskType || 'one-time'); setLocation(prefill.location || '');
    setCost(prefill.estCost ? String(prefill.estCost) : ''); setRate(prefill.ratePerDay ? String(prefill.ratePerDay) : '');
    setForWhom(prefill.forWhom || 'self'); setRecipientName(prefill.recipientName || '');
    setRecipientRelation(prefill.recipientRelation || ''); setRecipientPhone(prefill.recipientPhone || '');
    setWhen(''); setSelectedTemplate(null); setError(''); setStep(2);
  }, [route?.params?.prefillKey]); // eslint-disable-line react-hooks/exhaustive-deps

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
        forWhom,
        recipientName: forWhom === 'other' ? recipientName.trim() : null,
        recipientRelation: forWhom === 'other' ? recipientRelation.trim() || null : null,
        recipientPhone: forWhom === 'other' ? recipientPhone.trim() || null : null,
      }, user.id);
      setTitle(''); setDesc(''); setCost(''); setRate(''); setWhen(''); setSelectedTemplate(null);
      setRecipientName(''); setRecipientRelation(''); setRecipientPhone(''); setForWhom('self');
      setStep(1);
      navigation.navigate('TrackTask', { taskId: task.id });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const STEPS = ['What', 'Details', 'Review'];
  const first = (profile?.full_name || '').split(' ')[0] || 'there';
  const cat = catMeta(category);

  function next() {
    setError('');
    if (step === 1 && !title.trim()) return setError('Pick a category or a common request, or write what you need.');
    if (step === 2) {
      if (!location.trim()) return setError('Add where the task needs to be done.');
      if (forWhom === 'other' && !recipientName.trim()) return setError("Add the name of the person you're booking for.");
    }
    setStep(step + 1);
  }

  return (
    <ScrollView ref={scroller} style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: 60 }}>
      <View style={styles.hero}>
        <View style={styles.topRow}>
          <Text style={styles.hello}>Hi {first} 👋</Text>
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            <NotificationBell navigation={navigation} />
            <Pressable onPress={() => navigation.navigate('Account')} style={styles.avatar} accessibilityRole="button" accessibilityLabel="Account">
              <Text style={styles.avatarText}>{initials(profile?.full_name)}</Text>
            </Pressable>
          </View>
        </View>
        <Text style={styles.h1}>What do you need done?</Text>
        <Text style={styles.sub}>Every Personal Manager is ID-verified. Three quick steps.</Text>
        <View style={styles.stepper}>
          {STEPS.map((label, i) => {
            const n = i + 1; const done = n < step; const on = n === step;
            return (
              <React.Fragment key={label}>
                <View style={styles.stepItem}>
                  <View style={[styles.stepDot, (done || on) && styles.stepDotOn]}>
                    <Text style={[styles.stepNum, (done || on) && { color: colors.accent }]}>{done ? '✓' : n}</Text>
                  </View>
                  <Text style={[styles.stepLabel, on && { color: '#FFFFFF' }]}>{label}</Text>
                </View>
                {n < STEPS.length && <View style={[styles.stepLine, done && { backgroundColor: colors.brass }]} />}
              </React.Fragment>
            );
          })}
        </View>
      </View>

      <View style={styles.sheet}>
        {step === 1 && (
          <>
            <Text style={styles.h2}>Choose a category</Text>
            <View style={styles.tileGrid}>
              {CATEGORIES.map((c) => (
                <Pressable key={c.id} accessibilityRole="button" accessibilityState={{ selected: category === c.id }} accessibilityLabel={c.label}
                  onPress={() => { setCategory(c.id); setSelectedTemplate(null); }}
                  style={[styles.tile, category === c.id && styles.tileOn]}>
                  <Text style={styles.tileEmoji}>{c.emoji}</Text>
                  <Text style={styles.tileLabel}>{c.label}</Text>
                  {category === c.id && <Text style={styles.tileTick}>✓ Selected</Text>}
                </Pressable>
              ))}
            </View>

            <Text style={[styles.h2, { marginTop: spacing.xl }]}>Or start from a common request</Text>
            <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
              {TEMPLATES.map((t, i) => (
                <Pressable key={t.label} accessibilityRole="button" accessibilityState={{ selected: selectedTemplate === i }}
                  onPress={() => applyTemplate(t, i)} style={[styles.row, selectedTemplate === i && styles.tileOn]}>
                  <Text style={{ fontSize: 24 }}>{t.emoji}</Text>
                  <Text style={styles.rowLabel}>{t.label}</Text>
                  <Text style={styles.radio}>{selectedTemplate === i ? '◉' : '○'}</Text>
                </Pressable>
              ))}
            </View>

            <View style={{ marginTop: spacing.xl }}>
              <FieldLabel>Or write it in your own words</FieldLabel>
              <Input placeholder='e.g. "Fix a leaking kitchen tap"' value={title} onChangeText={(v) => { setTitle(v); setSelectedTemplate(null); }} />
            </View>
          </>
        )}

        {step === 2 && (
          <View style={{ gap: spacing.lg }}>
            <Text style={styles.h2}>Tell us the details</Text>
            <View>
              <FieldLabel>What do you need done?</FieldLabel>
              <Input value={title} onChangeText={setTitle} />
            </View>
            <View>
              <FieldLabel>More detail (helps us match the right person)</FieldLabel>
              <Input multiline value={desc} onChangeText={setDesc} placeholder="Anything the Personal Manager should know" />
            </View>
            <View>
              <FieldLabel>How long will this take?</FieldLabel>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button label="One-time" size="sm" variant={taskType === 'one-time' ? 'primary' : 'ghost'} onPress={() => setTaskType('one-time')} style={{ flex: 1 }} />
                <Button label="↻ Ongoing" size="sm" variant={taskType === 'ongoing' ? 'primary' : 'ghost'} onPress={() => setTaskType('ongoing')} style={{ flex: 1 }} />
              </View>
            </View>
            <View>
              <FieldLabel>🗓 When?</FieldLabel>
              <Input placeholder='e.g. "Sat 26 Aug, 11 AM" or "Any weekday evening"' value={when} onChangeText={setWhen} />
            </View>
            <View>
              <FieldLabel>📍 Where?</FieldLabel>
              <Input placeholder="Flat / building, area — e.g. Flat 4B, Kandivali West" value={location} onChangeText={setLocation} />
              {recentPlaces.length > 0 && (
                <View style={[styles.chipRow, { marginTop: 8 }]}>
                  {recentPlaces.map((place) => (
                    <Pressable key={place} accessibilityRole="button" onPress={() => setLocation(place)} style={[styles.chip, location === place && styles.chipOn]}>
                      <Text style={styles.chipText} numberOfLines={1}>📍 {place}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
            <View>
              <FieldLabel>Who is this for?</FieldLabel>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button label="Myself" size="sm" variant={forWhom === 'self' ? 'primary' : 'ghost'} onPress={() => setForWhom('self')} style={{ flex: 1 }} />
                <Button label="Someone else" size="sm" variant={forWhom === 'other' ? 'primary' : 'ghost'} onPress={() => setForWhom('other')} style={{ flex: 1 }} />
              </View>
            </View>
            {forWhom === 'other' && (
              <View style={styles.otherBox}>
                <View><FieldLabel>Their name</FieldLabel><Input placeholder="e.g. Kamala Bai" value={recipientName} onChangeText={setRecipientName} /></View>
                <View><FieldLabel>Relationship to you</FieldLabel><Input placeholder="e.g. Mother" value={recipientRelation} onChangeText={setRecipientRelation} /></View>
                <View><FieldLabel>Their phone (so your PM can reach them)</FieldLabel><Input placeholder="e.g. 98200 12345" keyboardType="phone-pad" value={recipientPhone} onChangeText={setRecipientPhone} /></View>
              </View>
            )}
          </View>
        )}

        {step === 3 && (
          <View style={{ gap: spacing.md }}>
            <Text style={styles.h2}>Check and post</Text>
            <Card style={{ gap: spacing.sm, backgroundColor: colors.accentLight, borderColor: colors.accent, borderWidth: 2 }}>
              <Text style={styles.reviewTitle}>{cat.emoji} {title}</Text>
              {!!desc.trim() && <Text style={styles.reviewLine}>{desc}</Text>}
              <Text style={styles.reviewLine}>🗓 {when.trim() || 'Flexible'}</Text>
              <Text style={styles.reviewLine}>📍 {location}</Text>
              <Text style={styles.reviewLine}>{taskType === 'ongoing' ? '↻ Ongoing, multi-day' : 'One-time task'}</Text>
              {forWhom === 'other' && <Text style={styles.reviewLine}>For: {recipientName}{recipientRelation ? ` (${recipientRelation})` : ''}</Text>}
            </Card>
            <Card style={{ gap: 4 }}>
              <FieldLabel>Price</FieldLabel>
              <Text style={styles.reviewLine}>Our team sets the price, usually within a few minutes. You confirm it before any work starts. Posting is free.</Text>
            </Card>
          </View>
        )}

        <View style={{ marginTop: spacing.md }}><ErrorText>{error}</ErrorText></View>
        <View style={styles.navRow}>
          {step > 1 && <Button label="Back" variant="ghost" onPress={() => { setError(''); setStep(step - 1); }} style={{ flex: 1 }} />}
          {step < 3
            ? <Button label="Continue" onPress={next} style={{ flex: 2 }} />
            : <Button label={busy ? 'Posting…' : 'Post my task'} onPress={submit} disabled={busy} style={{ flex: 2 }} />}
        </View>

        <Text style={[styles.h2, { marginTop: spacing.xxl }]}>Your recent tasks</Text>
        <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
          {mine.map((t) => (
            <Pressable key={t.id} accessibilityRole="button" onPress={() => navigation.navigate('TrackTask', { taskId: t.id })}>
              <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Text style={{ fontSize: 24 }}>{catMeta(t.category).emoji}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '800', fontSize: 16, color: colors.text }}>{t.title}</Text>
                  <Text style={{ color: colors.muted, fontSize: 14, marginTop: 2 }}>{t.scheduledFor}</Text>
                </View>
                <Badge label={STATUS_META[t.status].label} tone={STATUS_META[t.status].tone} />
              </Card>
            </Pressable>
          ))}
          {!mine.length && <Text style={{ color: colors.muted, textAlign: 'center', padding: 20, fontSize: 16 }}>No tasks yet — post one above.</Text>}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  hero: { backgroundColor: colors.accent, paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: 36 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.lg },
  hello: { fontSize: 16, fontWeight: '700', color: '#CFE3DF' },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.brass, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontWeight: '800', color: colors.accentDark, fontSize: 16 },
  h1: { fontSize: 30, fontWeight: '800', color: '#FFFFFF', lineHeight: 36, letterSpacing: -0.3 },
  sub: { color: '#CFE3DF', fontSize: 16, lineHeight: 23, marginTop: 6, marginBottom: spacing.lg },
  stepper: { flexDirection: 'row', alignItems: 'flex-start' },
  stepItem: { alignItems: 'center', width: 72 },
  stepDot: { width: 36, height: 36, borderRadius: 18, borderWidth: 2, borderColor: '#5E8A87', alignItems: 'center', justifyContent: 'center' },
  stepDotOn: { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF' },
  stepNum: { fontWeight: '800', color: '#9CBBB8', fontSize: 16 },
  stepLabel: { color: '#9CBBB8', fontWeight: '700', fontSize: 13, marginTop: 6 },
  stepLine: { flex: 1, height: 3, borderRadius: 2, backgroundColor: '#5E8A87', marginTop: 17, marginHorizontal: -8 },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, marginTop: -20, padding: spacing.lg, paddingTop: spacing.xl },
  h2: { fontSize: 19, fontWeight: '800', color: colors.text },
  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: spacing.md },
  tile: {
    width: '47.5%', minHeight: 120, alignItems: 'center', justifyContent: 'center', gap: 6, padding: spacing.md,
    borderRadius: radius.lg, borderWidth: 2, borderColor: colors.accent, backgroundColor: '#E9F2EF',
  },
  tileOn: { backgroundColor: colors.brassLight, borderColor: colors.brass },
  tileEmoji: { fontSize: 38 },
  tileLabel: { fontSize: 16, fontWeight: '800', color: colors.accentDark, textAlign: 'center' },
  tileTick: { fontSize: 13, fontWeight: '800', color: colors.brassDark },
  row: {
    minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: spacing.md, paddingVertical: 10,
    borderRadius: radius.md, borderWidth: 2, borderColor: colors.border, backgroundColor: colors.surface,
  },
  rowLabel: { flex: 1, fontSize: 16, fontWeight: '700', color: colors.text },
  radio: { fontSize: 22, color: colors.accent },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 16, borderRadius: radius.pill, borderWidth: 2, borderColor: colors.border, backgroundColor: colors.surface },
  chipOn: { borderColor: colors.accent, backgroundColor: colors.accentLight },
  chipText: { fontSize: 15, fontWeight: '700', color: colors.muted },
  otherBox: { backgroundColor: '#E9F2EF', borderRadius: radius.md, padding: spacing.md, gap: spacing.md },
  reviewTitle: { fontSize: 20, fontWeight: '800', color: colors.accentDark },
  reviewLine: { fontSize: 16, lineHeight: 23, color: colors.text },
  navRow: { flexDirection: 'row', gap: 12, marginTop: spacing.md },
});
