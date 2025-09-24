import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Alert,
} from 'react-native';
import StorageService from '../utils/storage';
import ApiService from '../services/api';
import { User, InstagramAccount, TelegramAccount } from '../types';

const DashboardScreen: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState({
    totalAccounts: 0,
    activeSchedules: 0,
    postsToday: 0,
    instagramAccounts: 0,
    telegramAccounts: 0,
  });

  useEffect(() => {
    loadUserData();
    loadDashboardData();
  }, []);

  const loadUserData = async () => {
    try {
      const userData = await StorageService.getUserData();
      setUser(userData);
    } catch (error) {
      console.error('Error loading user data:', error);
    }
  };

  const loadDashboardData = async () => {
    try {
      if (!user?.Id) {
        await loadUserData(); // Ensure user data is loaded
        if (!user?.Id) return; // Exit if still no user
      }

      // Fetch user-specific data from /user/<id>
      const response = await ApiService.getUser(user.Id);
      const { instagram_accounts, telegram_channels, facebook_pages, youtube_channels } = response;

      // Calculate stats
      const instagramActive = instagram_accounts.filter((acc: InstagramAccount) => acc.selected === 'Yes').length;
      const telegramActive = telegram_channels.filter((acc: TelegramAccount) => acc.selected === 'Yes').length;
      const facebookActive = facebook_pages.filter((acc: any) => acc.selected === 'Yes').length;
      const youtubeActive = youtube_channels.filter((acc: any) => acc.selected === 'Yes').length;

      // Calculate posts today (posts with next_post_time within today)
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(today.getDate() + 1);

      const countPostsToday = (accounts: any[]) =>
        accounts.filter((acc: any) => {
          if (!acc.next_post_time) return false;
          const postTime = new Date(acc.next_post_time);
          return postTime >= today && postTime < tomorrow;
        }).length;

      const postsToday =
        countPostsToday(instagram_accounts) +
        countPostsToday(telegram_channels) +
        countPostsToday(facebook_pages) +
        countPostsToday(youtube_channels);

      setStats({
        totalAccounts:
          instagram_accounts.length +
          telegram_channels.length +
          facebook_pages.length +
          youtube_channels.length,
        activeSchedules: instagramActive + telegramActive + facebookActive + youtubeActive,
        postsToday,
        instagramAccounts: instagram_accounts.length,
        telegramAccounts: telegram_channels.length,
      });
    } catch (error: any) {
      console.error('Error loading dashboard data:', error);
      Alert.alert('Error', 'Failed to load dashboard data');
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadDashboardData();
    setRefreshing(false);
  };

  const StatCard: React.FC<{ title: string; value: number; color: string }> = ({
    title,
    value,
    color,
  }) => (
    <View style={[styles.statCard, { borderLeftColor: color }]}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statTitle}>{title}</Text>
    </View>
  );

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.header}>
        <Text style={styles.welcomeText}>Welcome back,</Text>
        <Text style={styles.userName}>{user?.Name || 'User'}</Text>
      </View>

      <View style={styles.statsContainer}>
        <Text style={styles.sectionTitle}>Overview</Text>
        
        <View style={styles.statsGrid}>
          <StatCard
            title="Total Accounts"
            value={stats.totalAccounts}
            color="#007AFF"
          />
          <StatCard
            title="Active Schedules"
            value={stats.activeSchedules}
            color="#34C759"
          />
          <StatCard
            title="Posts Today"
            value={stats.postsToday}
            color="#FF9500"
          />
          <StatCard
            title="Instagram Accounts"
            value={stats.instagramAccounts}
            color="#5856D6"
          />
          <StatCard
            title="Telegram Accounts"
            value={stats.telegramAccounts}
            color="#00C7BE"
          />
        </View>
      </View>

      <View style={styles.quickActions}>
        <Text style={styles.sectionTitle}>Quick Actions</Text>
        
        <TouchableOpacity style={styles.actionButton}>
          <Text style={styles.actionButtonText}>📱 Add Instagram Account</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.actionButton}>
          <Text style={styles.actionButtonText}>📢 Add Telegram Channel</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.actionButton}>
          <Text style={styles.actionButtonText}>📅 Create Schedule</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.actionButton}>
          <Text style={styles.actionButtonText}>📤 Upload Media</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.recentActivity}>
        <Text style={styles.sectionTitle}>Recent Activity</Text>
        <View style={styles.activityItem}>
          <Text style={styles.activityText}>No recent activity</Text>
          <Text style={styles.activitySubtext}>Your posts and schedules will appear here</Text>
        </View>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    backgroundColor: '#fff',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  welcomeText: {
    fontSize: 16,
    color: '#666',
  },
  userName: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 4,
  },
  statsContainer: {
    padding: 15, // Reduced padding
  },
  sectionTitle: {
    fontSize: 18, // Slightly smaller
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12, // Reduced margin
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    marginBottom: 12, // Reduced margin
  },
  statCard: {
    backgroundColor: '#fff',
    padding: 12, // Reduced padding
    borderRadius: 10, // Slightly smaller radius
    flex: 0.48, // Maintains 2 cards per row on larger screens
    borderLeftWidth: 3, // Thinner border
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 }, // Reduced shadow
    shadowOpacity: 0.05, // Lighter shadow
    shadowRadius: 2,
    elevation: 3, // Reduced elevation
    marginBottom: 10, // Reduced margin
    alignItems: 'center', // Center content
  },
  statValue: {
    fontSize: 22, // Reduced from 28
    fontWeight: 'bold',
    color: '#333',
    textAlign: 'center',
  },
  statTitle: {
    fontSize: 12, // Reduced from 14
    color: '#666',
    textAlign: 'center',
    marginTop: 4,
  },
  quickActions: {
    padding: 15, // Reduced padding
  },
  actionButton: {
    backgroundColor: '#fff',
    padding: 12, // Reduced padding
    borderRadius: 10, // Slightly smaller radius
    marginBottom: 10, // Reduced margin
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 }, // Reduced shadow
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 3, // Reduced elevation
  },
  actionButtonText: {
    fontSize: 14, // Reduced from 16
    color: '#333',
    fontWeight: '500',
  },
  recentActivity: {
    padding: 15, // Reduced padding
  },
  activityItem: {
    backgroundColor: '#fff',
    padding: 12, // Reduced padding
    borderRadius: 10, // Slightly smaller radius
    alignItems: 'center',
  },
  activityText: {
    fontSize: 14, // Reduced from 16
    color: '#666',
    fontWeight: '500',
  },
  activitySubtext: {
    fontSize: 12, // Reduced from 14
    color: '#999',
    marginTop: 4,
    textAlign: 'center',
  },
});

export default DashboardScreen;