import axios, { AxiosResponse } from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  User,
  LoginRequest,
  SignupRequest,
  AuthResponse,
  InstagramAccount,
  TelegramAccount,
  ApiResponse,
} from '../types';

// Base URL for your Flask API - Update this to your server URL
const BASE_URL = 'https://monitor-renewing-oarfish.ngrok-free.app'; // Change this to your actual server URL

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add request interceptor to include auth token
api.interceptors.request.use(
  async (config) => {
    const token = await AsyncStorage.getItem('authToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Add response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      // Token expired or invalid, clear storage and redirect to login
      await AsyncStorage.removeItem('authToken');
      await AsyncStorage.removeItem('userData');
    }
    return Promise.reject(error);
  }
);

export class ApiService {
  // Authentication
  static async login(credentials: LoginRequest): Promise<AuthResponse> {
    try {
      const response: AxiosResponse<AuthResponse> = await api.post('/login', credentials);
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Login failed');
    }
  }

  static async signup(userData: SignupRequest): Promise<AuthResponse> {
    try {
      const response: AxiosResponse<AuthResponse> = await api.post('/signup', userData);
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Signup failed');
    }
  }

  static async logout(): Promise<void> {
    try {
      await api.post('/logout');
      await AsyncStorage.removeItem('authToken');
      await AsyncStorage.removeItem('userData');
    } catch (error: any) {
      // Even if logout fails on server, clear local storage
      await AsyncStorage.removeItem('authToken');
      await AsyncStorage.removeItem('userData');
    }
  }

  // Instagram Accounts
  static async getInstagramAccounts(): Promise<InstagramAccount[]> {
    try {
      const response: AxiosResponse<InstagramAccount[]> = await api.get('/instagram');
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to fetch Instagram accounts');
    }
  }

  static async addInstagramAccount(accountData: Partial<InstagramAccount>): Promise<ApiResponse> {
    try {
      const response: AxiosResponse<ApiResponse> = await api.post('/instagram', accountData);
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to add Instagram account');
    }
  }

  static async updateInstagramAccount(id: number, accountData: Partial<InstagramAccount>): Promise<ApiResponse> {
    try {
      const response: AxiosResponse<ApiResponse> = await api.patch(`/instagram/${id}`, accountData);
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to update Instagram account');
    }
  }

  static async deleteInstagramAccount(id: number): Promise<ApiResponse> {
    try {
      const response: AxiosResponse<ApiResponse> = await api.delete(`/instagram/${id}`);
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to delete Instagram account');
    }
  }

  // Telegram Accounts
  static async getTelegramAccounts(): Promise<TelegramAccount[]> {
    try {
      const response: AxiosResponse<TelegramAccount[]> = await api.get('/telegram');
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to fetch Telegram accounts');
    }
  }

  static async addTelegramAccount(accountData: Partial<TelegramAccount>): Promise<ApiResponse> {
    try {
      const response: AxiosResponse<ApiResponse> = await api.post('/telegram', accountData);
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to add Telegram account');
    }
  }

  static async updateTelegramAccount(id: number, accountData: Partial<TelegramAccount>): Promise<ApiResponse> {
    try {
      const response: AxiosResponse<ApiResponse> = await api.patch(`/telegram/${id}`, accountData);
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to update Telegram account');
    }
  }

  static async deleteTelegramAccount(id: number): Promise<ApiResponse> {
    try {
      const response: AxiosResponse<ApiResponse> = await api.delete(`/telegram/${id}`);
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to delete Telegram account');
    }
  }

  // Dashboard Data (You'll need to add these endpoints to your Flask API)
  static async getDashboardData(): Promise<any> {
    try {
      const response: AxiosResponse<any> = await api.get('/dashboard');
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to fetch dashboard data');
    }
  }

  static async getUser(userId: number): Promise<{
  user: User;
  instagram_accounts: InstagramAccount[];
  telegram_channels: TelegramAccount[];
  facebook_pages: any[];
  youtube_channels: any[];
}> {
  try {
    const response: AxiosResponse = await api.get(`/user/${userId}`);
    return response.data;
  } catch (error: any) {
    throw new Error(error.response?.data?.error || 'Failed to fetch user data');
  }
}



  // User Profile
  static async updateUser(id: number, userData: Partial<User>): Promise<ApiResponse> {
    try {
      const response: AxiosResponse<ApiResponse> = await api.patch(`/user/${id}`, userData);
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to update user');
    }
  }
}

export default ApiService;

