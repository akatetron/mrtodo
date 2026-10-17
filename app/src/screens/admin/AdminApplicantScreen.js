// One applicant: their details, their private documents, and the decision.
// Only a super admin can see documents or decide; the database enforces that too.
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, Image, Linking, Pressable, StyleSheet } from 'react-native';
import { colors, spacing, radius } from '../../theme';
import { Card, Badge, Button, FieldLabel, Input, ErrorText } from '../../components/UI';
import { useAuth } from '../../lib/AuthContext';
import AdminContact from '../../components/AdminContact';
import { catMeta, initials, timeAgo } from '../../data/store';
import { expiryText, docExpiry } from '../../data/extras';
import { getProfile, listWorkerDocs, reviewApplication, isSuperAdmin, useLiveQuery } from '../../data/adminData';

const STATUS = {
  draft: ['Not submitted', 'neutral'], pending: ['Pending review', 'brass'], more_info: ['More info requested', 'brass'],
  approved: ['Approved', 'success'], rejected: ['Rejected', 'danger'], suspended: ['Suspended', 'danger'],
};

export default function AdminApplicantScreen({ route, navigation }) {
  const { workerId } = route.params;
  const { profile: me } = useAuth();
  const superAdmin = isSuperAdmin(me);
  const { data: p, error } = useLiveQuery(() => getProfile(workerId), ['profiles'], navigation);
  const [docs, setDocs] = useState(null);
  const [docError, setDocError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [decisionError, setDecisionError] = useState('');
  const [done, setDone] = useState('');

  useEffect(() => {
    if (!superAdmin) return;
    listWorkerDocs(workerId).then(setDocs).catch((e) => setDocError(e.message));
  }, [workerId, superAdmin]);

  if (!p) return <Text style={{ padding: 20, color: colors.muted }}>{error || 'Loading…'}</Text>;
  const [statusLabel, statusTone] = STATUS[p.worker_status] || ['—', 'neutral'];
  const decidable = ['pending', 'more_info', 'rejected', 'suspended'].includes(p.worker_status);

  async function decide(decision) {
    setDecisionError(''); setDone(''); setBusy(true);
    try {
      await reviewApplication(workerId, decision, note.trim());
      setDone({ approved: 'Approved. They can now receive tasks.', rejected: 'Rejected. They have been told.', more_info: 'Asked for more information.', suspended: 'Suspended.' }[decision]);
      setNote('');
    } catch (e) { setDecisionError(e.message); } finally { setBusy(false); }
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60, gap: spacing.md }}>
      <Card style={{ gap: spacing.md }}>
        <View style={styles.head}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{initials(p.full_name)}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{p.full_name}</Text>
          </View>
          <Badge label={statusLabel} tone={statusTone} />
        </View>
        <AdminContact personId={p.id} style={styles.meta} />
        <Info label="Can help with" value={(p.categories || []).length ? p.categories.map((c) => `${catMeta(c).emoji} ${catMeta(c).label}`).join('  ') : 'Nothing chosen'} />
        <Info label="Area" value={p.service_area || '—'} />
        <Info label="Experience" value={p.experience_years != null ? `${p.experience_years} years` : '—'} />
        {!!p.bio && <Info label="About" value={p.bio} />}
        {!!p.applied_at && <Info label="Applied" value={timeAgo(p.applied_at)} />}
        {!!p.application_note && <Info label="Last message to applicant" value={p.application_note} />}
      </Card>

      <Card style={{ gap: spacing.md }}>
        <Text style={styles.h2}>Documents</Text>
        {!superAdmin && <Text style={styles.meta}>Only a super admin can open ID and certificate files.</Text>}
        <ErrorText>{docError}</ErrorText>
        {superAdmin && !docs && !docError && <Text style={styles.meta}>Loading…</Text>}
        {superAdmin && docs && !docs.length && <Text style={styles.meta}>Nothing uploaded.</Text>}
        {(docs || []).map((d) => {
          const e = docExpiry(d);
          return (
            <View key={d.id} style={{ gap: 6 }}>
              <View style={styles.docHead}>
                <Badge label={d.doc_type === 'id' ? 'Government ID' : d.doc_type === 'qualification' ? 'Certificate' : 'Other'} tone={d.doc_type === 'id' ? 'accent' : 'neutral'} />
                <Text style={[styles.meta, { flex: 1 }]} numberOfLines={1}>{d.label}</Text>
                {e && <Badge label={expiryText(d)} tone={e.state === 'expired' ? 'danger' : e.state === 'soon' ? 'brass' : 'neutral'} />}
              </View>
              {d.isImage && !!d.url && <Image source={{ uri: d.url }} style={styles.doc} resizeMode="contain" />}
              {!d.isImage && !!d.url && (
                <Pressable onPress={() => Linking.openURL(d.url)}><Text style={styles.link}>Open the file ↗</Text></Pressable>
              )}
            </View>
          );
        })}
      </Card>

      {superAdmin && decidable && (
        <Card style={{ gap: spacing.md }}>
          <Text style={styles.h2}>Decision</Text>
          <View>
            <FieldLabel>Message to the applicant</FieldLabel>
            <Input multiline placeholder="Required when asking for more information, e.g. “The ID photo is blurry, please upload it again.”" value={note} onChangeText={setNote} />
          </View>
          <ErrorText>{decisionError}</ErrorText>
          {!!done && <Text style={styles.ok}>{done}</Text>}
          <Button label={busy ? 'Saving…' : p.worker_status === 'suspended' ? 'Reinstate' : '✓ Approve'} disabled={busy} onPress={() => decide('approved')} />
          {p.worker_status !== 'suspended' && (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Button label="Ask for more info" variant="ghost" style={{ flex: 1 }} disabled={busy || !note.trim()} onPress={() => decide('more_info')} />
              <Button label="Reject" variant="danger" style={{ flex: 1 }} disabled={busy} onPress={() => decide('rejected')} />
            </View>
          )}
        </Card>
      )}
      {!superAdmin && <Text style={styles.meta}>Approving, rejecting and suspending is for super admins.</Text>}
      {superAdmin && p.worker_status === 'draft' && <Text style={styles.meta}>They have signed up but not submitted an application yet.</Text>}
      {superAdmin && p.worker_status === 'approved' && (
        <Button label="Suspend this Personal Manager" variant="danger" disabled={busy} onPress={() => decide('suspended')} />
      )}
    </ScrollView>
  );
}

function Info({ label, value }) {
  return (<View><FieldLabel>{label}</FieldLabel><Text style={{ fontSize: 14, color: colors.text, lineHeight: 20 }}>{value}</Text></View>);
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.accentLight, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontWeight: '800', color: colors.accentDark },
  name: { fontWeight: '800', fontSize: 16, color: colors.text },
  meta: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  h2: { fontSize: 15, fontWeight: '700', color: colors.text },
  docHead: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  doc: { width: '100%', height: 260, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt },
  link: { color: colors.accent, fontWeight: '700', fontSize: 13.5 },
  ok: { color: colors.success, fontWeight: '700', fontSize: 13 },
});
