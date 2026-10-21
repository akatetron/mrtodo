// Discover: an editorial concierge introduction, search, a way to describe anything
// else, photography-led categories, and warm guidance for people who are unsure.
// Every service shown comes from the published catalogue.
import React, { useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, radius, typo, pagePad, maxContentWidth } from '../theme';
import { Badge } from '../components/UI';
import AppIcon from '../components/AppIcon';
import NotificationBell from '../components/NotificationBell';
import { RecipientSheet } from '../components/discover/BookingParts';
import { ServiceSearchField, ServiceListItem, EmptySearchState } from '../components/discover/Discover';
import {
  ConciergeHeader, ConciergeIntroduction, DescribeTaskRow, ServiceCategorySection, LoadingPlaceholder, InlineErrorState,
  GeneralRequestPanel, FamilyBookingEntry,
} from '../components/concierge/Concierge';
import { useCatalogue, searchServices } from '../data/useCatalogue';
import { useBookingDraft, patchDraft } from '../data/bookingDraft';
import { useTasks, myTasks, STATUS_META } from '../data/store';
import { useAuth } from '../lib/AuthContext';

export default function HomeScreen({ navigation }) {
  useTasks();
  const { user } = useAuth();
  const { width } = useWindowDimensions();
  const pad = pagePad(width);
  const contentWidth = Math.min(width, maxContentWidth);
  const { families, loaded, failed, reload } = useCatalogue();
  const draft = useBookingDraft();
  const [query, setQuery] = useState('');
  const insets = useSafeAreaInsets();
  const [sheet, setSheet] = useState(false);
  const scroller = useRef(null);
  const exploreY = useRef(0);
  const results = searchServices(families, query);
  const searching = query.trim().length > 0;
  const recent = myTasks(user?.id).slice(0, 3);
  const general = () => navigation.navigate('Booking', { general: true });
  const forSomeone = draft.forWhom === 'other';

  const clearRecipient = () => patchDraft({ forWhom: 'self', recipientName: '', recipientRelation: '', recipientPhone: '', consent: false });
  const strip = forSomeone && !!draft.recipientName;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
    {strip && (
      <View style={s.strip} accessibilityLiveRegion="polite">
        <AppIcon name="heart" size={18} color={colors.accent} />
        <Text style={s.stripText} numberOfLines={1}>Booking for {draft.recipientName}</Text>
        <Pressable accessibilityRole="button" onPress={() => setSheet(true)} style={s.stripBtn}><Text style={s.stripBtnText}>Change</Text></Pressable>
        <Pressable accessibilityRole="button" onPress={clearRecipient} style={s.stripBtn}><Text style={s.stripBtnText}>Remove</Text></Pressable>
      </View>
    )}
    <ScrollView ref={scroller} style={{ flex: 1, backgroundColor: colors.bg }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ alignItems: 'center', paddingBottom: 56 }}>
      <View style={{ width: '100%', maxWidth: maxContentWidth, paddingHorizontal: pad }}>
        <ConciergeHeader onAccount={() => navigation.navigate('Account')} right={<NotificationBell navigation={navigation} />} />

        <View style={{ marginTop: spacing.lg }}>
          <ConciergeIntroduction title="What can we take off your plate?" body="Tell us what you need help with. We’ll guide you through the next steps." />
        </View>

        <View style={{ marginTop: spacing.xl }}>
          <ServiceSearchField value={query} onChangeText={setQuery} />
        </View>

        {!searching && <DescribeTaskRow onPress={general} />}

        {draft.cart.length > 0 && !searching && (
          <Pressable accessibilityRole="button" onPress={() => navigation.navigate('Booking', { resume: true })} style={s.resume}>
            <View style={{ flex: 1 }}>
              <Text style={s.resumeTitle}>Your booking has {draft.cart.length} task{draft.cart.length === 1 ? '' : 's'}</Text>
              <Text style={s.resumeSub}>Add more below, or review and send.</Text>
            </View>
            <Text style={s.resumeAction}>Review</Text>
          </Pressable>
        )}

        {searching ? (
          <View style={{ marginTop: spacing.xl }}>
            {results.length ? (
              <>
                <Text style={s.resultsHead} accessibilityRole="header">{results.length} result{results.length === 1 ? '' : 's'}</Text>
                <View style={s.listSurface}>
                  {results.map((r, i) => (
                    <ServiceListItem key={r.service.id} title={r.service.definition.title} description={r.service.definition.description} meta={r.family.name}
                      last={i === results.length - 1} onPress={() => navigation.navigate('Booking', { serviceId: r.service.id })} />
                  ))}
                </View>
                <View style={{ marginTop: spacing.xl }}><DescribeTaskRow onPress={general} /></View>
              </>
            ) : <EmptySearchState query={query.trim()} onGeneral={general} />}
          </View>
        ) : (
          <>
            <View style={{ marginTop: spacing.xxl }} onLayout={(e) => { exploreY.current = e.nativeEvent.layout.y; }}>
              {!loaded ? <><Text style={s.sectionHead} accessibilityRole="header">Explore ways we can help</Text><LoadingPlaceholder /></>
                : failed ? <InlineErrorState message="We couldn’t load our services. Check your connection and try again. You can still describe your task." onRetry={reload} />
                : families.length ? (
                  <ServiceCategorySection title="Explore ways we can help" families={families} width={contentWidth}
                    onOpen={(f) => navigation.navigate('ServiceCategory', { familyId: f.id })} />
                ) : (
                  <View style={{ gap: spacing.md }}>
                    <Text style={s.sectionHead} accessibilityRole="header">Explore ways we can help</Text>
                    <Text style={s.muted}>No services are available to book right now. You can still tell us what you need.</Text>
                  </View>
                )}
            </View>

            <View style={{ marginTop: spacing.xxl }}><GeneralRequestPanel onPress={general} /></View>

            <View style={{ marginTop: spacing.xl }}>
              <FamilyBookingEntry active={forSomeone} name={draft.recipientName} onPress={() => setSheet(true)} onClear={clearRecipient} />
            </View>

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
                <Text style={[s.sectionHead, { marginTop: spacing.xxl }]} accessibilityRole="header">Your recent tasks</Text>
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
      </View>
      <RecipientSheet visible={sheet} initial={draft} onClose={() => setSheet(false)} onSave={(v) => { patchDraft(v); setSheet(false); setTimeout(() => scroller.current?.scrollTo({ y: Math.max(exploreY.current - 12, 0), animated: true }), 250); }} />
    </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  sectionHead: { ...typo.section, color: colors.text, marginBottom: spacing.md },
  resultsHead: { ...typo.h2, color: colors.text },
  muted: { fontSize: 15, lineHeight: 22, color: colors.muted },
  listSurface: { marginTop: spacing.md, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 16, overflow: 'hidden' },
  resume: { marginTop: spacing.lg, flexDirection: 'row', alignItems: 'center', minHeight: 56, padding: 14, borderRadius: radius.md, backgroundColor: colors.accentLight, gap: 12 },
  resumeTitle: { ...typo.service, color: colors.text },
  resumeSub: { ...typo.meta, color: colors.muted },
  resumeAction: { ...typo.button, color: colors.accent },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: radius.md, backgroundColor: colors.accentLight, marginBottom: spacing.lg },
  strip: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 16, paddingRight: 4, minHeight: 52, backgroundColor: colors.accentLight, borderBottomWidth: 1, borderBottomColor: colors.border },
  stripText: { flex: 1, ...typo.body, fontWeight: '700', color: colors.text },
  stripBtn: { minHeight: 48, minWidth: 56, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  stripBtnText: { ...typo.body, fontWeight: '700', color: colors.accent },
  bannerText: { flex: 1, fontSize: 14, lineHeight: 20, color: colors.text },
  plus: { marginTop: spacing.xl, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingVertical: 12, paddingHorizontal: 16, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  plusIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.brassLight, alignItems: 'center', justifyContent: 'center' },
  plusTitle: { ...typo.service, color: colors.text },
  task: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, minHeight: 56 },
  taskLine: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  taskTitle: { ...typo.service, color: colors.text },
});
