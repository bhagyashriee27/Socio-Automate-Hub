import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { NavigationProp, useNavigation } from '@react-navigation/native';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

// Import screens
import AccountsScreen from './AccountsScreen';
import DashboardScreen from './DashboardScreen';
import LoginScreen from './LoginScreen';
import SignupScreen from './SignupScreen';
import ForgotPasswordScreen from './ForgotPasswordScreen'; // Add this import
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
  ForgotPassword: undefined; // Add this
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
      tabBarActiveTintColor: '#007AFF',
      tabBarInactiveTintColor: '#666',
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
        tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>📊</Text>,
        headerTitle: 'Dashboard',
      }}
    />
    <Tab.Screen
      name="Accounts"
      component={AccountsScreen}
      options={{
        tabBarLabel: 'Accounts',
        tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>👥</Text>,
        headerTitle: 'Social Media Accounts',
      }}
    />
    <Tab.Screen
      name="Schedule"
      component={ScheduleScreen}
      options={{
        tabBarLabel: 'Schedule',
        tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>📅</Text>,
        headerTitle: 'Schedule Posts',
      }}
    />
    <Tab.Screen
      name="Upload"
      component={UploadScreen}
      options={{
        tabBarLabel: 'Upload',
        tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>📤</Text>,
        headerTitle: 'Upload Media',
      }}
    />
    <Tab.Screen
      name="Profile"
      component={Profile}
      options={{
        tabBarLabel: 'Profile',
        tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>👤</Text>,
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
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
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
    color: '#666',
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
});