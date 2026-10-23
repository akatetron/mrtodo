// Mr. Todo — auth session + profile, available to every screen via useAuth().
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { supabase } from './supabase';
import { resetStore, setStoreUser } from '../data/store';
import { PROFILE_COLUMNS, PROFILE_EXTRA_COLUMNS } from './errors';
import { startNotifications, stopNotifications } from '../data/extras';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined); // undefined = still loading
  const [profile, setProfile] = useState(null);
  const userId = session?.user?.id;

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!userId) return;
    let res = await supabase.from('profiles').select(`${PROFILE_COLUMNS},${PROFILE_EXTRA_COLUMNS}`).eq('id', userId).single();
    if (res.error && /column|does not exist/i.test(res.error.message || '')) res = await supabase.from('profiles').select(PROFILE_COLUMNS).eq('id', userId).single();   // database not updated yet
    setProfile(res.data);
  }, [userId]);

  // Load the profile, and keep it live so a PM sees "approved" the moment an
  // admin approves them. Tasks cached for a previous user are thrown away.
  useEffect(() => {
    resetStore();
    setStoreUser(userId);
    stopNotifications();
    setProfile(null);
    if (!userId) return undefined;
    refreshProfile();
    startNotifications(userId);
    const channel = supabase
      .channel(`profile-${userId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${userId}` },
        (payload) => setProfile(payload.new))
      .subscribe();
    return () => { supabase.removeChannel(channel); stopNotifications(); };
  }, [userId, refreshProfile]);

  async function signUpWithPassword({ email, password, fullName, phone, role }) {
    return supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName, phone, role } },
    });
  }

  async function signInWithPassword({ email, password }) {
    return supabase.auth.signInWithPassword({ email, password });
  }

  async function signInWithOtp({ email }) {
    return supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
  }

  async function verifyOtp({ email, token }) {
    return supabase.auth.verifyOtp({ email, token, type: 'email' });
  }

  async function signOut() {
    return supabase.auth.signOut();
  }

  const value = {
    session,
    user: session?.user || null,
    profile,
    loading: session === undefined,
    refreshProfile,
    signUpWithPassword,
    signInWithPassword,
    signInWithOtp,
    verifyOtp,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
