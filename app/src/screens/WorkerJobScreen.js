import React, { useState } from 'react';
import { View, Text, ScrollView, TextInput, StyleSheet } from 'react-native';
import { colors, spacing, radius } from '../theme';
import { Card, Badge, Button, FieldLabel } from '../components/UI';
import {
  useTasks, getTask, catMeta, acceptTask, declineTask, logVisit, completeWithOtp, visitsDone, STATUS_META,
} from '../data/store';

export default function WorkerJobScreen({ route, navigation }) {
  useTasks();
  const { taskId } = route.params;
  const t = getTask(taskId);
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');

  if (!t) return <Text style={{ padding: 20 }}>Task not found.</Text>;

  function confirmComplete() {
    const ok = completeWithOtp(t.id, otp.trim());
    if (!ok) {
      setError('Incorrect code — ask the customer for their completion code.');
      return;
    }
    setError('');
    setOtp('');
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }}>
      <Card style={{ marginBottom: spacing.md }}>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <Badge label={`${catMeta(t.category).emoji} ${catMeta(t.category).label}`} />
          <Badge label={STATUS_META[t.status].label} tone={t.status === 'completed' ? 'success' : 'accent'} />
          {t.taskType === 'ongoing' && <Badge label="↻ Ongoing" tone="brass" />}
        </View>
        <Text style={styles.title}>{t.title}</Text>
        {!!t.description && <Text style={styles.desc}>{t.description}</Text>}
      </Card>

      <Card style={{ marginBottom: spacing.md, gap: 12 }}>
        <Row label="Scheduled" value={t.scheduledFor} />
        <Divider />
        <Row label="📍 Location" value={t.location} />
        {t.taskType === 'ongoing' ? (
          <>
            <Divider />
            <Row label="You earn" value={`₹${Math.round((t.ratePerDay || 0) * 0.8)}/day`} sub={`₹${t.ratePerDay || 0}/day · ${visitsDone(t)} visit(s) so far`} />
          </>
        ) : t.estCost ? (
          <>
            <Divider />
            <Row label="You earn" value={`₹${Math.round(t.estCost * 0.8)}`} sub={`Job value ₹${t.estCost} · platform fee ₹${Math.round(t.estCost * 0.2)}`} />
          </>
        ) : null}
      </Card>

      <Card style={{ marginBottom: spacing.md, flexDirection: 'row', alignItems: 'center', gap: 13 }}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{(t.customerName || '?').split(' ').map((s) => s[0]).join('').slice(0, 2)}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontWeight: '700', fontSize: 14 }}>{t.customerName}</Text>
          <Badge label={`★ ${t.customerRating.toFixed(1)} customer${t.customerRating < 4 ? ' · caution' : ''}`} tone={t.customerRating < 4 ? 'danger' : 'neutral'} style={{ marginTop: 4 }} />
        </View>
      </Card>

      {t.forWhom === 'other' && (
        <Card style={{ marginBottom: spacing.md }}>
          <Text style={{ fontSize: 13, color: colors.muted }}>
            <Text style={{ fontWeight: '700', color: colors.text }}>Meeting on arrival: </Text>
            {t.recipientName} ({t.recipientRelation}), {t.recipientPhone || 'no phone on file'}
          </Text>
        </Card>
      )}

      {t.taskType === 'ongoing' && (
        <Card style={{ marginBottom: spacing.md }}>
          <Text style={{ fontWeight: '700', fontSize: 14, marginBottom: 10 }}>Visit log</Text>
          <View style={{ gap: 8, marginBottom: 12 }}>
            {t.visits.length ? (
              t.visits.map((v, i) => (
                <Text key={i} style={{ fontSize: 13 }}>
                  <Text style={{ fontWeight: '700' }}>{v.date}: </Text>
                  <Text style={{ color: colors.muted }}>{v.note}</Text>
                </Text>
              ))
            ) : (
              <Text style={{ color: colors.faint, fontSize: 13 }}>No visits logged yet.</Text>
            )}
          </View>
          {t.status === 'in_progress' && (
            <Button label="+ Log a visit" variant="ghost" size="sm" onPress={() => logVisit(t.id, 'Visit logged by Personal Manager.')} />
          )}
        </Card>
      )}

      {t.status === 'in_progress' && (
        <Card style={{ marginBottom: spacing.md }}>
          <Text style={{ fontWeight: '700', fontSize: 14, marginBottom: 4 }}>Finish the task</Text>
          <Text style={{ color: colors.muted, fontSize: 12.5, marginBottom: 12, lineHeight: 18 }}>
            Ask the customer for their 4-digit completion code and enter it below.
          </Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <TextInput
              style={styles.otpInput}
              placeholder="0000"
              keyboardType="numeric"
              maxLength={4}
              value={otp}
              onChangeText={setOtp}
            />
            <Button label="Confirm & complete" onPress={confirmComplete} style={{ flex: 1 }} />
          </View>
          {!!error && <Text style={{ color: colors.danger, fontSize: 12.5, marginTop: 8 }}>{error}</Text>}
        </Card>
      )}

      {t.status === 'assigned' && (
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Button
            label="Decline"
            variant="ghost"
            style={{ flex: 1 }}
            onPress={() => {
              declineTask(t.id);
              navigation.goBack();
            }}
          />
          <Button label="Accept task" style={{ flex: 2 }} onPress={() => acceptTask(t.id)} />
        </View>
      )}

      {t.status === 'completed' && <Text style={{ textAlign: 'center', color: colors.muted, padding: 12 }}>Task completed ✓</Text>}
    </ScrollView>
  );
}

function Row({ label, value, sub }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ flex: 1 }}>
        <FieldLabel>{label}</FieldLabel>
        <Text style={{ fontWeight: '700', fontSize: 13.5, color: colors.text }}>{value}</Text>
        {!!sub && <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>{sub}</Text>}
      </View>
    </View>
  );
}
function Divider() {
  return <View style={{ height: 1, backgroundColor: colors.border }} />;
}

const styles = StyleSheet.create({
  title: { fontWeight: '800', fontSize: 17, marginBottom: 6, color: colors.text },
  desc: { color: colors.muted, fontSize: 13.5, lineHeight: 20 },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.accentLight, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontWeight: '800', color: colors.accentDark },
  otpInput: {
    width: 100, textAlign: 'center', fontWeight: '700', fontSize: 16, letterSpacing: 4,
    borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.sm, paddingVertical: 11,
  },
});
