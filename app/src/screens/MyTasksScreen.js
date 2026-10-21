// Every task the customer has asked for, newest first, one tap from anywhere.
import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, radius, typo, pagePad, maxContentWidth } from '../theme';
import { Badge } from '../components/UI';
import { useTasks, myTasks, STATUS_META } from '../data/store';
import { useAuth } from '../lib/AuthContext';

export default function MyTasksScreen({ navigation }) {
  useTasks();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const pad = pagePad(width);
  const tasks = myTasks(user?.id);
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ alignItems: 'center', paddingBottom: 40 }}>
      <View style={{ width: '100%', maxWidth: maxContentWidth, paddingHorizontal: pad, paddingTop: spacing.xl + insets.top }}>
        <Text style={s.h1} accessibilityRole="header">My tasks</Text>
        {tasks.length === 0 ? (
          <View style={s.empty}>
            <Text style={s.title}>No tasks yet</Text>
            <Text style={s.muted}>When you ask for help, you can follow each task here.</Text>
            <Pressable accessibilityRole="button" onPress={() => navigation.navigate('Home')} style={s.cta}><Text style={s.ctaText}>Find help</Text></Pressable>
          </View>
        ) : (
          <View style={s.list}>
            {tasks.map((t, i) => (
              <Pressable key={t.id} accessibilityRole="button" onPress={() => navigation.navigate('TrackTask', { taskId: t.id })} style={[s.row, i < tasks.length - 1 && s.line]}>
                <View style={{ flex: 1 }}>
                  <Text style={s.title} numberOfLines={2}>{t.title}</Text>
                  <Text style={s.muted} numberOfLines={1}>{t.scheduledFor || 'Flexible'}</Text>
                </View>
                <Badge label={STATUS_META[t.status].label} tone={STATUS_META[t.status].tone} />
              </Pressable>
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  h1: { ...typo.h1, color: colors.text, marginBottom: spacing.lg },
  list: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, minHeight: 64 },
  line: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  title: { ...typo.service, color: colors.text },
  muted: { ...typo.body, color: colors.muted },
  empty: { gap: 8, padding: 20, borderRadius: radius.lg, backgroundColor: colors.accentLight },
  cta: { marginTop: 8, minHeight: 48, borderRadius: radius.md, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  ctaText: { ...typo.service, color: '#FFFFFF' },
});
