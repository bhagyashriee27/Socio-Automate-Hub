import axios, { AxiosResponse } from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  User,
  LoginRequest,
  SignupRequest,
  AuthResponse,
  InstagramAccount,
  TelegramAccount,
  FacebookAccount,
  YouTubeAccount,
  ApiResponse,
} from '../types';

// Define possible base URLs
const BASE_URLS = [
  'http://127.0.0.1:5000',
  'https://credible-mastodon-fully.ngrok-free.app',
  'https://monitor-renewing-oarfish.ngrok-free.app',
];

// Create axios instance without a fixed baseURL initially
const api = axios.create({
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Function to check if a URL is reachable
const checkUrlAvailability = async (url: string): Promise<boolean> => {
  try {
    await axios.get(`${url}/health`, { timeout: 5000 }); // Adjust endpoint if needed
    return true;
  } catch (error) {
    return false;
  }
};

// Function to select an active base URL
const selectBaseUrl = async (): Promise<string> => {
  // Check if we have a previously stored working URL
  const storedUrl = await AsyncStorage.getItem('activeBaseUrl');
  if (storedUrl && await checkUrlAvailability(storedUrl)) {
    return storedUrl;
  }

  // Try each URL in the list
  for (const url of BASE_URLS) {
    if (await checkUrlAvailability(url)) {
      await AsyncStorage.setItem('activeBaseUrl', url); // Store the working URL
      return url;
    }
  }

  // If no URL is available, throw an error
  throw new Error('No available API server found');
};

// Initialize or update axios baseURL
const initializeApi = async () => {
  const baseUrl = await selectBaseUrl();
  api.defaults.baseURL = baseUrl;
};

// Call initializeApi before making any requests
initializeApi().catch((error) => {
  console.error('Failed to initialize API:', error);
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

// Add response interceptor for error handling and fallback
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 503 || error.code === 'ECONNABORTED') {
      // Server is down or timeout, try switching to another URL
      try {
        const currentUrl = api.defaults.baseURL;
        const nextUrl = BASE_URLS.find((url) => url !== currentUrl);
        if (nextUrl && (await checkUrlAvailability(nextUrl))) {
          api.defaults.baseURL = nextUrl;
          await AsyncStorage.setItem('activeBaseUrl', nextUrl);
          // Retry the failed request with the new URL
          return api.request(error.config);
        }
      } catch (retryError) {
        console.error('Retry with fallback URL failed:', retryError);
      }
    }
    if (error.response?.status === 401) {
      // Token expired or invalid, clear storage and redirect to login
      await AsyncStorage.removeItem('authToken');
      await AsyncStorage.removeItem('userData');
    }
    return Promise.reject(error);
  }
);

export class ApiService {
  // Ensure API is initialized before any request
  static async ensureApiInitialized() {
    if (!api.defaults.baseURL) {
      await initializeApi();
    }
  }

  // Authentication
  static async login(credentials: LoginRequest): Promise<AuthResponse> {
    await this.ensureApiInitialized();
    try {
      const response: AxiosResponse<AuthResponse> = await api.post('/login', credentials);
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Login failed');
    }
  }

  static async signup(userData: SignupRequest): Promise<AuthResponse> {
    await this.ensureApiInitialized();
    try {
      const response: AxiosResponse<AuthResponse> = await api.post('/signup', userData);
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Signup failed');
    }
  }

  static async logout(): Promise<void> {
    await this.ensureApiInitialized();
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
    await this.ensureApiInitialized();
    try {
      const response: AxiosResponse<InstagramAccount[]> = await api.get('/instagram');
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to fetch Instagram accounts');
    }
  }

  static async addInstagramAccount(accountData: Partial<InstagramAccount>): Promise<ApiResponse> {
    await this.ensureApiInitialized();
    try {
      const response: AxiosResponse<ApiResponse> = await api.post('/instagram', accountData);
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to add Instagram account');
    }
  }

  static async updateInstagramAccount(id: number, accountData: Partial<InstagramAccount>): Promise<ApiResponse> {
    await this.ensureApiInitialized();
    try {
      const response: AxiosResponse<ApiResponse> = await api.patch(`/instagram/${id}`, accountData);
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to update Instagram account');
    }
  }

  static async deleteInstagramAccount(id: number): Promise<ApiResponse> {
    await this.ensureApiInitialized();
    try {
      const response: AxiosResponse<ApiResponse> = await api.delete(`/instagram/${id}`);
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to delete Instagram account');
    }
  }

  // Telegram Accounts
  static async getTelegramAccounts(): Promise<TelegramAccount[]> {
    await this.ensureApiInitialized();
    try {
      const response: AxiosResponse<TelegramAccount[]> = await api.get('/telegram');
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to fetch Telegram accounts');
    }
  }

  static async addTelegramAccount(accountData: Partial<TelegramAccount>): Promise<ApiResponse> {
    await this.ensureApiInitialized();
    try {
      const response: AxiosResponse<ApiResponse> = await api.post('/telegram', accountData);
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to add Telegram account');
    }
  }

  static async updateTelegramAccount(id: number, accountData: Partial<TelegramAccount>): Promise<ApiResponse> {
    await this.ensureApiInitialized();
    try {
      const response: AxiosResponse<ApiResponse> = await api.patch(`/telegram/${id}`, accountData);
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to update Telegram account');
    }
  }

  static async deleteTelegramAccount(id: number): Promise<ApiResponse> {
    await this.ensureApiInitialized();
    try {
      const response: AxiosResponse<ApiResponse> = await api.delete(`/telegram/${id}`);
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to delete Telegram account');
    }
  }

  // Facebook Accounts
  static async addFacebookAccount(accountData: Partial<FacebookAccount>): Promise<ApiResponse> {
    await this.ensureApiInitialized();
    try {
      const response: AxiosResponse<ApiResponse> = await api.post('/facebook', accountData);
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to add Facebook account');
    }
  }

  static async updateFacebookAccount(id: number, accountData: Partial<FacebookAccount>): Promise<ApiResponse> {
    await this.ensureApiInitialized();
    try {
      const response: AxiosResponse<ApiResponse> = await api.patch(`/facebook/${id}`, accountData);
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to update Facebook account');
    }
  }

  static async deleteFacebookAccount(id: number): Promise<ApiResponse> {
    await this.ensureApiInitialized();
    try {
      const response: AxiosResponse<ApiResponse> = await api.delete(`/facebook/${id}`);
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to delete Facebook account');
    }
  }

  // YouTube Accounts
  static async addYouTubeAccount(accountData: Partial<YouTubeAccount>): Promise<ApiResponse> {
    await this.ensureApiInitialized();
    try {
      const response: AxiosResponse<ApiResponse> = await api.post('/youtube', accountData);
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to add YouTube account');
    }
  }

  static async updateYouTubeAccount(id: number, accountData: Partial<YouTubeAccount>): Promise<ApiResponse> {
    await this.ensureApiInitialized();
    try {
      const response: AxiosResponse<ApiResponse> = await api.patch(`/youtube/${id}`, accountData);
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to update YouTube account');
    }
  }

  static async deleteYouTubeAccount(id: number): Promise<ApiResponse> {
    await this.ensureApiInitialized();
    try {
      const response: AxiosResponse<ApiResponse> = await api.delete(`/youtube/${id}`);
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to delete YouTube account');
    }
  }

  // Dashboard Data
  static async getDashboardData(): Promise<any> {
    await this.ensureApiInitialized();
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
    facebook_pages: FacebookAccount[];
    youtube_channels: YouTubeAccount[];
  }> {
    await this.ensureApiInitialized();
    try {
      const response: AxiosResponse = await api.get(`/user/${userId}`);
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to fetch user data');
    }
  }

  // User Profile
  static async updateUser(id: number, userData: Partial<User>): Promise<ApiResponse> {
    await this.ensureApiInitialized();
    try {
      const response: AxiosResponse<ApiResponse> = await api.patch(`/user/${id}`, userData);
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to update user');
    }
  }

  // Upload Media
  static async uploadMedia(formData: FormData): Promise<ApiResponse> {
    await this.ensureApiInitialized();
    try {
      const response: AxiosResponse<ApiResponse> = await api.post('/upload-media', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to upload media');
    }
  }

  // Forgot Password
  static async sendPasswordResetOtp(email: string, phoneNumber: string): Promise<ApiResponse> {
    await this.ensureApiInitialized();
    try {
      const response: AxiosResponse<ApiResponse> = await api.post('/forgot-password/send-otp', {
        email,
        phone_number: phoneNumber,
      });
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to send OTP');
    }
  }

  static async verifyPasswordResetOtp(email: string, phoneNumber: string, otp: string): Promise<ApiResponse> {
    await this.ensureApiInitialized();
    try {
      const response: AxiosResponse<ApiResponse> = await api.post('/forgot-password/verify-otp', {
        email,
        phone_number: phoneNumber,
        otp,
      });
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to verify OTP');
    }
  }

  static async resetPassword(email: string, phoneNumber: string, otp: string, newPassword: string): Promise<ApiResponse> {
    await this.ensureApiInitialized();
    try {
      const response: AxiosResponse<ApiResponse> = await api.post('/forgot-password/reset', {
        email,
        phone_number: phoneNumber,
        otp,
        new_password: newPassword,
      });
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to reset password');
    }
  }

  // Schedule Management
  static async resetSchedule(platform: 'instagram' | 'telegram' | 'facebook' | 'youtube' | 'both'): Promise<ApiResponse> {
    await this.ensureApiInitialized();
    try {
      const response: AxiosResponse<ApiResponse> = await api.post('/schedule/reset', {
        platform,
      });
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to reset schedule');
    }
  }

  static async getScheduleStatus(platform: 'instagram' | 'telegram' | 'facebook' | 'youtube' | 'both', email?: string): Promise<any> {
    await this.ensureApiInitialized();
    try {
      const params: any = { platform };
      if (email) params.email = email;

      const response: AxiosResponse<any> = await api.get('/schedule/status', { params });
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to fetch schedule status');
    }
  }

  static async addPosts(platform: 'instagram' | 'telegram' | 'facebook' | 'youtube', recordId: number, additionalPosts: number): Promise<ApiResponse> {
    await this.ensureApiInitialized();
    try {
      const response: AxiosResponse<ApiResponse> = await api.post('/posts/add', {
        platform,
        record_id: recordId,
        additional_posts: additionalPosts,
      });
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to add posts');
    }
  }

  // Admin/Export
  static async exportData(email?: string): Promise<any> {
    await this.ensureApiInitialized();
    try {
      const params: any = {};
      if (email) params.email = email;

      const response: AxiosResponse<any> = await api.get('/admin/export', { params });
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to export data');
    }
  }
}

export default ApiService;