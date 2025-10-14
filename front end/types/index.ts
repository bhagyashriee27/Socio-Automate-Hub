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
  phone_number: string;
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
  passwand?: string; // Matches DB typo
  email: string;
  token_sesson?: string;
  google_drive_link: string;
  selected: 'Yes' | 'No';
  sch_start_range: string;
  sch_end_range: string;
  number_of_posts: number;
  posts_left: number;
  done: 'Yes' | 'No';
  next_post_time?: string;
  // ADD THESE NEW FIELDS:
  post_daily_range: number;
  post_daily_range_left: number;
  last_reset?: string;
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
  // ADD THESE NEW FIELDS:
  post_daily_range: number;
  post_daily_range_left: number;
  last_reset?: string;
}

export interface FacebookAccount {
  id: number;
  user_id: number;
  username: string;
  passwand: string; // Matches DB typo
  email: string;
  channel_name: string;
  token_sesson: string;
  selected: 'Yes' | 'No';
  google_drive_link: string;
  sch_start_range: string;
  sch_end_range: string;
  sch_date?: string;
  sch_time?: string;
  number_of_posts: number;
  posts_left: number;
  done: 'Yes' | 'No';
  schedule_type: 'range' | 'datetime';
  next_post_time?: string;
  // ADD THESE NEW FIELDS:
  post_daily_range: number;
  post_daily_range_left: number;
  last_reset?: string;
}

export interface YouTubeAccount {
  id: number;
  user_id: number;
  username: string;
  email: string;
  google_drive_link: string;
  selected: 'Yes' | 'No';
  sch_start_range: string;
  sch_end_range: string;
  number_of_posts: number;
  token_sesson: string;
  channel_id: string;
  posts_left: number;
  done: 'Yes' | 'No';
  next_post_time?: string;
  token_drive: string;
  // ADD THESE NEW FIELDS:
  post_daily_range: number;
  post_daily_range_left: number;
  last_reset?: string;
}

// API Response types
export interface ApiResponse<T = any> {
  message?: string;
  error?: string;
  data?: T & { file_id?: string };
  token_sesson?: string;
  file_id?: string;
}

// Navigation types
export type RootStackParamList = {
  Login: undefined;
  Signup: undefined;
  Main: undefined;
  ForgotPassword: undefined;
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

export interface UploadResponse extends ApiResponse {
  success?: boolean;
  file_id?: string;
  drive_link?: string;
  file_name?: string;
  chunk_index?: number;
  uploaded_chunks?: number;
  total_chunks?: number;
  upload_id?: string;
  status?: string;
}

export interface RecentPost {
  id: number;
  platform: 'instagram' | 'telegram' | 'facebook' | 'youtube';
  account: string;
  status: 'success' | 'failed' | 'pending';
  timestamp: string;
}

// Schedule types
export interface ScheduleRequest {
  platform: 'instagram' | 'telegram' | 'facebook' | 'youtube';
  account_id: number;
  start_time: string;
  end_time: string;
  number_of_posts: number;
  // ADD OPTIONAL NEW FIELD:
  post_daily_range?: number;
}