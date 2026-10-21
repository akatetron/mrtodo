// The concierge look: editorial introduction, photography-led service tiles, warm
// guidance panels. Photography comes from three places, in this order: photos bundled
// in the app (src/assets/servicePhotos.js), an https link set by an admin, then a
// designed fallback artwork. A missing or failing image is never shown as broken.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Image, Pressable, Animated, AccessibilityInfo, StyleSheet } from 'react-native';
import { colors, spacing, radius, typo } from '../../theme';
import AppIcon from '../AppIcon';
import { servicePhotos } from '../../assets/servicePhotos';

// ---- artwork and photography ---------------------------------------------------------------

const TONES = [
  { bg: colors.accent, fg: colors.brass, mark: '#FFFFFF' },        // deep teal, brass icon
  { bg: colors.accentLight, fg: colors.accent, mark: colors.accent },
  { bg: colors.brassLight, fg: colors.brassDark, mark: colors.brassDark },
];

export function ServiceArtwork({ icon, index = 0, style }) {
  const tone = TONES[index % TONES.length];
  return (
    <View style={[s.artwork, { backgroundColor: tone.bg }, style]} accessible={false} importantForAccessibility="no-hide-descendants">
      <View style={s.artMark}><AppIcon name={icon} size={150} color={tone.mark} /></View>
      <View style={[s.artRule, { backgroundColor: tone.fg }]} />
      <AppIcon name={icon} size={44} color={tone.fg} style={s.artIcon} />
    </View>
  );
}

// 4:3 by default. `photoKey` finds a bundled photo; `uri` is an optional admin link.
export function hasPhoto(photoKey, uri) { return !!((photoKey && servicePhotos[photoKey]) || uri); }

export function ServicePhoto({ photoKey, uri, alt, icon, index, ratio = 4 / 3, radiusSize = radius.lg, style, hideWhenEmpty }) {
  const bundled = photoKey ? servicePhotos[photoKey] : null;
  const [failed, setFailed] = useState(false);
  const fade = useRef(new Animated.Value(0)).current;
  const reduce = useRef(false);
  useEffect(() => { AccessibilityInfo.isReduceMotionEnabled?.().then((v) => { reduce.current = !!v; }).catch(() => {}); }, []);
  const source = bundled || (uri && !failed ? { uri } : null);
  if (!source && hideWhenEmpty) return null;
  const onLoad = () => { if (reduce.current) fade.setValue(1); else Animated.timing(fade, { toValue: 1, duration: 200, useNativeDriver: true }).start(); };
  return (
    <View style={[{ aspectRatio: ratio, borderRadius: radiusSize, overflow: 'hidden', backgroundColor: colors.accentLight }, style]}>
      {source ? (
        <Animated.Image source={source} onLoad={onLoad} onError={() => setFailed(true)} resizeMode="cover" style={{ width: '100%', height: '100%', opacity: fade }}
          accessible={!!alt} accessibilityLabel={alt || undefined} accessibilityRole={alt ? 'image' : undefined} />
      ) : <ServiceArtwork icon={icon} index={index} style={StyleSheet.absoluteFill} />}
    </View>
  );
}

// ---- header and introduction ----------------------------------------------------------------

export function ConciergeHeader({ onAccount, right }) {
  return (
    <View style={s.header}>
      <View style={s.brandRow}>
        <Text style={s.brand} accessibilityRole="header">Mr. Todo</Text>
      </View>
      <View style={s.headerRight}>
        {right}
        <Pressable accessibilityRole="button" accessibilityLabel="Your account" onPress={onAccount} style={s.account}>
          <AppIcon name="user" size={18} />
          <Text style={s.accountText}>Account</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function ConciergeIntroduction({ title, body }) {
  return (
    <View style={{ gap: spacing.md }}>
      <View style={s.rule} />
      <Text style={s.hero} accessibilityRole="header">{title}</Text>
      <Text style={s.lead}>{body}</Text>
    </View>
  );
}

// ---- describe your task ----------------------------------------------------------------------

export function DescribeTaskRow({ onPress }) {
  return (
    <View style={s.describe}>
      <Text style={s.describeTitle}>Have something specific in mind?</Text>
      <Text style={s.describeBody}>Tell us what you need, even if you can’t find it here.</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Describe your task" onPress={onPress} style={({ pressed }) => [s.describeLink, pressed && { opacity: 0.6 }]}>
        <Text style={s.describeLinkText}>Describe your task</Text>
        <AppIcon name="chevron-right" size={18} color={colors.accent} />
      </Pressable>
    </View>
  );
}

// ---- photography-led category tiles -----------------------------------------------------------

export function ServicePhotographyTile({ family, index, onPress }) {
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={[family.name, family.description].filter(Boolean).join('. ')} onPress={onPress}
      style={({ pressed }) => [s.tile, pressed && { opacity: 0.86 }]}
    >
      <ServicePhoto photoKey={family.key} uri={family.image_url} alt={family.image_alt} icon={family.icon_key || 'grid'} index={index} />
      <View style={{ gap: 4, paddingHorizontal: 2 }}>
        <Text style={s.tileTitle} numberOfLines={3}>{family.name}</Text>
        {!!family.description && <Text style={s.tileDesc} numberOfLines={2}>{family.description}</Text>}
      </View>
    </Pressable>
  );
}

export function ServiceCategorySection({ title, families, onOpen, width }) {
  const single = width < 340;
  return (
    <View>
      <Text style={s.section} accessibilityRole="header">{title}</Text>
      <View style={[s.grid, single && { flexDirection: 'column' }]}>
        {families.map((f, i) => <View key={f.id} style={single ? { width: '100%' } : s.cell}><ServicePhotographyTile family={f} index={i} onPress={() => onOpen(f)} /></View>)}
      </View>
    </View>
  );
}

export function LoadingPlaceholder({ count = 4 }) {
  return (
    <View style={s.grid} accessibilityLabel="Loading services" accessibilityLiveRegion="polite">
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={s.cell}>
          <View style={{ aspectRatio: 4 / 3, borderRadius: radius.lg, backgroundColor: colors.surfaceAlt }} />
          <View style={{ height: 14, width: '70%', borderRadius: 7, backgroundColor: colors.surfaceAlt, marginTop: 10 }} />
        </View>
      ))}
    </View>
  );
}

export function InlineErrorState({ message, onRetry }) {
  return (
    <View style={s.error} accessibilityRole="alert">
      <AppIcon name="help-circle" size={22} color={colors.danger} />
      <View style={{ flex: 1, gap: 8 }}>
        <Text style={s.errorText}>{message}</Text>
        {onRetry && <Pressable accessibilityRole="button" onPress={onRetry} style={s.retry}><Text style={s.retryText}>Try again</Text></Pressable>}
      </View>
    </View>
  );
}

// ---- warm guidance panels ----------------------------------------------------------------------

export function GeneralRequestPanel({ onPress }) {
  return (
    <View style={s.panel}>
      {hasPhoto('concierge') ? <ServicePhoto photoKey="concierge" icon="message-circle" ratio={16 / 9} radiusSize={radius.lg} alt="" />
        : <View style={s.panelIcon}><AppIcon name="message-circle" size={24} color={colors.brassDark} /></View>}
      <Text style={s.panelTitle} accessibilityRole="header">Not sure where to start?</Text>
      <Text style={s.panelBody}>Start with what you need done. You don’t have to know which service to choose.</Text>
      <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [s.cta, pressed && { backgroundColor: colors.accentDark }]}>
        <Text style={s.ctaText}>Tell us what you need</Text>
      </Pressable>
    </View>
  );
}

export function FamilyBookingEntry({ onPress, active, onClear }) {
  return (
    <View style={s.family}>
      <View style={{ width: 96 }}><ServicePhoto photoKey="someone-else" icon="heart" index={1} ratio={1} radiusSize={radius.md} alt="" /></View>
      <View style={{ flex: 1, gap: 6 }}>
        <Text style={s.familyTitle} accessibilityRole="header">Arrange help for someone you care about</Text>
        <Text style={s.panelBody}>Book practical assistance for a family member or another person.</Text>
        {active ? (
          <Pressable accessibilityRole="button" onPress={onClear} style={s.familyBtn}><AppIcon name="check" size={16} /><Text style={s.familyBtnText}>Booking for someone else · Undo</Text></Pressable>
        ) : (
          <Pressable accessibilityRole="button" onPress={onPress} style={s.familyBtn}><Text style={s.familyBtnText}>Book for someone else</Text></Pressable>
        )}
      </View>
    </View>
  );
}

export function PriceOrQuoteSummary({ pricing, compact }) {
  const p = pricing || {};
  const fixed = p.approach === 'fixed';
  const label = fixed ? `Fixed price ₹${Number(p.price).toLocaleString('en-IN')}`
    : p.approach === 'estimate_approval' ? 'Estimate, then your approval' : 'Quote required';
  const note = fixed ? null : 'We set the price after we review your request. You confirm it before any work starts.';
  return (
    <View style={[s.price, compact && { padding: 0, backgroundColor: 'transparent' }]}>
      <Text style={[s.priceLabel, fixed ? { color: colors.brassDark } : { color: colors.text }]}>{label}</Text>
      {!compact && !!note && <Text style={s.priceNote}>{note}</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  artwork: { overflow: 'hidden', justifyContent: 'flex-end', padding: 14 },
  artMark: { position: 'absolute', right: -18, top: -18, opacity: 0.08 },
  artRule: { width: 28, height: 3, borderRadius: 2, marginBottom: 10 },
  artIcon: {},
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 56 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  mark: { width: 32, height: 32, borderRadius: 9, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  markText: { color: colors.brass, fontWeight: '800', fontSize: 18 },
  brand: { fontSize: 17, fontWeight: '700', color: colors.accent, letterSpacing: -0.2 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  account: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 48, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  accountText: { fontSize: 14, fontWeight: '600', color: colors.text },
  rule: { width: 40, height: 3, borderRadius: 2, backgroundColor: colors.brass },
  hero: { ...typo.hero, color: colors.text },
  lead: { fontSize: 16, lineHeight: 24, color: colors.muted },
  describe: { marginTop: spacing.lg, gap: 2, paddingLeft: 14, borderLeftWidth: 3, borderLeftColor: colors.brass },
  describeTitle: { ...typo.service, color: colors.text },
  describeBody: { fontSize: 14, lineHeight: 20, color: colors.muted },
  describeLink: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  describeLinkText: { ...typo.button, color: colors.accent },
  section: { ...typo.section, color: colors.text, marginBottom: spacing.lg },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 20 },
  cell: { width: '47%', flexGrow: 1 },
  tile: { gap: 10 },
  tileTitle: { fontSize: 17, lineHeight: 22, fontWeight: '600', color: colors.text },
  tileDesc: { fontSize: 13, lineHeight: 18, color: colors.muted },
  error: { flexDirection: 'row', gap: 12, padding: 16, borderRadius: radius.lg, backgroundColor: colors.dangerLight },
  errorText: { fontSize: 15, lineHeight: 22, color: colors.text },
  retry: { minHeight: 48, alignSelf: 'flex-start', justifyContent: 'center', paddingHorizontal: 16, borderRadius: radius.md, borderWidth: 1, borderColor: colors.danger, backgroundColor: colors.surface },
  retryText: { fontWeight: '600', color: colors.danger },
  panel: { padding: 20, borderRadius: radius.xl, backgroundColor: colors.brassLight, gap: 12 },
  panelIcon: { width: 48, height: 48, borderRadius: 14, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  panelTitle: { ...typo.featured, color: colors.text },
  panelBody: { fontSize: 15, lineHeight: 22, color: colors.text },
  cta: { minHeight: 54, borderRadius: 14, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  ctaText: { ...typo.button, color: colors.accentText },
  family: { flexDirection: 'row', gap: 16, padding: 16, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'flex-start' },
  familyTitle: { fontSize: 18, lineHeight: 24, fontWeight: '700', color: colors.text },
  familyBtn: { minHeight: 48, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center', paddingHorizontal: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.surface },
  familyBtnText: { fontSize: 14, fontWeight: '600', color: colors.accent },
  price: { padding: 12, borderRadius: radius.md, backgroundColor: colors.surfaceAlt, gap: 2 },
  priceLabel: { ...typo.service },
  priceNote: { fontSize: 13, lineHeight: 18, color: colors.muted },
});
