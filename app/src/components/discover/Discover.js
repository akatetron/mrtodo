// Presentational building blocks for finding a service. No data fetching here.
import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, Platform, StyleSheet } from 'react-native';
import { colors, spacing, radius, typo } from '../../theme';
import AppIcon from '../AppIcon';

export function ScreenHeader({ title, subtitle, onBack, right }) {
  return (
    <View style={s.header}>
      <View style={s.headerTop}>
        {onBack ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} style={s.back} hitSlop={8}>
            <AppIcon name="chevron-left" size={22} />
            <Text style={s.backText}>Back</Text>
          </Pressable>
        ) : <Text style={s.brand} accessibilityRole="header">Mr. Todo</Text>}
        {right}
      </View>
      <Text style={s.title} accessibilityRole="header">{title}</Text>
      {!!subtitle && <Text style={s.subtitle}>{subtitle}</Text>}
    </View>
  );
}

export function ServiceSearchField({ value, onChangeText }) {
  const [focus, setFocus] = useState(false);
  return (
    <View style={[s.search, focus && s.searchFocus]}>
      <AppIcon name="search" size={20} color={colors.muted} />
      <TextInput
        value={value} onChangeText={onChangeText} placeholder="Search for a service or task" placeholderTextColor={colors.faint}
        accessibilityLabel="Search for a service or task" returnKeyType="search" autoCorrect={false} autoCapitalize="none"
        onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} style={[s.searchInput, Platform.OS === 'web' && { outlineStyle: 'none' }]}
      />
      {!!value && (
        <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => onChangeText('')} hitSlop={10} style={s.clear}>
          <Text style={s.clearText}>Clear</Text>
        </Pressable>
      )}
    </View>
  );
}

// Two columns when each tile stays comfortable; one when the screen is too narrow.
export function ServiceCategoryGrid({ children, width }) {
  const single = width < 340;
  return <View style={[s.grid, single && { flexDirection: 'column' }]}>{React.Children.map(children, (c) => <View style={single ? s.cellFull : s.cell}>{React.cloneElement(c, { horizontal: single })}</View>)}</View>;
}

export function ServiceCategoryTile({ name, description, icon, onPress, selected, horizontal }) {
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={description ? `${name}. ${description}` : name} accessibilityState={{ selected: !!selected }}
      onPress={onPress} style={({ pressed }) => [s.tile, horizontal && s.tileRow, selected && s.tileOn, pressed && s.tilePressed]}
    >
      <View style={s.tileIcon}><AppIcon name={icon} size={26} /></View>
      <View style={{ gap: 4, flex: horizontal ? 1 : undefined }}>
        <Text style={s.tileTitle} numberOfLines={3}>{name}</Text>
        {!!description && <Text style={s.tileDesc} numberOfLines={2}>{description}</Text>}
      </View>
      {horizontal && <AppIcon name="chevron-right" size={20} color={colors.muted} />}
    </Pressable>
  );
}

export function ServiceListItem({ title, description, meta, onPress, last }) {
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={[title, description].filter(Boolean).join('. ')} onPress={onPress}
      style={({ pressed }) => [s.item, !last && s.itemLine, pressed && s.itemPressed]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.itemTitle}>{title}</Text>
        {!!description && <Text style={s.itemDesc} numberOfLines={2}>{description}</Text>}
        {!!meta && (typeof meta === 'string' ? <Text style={s.itemMeta}>{meta}</Text> : meta)}
      </View>
      <AppIcon name="chevron-right" size={22} color={colors.muted} />
    </Pressable>
  );
}

// Always a way forward, even when nothing in the catalogue matches.
export function GeneralRequestEntry({ onPress, compact }) {
  return (
    <View style={[s.general, compact && { marginTop: 16, alignSelf: 'stretch' }]}>
      <View style={s.generalIcon}><AppIcon name="edit-3" size={22} color={colors.brassDark} /></View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.generalTitle}>Something else? Tell us what you need.</Text>
        <Text style={s.generalDesc}>Describe the task, and we’ll review your request.</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Make a general request" onPress={onPress} style={({ pressed }) => [s.generalBtn, pressed && { backgroundColor: colors.accentDark }]}>
        <Text style={s.generalBtnText}>Describe it</Text>
      </Pressable>
    </View>
  );
}

export function EmptySearchState({ query, onGeneral }) {
  return (
    <View style={s.empty} accessibilityLiveRegion="polite">
      <View style={s.emptyIcon}><AppIcon name="search" size={26} color={colors.muted} /></View>
      <Text style={s.emptyTitle}>Nothing matches “{query}”</Text>
      <Text style={s.emptyDesc}>Try a different word, or tell us what you need and we’ll review it.</Text>
      <GeneralRequestEntry onPress={onGeneral} compact />
    </View>
  );
}

const s = StyleSheet.create({
  header: { gap: 6 },
  headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 },
  brand: { fontSize: 15, fontWeight: '700', color: colors.accent, letterSpacing: 0.2 },
  back: { flexDirection: 'row', alignItems: 'center', minHeight: 48, marginLeft: -6, gap: 2 },
  backText: { ...typo.body, color: colors.accent, fontWeight: '600' },
  title: { ...typo.h1, color: colors.text },
  subtitle: { ...typo.body, color: colors.muted },
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 54, paddingHorizontal: 16, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  searchInput: { flex: 1, ...typo.body, fontSize: 16, color: colors.text, minHeight: 48, paddingVertical: 0 },
  searchFocus: { borderColor: colors.accent, borderWidth: 2 },
  clear: { minHeight: 48, justifyContent: 'center' },
  clearText: { ...typo.meta, color: colors.accent, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  cell: { width: '48%', flexGrow: 1, flexBasis: '45%' },
  cellFull: { width: '100%' },
  tile: { minHeight: 132, padding: 16, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: 10, justifyContent: 'space-between' },
  tileRow: { minHeight: 88, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', gap: 14, padding: 14 },
  tileOn: { backgroundColor: colors.accentLight, borderColor: colors.accent },
  tilePressed: { backgroundColor: colors.accentLight },
  tileIcon: { width: 48, height: 48, borderRadius: 14, backgroundColor: colors.accentLight, alignItems: 'center', justifyContent: 'center' },
  tileTitle: { ...typo.tile, color: colors.text },
  tileDesc: { ...typo.meta, color: colors.muted },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 15, minHeight: 56, backgroundColor: colors.surface },
  itemLine: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  itemPressed: { backgroundColor: colors.surfaceAlt },
  itemTitle: { ...typo.service, color: colors.text },
  itemDesc: { ...typo.body, color: colors.muted },
  itemMeta: { ...typo.meta, color: colors.brassDark },
  general: { marginTop: 32, padding: 16, borderRadius: radius.lg, backgroundColor: colors.brassLight, gap: 12 },
  generalIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  generalTitle: { ...typo.service, color: colors.text },
  generalDesc: { ...typo.body, color: colors.text },
  generalBtn: { minHeight: 52, borderRadius: 14, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  generalBtnText: { ...typo.button, color: colors.accentText },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 24, alignSelf: 'stretch' },
  emptyIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { ...typo.h2, color: colors.text, textAlign: 'center' },
  emptyDesc: { ...typo.body, color: colors.muted, textAlign: 'center' },
});
