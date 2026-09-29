import React, { useState } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet } from 'react-native';
import { colors, spacing, radius } from '../../theme';
import { Button, FieldLabel } from '../../components/UI';
import { useAuth } from '../../lib/AuthContext';

export default function SignupScreen({ navigation }) {
  const { signUpWithPassword } = useAuth();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState('customer');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit() {
    setError(''); setBusy(true);
    const { error } = await signUpWithPassword({ email: email.trim(), password, fullName: fullName.trim(), phone: phone.trim(), role });
    setBusy(false);
    if (error) setError(error.message);
    else setDone(true);
  }

  if (done) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, padding: spacing.lg, justifyContent: 'center' }}>
        <Text style={{ fontSize: 20, fontWeight: '800', textAlign: 'center', marginBottom: 8, color: colors.text }}>Check your email</Text>
        <Text style={{ color: colors.muted, textAlign: 'center', marginBottom: 20 }}>
          We sent a confirmation link to {email}. Tap it, then come back and log in.
        </Text>
        <Button label="Back to login" onPress={() => navigation.navigate('Login')} />
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, paddingTop: 60 }}>
      <Text style={styles.h1}>Create your account</Text>
      <Text style={styles.sub}>Sign up as a customer or a Personal Manager</Text>

      <View style={{ flexDirection: 'row', gap: 8, marginBottom: spacing.lg }}>
        <Button label="Customer" size="sm" variant={role === 'customer' ? 'primary' : 'ghost'} onPress={() => setRole('customer')} style={{ flex: 1 }} />
        <Button label="Personal Manager" size="sm" variant={role === 'worker' ? 'primary' : 'ghost'} onPress={() => setRole('worker')} style={{ flex: 1 }} />
      </View>

      {role === 'worker' && (
        <Text style={styles.note}>
          After signing up you'll fill in a short application — your skills, service area and a photo of a government ID.
          An admin reviews it, and once you're approved you'll start receiving tasks.
        </Text>
      )}

      <View style={{ gap: spacing.md }}>
        <View>
          <FieldLabel>Full name</FieldLabel>
          <TextInput placeholderTextColor={colors.faint} style={styles.input} placeholder="e.g. Priya Sharma" value={fullName} onChangeText={setFullName} />
        </View>
        <View>
          <FieldLabel>Email</FieldLabel>
          <TextInput placeholderTextColor={colors.faint} style={styles.input} placeholder="you@example.com" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />
        </View>
        <View>
          <FieldLabel>Mobile number</FieldLabel>
          <TextInput placeholderTextColor={colors.faint} style={styles.input} placeholder="e.g. 98200 12345" keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
        </View>
        <View>
          <FieldLabel>Password</FieldLabel>
          <TextInput placeholderTextColor={colors.faint} style={styles.input} placeholder="At least 6 characters" secureTextEntry value={password} onChangeText={setPassword} />
        </View>
        {!!error && <Text style={styles.error}>{error}</Text>}
        <Button label={busy ? 'Creating account…' : 'Create account'} onPress={submit} disabled={busy || !fullName.trim() || !email.trim() || !phone.trim() || password.length < 6} />
        <Button label="Already have an account? Log in" variant="ghost" onPress={() => navigation.navigate('Login')} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  h1: { fontSize: 22, fontWeight: '800', color: colors.text, marginBottom: 4 },
  sub: { color: colors.muted, fontSize: 14.5, marginBottom: spacing.xl },
  input: {
    borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.sm,
    paddingHorizontal: 13, paddingVertical: 11, fontSize: 14.5, color: colors.text, backgroundColor: colors.surface,
  },
  error: { color: colors.danger, fontSize: 13 },
  note: {
    backgroundColor: colors.brassLight, color: colors.brassDark, borderRadius: radius.sm,
    padding: spacing.md, fontSize: 13, lineHeight: 19, marginBottom: spacing.lg,
  },
});
