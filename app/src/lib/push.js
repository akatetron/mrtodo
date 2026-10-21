// Turning on notifications. The phone's permission question is asked only when the
// person taps the button, never at start-up. The token is stored with the
// account through register_push_token; sending happens on the server.
import { Platform } from 'react-native';
import { supabase } from './supabase';

export async function enablePush() {
  if (Platform.OS === 'web') throw new Error('Notifications are for the phone app. Open Mr. Todo on your phone to turn them on.');
  const Notifications = require('expo-notifications');
  const Constants = require('expo-constants').default;
  const perm = await Notifications.getPermissionsAsync();
  let status = perm.status;
  if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') throw new Error('Notifications are switched off for Mr. Todo. You can turn them on in your phone settings.');
  const projectId = Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;
  let token;
  try {
    token = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
  } catch (e) {
    throw new Error('This phone could not get a notification token. Push notifications need the installed app (not Expo Go on Android) and an Expo project id.');
  }
  const { error } = await supabase.rpc('register_push_token', { p_token: token, p_platform: Platform.OS });
  if (error) throw new Error(error.message);
  return true;
}
