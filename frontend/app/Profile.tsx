import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Switch,
  Image,
} from 'react-native';
import ApiService from '../services/api';
import StorageService from '../utils/storage';
import { User, InstagramAccount, TelegramAccount } from '../types';

const Profile: React.FC<{ navigation: any }> = ({ navigation }) => {
  const [user, setUser] = useState<User | null>(null);
  const [instagramAccounts, setInstagramAccounts] = useState<InstagramAccount[]>([]);
  const [telegramAccounts, setTelegramAccounts] = useState<TelegramAccount[]>([]);
  const [darkMode, setDarkMode] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);

  useEffect(() => {
    loadProfileData();
  }, []);

  const loadProfileData = async () => {
    try {
      const userData = await StorageService.getUserData();
      if (!userData?.Id) {
        Alert.alert('Error', 'User not logged in. Please log in again.');
        return;
      }
      const response = await ApiService.getUser(userData.Id);
      setUser(response.user);
      setInstagramAccounts(response.instagram_accounts || []);
      setTelegramAccounts(response.telegram_channels || []);
    } catch (error: any) {
      Alert.alert('Error', 'Failed to load profile data. Check server or network.');
      console.error('Load profile error:', error); // Debug log
    }
  };

  const handleLogout = async () => {
    Alert.alert(
      'Confirm Logout',
      'Are you sure you want to log out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: async () => {
            try {
              await StorageService.removeUserData(); // Updated to removeUserData
              await StorageService.removeAuthToken(); // Clear auth token as well
              // Reset navigation to Login screen
              navigation.reset({
                index: 0,
                routes: [{ name: 'Login' }],
              });
            } catch (error) {
              Alert.alert('Error', 'Failed to log out. Try again.');
              console.error('Logout error:', error); // Debug log
            }
          },
        },
      ]
    );
  };

  const toggleDarkMode = () => setDarkMode((prev) => !prev);
  const toggleNotifications = () => setNotificationsEnabled((prev) => !prev);

  return (
    <ScrollView style={[styles.container, darkMode && styles.darkContainer]}>
      {/* Header Section */}
      <View style={[styles.header, darkMode && styles.darkHeader]}>
        <Image
          style={styles.avatar}
          source={{ uri: 'https://via.placeholder.com/120' }} // Updated size
        />
        <Text style={[styles.name, darkMode && styles.darkText]}>
          {user?.Name || 'User'}
        </Text>
        <Text style={[styles.email, darkMode && styles.darkText]}>
          {user?.email || 'email@example.com'}
        </Text>
      </View>

      {/* Linked Accounts Section */}
      <View style={[styles.section, darkMode && styles.darkSection]}>
        <Text style={[styles.sectionTitle, darkMode && styles.darkText]}>
          Linked Accounts
        </Text>
        {[...instagramAccounts, ...telegramAccounts].length === 0 ? (
          <Text style={[styles.noAccounts, darkMode && styles.darkText]}>
            No accounts linked yet
          </Text>
        ) : (
          <View style={styles.accountsList}>
            {instagramAccounts.map((account) => {
              const now = new Date('2025-08-13T03:29:00+05:30'); // Updated to current time
              const [endHours, endMinutes, endSeconds] = account.sch_end_range.split(':').map(Number);
              const endTime = new Date(now);
              endTime.setHours(endHours, endMinutes, endSeconds, 0);
              const isInactive = account.selected === 'No' || now > endTime;
              return (
                <View key={account.id} style={[styles.accountItem, darkMode && styles.darkAccountItem]}>
                  <Text style={[styles.accountText, darkMode && styles.darkText]}>
                    Instagram: {account.username} ({isInactive ? 'Inactive' : 'Active'})
                  </Text>
                </View>
              );
            })}
            {telegramAccounts.map((account) => {
              const now = new Date('2025-08-13T03:29:00+05:30'); // Updated to current time
              const [endHours, endMinutes, endSeconds] = account.sch_end_range.split(':').map(Number);
              const endTime = new Date(now);
              endTime.setHours(endHours, endMinutes, endSeconds, 0);
              const isInactive = account.selected === 'No' || now > endTime;
              return (
                <View key={account.id} style={[styles.accountItem, darkMode && styles.darkAccountItem]}>
                  <Text style={[styles.accountText, darkMode && styles.darkText]}>
                    Telegram: {account.channel_name} ({isInactive ? 'Inactive' : 'Active'})
                  </Text>
                </View>
              );
            })}
          </View>
        )}
      </View>

      {/* Settings Section */}
      <View style={[styles.section, darkMode && styles.darkSection]}>
        <Text style={[styles.sectionTitle, darkMode && styles.darkText]}>Settings</Text>
        <View style={[styles.settingItem, darkMode && styles.darkSettingItem]}>
          <Text style={[styles.settingText, darkMode && styles.darkText]}>Dark Mode</Text>
          <Switch
            onValueChange={toggleDarkMode}
            value={darkMode}
            trackColor={{ false: '#ccc', true: '#007AFF' }}
            thumbColor={darkMode ? '#FFD700' : '#fff'}
          />
        </View>
        <View style={[styles.settingItem, darkMode && styles.darkSettingItem]}>
          <Text style={[styles.settingText, darkMode && styles.darkText]}>Notifications</Text>
          <Switch
            onValueChange={toggleNotifications}
            value={notificationsEnabled}
            trackColor={{ false: '#ccc', true: '#007AFF' }}
            thumbColor={notificationsEnabled ? '#FFD700' : '#fff'}
          />
        </View>
        <TouchableOpacity
          style={[styles.changePasswordButton, darkMode && styles.darkChangePasswordButton]}
          onPress={() => Alert.alert('Feature', 'Password change coming soon!')}
        >
          <Text style={[styles.changePasswordText, darkMode && styles.darkChangePasswordText]}>
            Change Password
          </Text>
        </TouchableOpacity>
      </View>

      {/* Logout Button */}
      <TouchableOpacity style={[styles.logoutButton, darkMode && styles.darkLogoutButton]} onPress={handleLogout}>
        <Text style={[styles.logoutText, darkMode && styles.darkLogoutText]}>Logout</Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#b4c5d8', // Updated to the requested background color
  },
  darkContainer: {
    backgroundColor: '#1a1a2e',
  },
  header: {
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#ddd',
    marginBottom: 20,
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  darkHeader: {
    backgroundColor: '#2c2c3e',
    borderBottomColor: '#444',
  },
  avatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    marginBottom: 15,
    borderWidth: 2,
    borderColor: '#007AFF',
  },
  name: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#333',
  },
  email: {
    fontSize: 18,
    color: '#666',
    marginBottom: 10,
  },
  section: {
    padding: 15,
    backgroundColor: '#fff',
    marginBottom: 15,
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  darkSection: {
    backgroundColor: '#2c2c3e',
    shadowColor: '#000',
    shadowOpacity: 0.2,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#333',
    marginBottom: 15,
  },
  noAccounts: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    padding: 10,
  },
  accountsList: {
    marginBottom: 10,
  },
  accountItem: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    backgroundColor: '#f9f9f9',
    borderRadius: 8,
    marginBottom: 5,
  },
  darkAccountItem: {
    borderBottomColor: '#444',
    backgroundColor: '#3a3a50',
  },
  accountText: {
    fontSize: 16,
    color: '#333',
  },
  settingItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  darkSettingItem: {
    borderBottomColor: '#444',
  },
  settingText: {
    fontSize: 18,
    color: '#333',
  },
  changePasswordButton: {
    paddingVertical: 12,
    backgroundColor: '#007AFF',
    borderRadius: 8,
    marginTop: 15,
    alignItems: 'center',
  },
  darkChangePasswordButton: {
    backgroundColor: '#0056b3',
  },
  changePasswordText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '500',
  },
  darkChangePasswordText: {
    color: '#e0e0e0',
  },
  logoutButton: {
    paddingVertical: 15,
    backgroundColor: '#FF3B30',
    borderRadius: 8,
    margin: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 5,
  },
  darkLogoutButton: {
    backgroundColor: '#cc0000',
  },
  logoutText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  darkLogoutText: {
    color: '#fff',
  },
  darkText: {
    color: '#e0e0e0',
  },
});

export default Profile;