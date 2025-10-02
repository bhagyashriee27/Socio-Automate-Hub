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
import FontAwesome from 'react-native-vector-icons/FontAwesome'; // For Instagram, Telegram, and YouTube icons
import MaterialIcons from 'react-native-vector-icons/MaterialIcons'; // For Schedule and Upload icons
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

  const handleUploadForm = () => {
    // Placeholder for navigation to UploadFormScreen
    // Replace with your navigation logic, e.g., using useNavigation from @react-navigation/native
    Alert.alert('Upload Form', 'Navigating to Upload Form...');
    // Example: navigation.navigate('UploadFormScreen');
  };

  // Get greeting based on time of day
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return 'Good Morning';
    if (hour >= 12 && hour < 17) return 'Good Afternoon';
    return 'Good Evening';
  };

  // Get formatted date (without time)
  const getFormattedDate = () => {
    const date = new Date();
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      timeZone: 'Asia/Kolkata', // IST
    });
  };

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.header}>
          <Text style={styles.welcomeText}>
            {getGreeting()}, {user?.Name || 'User'}
          </Text>
          <Text style={styles.dateText}>{getFormattedDate()}</Text>
        </View>

        <View style={styles.statsContainer}>
          <Text style={styles.sectionTitle}>Today's Overview</Text>
          
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.statsGrid}
            contentContainerStyle={styles.statsGridContent}
          >
            <StatCard
              title="Total Accounts"
              value={stats.totalAccounts}
              color="#070840ff"
            />
            <StatCard
              title="Active Schedules"
              value={stats.activeSchedules}
              color="#070840ff"
            />
            <StatCard
              title="Posts Today"
              value={stats.postsToday}
              color="#070840ff"
            />
            <StatCard
              title="Instagram Accounts"
              value={stats.instagramAccounts}
              color="#070840ff"
            />
            <StatCard
              title="Telegram Accounts"
              value={stats.telegramAccounts}
              color="#070840ff"
            />
          </ScrollView>
        </View>

        <View style={styles.quickActions}>
          <Text style={styles.sectionTitle}>Quick Actions</Text>
          
          <TouchableOpacity style={styles.actionButton}>
            <FontAwesome name="instagram" size={20} color="#E4405F" style={styles.icon} />
            <Text style={styles.actionButtonText}>Add Instagram Accounts</Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.actionButton}>
            <FontAwesome name="telegram" size={20} color="#0088cc" style={styles.icon} />
            <Text style={styles.actionButtonText}>Add Telegram Channels</Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.actionButton}>
            <MaterialIcons name="calendar-month" size={20} color="#104d29ff" style={styles.icon} />
            <Text style={styles.actionButtonText}>Update Schedules</Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.actionButton}>
            <MaterialIcons name="file-upload" size={20} color="#782d85ff" style={styles.icon} />
            <Text style={styles.actionButtonText}>Upload Media</Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.actionButton}>
            <FontAwesome name="youtube" size={20} color="#d32121ff" style={styles.icon} />
            <Text style={styles.actionButtonText}>Add YouTube Channels</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* New Circular Upload Form Button at Bottom Left */}
      <TouchableOpacity style={styles.uploadButton} onPress={handleUploadForm}>
        <Text style={styles.uploadButtonText}>+</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#b4c5d8',
  },
  scrollView: {
    flex: 1,
  },
  header: {
    backgroundColor: '#fff',
    padding: 20,
    paddingBottom: 10,
    marginBottom: 5,
    borderBottomWidth: 0.5,
    borderBottomColor: '#ddd',
  },
  welcomeText: {
    fontSize: 28,
    fontWeight: '500',
    fontFamily: 'Times New Roman',
    color: '#03021eff',
    textAlign: 'left',
  },
  dateText: {
    fontSize: 16,
    color: '#666',
    textAlign: 'left',
    marginTop: 5,
    fontStyle: 'italic',
  },
  statsContainer: {
    padding: 10,
    paddingTop: 15,
  },
  sectionTitle: {
    fontSize: 32,
    fontFamily: 'Times New Roman',
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 10,
  },
  statsGrid: {
    flexDirection: 'row',
  },
  statsGridContent: {
    paddingVertical: 5,
  },
  statCard: {
    backgroundColor: '#ffffffdd',
    padding: 12,
    borderRadius: 12,
    width: 100,
    borderLeftWidth: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 5,
    marginHorizontal: 5,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#333',
    textAlign: 'center',
  },
  statTitle: {
    fontSize: 14,
    color: '#343232ff',
    fontFamily: 'Times New Roman',
    textAlign: 'center',
    marginTop: 2,
  },
  quickActions: {
    padding: 15,
    paddingTop: 30,
  },
  actionButton: {
    backgroundColor: '#fff',
    padding: 10,
    borderRadius: 8,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 2,
    elevation: 2,
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionButtonText: {
    fontSize: 15,
    fontFamily: 'Times New Roman',
    color: '#333',
    fontWeight: '500',
    marginLeft: 10,
  },
  icon: {
    marginRight: 8,
  },
  uploadButton: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 2,
    elevation: 2,
  },
  uploadButtonText: {
    fontSize: 30,
    fontFamily: 'Times New Roman',
    color: '#333',
    fontWeight: '800',
    textAlign: 'center',
    lineHeight: 30,
  },
});

export default DashboardScreen;