import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { colors, spacing } from '../theme';
import { Card, Button, FieldLabel, Input, ErrorText, Badge } from '../components/UI';
import { myContact, updateMyProfile, formatRating, catMeta, listMyDocuments, uploadDocument } from '../data/store';
import { docExpiry, expiryText, isValidDate } from '../data/extras';
import { useAuth } from '../lib/AuthContext';

const ROLE_LABEL = { customer: 'Customer', worker: 'Personal Manager', admin: 'Admin' };

export default function AccountScreen() {
  const { user, profile, refreshProfile, signOut } = useAuth();
  const [fullName, setFullName] = useState(profile.full_name || '');
  const [phone, setPhone] = useState('');
  useEffect(() => { myContact().then((c) => setPhone(c.phone || '')); }, []);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save() {
    setError(''); setSaved(false); setBusy(true);
    try {
      await updateMyProfile(profile.id, { full_name: fullName.trim(), phone: phone.trim() || null });
      await refreshProfile();
      setSaved(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: 60 }}>
      <Card style={{ gap: 6 }}>
        <Badge label={ROLE_LABEL[profile.role]} tone="accent" />
        <Text style={{ fontSize: 13.5, color: colors.muted, marginTop: 6 }}>{user?.email}</Text>
        <Text style={{ fontSize: 13.5, color: colors.muted }}>Your rating: {formatRating(profile.rating, profile.rating_count)}</Text>
        {profile.role === 'worker' && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            {(profile.categories || []).map((c) => <Badge key={c} label={`${catMeta(c).emoji} ${catMeta(c).label}`} />)}
          </View>
        )}
      </Card>

      <Card style={{ gap: spacing.md }}>
        <View>
          <FieldLabel>Full name</FieldLabel>
          <Input value={fullName} onChangeText={(v) => { setFullName(v); setSaved(false); }} />
        </View>
        <View>
          <FieldLabel>Mobile number</FieldLabel>
          <Input value={phone} onChangeText={(v) => { setPhone(v); setSaved(false); }} keyboardType="phone-pad" />
          <Text style={{ fontSize: 12, color: colors.faint, marginTop: 6 }}>Shared only with the person on the other side of an accepted task.</Text>
        </View>
        <ErrorText>{error}</ErrorText>
        {saved && <Text style={{ color: colors.success, fontSize: 13 }}>Saved ✓</Text>}
        <Button label={busy ? 'Saving…' : 'Save changes'} onPress={save} disabled={busy || !fullName.trim()} />
      </Card>

      {profile.role === 'worker' && profile.worker_status === 'approved' && <Documents profile={profile} />}

      <Button label="Sign out" variant="danger" onPress={signOut} />
    </ScrollView>
  );
}

// Certificates and licences. Approved PMs can add a renewed copy; the original ID stays as verified.
function Documents({ profile }) {
  const [docs, setDocs] = useState([]);
  const [expiry, setExpiry] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setDocs(await listMyDocuments(profile.id)); } catch (e) { setError(e.message); }
  }, [profile.id]);
  useEffect(() => { load(); }, [load]);

  async function add() {
    setError('');
    const date = expiry.trim();
    if (date && !isValidDate(date)) return setError('Write the expiry date like 2027-03-31 (year-month-day), or leave it empty.');
    const res = await DocumentPicker.getDocumentAsync({ type: ['image/*', 'application/pdf'], copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.length) return;
    const file = res.assets[0];
    if (file.size && file.size > 10 * 1024 * 1024) return setError('That file is over 10 MB. Pick a smaller one.');
    setBusy(true);
    try { await uploadDocument(profile.id, 'qualification', file.name, file, date || undefined); setExpiry(''); await load(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <Card style={{ gap: spacing.md }}>
      <Text style={{ fontWeight: '700', fontSize: 15, color: colors.text }}>Your documents</Text>
      {docs.map((d) => {
        const e = docExpiry(d);
        return (
          <View key={d.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={{ flex: 1, fontSize: 13.5, color: colors.text }} numberOfLines={1}>📄 {d.label}</Text>
            {e
              ? <Badge label={expiryText(d)} tone={e.state === 'expired' ? 'danger' : e.state === 'soon' ? 'brass' : 'neutral'} />
              : <Badge label={d.doc_type === 'id' ? 'ID' : 'No expiry'} />}
          </View>
        );
      })}
      {!docs.length && <Text style={{ color: colors.faint, fontSize: 13 }}>No documents on file.</Text>}
      <View>
        <FieldLabel>Add or renew a certificate</FieldLabel>
        <Input value={expiry} onChangeText={(v) => { setExpiry(v); setError(''); }} placeholder="Expiry date, if it has one (2027-03-31)" autoCapitalize="none" />
      </View>
      <ErrorText>{error}</ErrorText>
      <Button label={busy ? 'Uploading…' : '⬆ Choose a file'} variant="ghost" size="sm" onPress={add} disabled={busy} />
    </Card>
  );
}
