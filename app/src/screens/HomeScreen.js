// Discover: "What can we help you with?" Heading, search, category grid, a way to
// describe anything else. Everything shown comes from the published catalogue.
import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import { colors, spacing, radius, typo, pagePad } from '../theme';
import { Badge } from '../components/UI';
import AppIcon from '../components/AppIcon';
import NotificationBell from '../components/NotificationBell';
import { ScreenHeader, ServiceSearchField, ServiceCategoryGrid, ServiceCategoryTile, ServiceListItem, GeneralRequestEntry, EmptySearchState } from '../components/discover/Discover';
import { useCatalogue, searchServices } from '../data/useCatalogue';
import { useBookingDraft } from '../data/bookingDraft';
import { useTasks, myTasks, STATUS_META } from '../data/store';
import { useAuth } from '../lib/AuthContext';

export default function HomeScreen({ navigation }) {
  useTasks();
  const { user } = useAuth();
  const { width } = useWindowDimensions();
  const pad = pagePad(width);
  const { families, loaded } = useCatalogue();
  const draft = useBookingDraft();
  const [query, setQuery] = useState('');
  const results = searchServices(families, query);
  const searching = query.trim().length > 0;
  const recent = myTasks(user?.id).slice(0, 3);
  const general = () => navigation.navigate('Booking', { general: true });

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ paddingHorizontal: pad, paddingBottom: 48, paddingTop: 4 }} keyboardShouldPersistTaps="handled">
      <ScreenHeader
        title={"What can we help\nyou with?"}
        subtitle="Get help with everyday tasks, technology, and practical assistance."
        right={(
          <View style={s.headerActions}>
            <NotificationBell navigation={navigation} />
            <Pressable accessibilityRole="button" accessibilityLabel="Your account" onPress={() => navigation.navigate('Account')} style={s.accountBtn}>
              <AppIcon name="user" size={18} />
              <Text style={s.accountText}>Account</Text>
            </Pressable>
          </View>
        )}
      />

      <View style={{ marginTop: spacing.xl }}>
        <ServiceSearchField value={query} onChangeText={setQuery} />
      </View>

      {draft.cart.length > 0 && !searching && (
        <Pressable accessibilityRole="button" onPress={() => navigation.navigate('Booking', { resume: true })} style={s.resume}>
          <View style={{ flex: 1 }}>
            <Text style={s.resumeTitle}>Your booking has {draft.cart.length} task{draft.cart.length === 1 ? '' : 's'}</Text>
            <Text style={s.resumeSub}>Add more from below, or review and send.</Text>
          </View>
          <Text style={s.resumeAction}>Review</Text>
        </Pressable>
      )}

      {searching ? (
        <View style={{ marginTop: spacing.xl }}>
          {results.length ? (
            <>
              <Text style={s.h2} accessibilityRole="header">{results.length} result{results.length === 1 ? '' : 's'}</Text>
              <View style={s.listSurface}>
                {results.map((r, i) => (
                  <ServiceListItem key={r.service.id} title={r.service.definition.title} description={r.service.definition.description} meta={r.family.name}
                    last={i === results.length - 1} onPress={() => navigation.navigate('Booking', { serviceId: r.service.id })} />
                ))}
              </View>
              <GeneralRequestEntry onPress={general} />
            </>
          ) : <EmptySearchState query={query.trim()} onGeneral={general} />}
        </View>
      ) : (
        <>
          <Text style={[s.h2, { marginTop: spacing.xl }]} accessibilityRole="header">Browse by category</Text>
          <View style={{ marginTop: spacing.md }}>
            {!loaded ? <Text style={s.muted}>Loading services…</Text> : families.length ? (
              <ServiceCategoryGrid width={width}>
                {families.map((f) => (
                  <ServiceCategoryTile key={f.id} name={f.name} description={f.description} icon={f.icon_key || 'grid'}
                    onPress={() => navigation.navigate('ServiceCategory', { familyId: f.id })} />
                ))}
              </ServiceCategoryGrid>
            ) : (
              <Text style={s.muted}>No services are available to book right now. You can still tell us what you need below.</Text>
            )}
          </View>

          <GeneralRequestEntry onPress={general} />

          <Pressable accessibilityRole="button" onPress={() => navigation.navigate('TodoPlus')} style={s.plus}>
            <View style={s.plusIcon}><AppIcon name="star" size={20} color={colors.brassDark} /></View>
            <View style={{ flex: 1 }}>
              <Text style={s.plusTitle}>Todo+ Monthly Maintenance</Text>
              <Text style={s.muted}>See the monthly plan</Text>
            </View>
            <AppIcon name="chevron-right" size={22} color={colors.muted} />
          </Pressable>

          {recent.length > 0 && (
            <>
              <Text style={[s.h2, { marginTop: spacing.xxl }]} accessibilityRole="header">Your recent tasks</Text>
              <View style={s.listSurface}>
                {recent.map((t, i) => (
                  <Pressable key={t.id} accessibilityRole="button" onPress={() => navigation.navigate('TrackTask', { taskId: t.id })} style={[s.task, i < recent.length - 1 && s.taskLine]}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.taskTitle} numberOfLines={2}>{t.title}</Text>
                      <Text style={s.muted} numberOfLines={1}>{t.scheduledFor || 'Flexible'}</Text>
                    </View>
                    <Badge label={STATUS_META[t.status].label} tone={STATUS_META[t.status].tone} />
                  </Pressable>
                ))}
              </View>
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  accountBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 48, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  accountText: { ...typo.meta, fontSize: 14, color: colors.text, fontWeight: '600' },
  h2: { ...typo.h2, color: colors.text },
  muted: { ...typo.body, color: colors.muted },
  listSurface: { marginTop: spacing.md, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 16, overflow: 'hidden' },
  resume: { marginTop: spacing.lg, flexDirection: 'row', alignItems: 'center', minHeight: 56, padding: 14, borderRadius: radius.md, backgroundColor: colors.accentLight, gap: 12 },
  resumeTitle: { ...typo.service, color: colors.text },
  resumeSub: { ...typo.meta, color: colors.muted },
  resumeAction: { ...typo.button, color: colors.accent },
  plus: { marginTop: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingVertical: 12, paddingHorizontal: 16, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  plusIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.brassLight, alignItems: 'center', justifyContent: 'center' },
  plusTitle: { ...typo.service, color: colors.text },
  task: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, minHeight: 56 },
  taskLine: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  taskTitle: { ...typo.service, color: colors.text },
});
