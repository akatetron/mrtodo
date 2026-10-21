// Notifications, a Personal Manager's base location and languages, and deleting
// the account. Permissions are asked for only when a button is tapped.
import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { colors, spacing } from '../theme';
import { Card, Button, FieldLabel, Input, ErrorText } from './UI';
import { enablePush } from '../lib/push';
import { currentPoint } from '../lib/location';
import { updateMyProfile } from '../data/store';
import { supabase } from '../lib/supabase';

export default function AccountExtras({ profile, refreshProfile, signOut }) {
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [langs, setLangs] = useState((profile.languages || []).join(', '));
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const run = async (fn, ok) => { setBusy(true); setError(''); setMsg(''); try { await fn(); if (ok) setMsg(ok); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const isPm = profile.role === 'worker';

  async function deleteAccount() {
    const { data, error: err } = await supabase.functions.invoke('delete-account');
    if (err) {
      let m = 'Could not delete the account. Please try again.';
      try { const body = await err.context?.json?.(); if (body?.error) m = body.error; } catch { /* keep the generic message */ }
      throw new Error(m);
    }
    if (!data?.ok) throw new Error('Could not delete the account. Please try again.');
    await signOut();
  }

  return (
    <>
      <Card style={{ gap: spacing.md }}>
        <Text style={{ fontSize: 17, fontWeight: '800', color: colors.text }}>Notifications</Text>
        <Text style={{ fontSize: 15, lineHeight: 22, color: colors.muted }}>Get a message on your phone when something happens to a task.</Text>
        <Button label="Turn on notifications" variant="ghost" size="sm" disabled={busy} onPress={() => run(enablePush, 'Notifications are on for this phone.')} />
        {isPm && (
          <>
            <View>
              <FieldLabel>Where you work from</FieldLabel>
              <Text style={{ fontSize: 14, color: colors.muted, marginBottom: 6 }}>Used to show you tasks nearby. Saved on your profile, never shown to customers.{profile.base_lat != null ? ' A location is saved.' : ''}</Text>
              <Button label="Use my current location" variant="ghost" size="sm" disabled={busy}
                onPress={() => run(async () => { const p = await currentPoint(); await updateMyProfile(profile.id, { base_lat: p.lat, base_lng: p.lng }); await refreshProfile(); }, 'Location saved.')} />
            </View>
            <View>
              <FieldLabel>Languages you speak (separated by commas)</FieldLabel>
              <Input value={langs} onChangeText={setLangs} placeholder="English, Hindi, Marathi" />
              <Button label="Save languages" variant="ghost" size="sm" disabled={busy} style={{ marginTop: 8 }}
                onPress={() => run(async () => { await updateMyProfile(profile.id, { languages: langs.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 10) }); await refreshProfile(); }, 'Languages saved. Customers can see them on your profile.')} />
            </View>
          </>
        )}
        <ErrorText>{error}</ErrorText>
        {!!msg && <Text style={{ color: colors.successText, fontSize: 15, fontWeight: '700' }} accessibilityLiveRegion="polite">{msg}</Text>}
      </Card>

      {profile.role !== 'admin' && (
        <Card style={{ gap: spacing.md, borderColor: colors.danger }}>
          <Text style={{ fontSize: 17, fontWeight: '800', color: colors.text }}>Delete my account</Text>
          <Text style={{ fontSize: 15, lineHeight: 22, color: colors.muted }}>
            Your name, contact details, documents and notifications are erased and you are signed out for good. Records we must keep for billing and disputes, such as the tasks you took part in, stay but no longer carry your name. You cannot delete while you have open tasks or an active Todo+ plan.
          </Text>
          {!confirming ? (
            <Button label="Delete my account…" variant="danger" size="sm" onPress={() => setConfirming(true)} />
          ) : (
            <>
              <FieldLabel>Type DELETE to confirm</FieldLabel>
              <Input value={typed} onChangeText={setTyped} autoCapitalize="characters" accessibilityLabel="Type DELETE to confirm" />
              <Button label={busy ? 'Deleting…' : 'Permanently delete my account'} variant="danger" disabled={busy || typed.trim() !== 'DELETE'} onPress={() => run(deleteAccount)} />
              <Button label="Keep my account" variant="ghost" size="sm" onPress={() => { setConfirming(false); setTyped(''); }} />
            </>
          )}
        </Card>
      )}
    </>
  );
}
