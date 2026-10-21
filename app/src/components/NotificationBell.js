import React from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { colors } from '../theme';
import AppIcon from './AppIcon';
import { useNotifications } from '../data/extras';

// Bell with an unread count. Renders nothing until the notifications table exists,
// so an app running ahead of the database update looks exactly as it did before.
export default function NotificationBell({ navigation }) {
  const { unread, unavailable, loaded } = useNotifications();
  if (!loaded || unavailable) return null;
  return (
    <Pressable onPress={() => navigation.navigate('Notifications')} style={styles.btn} accessibilityRole="button" accessibilityLabel={unread > 0 ? `Alerts, ${unread} unread` : 'Alerts'}>
      <AppIcon name="bell" size={18} color={colors.accent} />
      <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text }}>Alerts</Text>
      {unread > 0 && (
        <View style={styles.badge}><Text style={styles.badgeText}>{unread > 9 ? '9+' : unread}</Text></View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { flexDirection: 'row', gap: 6, minWidth: 48, height: 48, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute', top: -6, right: -6, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4,
    backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { color: 'white', fontSize: 10.5, fontWeight: '800' },
});
