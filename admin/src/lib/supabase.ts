// Same Supabase project as the mobile app (app/src/lib/supabase.js) unless
// overridden with VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in admin/.env.
// The publishable key is safe in a browser: the database's row-level security
// and the admin-only checks in supabase/schema.sql decide what anyone can do.
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://fnacuxmpygrotjqwmpwj.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_xba6wA7m8OAUrOZDojfLIg_1FOAfxAM';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
