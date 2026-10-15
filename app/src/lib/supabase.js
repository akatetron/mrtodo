// Mr. Todo — Supabase client.
//
// Fill in your project's URL and anon key below (Supabase dashboard →
// Project Settings → API). These two values are safe to ship inside the app —
// the anon key only grants what your Row Level Security policies allow.
// Supabase builds URLs internally, so iOS and Android need a complete URL
// implementation. This is what "react-native-url-polyfill/auto" does; it is
// spelled out here because some bundlers (Expo Snack among them) cannot
// resolve that subpath. The web guard matters: browsers already have a proper
// URL, and replacing it breaks Supabase's own URL validation.
import { Platform } from 'react-native';
import { setupURLPolyfill } from 'react-native-url-polyfill';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

if (Platform.OS !== 'web') {
  setupURLPolyfill();
}

const SUPABASE_URL = 'https://fnacuxmpygrotjqwmpwj.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_xba6wA7m8OAUrOZDojfLIg_1FOAfxAM';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
