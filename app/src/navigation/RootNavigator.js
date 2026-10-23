import React, { useEffect, useState } from 'react';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
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
import NotificationsScreen from '../screens/NotificationsScreen';
import ReportProblemScreen from '../screens/ReportProblemScreen';
import AdminMoreScreen from '../screens/admin/AdminMoreScreen';
import AdminApplicationsScreen from '../screens/admin/AdminApplicationsScreen';
import AdminApplicantScreen from '../screens/admin/AdminApplicantScreen';
import AdminPeopleScreen from '../screens/admin/AdminPeopleScreen';
import AdminPersonScreen from '../screens/admin/AdminPersonScreen';
import AdminReportsScreen from '../screens/admin/AdminReportsScreen';
import AdminReviewsScreen from '../screens/admin/AdminReviewsScreen';
import AdminMoneyScreen from '../screens/admin/AdminMoneyScreen';
import AdminInsightsScreen from '../screens/admin/AdminInsightsScreen';
import AdminBroadcastScreen from '../screens/admin/AdminBroadcastScreen';
import AdminTeamScreen from '../screens/admin/AdminTeamScreen';
import AdminCatalogueScreen from '../screens/admin/AdminCatalogueScreen';
import AdminStandardsScreen from '../screens/admin/AdminStandardsScreen';
import PmSkillsScreen from '../screens/PmSkillsScreen';
import TodoPlusScreen from '../screens/TodoPlusScreen';
import CategoryScreen from '../screens/CategoryScreen';
import BookingScreen from '../screens/BookingScreen';
import AdminEscalationsScreen from '../screens/admin/AdminEscalationsScreen';
import AdminPlansScreen from '../screens/admin/AdminPlansScreen';
import MyTasksScreen from '../screens/MyTasksScreen';
import PmAvailabilityScreen from '../screens/PmAvailabilityScreen';
import CustomerTabBar from '../components/CustomerTabBar';
import AdminOpsScreen from '../screens/admin/AdminOpsScreen';

const navRef = createNavigationContainerRef();
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
      <CustomerStack.Screen name="Home" component={HomeScreen} options={{ headerShown: false }} />
      <CustomerStack.Screen name="MyTasks" component={MyTasksScreen} options={{ headerShown: false }} />
      <CustomerStack.Screen name="ServiceCategory" component={CategoryScreen} options={{ headerShown: false }} />
      <CustomerStack.Screen name="Booking" component={BookingScreen} options={{ headerShown: false }} />
      <CustomerStack.Screen name="TrackTask" component={TrackTaskScreen} options={{ title: 'Track task' }} />
      <CustomerStack.Screen name="TodoPlus" component={TodoPlusScreen} options={{ title: 'Todo+' }} />
      <CustomerStack.Screen name="Account" component={AccountScreen} options={{ title: 'Your account' }} />
      <CustomerStack.Screen name="Notifications" component={NotificationsScreen} options={{ title: 'Notifications' }} />
      <CustomerStack.Screen name="ReportProblem" component={ReportProblemScreen} options={{ title: 'Report a problem' }} />
    </CustomerStack.Navigator>
  );
}

function WorkerNavigator() {
  return (
    <WorkerStack.Navigator screenOptions={screenOptions}>
      <WorkerStack.Screen name="WorkerHome" component={WorkerHomeScreen} options={{ title: 'Personal Manager' }} />
      <WorkerStack.Screen name="WorkerJob" component={WorkerJobScreen} options={{ title: 'Task details' }} />
      <WorkerStack.Screen name="Account" component={AccountScreen} options={{ title: 'Your account' }} />
      <WorkerStack.Screen name="Availability" component={PmAvailabilityScreen} options={{ title: 'Availability' }} />
      <WorkerStack.Screen name="Skills" component={PmSkillsScreen} options={{ title: 'Your skills' }} />
      <WorkerStack.Screen name="Notifications" component={NotificationsScreen} options={{ title: 'Notifications' }} />
      <WorkerStack.Screen name="ReportProblem" component={ReportProblemScreen} options={{ title: 'Report a problem' }} />
    </WorkerStack.Navigator>
  );
}

function AdminNavigator() {
  return (
    <AdminStack.Navigator screenOptions={screenOptions}>
      <AdminStack.Screen name="AdminHome" component={AdminHomeScreen} options={{ title: 'Mr. Todo Admin' }} />
      <AdminStack.Screen name="AdminTask" component={AdminTaskScreen} options={{ title: 'Task' }} />
      <AdminStack.Screen name="Account" component={AccountScreen} options={{ title: 'Your account' }} />
      <AdminStack.Screen name="Notifications" component={NotificationsScreen} options={{ title: 'Notifications' }} />
      <AdminStack.Screen name="AdminMore" component={AdminMoreScreen} options={{ title: 'Admin tools' }} />
      <AdminStack.Screen name="AdminApplications" component={AdminApplicationsScreen} options={{ title: 'Applications' }} />
      <AdminStack.Screen name="AdminApplicant" component={AdminApplicantScreen} options={{ title: 'Applicant' }} />
      <AdminStack.Screen name="AdminPeople" component={AdminPeopleScreen} options={{ title: 'People' }} />
      <AdminStack.Screen name="AdminPerson" component={AdminPersonScreen} options={{ title: 'Profile' }} />
      <AdminStack.Screen name="AdminReports" component={AdminReportsScreen} options={{ title: 'Reports' }} />
      <AdminStack.Screen name="AdminReviews" component={AdminReviewsScreen} options={{ title: 'Reviews' }} />
      <AdminStack.Screen name="AdminMoney" component={AdminMoneyScreen} options={{ title: 'Money' }} />
      <AdminStack.Screen name="AdminInsights" component={AdminInsightsScreen} options={{ title: 'Insights' }} />
      <AdminStack.Screen name="AdminBroadcast" component={AdminBroadcastScreen} options={{ title: 'Broadcast' }} />
      <AdminStack.Screen name="AdminEscalations" component={AdminEscalationsScreen} options={{ title: 'Escalations' }} />
      <AdminStack.Screen name="AdminPlans" component={AdminPlansScreen} options={{ title: 'Todo+ plans' }} />
      <AdminStack.Screen name="AdminOps" component={AdminOpsScreen} options={{ title: 'Operations' }} />
      <AdminStack.Screen name="AdminStandards" component={AdminStandardsScreen} options={{ title: 'Standards and specialists' }} />
      <AdminStack.Screen name="AdminCatalogue" component={AdminCatalogueScreen} options={{ title: 'Service catalogue' }} />
      <AdminStack.Screen name="AdminTeam" component={AdminTeamScreen} options={{ title: 'Admin team' }} />
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
  const [previewRole, setPreviewRole] = useState(null);
  const [route, setRoute] = useState('Home'); // lets an admin peek at either view

  // The "view as" choice belongs to one sign-in. Without this it outlived the
  // session, so signing in as a customer after an admin picked "PM view" showed
  // the Personal Manager app.
  useEffect(() => { setPreviewRole(null); }, [user?.id]);
  useEffect(() => { setRoute('Home'); }, [user?.id, previewRole]);

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

  // Only admins can view as another role; everyone else gets exactly their own.
  const role = profile.role === 'admin' ? (previewRole || 'admin') : profile.role;

  return (
    <NavigationContainer ref={navRef} onStateChange={() => setRoute(navRef.getCurrentRoute()?.name || 'Home')}>
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        {role === 'admin' ? <AdminNavigator key="admin" /> : role === 'worker' ? <WorkerNavigator key="worker" /> : <CustomerNavigator key="customer" />}
        {role === 'customer' && route !== 'Booking' && (
          <CustomerTabBar current={route} onGo={(n) => navRef.isReady() && navRef.resetRoot({ index: 0, routes: [{ name: n }] })} extraBottom={profile.role === 'admin'} />
        )}
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
