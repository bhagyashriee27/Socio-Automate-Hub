import AsyncStorage from '@react-native-async-storage/async-storage';
import { User } from '../types';

export class StorageService {
  // Auth Token
  static async setAuthToken(token: string): Promise<void> {
    try {
      await AsyncStorage.setItem('authToken', token);
    } catch (error) {
      console.error('Error saving auth token:', error);
    }
  }

  static async getAuthToken(): Promise<string | null> {
    try {
      return await AsyncStorage.getItem('authToken');
    } catch (error) {
      console.error('Error getting auth token:', error);
      return null;
    }
  }

  static async removeAuthToken(): Promise<void> {
    try {
      await AsyncStorage.removeItem('authToken');
    } catch (error) {
      console.error('Error removing auth token:', error);
    }
  }

  // User Data
  static async setUserData(user: User): Promise<void> {
    try {
      await AsyncStorage.setItem('userData', JSON.stringify(user));
    } catch (error) {
      console.error('Error saving user data:', error);
    }
  }

  static async getUserData(): Promise<User | null> {
    try {
      const userData = await AsyncStorage.getItem('userData');
      return userData ? JSON.parse(userData) : null;
    } catch (error) {
      console.error('Error getting user data:', error);
      return null;
    }
  }

  static async removeUserData(): Promise<void> {
    try {
      await AsyncStorage.removeItem('userData');
    } catch (error) {
      console.error('Error removing user data:', error);
    }
  }

  // App Settings
  static async setAppSettings(settings: any): Promise<void> {
    try {
      await AsyncStorage.setItem('appSettings', JSON.stringify(settings));
    } catch (error) {
      console.error('Error saving app settings:', error);
    }
  }

  static async getAppSettings(): Promise<any> {
    try {
      const settings = await AsyncStorage.getItem('appSettings');
      return settings ? JSON.parse(settings) : {};
    } catch (error) {
      console.error('Error getting app settings:', error);
      return {};
    }
  }

  // Clear All Data
  static async clearAllData(): Promise<void> {
    try {
      await AsyncStorage.clear();
    } catch (error) {
      console.error('Error clearing all data:', error);
    }
  }

  // Check if user is logged in
  static async isLoggedIn(): Promise<boolean> {
    try {
      const token = await AsyncStorage.getItem('authToken');
      const userData = await AsyncStorage.getItem('userData');
      return !!(token && userData);
    } catch (error) {
      console.error('Error checking login status:', error);
      return false;
    }
  }

  // Added getUserId method
  static async getUserId(): Promise<number | null> {
    try {
      const userData = await this.getUserData();
      return userData ? userData.Id : null;
    } catch (error) {
      console.error('Error getting user ID:', error);
      return null;
    }
  }
}

export default StorageService;