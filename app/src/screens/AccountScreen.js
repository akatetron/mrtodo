import React, { useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { colors, spacing } from '../theme';
import { Card, Button, FieldLabel, Input, ErrorText, Badge } from '../components/UI';
import { updateMyProfile, formatRating, catMeta } from '../data/store';
import { useAuth } from '../lib/AuthContext';

const ROLE_LABEL = { customer: 'Customer', worker: 'Personal Manager', admin: 'Admin' };

export default function AccountScreen() {
  const { user, profile, refreshProfile, signOut } = useAuth();
  const [fullName, setFullName] = useState(profile.full_name || '');
  const [phone, setPhone] = useState(profile.phone || '');
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

      <Button label="Sign out" variant="danger" onPress={signOut} />
    </ScrollView>
  );
}
