// Mr. Todo — Supabase client.
//
// Fill in your project's URL and anon key below (Supabase dashboard →
// Project Settings → API). These two values are safe to ship inside the app —
// the anon key only grants what your Row Level Security policies allow.
// No URL polyfill here on purpose. Older Supabase + React Native setups added
// react-native-url-polyfill, but that package has been unmaintained since 2021
// and its URL throws on a plain https address under current React Native —
// Supabase then rejects its own project URL as "malformed" and the app dies on
// the first screen. React Native 0.81 and browsers both provide a URL that
// Supabase is happy with, so the right move is to use theirs.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

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
