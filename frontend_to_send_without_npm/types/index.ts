// User types
export interface User {
  Id: number;
  Name: string;
  email: string;
  expiry: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface SignupRequest {
  name: string;
  email: string;
  password: string;
  expiry?: string;
}

export interface AuthResponse {
  message: string;
  user_id: number;
  name: string;
}

// Social Media Account types
export interface InstagramAccount {
  id: number;
  user_id: number;
  username: string;
  password: string; // Added password field
  email: string;
  google_drive_link: string;
  selected: 'Yes' | 'No';
  sch_start_range: string;
  sch_end_range: string;
  number_of_posts: number;
  posts_left: number;
  done: 'Yes' | 'No';
  next_post_time?: string;
}

export interface TelegramAccount {
  id: number;
  user_id: number;
  channel_name: string;
  token_sesson: string;
  email: string;
  google_drive_link: string;
  selected: 'Yes' | 'No';
  sch_start_range: string;
  sch_end_range: string;
  number_of_posts: number;
  posts_left: number;
  done: 'Yes' | 'No';
  next_post_time?: string;
}

// API Response types
export interface ApiResponse<T = any> {
  message?: string;
  error?: string;
  data?: T;
}

// Navigation types
export type RootStackParamList = {
  Login: undefined;
  Signup: undefined;
  Main: undefined;
};

export type MainTabParamList = {
  Dashboard: undefined;
  Accounts: undefined;
  Schedule: undefined;
  Upload: undefined;
  Profile: undefined;
};

// Dashboard types
export interface DashboardData {
  totalAccounts: number;
  activeSchedules: number;
  postsToday: number;
  recentPosts: RecentPost[];
}

export interface RecentPost {
  id: number;
  platform: 'instagram' | 'telegram';
  account: string;
  status: 'success' | 'failed' | 'pending';
  timestamp: string;
}

// Schedule types
export interface ScheduleRequest {
  platform: 'instagram' | 'telegram';
  account_id: number;
  start_time: string;
  end_time: string;
  number_of_posts: number;
}

