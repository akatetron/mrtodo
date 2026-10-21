// Service catalogue: families and services customers book from. Admins add and
// change services here without a developer. A service is a draft until it is
// published; publishing freezes a numbered version, and bookings keep the version
// (and price) they were made against.
import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { colors, spacing, radius } from '../../theme';
import { Card, Badge, Button, FieldLabel, Input, ErrorText, Chip } from '../../components/UI';
import DynamicQuestions from '../../components/DynamicQuestions';
import { useAuth } from '../../lib/AuthContext';
import {
  listCatalogueAdmin, saveFamily, saveServiceDraft, serviceReadiness, publishService, setServiceStatus, duplicateService,
  isSuperAdmin, useLiveQuery,
} from '../../data/adminData';
import { CATEGORIES, listSkills } from '../../data/store';

const QTYPES = [['short_text', 'Short answer'], ['long_text', 'Long answer'], ['single_choice', 'Pick one'], ['multiple_choice', 'Pick several'], ['datetime', 'Date and time'], ['address', 'Address']];
const APPROACHES = [['manual_quote', 'Quote by our team'], ['estimate_approval', 'Estimate, then approve'], ['fixed', 'Fixed price']];
const TONE = { draft: 'neutral', published: 'success', paused: 'brass', archived: 'danger' };
const slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

export default function AdminCatalogueScreen({ navigation }) {
  const { profile } = useAuth();
  const superAdmin = isSuperAdmin(profile);
  const { data, error } = useLiveQuery(listCatalogueAdmin, ['service_families', 'catalogue_services'], navigation);
  const [editing, setEditing] = useState(null);       // null | { service?, familyId }
  const [message, setMessage] = useState('');
  const [err, setErr] = useState('');

  async function act(fn, ok) {
    setErr(''); setMessage('');
    try { await fn(); if (ok) setMessage(ok); } catch (e) { setErr(e.message); }
  }

  if (editing) return <ServiceEditor families={data.families} initial={editing} onDone={() => setEditing(null)} />;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60, gap: spacing.md }}>
      {!superAdmin && <Text style={styles.hint}>Only super admins can change the catalogue. You can look at it.</Text>}
      <ErrorText>{error || err}</ErrorText>
      {!!message && <Text style={styles.ok}>{message}</Text>}
      {!data && !error && <Text style={styles.hint}>Loading…</Text>}
      {data && data.families.map((f) => {
        const services = data.services.filter((s) => s.family_id === f.id);
        return (
          <Card key={f.id} style={{ gap: spacing.sm }}>
            <View style={styles.rowBetween}>
              <Text style={styles.h2}>{f.icon || ''} {f.name}</Text>
              <Badge label={f.status} tone={TONE[f.status]} />
            </View>
            {superAdmin && (
              <View style={styles.row}>
                <Button size="sm" variant="ghost" label={f.status === 'published' ? 'Pause family' : 'Publish family'}
                  onPress={() => act(() => saveFamily({ key: f.key, name: f.name, description: f.description, icon: f.icon, sort: f.sort_order, status: f.status === 'published' ? 'paused' : 'published', available: f.available_for_booking }))} />
                <Button size="sm" label="Add a service" onPress={() => setEditing({ familyId: f.id })} />
              </View>
            )}
            {services.map((s) => (
              <View key={s.id} style={styles.service}>
                <View style={styles.rowBetween}>
                  <Text style={styles.title}>{s.draft?.title || s.key}</Text>
                  <Badge label={`${s.status}${s.current_version ? ` · v${s.current_version}` : ''}`} tone={TONE[s.status]} />
                </View>
                <Text style={styles.hint}>{s.draft?.pricing?.approach ? `Pricing: ${s.draft.pricing.approach.replace('_', ' ')}` : 'No pricing yet'}</Text>
                {superAdmin && (
                  <View style={styles.row}>
                    <Button size="sm" variant="ghost" label="Edit" onPress={() => setEditing({ service: s, familyId: f.id })} />
                    <Button size="sm" variant="ghost" label="Duplicate" onPress={() => act(() => duplicateService(s.id, `${s.key}-copy-${Date.now().toString(36).slice(-4)}`), 'Duplicated as a draft.')} />
                    {s.status === 'published' && <Button size="sm" variant="ghost" label="Pause" onPress={() => act(() => setServiceStatus(s.id, 'paused'))} />}
                    {s.status === 'paused' && <Button size="sm" variant="ghost" label="Resume" onPress={() => act(() => setServiceStatus(s.id, 'published'))} />}
                    {s.status !== 'archived' && <Button size="sm" variant="danger" label="Archive" onPress={() => act(() => setServiceStatus(s.id, 'archived'))} />}
                  </View>
                )}
              </View>
            ))}
            {!services.length && <Text style={styles.hint}>No services yet.</Text>}
          </Card>
        );
      })}
    </ScrollView>
  );
}

function ServiceEditor({ families, initial, onDone }) {
  const s = initial.service;
  const d = s?.draft || {};
  const [familyId, setFamilyId] = useState(initial.familyId);
  const [title, setTitle] = useState(d.title || '');
  const [description, setDescription] = useState(d.description || '');
  const [instructions, setInstructions] = useState(d.instructions || '');
  const [safety, setSafety] = useState(d.safety_notes || '');
  const [skillList, setSkillList] = useState([]);
  React.useEffect(() => { listSkills().then(setSkillList); }, []);
  const [skills, setSkills] = useState(d.required_skills || []);
  const [specialist, setSpecialist] = useState(!!d.requires_specialist);
  const [duration, setDuration] = useState(d.duration_minutes ? String(d.duration_minutes) : '');
  const [category, setCategory] = useState(s?.category || 'general');
  const [approach, setApproach] = useState(d.pricing?.approach || 'manual_quote');
  const [price, setPrice] = useState(d.pricing?.price != null ? String(d.pricing.price) : '');
  const [explanation, setExplanation] = useState(d.pricing?.explanation || '');
  const [questions, setQuestions] = useState(d.questions || []);
  const [problems, setProblems] = useState(null);
  const [preview, setPreview] = useState(false);
  const [previewAnswers, setPreviewAnswers] = useState({});
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const definition = () => ({
    title: title.trim(), description: description.trim(), instructions: instructions.trim() || undefined, safety_notes: safety.trim() || undefined,
    required_skills: skills, requires_specialist: specialist,
    duration_minutes: duration ? parseInt(duration, 10) : undefined, questions,
    pricing: { approach, currency: 'INR', price: approach === 'fixed' && price ? Number(price) : undefined, explanation: explanation.trim() || undefined },
  });
  const key = s?.key || slug(title);

  async function run(fn) {
    setErr(''); setMsg(''); setBusy(true);
    try { await fn(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  const save = () => run(async () => {
    const id = await saveServiceDraft(key, familyId, category, definition());
    setProblems(await serviceReadiness(id)); setMsg('Draft saved.');
    return id;
  });
  const publish = () => run(async () => {
    const id = await saveServiceDraft(key, familyId, category, definition());
    const v = await publishService(id);
    setMsg(`Published as version ${v}. Customers can book it now.`); setProblems([]);
  });

  const setQ = (i, patch) => setQuestions(questions.map((q, j) => (j === i ? { ...q, ...patch } : q)));

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, paddingBottom: 80, gap: spacing.lg }}>
      <Button label="‹ Back to the catalogue" variant="ghost" size="sm" onPress={onDone} />
      <Text style={styles.h2}>{s ? 'Edit service' : 'New service'}</Text>
      <View><FieldLabel>Family</FieldLabel>
        <View style={styles.row}>{families.map((f) => <Chip key={f.id} label={f.name} selected={familyId === f.id} onPress={() => setFamilyId(f.id)} />)}</View></View>
      <View><FieldLabel>What customers see: title</FieldLabel><Input value={title} onChangeText={setTitle} placeholder="e.g. Wi-Fi setup" /></View>
      <View><FieldLabel>Description</FieldLabel><Input multiline value={description} onChangeText={setDescription} /></View>
      <View><FieldLabel>Instructions or examples (optional)</FieldLabel><Input multiline value={instructions} onChangeText={setInstructions} /></View>
      <View><FieldLabel>Safety notes shown to customers (optional)</FieldLabel><Input multiline value={safety} onChangeText={setSafety} /></View>
      <View><FieldLabel>Closest category (used for matching)</FieldLabel>
        <View style={styles.row}>{[...CATEGORIES.map((c) => [c.id, c.label]), ['general', 'Something else']].map(([id, label]) => <Chip key={id} label={label} selected={category === id} onPress={() => setCategory(id)} />)}</View></View>

      <Card style={{ gap: spacing.md }}>
        <Text style={styles.h2}>Questions</Text>
        {questions.map((q, i) => (
          <View key={i} style={styles.service}>
            <Input value={q.label} placeholder="Question" onChangeText={(v) => setQ(i, { label: v, id: q.id || `q${i + 1}` })} />
            <View style={styles.row}>{QTYPES.map(([t, label]) => <Chip key={t} label={label} selected={q.type === t} onPress={() => setQ(i, { type: t, id: q.id || `q${i + 1}` })} />)}</View>
            {(q.type === 'single_choice' || q.type === 'multiple_choice') && (
              <Input value={(q.options || []).join(', ')} placeholder="Options, separated by commas" onChangeText={(v) => setQ(i, { options: v.split(',').map((x) => x.trim()).filter(Boolean) })} />
            )}
            <View style={styles.row}>
              <Chip label="Required" selected={!!q.required} onPress={() => setQ(i, { required: !q.required })} />
              {i > 0 && <Chip label={q.show_if ? `Only if “${questions.find((x) => x.id === q.show_if.question)?.label || ''}” is “${q.show_if.equals}”` : 'Always show'}
                selected={!!q.show_if} onPress={() => setQ(i, { show_if: q.show_if ? undefined : { question: questions[i - 1].id, equals: (questions[i - 1].options || [''])[0] } })} />}
              <Button size="sm" variant="danger" label="Remove" onPress={() => setQuestions(questions.filter((_, j) => j !== i))} />
            </View>
          </View>
        ))}
        <Button size="sm" variant="ghost" label="Add a question" onPress={() => setQuestions([...questions, { id: `q${questions.length + 1}`, type: 'short_text', label: '', required: false }])} />
      </Card>

      <Card style={{ gap: spacing.md }}>
        <Text style={styles.h2}>Pricing</Text>
        <View style={styles.row}>{APPROACHES.map(([id, label]) => <Chip key={id} label={label} selected={approach === id} onPress={() => setApproach(id)} />)}</View>
        {approach === 'fixed' && <View><FieldLabel>Fixed price (₹) — your decision, nothing is pre-filled</FieldLabel><Input keyboardType="numeric" value={price} onChangeText={setPrice} /></View>}
        <View><FieldLabel>What customers are told about the price (optional)</FieldLabel><Input multiline value={explanation} onChangeText={setExplanation} /></View>
        <Text style={styles.hint}>Time-based, specialist-plus-fee and multi-visit pricing are not available yet.</Text>
      </Card>

      <Card style={{ gap: spacing.md }}>
        <Text style={styles.h2}>Who can do it</Text>
        <View><FieldLabel>Skills a Personal Manager must be verified for</FieldLabel>
          <View style={styles.row}>{skillList.map((s) => <Chip key={s.key} label={s.name} selected={skills.includes(s.key)} onPress={() => setSkills(skills.includes(s.key) ? skills.filter((x) => x !== s.key) : [...skills, s.key])} />)}</View></View>
        <View><FieldLabel>Usual duration (minutes, optional)</FieldLabel><Input keyboardType="numeric" value={duration} onChangeText={setDuration} /></View>
        <Chip label="May need a specialist (an admin reviews before it is offered)" selected={specialist} onPress={() => setSpecialist(!specialist)} />
        <Text style={styles.hint}>Only verified Personal Managers can be assigned to, or accept, this service. Verify people in More → People.</Text>
      </Card>

      <Button label={preview ? 'Hide preview' : 'Preview what customers see'} variant="ghost" onPress={() => setPreview(!preview)} />
      {preview && (
        <Card style={{ gap: spacing.md, borderColor: colors.accent, borderWidth: 2 }}>
          <Text style={styles.h2}>{title || 'Untitled'}</Text>
          <Text style={styles.title}>{description}</Text>
          <DynamicQuestions questions={questions.filter((q) => q.label)} answers={previewAnswers} onChange={setPreviewAnswers} />
        </Card>
      )}

      {problems && problems.length > 0 && (
        <Card style={{ borderColor: colors.brass, borderWidth: 2, gap: 4 }}>
          <Text style={styles.title}>Before this can be published:</Text>
          {problems.map((p) => <Text key={p} style={styles.hint}>• {p}</Text>)}
        </Card>
      )}
      <ErrorText>{err}</ErrorText>
      {!!msg && <Text style={styles.ok}>{msg}</Text>}
      <Button label={busy ? 'Working…' : 'Save draft'} variant="ghost" onPress={save} disabled={busy || title.trim().length < 3} />
      <Button label={busy ? 'Working…' : 'Publish'} onPress={publish} disabled={busy || title.trim().length < 3} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  h2: { fontSize: 19, fontWeight: '800', color: colors.text },
  title: { fontSize: 16, fontWeight: '700', color: colors.text, flex: 1 },
  hint: { fontSize: 14, color: colors.muted, lineHeight: 20 },
  ok: { fontSize: 15, color: colors.success, fontWeight: '700' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  service: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, gap: spacing.sm },
});
