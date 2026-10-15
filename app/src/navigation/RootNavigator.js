import React, { useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { View, Pressable, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { colors } from '../theme';
import { useAuth } from '../lib/AuthContext';

import LoginScreen from '../screens/auth/LoginScreen';
import SignupScreen from '../screens/auth/SignupScreen';
import HomeScreen from '../screens/HomeScreen';
import TrackTaskScreen from '../screens/TrackTaskScreen';
import WorkerHomeScreen from '../screens/WorkerHomeScreen';
import WorkerJobScreen from '../screens/WorkerJobScreen';
import PmApplicationScreen from '../screens/PmApplicationScreen';
import AccountScreen from '../screens/AccountScreen';
import AdminHomeScreen from '../screens/admin/AdminHomeScreen';
import AdminTaskScreen from '../screens/admin/AdminTaskScreen';

const AuthStack = createNativeStackNavigator();
const CustomerStack = createNativeStackNavigator();
const WorkerStack = createNativeStackNavigator();
const ApplyStack = createNativeStackNavigator();
const AdminStack = createNativeStackNavigator();

const screenOptions = {
  headerStyle: { backgroundColor: colors.surface },
  headerTitleStyle: { color: colors.text, fontWeight: '800' },
  headerTintColor: colors.accent,
  headerShadowVisible: false,
  contentStyle: { backgroundColor: colors.bg },
};

function AuthNavigator() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Login" component={LoginScreen} />
      <AuthStack.Screen name="Signup" component={SignupScreen} />
    </AuthStack.Navigator>
  );
}

function CustomerNavigator() {
  return (
    <CustomerStack.Navigator screenOptions={screenOptions}>
      <CustomerStack.Screen name="Home" component={HomeScreen} options={{ title: 'Mr. Todo' }} />
      <CustomerStack.Screen name="TrackTask" component={TrackTaskScreen} options={{ title: 'Track task' }} />
      <CustomerStack.Screen name="Account" component={AccountScreen} options={{ title: 'Your account' }} />
    </CustomerStack.Navigator>
  );
}

function WorkerNavigator() {
  return (
    <WorkerStack.Navigator screenOptions={screenOptions}>
      <WorkerStack.Screen name="WorkerHome" component={WorkerHomeScreen} options={{ title: 'Personal Manager' }} />
      <WorkerStack.Screen name="WorkerJob" component={WorkerJobScreen} options={{ title: 'Task details' }} />
      <WorkerStack.Screen name="Account" component={AccountScreen} options={{ title: 'Your account' }} />
    </WorkerStack.Navigator>
  );
}

function AdminNavigator() {
  return (
    <AdminStack.Navigator screenOptions={screenOptions}>
      <AdminStack.Screen name="AdminHome" component={AdminHomeScreen} options={{ title: 'Mr. Todo Admin' }} />
      <AdminStack.Screen name="AdminTask" component={AdminTaskScreen} options={{ title: 'Task' }} />
      <AdminStack.Screen name="Account" component={AccountScreen} options={{ title: 'Your account' }} />
    </AdminStack.Navigator>
  );
}

// Personal Managers who aren't approved yet only see their application.
function ApplyNavigator() {
  return (
    <ApplyStack.Navigator screenOptions={screenOptions}>
      <ApplyStack.Screen name="Apply" component={PmApplicationScreen} options={{ title: 'Become a Personal Manager' }} />
    </ApplyStack.Navigator>
  );
}

export default function RootNavigator() {
  const { loading, user, profile } = useAuth();
  const [previewRole, setPreviewRole] = useState(null); // lets an admin peek at either view

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (!user) {
    return (
      <NavigationContainer>
        <AuthNavigator />
      </NavigationContainer>
    );
  }

  // Profile row is created by a DB trigger right after signup; on the very
  // first render after signing in it may not have arrived yet.
  if (!profile) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (profile.role === 'worker' && profile.worker_status !== 'approved') {
    return (
      <NavigationContainer>
        <ApplyNavigator />
      </NavigationContainer>
    );
  }

  const role = previewRole || profile.role;

  return (
    <NavigationContainer>
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        {role === 'admin' ? <AdminNavigator key="admin" /> : role === 'worker' ? <WorkerNavigator key="worker" /> : <CustomerNavigator key="customer" />}
        {profile.role === 'admin' && (
          <View style={styles.switcher}>
            <Pressable onPress={() => setPreviewRole('admin')} style={[styles.switchBtn, role === 'admin' && styles.switchBtnActive]}>
              <Text style={[styles.switchText, role === 'admin' && styles.switchTextActive]}>🛠 Admin</Text>
            </Pressable>
            <Pressable onPress={() => setPreviewRole('customer')} style={[styles.switchBtn, role === 'customer' && styles.switchBtnActive]}>
              <Text style={[styles.switchText, role === 'customer' && styles.switchTextActive]}>👤 Customer view</Text>
            </Pressable>
            <Pressable onPress={() => setPreviewRole('worker')} style={[styles.switchBtn, role === 'worker' && styles.switchBtnActive]}>
              <Text style={[styles.switchText, role === 'worker' && styles.switchTextActive]}>🧑‍💼 PM view</Text>
            </Pressable>
          </View>
        )}
      </View>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  switcher: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface, paddingBottom: 6 },
  switchBtn: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  switchBtnActive: { borderTopWidth: 2, borderTopColor: colors.accent, marginTop: -1 },
  switchText: { fontSize: 12.5, fontWeight: '700', color: colors.muted },
  switchTextActive: { color: colors.accent },
});
