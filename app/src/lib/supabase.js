// Mr. Todo — Supabase client.
//
// Fill in your project's URL and anon key below (Supabase dashboard →
// Project Settings → API). These two values are safe to ship inside the app —
// the anon key only grants what your Row Level Security policies allow.
import 'react-native-url-polyfill/auto';
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
