import React from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { colors } from '../theme';
import { useNotifications } from '../data/extras';

// Bell with an unread count. Renders nothing until the notifications table exists,
// so an app running ahead of the database update looks exactly as it did before.
export default function NotificationBell({ navigation }) {
  const { unread, unavailable, loaded } = useNotifications();
  if (!loaded || unavailable) return null;
  return (
    <Pressable onPress={() => navigation.navigate('Notifications')} style={styles.btn} accessibilityLabel="Notifications">
      <Text style={{ fontSize: 18 }}>🔔</Text>
      {unread > 0 && (
        <View style={styles.badge}><Text style={styles.badgeText}>{unread > 9 ? '9+' : unread}</Text></View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute', top: -2, right: -2, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4,
    backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { color: 'white', fontSize: 10.5, fontWeight: '800' },
});
