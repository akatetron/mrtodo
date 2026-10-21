// Who is an admin and what level they have. Everyone can look; only a super admin can change it.
import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { colors, spacing } from '../../theme';
import { Card, Badge, Button, ErrorText } from '../../components/UI';
import { useAuth } from '../../lib/AuthContext';
import { useLiveQuery, listAdmins, setAdminLevel, isSuperAdmin } from '../../data/adminData';

export default function AdminTeamScreen({ navigation }) {
  const { profile, user } = useAuth();
  const superAdmin = isSuperAdmin(profile);
  const { data, error, reload } = useLiveQuery(listAdmins, ['profiles'], navigation);
  const [actionError, setActionError] = useState('');
  const [busyId, setBusyId] = useState(null);

  async function change(a, level) {
    setActionError(''); setBusyId(a.id);
    try { await setAdminLevel(a.id, level); await reload(); } catch (e) { setActionError(e.message); } finally { setBusyId(null); }
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60, gap: spacing.md }}>
      <Card style={{ gap: 6 }}>
        <Text style={styles.h2}>What each level can do</Text>
        <Text style={styles.line}><Text style={styles.bold}>Super admin:</Text> everything, including approving and suspending Personal Managers, opening ID documents, recording payouts and sending broadcasts.</Text>
        <Text style={styles.line}><Text style={styles.bold}>Support admin:</Text> assigning, reassigning, cancelling and completing tasks, handling reports, and viewing people, reviews and insights.</Text>
      </Card>
      <ErrorText>{error || actionError}</ErrorText>
      {(data || []).map((a) => {
        const level = a.admin_level || 'super';
        const me = a.id === user?.id;
        return (
          <Card key={a.id} style={{ gap: spacing.sm }}>
            <View style={styles.top}>
              <Text style={styles.name}>{a.full_name}{me ? ' (you)' : ''}</Text>
              <Badge label={level === 'super' ? 'Super admin' : 'Support admin'} tone={level === 'super' ? 'accent' : 'neutral'} />
            </View>
            <Text style={styles.meta}>{a.email}</Text>
            {superAdmin && (
              <Button
                label={busyId === a.id ? 'Saving…' : level === 'super' ? 'Make support admin' : 'Make super admin'}
                variant="ghost" size="sm" disabled={!!busyId}
                onPress={() => change(a, level === 'super' ? 'support' : 'super')}
              />
            )}
          </Card>
        );
      })}
      {!data && !error && <Text style={styles.meta}>Loading…</Text>}
      <Text style={styles.hint}>New admins are created by hand in the Supabase SQL Editor (see SETUP_BACKEND.md). There must always be at least one super admin.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  h2: { fontSize: 15, fontWeight: '700', color: colors.text },
  line: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  bold: { fontWeight: '800', color: colors.text },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  name: { fontWeight: '700', fontSize: 15, color: colors.text, flexShrink: 1 },
  meta: { color: colors.muted, fontSize: 13 },
  hint: { color: colors.muted, fontSize: 12.5, lineHeight: 18 },
});
