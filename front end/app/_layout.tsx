import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { NavigationProp } from '@react-navigation/native';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { SafeAreaView } from 'react-native-safe-area-context';

// Import screens
import AccountsScreen from './AccountsScreen';
import DashboardScreen from './DashboardScreen';
import LoginScreen from './LoginScreen';
import SignupScreen from './SignupScreen';
import ForgotPasswordScreen from './ForgotPasswordScreen';
import Profile from './Profile';
import UploadScreen from './UploadScreen';
import ScheduleScreen from './ScheduleScreen';

// Import types and services
import StorageService from '../utils/storage';

// Define navigation param list for typing
type RootStackParamList = {
  Login: undefined;
  Signup: undefined;
  ForgotPassword: undefined;
  Main: undefined;
};

const Stack = createStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator();

// Main tabs
const MainTabs = () => (
  <Tab.Navigator
    screenOptions={{
      tabBarActiveTintColor: '#1C2526',
      tabBarInactiveTintColor: '#6B7280',
      tabBarStyle: {
        backgroundColor: '#fff',
        borderTopWidth: 1,
        borderTopColor: '#eee',
      },
    }}
  >
    <Tab.Screen
      name="Dashboard"
      component={DashboardScreen}
      options={{
        tabBarLabel: 'Dashboard',
        tabBarIcon: ({ color, size }) => <Ionicons name="stats-chart" size={size} color={color} />,
        headerTitle: 'Dashboard',
      }}
    />
    <Tab.Screen
      name="Accounts"
      component={AccountsScreen}
      options={{
        tabBarLabel: 'Accounts',
        tabBarIcon: ({ color, size }) => <Ionicons name="people" size={size} color={color} />,
        headerTitle: 'Social Media Accounts',
      }}
    />
    <Tab.Screen
      name="Schedule"
      component={ScheduleScreen}
      options={{
        tabBarLabel: 'Schedule',
        tabBarIcon: ({ color, size }) => <Ionicons name="calendar" size={size} color={color} />,
        headerTitle: 'Schedule Posts',
      }}
    />
    <Tab.Screen
      name="Upload"
      component={UploadScreen}
      options={{
        tabBarLabel: 'Upload',
        tabBarIcon: ({ color, size }) => <Ionicons name="cloud-upload" size={size} color={color} />,
        headerTitle: 'Upload Media',
      }}
    />
    <Tab.Screen
      name="Profile"
      component={Profile}
      options={{
        tabBarLabel: 'Profile',
        tabBarIcon: ({ color, size }) => <Ionicons name="person" size={size} color={color} />,
        headerTitle: 'Profile',
      }}
    />
  </Tab.Navigator>
);

export default function Layout() {
  const [isLoading, setIsLoading] = useState(true);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    checkAuthStatus();
  }, []);

  const checkAuthStatus = async () => {
    try {
      const loggedIn = await StorageService.isLoggedIn();
      setIsLoggedIn(loggedIn);
    } catch (error) {
      console.error('Error checking auth status:', error);
      setIsLoggedIn(false);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#1C2526" />
        <Text style={styles.loadingText}>Loading...</Text>
      </SafeAreaView>
    );
  }

  return (
    <Stack.Navigator
      initialRouteName={isLoggedIn ? 'Main' : 'Login'}
      screenOptions={{ headerShown: false }}
    >
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="Signup" component={SignupScreen} />
      <Stack.Screen
        name="ForgotPassword"
        component={ForgotPasswordScreen}
        options={{
          headerShown: true,
          title: 'Reset Password',
          headerStyle: {
            backgroundColor: '#03021eff',
          },
          headerTintColor: '#fff',
          headerTitleStyle: {
            fontWeight: 'bold',
          },
        }}
      />
      <Stack.Screen name="Main" component={MainTabs} />
    </Stack.Navigator>
  );
}

// Define specific types for styles
interface Styles {
  loadingContainer: import('react-native').ViewStyle;
  loadingText: import('react-native').TextStyle;
}

const styles: Styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#6B7280',
  },
});