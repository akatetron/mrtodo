// A message to everyone in a group. It lands in their notification inbox.
import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { colors, spacing } from '../../theme';
import { Card, Button, Chip, Input, ErrorText, FieldLabel } from '../../components/UI';
import { sendAnnouncement } from '../../data/adminData';

const AUDIENCES = [
  { id: 'workers', label: 'Personal Managers', who: 'every approved Personal Manager' },
  { id: 'customers', label: 'Customers', who: 'every customer' },
  { id: 'all', label: 'Everyone', who: 'every customer and approved Personal Manager' },
];

export default function AdminBroadcastScreen() {
  const [audience, setAudience] = useState('workers');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(null);
  const who = AUDIENCES.find((a) => a.id === audience).who;

  async function send() {
    setError(''); setBusy(true);
    try {
      const n = await sendAnnouncement(audience, title.trim(), body.trim());
      setSent(n); setTitle(''); setBody(''); setConfirming(false);
    } catch (e) { setError(e.message); setConfirming(false); } finally { setBusy(false); }
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60, gap: spacing.md }}>
      <Card style={{ gap: spacing.md }}>
        <View>
          <FieldLabel>Send to</FieldLabel>
          <View style={styles.chips}>
            {AUDIENCES.map((a) => <Chip key={a.id} label={a.label} selected={audience === a.id} onPress={() => { setAudience(a.id); setConfirming(false); setSent(null); }} />)}
          </View>
        </View>
        <View>
          <FieldLabel>Title</FieldLabel>
          <Input placeholder="e.g. Heavy rain tomorrow" value={title} onChangeText={(v) => { setTitle(v); setConfirming(false); setSent(null); }} />
        </View>
        <View>
          <FieldLabel>Message (optional)</FieldLabel>
          <Input multiline placeholder="e.g. Expect delays on the Western line. Allow extra time." value={body} onChangeText={(v) => { setBody(v); setConfirming(false); }} />
        </View>
        <ErrorText>{error}</ErrorText>
        {sent != null && <Text style={styles.ok}>Sent to {sent} {sent === 1 ? 'person' : 'people'}.</Text>}
        {!confirming ? (
          <Button label="Review and send" disabled={!title.trim()} onPress={() => setConfirming(true)} />
        ) : (
          <View style={{ gap: spacing.sm }}>
            <Text style={styles.confirm}>This goes to {who} and can't be taken back.</Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Button label="Back" variant="ghost" style={{ flex: 1 }} onPress={() => setConfirming(false)} />
              <Button label={busy ? 'Sending…' : 'Send now'} style={{ flex: 1 }} disabled={busy} onPress={send} />
            </View>
          </View>
        )}
      </Card>
      <Text style={styles.hint}>People see it in the bell on their home screen. It does not buzz their phone yet.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  ok: { color: colors.success, fontWeight: '700', fontSize: 13.5 },
  confirm: { color: colors.text, fontSize: 13.5, fontWeight: '700', lineHeight: 19 },
  hint: { color: colors.faint, fontSize: 12.5, lineHeight: 18 },
});
