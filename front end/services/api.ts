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

const BASE_URL = 'https://monitor-renewing-oarfish.ngrok-free.app';
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

// Define a type for the new data structure used in add operations
type DailyPostData = {
    post_daily_range: number;
    number_of_posts: number;
    posts_left: number;
}

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

  // UPDATED: Use post_daily_range and deprecate number_of_posts/posts_left
  static async addInstagramAccount(accountData: Partial<InstagramAccount> & DailyPostData): Promise<ApiResponse> {
    try {
      const payload = {
        ...accountData,
        post_daily_range: accountData.post_daily_range,
        number_of_posts: 0, // Deprecated, set to 0
        posts_left: 0, // Deprecated, set to 0
      };
      const response: AxiosResponse<ApiResponse> = await api.post('/instagram', payload);
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to add Instagram account');
    }
  }

  static async updateInstagramAccount(id: number, accountData: Partial<InstagramAccount> & { 
  post_daily_range?: number;
  number_of_posts?: number;
}): Promise<ApiResponse> {
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

  // UPDATED: Use post_daily_range and deprecate number_of_posts/posts_left
  static async addTelegramAccount(accountData: Partial<TelegramAccount> & DailyPostData): Promise<ApiResponse> {
    try {
      const payload = {
        ...accountData,
        post_daily_range: accountData.post_daily_range,
        number_of_posts: 0, // Deprecated, set to 0
        posts_left: 0, // Deprecated, set to 0
      };
      const response: AxiosResponse<ApiResponse> = await api.post('/telegram', payload);
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to add Telegram account');
    }
  }

  // ✅ UPDATED: Added google_drive_link support
  static async updateTelegramAccount(id: number, accountData: Partial<TelegramAccount> & { 
  post_daily_range?: number;
  number_of_posts?: number;
  google_drive_link?: string;
}): Promise<ApiResponse> {
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

  // Facebook Accounts
  static async addFacebookAccount(accountData: Partial<FacebookAccount>): Promise<ApiResponse> {
    try {
      const response: AxiosResponse<ApiResponse> = await api.post('/facebook', accountData);
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to add Facebook account');
    }
  }

  static async updateFacebookAccount(id: number, accountData: Partial<FacebookAccount>): Promise<ApiResponse> {
    try {
      const response: AxiosResponse<ApiResponse> = await api.patch(`/facebook/${id}`, accountData);
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to update Facebook account');
    }
  }

  static async deleteFacebookAccount(id: number): Promise<ApiResponse> {
    try {
      const response: AxiosResponse<ApiResponse> = await api.delete(`/facebook/${id}`);
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to delete Facebook account');
    }
  }

  // YouTube Accounts
  // UPDATED: Use post_daily_range and deprecate number_of_posts/posts_left
  static async addYouTubeAccount(accountData: Partial<YouTubeAccount> & DailyPostData): Promise<ApiResponse> {
    try {
      const payload = {
        ...accountData,
        post_daily_range: accountData.post_daily_range,
        number_of_posts: 0, // Deprecated, set to 0
        posts_left: 0, // Deprecated, set to 0
      };
      const response: AxiosResponse<ApiResponse> = await api.post('/youtube', payload);
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to add YouTube account');
    }
  }

  // ✅ UPDATED: Added post_daily_range support for YouTube
  static async updateYouTubeAccount(id: number, accountData: Partial<YouTubeAccount> & { 
  post_daily_range?: number;
  number_of_posts?: number;
  google_drive_link?: string;
  sch_start_range?: string;
  sch_end_range?: string;
  selected?: 'Yes' | 'No';
}): Promise<ApiResponse> {
  try {
    const response: AxiosResponse<ApiResponse> = await api.patch(`/youtube/${id}`, accountData);
    return response.data;
  } catch (error: any) {
    console.error('YouTube update error:', error.response?.data);
    throw new Error(error.response?.data?.error || 'Failed to update YouTube account');
  }
}

  static async deleteYouTubeAccount(id: number): Promise<ApiResponse> {
    try {
      const response: AxiosResponse<ApiResponse> = await api.delete(`/youtube/${id}`);
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to delete YouTube account');
    }
  }

  // Dashboard Data
  static async getDashboardData(): Promise<any> {
    try {
      const response: AxiosResponse<any> = await api.get('/dashboard');
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to fetch dashboard data');
    }
  }

  // Delete media from Google Drive and schedule
  // ✅ UPDATED: Added youtube platform support
  static async deleteMediaFromDrive(
    platform: 'instagram' | 'telegram' | 'facebook' | 'youtube',
    accountId: number,
    fileId: string
  ): Promise<ApiResponse> {
    try {
      const response: AxiosResponse<ApiResponse> = await api.delete(`/delete-media`, {
        data: {
          platform,
          account_id: accountId,
          file_id: fileId
        }
      });
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to delete media');
    }
  }

  // Update individual media schedule
  // ✅ UPDATED: Added youtube platform support
  static async updateMediaSchedule(
    platform: 'instagram' | 'telegram' | 'facebook' | 'youtube',
    accountId: number,
    mediaData: any
  ): Promise<ApiResponse> {
    try {
      const response: AxiosResponse<ApiResponse> = await api.patch(`/update-media-schedule`, {
        platform,
        account_id: accountId,
        media_data: mediaData
      });
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to update media schedule');
    }
  }

  // Update custom schedule data (entire schedule array)
  // ✅ UPDATED: Added youtube platform support
  static async updateCustomSchedule(
    platform: 'instagram' | 'telegram' | 'facebook' | 'youtube',
    accountId: number,
    customScheduleData: any[]
  ): Promise<ApiResponse> {
    try {
      const response: AxiosResponse<ApiResponse> = await api.patch(`/${platform}/${accountId}/custom-schedule`, {
        custom_schedule_data: customScheduleData
      });
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to update custom schedule');
    }
  }

  // Get custom schedule data
  // ✅ UPDATED: Added youtube platform support
  static async getCustomSchedule(
    platform: 'instagram' | 'telegram' | 'facebook' | 'youtube',
    accountId: number
  ): Promise<any> {
    try {
      const response: AxiosResponse<any> = await api.get(`/${platform}/${accountId}/custom-schedule`);
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to fetch custom schedule');
    }
  }

  static async getUser(userId: number): Promise<{
    user: User;
    instagram_accounts: InstagramAccount[];
    telegram_channels: TelegramAccount[];
    facebook_pages: FacebookAccount[];
    youtube_channels: YouTubeAccount[];
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

  // Upload Media
  static async uploadMedia(formData: FormData): Promise<ApiResponse> {
  try {
    const response: AxiosResponse<ApiResponse> = await api.post('/upload-media', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    
    // Handle duplicate file response
    if ((response.data as any).duplicate) {
      console.log('File already exists in Drive, scheduling updated');
    }
    
    return response.data;
  } catch (error: any) {
    // If it's a duplicate file error, treat as success
    if (error.response?.status === 400 && error.response?.data?.error?.includes('duplicate')) {
      return {
        message: 'File already exists, scheduling updated',
        success: true,
        duplicate: true
      } as any;
    }
    throw new Error(error.response?.data?.error || 'Failed to upload media');
  }
}

  // Forgot Password
  static async sendPasswordResetOtp(email: string, phoneNumber: string): Promise<ApiResponse> {
    try {
      const response: AxiosResponse<ApiResponse> = await api.post('/forgot-password/send-otp', {
        email,
        phone_number: phoneNumber
      });
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to send OTP');
    }
  }

  static async verifyPasswordResetOtp(email: string, phoneNumber: string, otp: string): Promise<ApiResponse> {
    try {
      const response: AxiosResponse<ApiResponse> = await api.post('/forgot-password/verify-otp', {
        email,
        phone_number: phoneNumber,
        otp
      });
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to verify OTP');
    }
  }

  static async resetPassword(email: string, phoneNumber: string, otp: string, newPassword: string): Promise<ApiResponse> {
    try {
      const response: AxiosResponse<ApiResponse> = await api.post('/forgot-password/reset', {
        email,
        phone_number: phoneNumber,
        otp,
        new_password: newPassword
      });
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to reset password');
    }
  }

  // Schedule Management
  // ✅ UPDATED: Added youtube platform support
  static async resetSchedule(platform: 'instagram' | 'telegram' | 'facebook' | 'youtube' | 'both'): Promise<ApiResponse> {
    try {
      const response: AxiosResponse<ApiResponse> = await api.post('/schedule/reset', {
        platform
      });
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to reset schedule');
    }
  }

  static async uploadMediaChunk(formData: FormData): Promise<ApiResponse> {
  try {
    const response: AxiosResponse<ApiResponse> = await api.post('/upload-media-chunk', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      timeout: 60000,
    });
    return response.data;
  } catch (error: any) {
    throw new Error(error.response?.data?.error || 'Chunk upload failed');
  }
}

  static async finalizeUpload(formData: FormData): Promise<ApiResponse> {
  try {
    const response: AxiosResponse<ApiResponse> = await api.post('/finalize-upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  } catch (error: any) {
    throw new Error(error.response?.data?.error || 'Upload finalization failed');
  }
}

  static async getUploadStatus(uploadId: string): Promise<any> {
    try {
      const response: AxiosResponse<any> = await api.get(`/upload-status/${uploadId}`);
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to get upload status');
    }
  }

  // ✅ UPDATED: Added youtube platform support
  static async getScheduleStatus(platform: 'instagram' | 'telegram' | 'facebook' | 'youtube' | 'both', email?: string): Promise<any> {
    try {
      const params: any = { platform };
      if (email) params.email = email;
      
      const response: AxiosResponse<any> = await api.get('/schedule/status', { params });
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to fetch schedule status');
    }
  }


  static async updateScheduleAccount(
  platform: 'instagram' | 'telegram' | 'youtube' | 'facebook',
  recordId: number,
  updateData: any
): Promise<ApiResponse> {
  try {
    const response: AxiosResponse<ApiResponse> = await api.patch('/schedule/update-account', {
      platform,
      record_id: recordId,
      update_data: updateData
    });
    return response.data;
  } catch (error: any) {
    throw new Error(error.response?.data?.error || 'Failed to update account');
  }
}
  // ✅ UPDATED: Added youtube platform support
  static async addPosts(platform: 'instagram' | 'telegram' | 'facebook' | 'youtube', recordId: number, additionalPosts: number): Promise<ApiResponse> {
    try {
      const response: AxiosResponse<ApiResponse> = await api.post('/posts/add', {
        platform,
        record_id: recordId,
        additional_posts: additionalPosts
      });
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to add posts');
    }
  }

  // Admin/Export
  static async exportData(email?: string): Promise<any> {
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