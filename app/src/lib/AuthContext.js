// Mr. Todo — auth session + profile, available to every screen via useAuth().
import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from './supabase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined); // undefined = still loading
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user) { setProfile(null); return; }
    supabase.from('profiles').select('*').eq('id', session.user.id).single()
      .then(({ data }) => setProfile(data));
  }, [session?.user?.id]);

  async function signUpWithPassword({ email, password, fullName, role }) {
    return supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName, role } },
    });
  }

  async function signInWithPassword({ email, password }) {
    return supabase.auth.signInWithPassword({ email, password });
  }

  async function signInWithOtp({ email }) {
    return supabase.auth.signInWithOtp({ email });
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
