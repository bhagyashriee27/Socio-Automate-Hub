import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { NavigationProp, useNavigation } from '@react-navigation/native';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';

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
  FrontPage: undefined;
  Login: undefined;
  Signup: undefined;
  ForgotPassword: undefined;
  Main: undefined;
};

const Stack = createStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator();

// FrontPage without animation
const FrontPage = () => {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();

  const handleLogoClick = () => {
    navigation.navigate('Login');
  };

  return (
    <View style={styles.container}>
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <TouchableOpacity onPress={handleLogoClick}>
          <Text style={styles.logo}>SocioMate</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

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
      headerTitle: ({ children }) => (
        <Text style={styles.headerTitle}>{children}</Text>
      ),
    }}
  >
    <Tab.Screen
      name="Dashboard"
      component={DashboardScreen}
      options={{
        tabBarLabel: ({ focused }) => (
          <Text style={[styles.tabBarLabel, { color: focused ? '#1C2526' : '#6B7280' }]}>
            Dashboard
          </Text>
        ),
        tabBarIcon: ({ color, size }) => <Ionicons name="stats-chart" size={size} color={color} />,
      }}
    />
    <Tab.Screen
      name="Accounts"
      component={AccountsScreen}
      options={{
        tabBarLabel: ({ focused }) => (
          <Text style={[styles.tabBarLabel, { color: focused ? '#1C2526' : '#6B7280' }]}>
            Accounts
          </Text>
        ),
        tabBarIcon: ({ color, size }) => <Ionicons name="people" size={size} color={color} />,
      }}
    />
    <Tab.Screen
      name="Schedule"
      component={ScheduleScreen}
      options={{
        tabBarLabel: ({ focused }) => (
          <Text style={[styles.tabBarLabel, { color: focused ? '#1C2526' : '#6B7280' }]}>
            Schedule
          </Text>
        ),
        tabBarIcon: ({ color, size }) => <Ionicons name="calendar" size={size} color={color} />,
      }}
    />
    <Tab.Screen
      name="Upload"
      component={UploadScreen}
      options={{
        tabBarLabel: ({ focused }) => (
          <Text style={[styles.tabBarLabel, { color: focused ? '#1C2526' : '#6B7280' }]}>
            Upload
          </Text>
        ),
        tabBarIcon: ({ color, size }) => <Ionicons name="cloud-upload" size={size} color={color} />,
      }}
    />
    <Tab.Screen
      name="Profile"
      component={Profile}
      options={{
        tabBarLabel: ({ focused }) => (
          <Text style={[styles.tabBarLabel, { color: focused ? '#1C2526' : '#6B7280' }]}>
            Profile
          </Text>
        ),
        tabBarIcon: ({ color, size }) => <Ionicons name="person" size={size} color={color} />,
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
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#1C2526" />
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  return (
    <Stack.Navigator
      initialRouteName={isLoggedIn ? 'Main' : 'FrontPage'}
      screenOptions={{ headerShown: false }}
    >
      <Stack.Screen name="FrontPage" component={FrontPage} />
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="Signup" component={SignupScreen} />
      <Stack.Screen
        name="ForgotPassword"
        component={ForgotPasswordScreen}
        options={{
          headerShown: true,
          headerTitle: () => (
            <Text style={styles.headerTitle}>Reset Password</Text>
          ),
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

const styles = StyleSheet.create({
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
  container: {
    flex: 1,
    backgroundColor: '#4B0082',
    justifyContent: 'center',
    alignItems: 'center',
  },
  logo: {
    fontSize: 50,
    fontWeight: 'bold',
    color: '#fff',
    textAlign: 'center',
  },
  tabBarLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1C2526',
  },
});