import React, { useState } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet } from 'react-native';
import { colors, spacing, radius } from '../../theme';
import { Button, FieldLabel } from '../../components/UI';
import { useAuth } from '../../lib/AuthContext';

export default function LoginScreen({ navigation }) {
  const { signInWithPassword, signInWithOtp, verifyOtp } = useAuth();
  const [mode, setMode] = useState('password'); // 'password' | 'otp'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submitPassword() {
    setError(''); setBusy(true);
    const { error } = await signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setError(error.message);
  }

  async function sendOtp() {
    setError(''); setBusy(true);
    const { error } = await signInWithOtp({ email: email.trim() });
    setBusy(false);
    if (error) setError(error.message);
    else setOtpSent(true);
  }

  async function confirmOtp() {
    setError(''); setBusy(true);
    const { error } = await verifyOtp({ email: email.trim(), token: otpCode.trim() });
    setBusy(false);
    if (error) setError(error.message);
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, paddingTop: 60 }}>
      <Text style={styles.h1}>Mr. Todo</Text>
      <Text style={styles.sub}>Log in to your account</Text>

      <View style={{ flexDirection: 'row', gap: 8, marginBottom: spacing.lg }}>
        <Button label="Password" size="sm" variant={mode === 'password' ? 'primary' : 'ghost'} onPress={() => { setMode('password'); setError(''); }} style={{ flex: 1 }} />
        <Button label="Email code" size="sm" variant={mode === 'otp' ? 'primary' : 'ghost'} onPress={() => { setMode('otp'); setError(''); }} style={{ flex: 1 }} />
      </View>

      <View style={{ gap: spacing.md }}>
        <View>
          <FieldLabel>Email</FieldLabel>
          <TextInput style={styles.input} placeholder="you@example.com" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />
        </View>

        {mode === 'password' ? (
          <>
            <View>
              <FieldLabel>Password</FieldLabel>
              <TextInput style={styles.input} placeholder="••••••••" secureTextEntry value={password} onChangeText={setPassword} />
            </View>
            {!!error && <Text style={styles.error}>{error}</Text>}
            <Button label={busy ? 'Logging in…' : 'Log in'} onPress={submitPassword} disabled={busy || !email || !password} />
          </>
        ) : !otpSent ? (
          <>
            {!!error && <Text style={styles.error}>{error}</Text>}
            <Button label={busy ? 'Sending…' : 'Send me a login code'} onPress={sendOtp} disabled={busy || !email} />
          </>
        ) : (
          <>
            <View>
              <FieldLabel>6-digit code (check your email)</FieldLabel>
              <TextInput style={styles.input} placeholder="123456" keyboardType="numeric" value={otpCode} onChangeText={setOtpCode} />
            </View>
            {!!error && <Text style={styles.error}>{error}</Text>}
            <Button label={busy ? 'Verifying…' : 'Confirm code'} onPress={confirmOtp} disabled={busy || !otpCode} />
          </>
        )}

        <Button label="New here? Create an account" variant="ghost" onPress={() => navigation.navigate('Signup')} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  h1: { fontSize: 26, fontWeight: '800', color: colors.accent, marginBottom: 4 },
  sub: { color: colors.muted, fontSize: 14.5, marginBottom: spacing.xl },
  input: {
    borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.sm,
    paddingHorizontal: 13, paddingVertical: 11, fontSize: 14.5, color: colors.text, backgroundColor: colors.surface,
  },
  error: { color: colors.danger, fontSize: 13 },
});
