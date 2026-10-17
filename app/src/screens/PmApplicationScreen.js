// Personal Manager onboarding: fill in the application, upload ID/qualification
// documents, submit, then wait for an admin to approve. The profile is live
// (see AuthContext), so this screen switches to the PM app the moment an
// admin approves.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { colors, spacing, radius } from '../theme';
import { Card, Button, FieldLabel, Badge, Input, ErrorText } from '../components/UI';
import {
  CATEGORIES, myContact, catMeta, listMyDocuments, uploadDocument, removeDocument, submitApplication,
} from '../data/store';
import { isValidDate, expiryText } from '../data/extras';
import { useAuth } from '../lib/AuthContext';

const DOC_TYPES = [
  { id: 'id', label: 'Government ID', hint: 'Aadhaar, PAN, driving licence, voter ID or passport — required' },
  { id: 'qualification', label: 'Qualification / certificate', hint: 'Trade licence, training certificate, reference letter — optional but speeds up approval' },
];
const MAX_FILE_BYTES = 10 * 1024 * 1024;

export default function PmApplicationScreen() {
  const { profile, signOut, refreshProfile } = useAuth();
  const status = profile.worker_status;

  if (status === 'pending') {
    return (
      <StatusPage
        emoji="⏳"
        title="Application under review"
        body="Thanks for applying! Our team is checking your details and documents. This screen will update automatically once you're approved — usually within 1–2 working days."
        extra={<Summary profile={profile} />}
        onSignOut={signOut}
      />
    );
  }
  if (status === 'rejected') {
    return (
      <StatusPage
        emoji="✋"
        title="Application not approved"
        body={profile.application_note || "We couldn't approve your application this time."}
        onSignOut={signOut}
      />
    );
  }
  if (status === 'suspended') {
    return (
      <StatusPage
        emoji="⏸"
        title="Account paused"
        body={profile.application_note || 'Your Personal Manager account has been paused. Please contact support.'}
        onSignOut={signOut}
      />
    );
  }
  return <ApplicationForm profile={profile} onSubmitted={refreshProfile} onSignOut={signOut} />;
}

function ApplicationForm({ profile, onSubmitted, onSignOut }) {
  const [fullName, setFullName] = useState(profile.full_name || '');
  const [phone, setPhone] = useState('');
  useEffect(() => { myContact().then((c) => setPhone((p) => p || c.phone || '')); }, []);
  const [bio, setBio] = useState(profile.bio || '');
  const [categories, setCategories] = useState(profile.categories || []);
  const [experience, setExperience] = useState(profile.experience_years != null ? String(profile.experience_years) : '');
  const [serviceArea, setServiceArea] = useState(profile.service_area || '');
  const [docs, setDocs] = useState([]);
  const [uploading, setUploading] = useState(null);
  const [expiry, setExpiry] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const loadDocs = useCallback(async () => {
    try { setDocs(await listMyDocuments(profile.id)); } catch (e) { setError(e.message); }
  }, [profile.id]);
  useEffect(() => { loadDocs(); }, [loadDocs]);

  function toggleCategory(id) {
    setCategories((cs) => (cs.includes(id) ? cs.filter((c) => c !== id) : [...cs, id]));
  }

  async function pick(docType) {
    setError('');
    const res = await DocumentPicker.getDocumentAsync({ type: ['image/*', 'application/pdf'], copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.length) return;
    const file = res.assets[0];
    if (file.size && file.size > MAX_FILE_BYTES) { setError('That file is over 10 MB — please pick a smaller one.'); return; }
    const expires = docType === 'qualification' ? expiry.trim() : '';
    if (expires && !isValidDate(expires)) { setError('Write the expiry date like 2027-03-31 (year-month-day), or leave it empty.'); return; }
    setUploading(docType);
    try {
      await uploadDocument(profile.id, docType, file.name, file, expires || undefined);
      if (expires) setExpiry('');
      await loadDocs();
    } catch (e) {
      setError(e.message);
    } finally {
      setUploading(null);
    }
  }

  async function remove(doc) {
    setError('');
    try { await removeDocument(doc); await loadDocs(); } catch (e) { setError(e.message); }
  }

  async function submit() {
    setError('');
    if (!fullName.trim() || !phone.trim()) return setError('Add your full name and mobile number.');
    if (!categories.length) return setError('Pick at least one type of task you can do.');
    if (!serviceArea.trim()) return setError('Tell us which area you can work in.');
    if (!docs.some((d) => d.doc_type === 'id')) return setError('Upload a photo or PDF of a government ID.');
    setBusy(true);
    try {
      await submitApplication({
        fullName: fullName.trim(),
        phone: phone.trim(),
        bio: bio.trim(),
        categories,
        experienceYears: parseInt(experience, 10) || 0,
        serviceArea: serviceArea.trim(),
      });
      await onSubmitted();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }}>
      <Badge label="Personal Manager application" tone="brass" style={{ marginBottom: 12 }} />
      <Text style={styles.h1}>Tell us about yourself</Text>
      <Text style={styles.sub}>
        Customers trust Mr. Todo because every Personal Manager is checked by our team. Fill this in once — it takes about five minutes.
      </Text>

      {profile.worker_status === 'more_info' && !!profile.application_note && (
        <Card style={{ marginBottom: spacing.lg, backgroundColor: colors.brassLight, borderColor: 'transparent' }}>
          <Text style={{ fontWeight: '700', color: colors.brassDark, marginBottom: 4 }}>Our team needs a little more from you</Text>
          <Text style={{ color: colors.brassDark, fontSize: 13.5, lineHeight: 19 }}>{profile.application_note}</Text>
        </Card>
      )}

      <Card style={{ gap: spacing.md, marginBottom: spacing.lg }}>
        <View>
          <FieldLabel>Full name (as on your ID)</FieldLabel>
          <Input value={fullName} onChangeText={setFullName} placeholder="e.g. Rakesh Kumar" />
        </View>
        <View>
          <FieldLabel>Mobile number</FieldLabel>
          <Input value={phone} onChangeText={setPhone} placeholder="e.g. 98200 12345" keyboardType="phone-pad" />
        </View>
        <View>
          <FieldLabel>What can you help with?</FieldLabel>
          <View style={styles.chipRow}>
            {CATEGORIES.map((c) => {
              const on = categories.includes(c.id);
              return (
                <Pressable key={c.id} onPress={() => toggleCategory(c.id)} style={[styles.chip, on && styles.chipOn]}>
                  <Text style={[styles.chipText, on && { color: colors.accentDark }]}>{on ? '✓ ' : ''}{c.emoji} {c.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
        <View>
          <FieldLabel>Years of experience</FieldLabel>
          <Input value={experience} onChangeText={setExperience} placeholder="e.g. 5" keyboardType="numeric" style={{ width: 120 }} />
        </View>
        <View>
          <FieldLabel>Area you can work in</FieldLabel>
          <Input value={serviceArea} onChangeText={setServiceArea} placeholder="e.g. Kandivali" />
          <Text style={styles.hint}>We use this to offer you nearby tasks. One neighbourhood or suburb name works best.</Text>
        </View>
        <View>
          <FieldLabel>About you (optional)</FieldLabel>
          <Input value={bio} onChangeText={setBio} multiline placeholder="Past work, tools you have, languages you speak…" />
        </View>
      </Card>

      <Text style={styles.h2}>Documents</Text>
      <Text style={[styles.hint, { marginBottom: spacing.md }]}>Photos or PDFs, up to 10 MB each. Only our verification team can see them.</Text>
      <View style={{ gap: spacing.md, marginBottom: spacing.lg }}>
        {DOC_TYPES.map((dt) => {
          const mine = docs.filter((d) => d.doc_type === dt.id);
          return (
            <Card key={dt.id} style={{ gap: spacing.sm }}>
              <Text style={{ fontWeight: '700', color: colors.text }}>{dt.label}</Text>
              <Text style={styles.hint}>{dt.hint}</Text>
              {mine.map((d) => (
                <View key={d.id} style={styles.docRow}>
                  <Text style={{ flex: 1, color: colors.text, fontSize: 13 }} numberOfLines={1}>📄 {d.label}{d.expires_on ? ` · ${expiryText(d)}` : ''}</Text>
                  <Pressable onPress={() => remove(d)} hitSlop={8}><Text style={{ color: colors.danger, fontWeight: '700', fontSize: 13 }}>Remove</Text></Pressable>
                </View>
              ))}
              {dt.id === 'qualification' && (
                <Input value={expiry} onChangeText={setExpiry} placeholder="Expiry date, if it has one (2027-03-31)" autoCapitalize="none" />
              )}
              <Button
                label={uploading === dt.id ? 'Uploading…' : mine.length ? '+ Add another' : '⬆ Upload'}
                variant="ghost" size="sm" disabled={!!uploading} onPress={() => pick(dt.id)}
              />
            </Card>
          );
        })}
      </View>

      <ErrorText>{error}</ErrorText>
      <Button label={busy ? 'Submitting…' : 'Submit application'} onPress={submit} disabled={busy || !!uploading} style={{ marginTop: spacing.sm }} />
      <Button label="Sign out" variant="ghost" onPress={onSignOut} style={{ marginTop: spacing.md }} />
    </ScrollView>
  );
}

function Summary({ profile }) {
  return (
    <Card style={{ gap: 8, alignSelf: 'stretch' }}>
      <Text style={{ fontWeight: '700', color: colors.text }}>{profile.full_name}</Text>
      <Text style={styles.hint}>📍 {profile.service_area} · {profile.experience_years || 0} yrs experience</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {(profile.categories || []).map((c) => <Badge key={c} label={`${catMeta(c).emoji} ${catMeta(c).label}`} />)}
      </View>
    </Card>
  );
}

function StatusPage({ emoji, title, body, extra, onSignOut }) {
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, paddingTop: 60, alignItems: 'center', gap: spacing.lg }}>
      <Text style={{ fontSize: 44 }}>{emoji}</Text>
      <Text style={[styles.h1, { textAlign: 'center' }]}>{title}</Text>
      <Text style={[styles.sub, { textAlign: 'center' }]}>{body}</Text>
      {extra}
      <Button label="Sign out" variant="ghost" onPress={onSignOut} style={{ alignSelf: 'stretch' }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  h1: { fontSize: 24, fontWeight: '800', color: colors.text, marginBottom: 6 },
  h2: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 4 },
  sub: { color: colors.muted, fontSize: 14.5, lineHeight: 21, marginBottom: spacing.lg },
  hint: { fontSize: 12.5, color: colors.muted, lineHeight: 18 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 13, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface },
  chipOn: { borderColor: colors.accent, backgroundColor: colors.accentLight },
  chipText: { fontSize: 13, fontWeight: '700', color: colors.muted },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surfaceAlt, borderRadius: radius.sm, padding: 10 },
});
