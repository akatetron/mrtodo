// Home, My tasks and Account, one tap from anywhere in the customer app.
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, typo } from '../theme';
import AppIcon from './AppIcon';

const TABS = [
  { name: 'Home', label: 'Home', icon: 'home' },
  { name: 'MyTasks', label: 'My tasks', icon: 'list' },
  { name: 'Account', label: 'Account', icon: 'user' },
];

export default function CustomerTabBar({ current, onGo, extraBottom = false }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.bar, { paddingBottom: extraBottom ? 0 : Math.max(insets.bottom, 6) }]} accessibilityRole="tablist">
      {TABS.map((t) => {
        const on = current === t.name;
        return (
          <Pressable key={t.name} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={t.label} onPress={() => onGo(t.name)} style={s.tab}>
            <AppIcon name={t.icon} size={22} color={on ? colors.accent : colors.muted} />
            <Text style={[s.label, on && s.labelOn]}>{t.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  bar: { flexDirection: 'row', backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  tab: { flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center', gap: 2 },
  label: { ...typo.meta, color: colors.muted, fontWeight: '600' },
  labelOn: { color: colors.accent, fontWeight: '800' },
});
