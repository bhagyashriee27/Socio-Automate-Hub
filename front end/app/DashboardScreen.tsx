import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Alert,
  Modal,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { useNavigation, NavigationProp } from '@react-navigation/native';
import FontAwesome from 'react-native-vector-icons/FontAwesome';
import Icon from 'react-native-vector-icons/MaterialIcons'; // Updated Import
import StorageService from '../utils/storage';
import ApiService from '../services/api';
import { User, InstagramAccount, TelegramAccount } from '../types';

type TabParamList = {
  Dashboard: undefined;
  Accounts: undefined;
  Schedule: undefined;
  Upload: undefined;
  Profile: undefined;
};

const DashboardScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp<TabParamList>>();
  const [user, setUser] = useState<User | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState({
    totalAccounts: 0,
    activeSchedules: 0,
    postsToday: 0,
    instagramAccounts: 0,
    telegramAccounts: 0,
  });
  const [modalVisible, setModalVisible] = useState(false);
  const [modalType, setModalType] = useState<'instagram' | 'telegram' | 'youtube'>('instagram');
  const [formData, setFormData] = useState({
    username: '',
    passwand: '',
    email: '',
    channel_name: '',
    google_drive_link: '',
    sch_start_range: '09:00:00',
    sch_end_range: '17:00:00',
    number_of_posts: '5',
    channel_id: '',
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      console.log('DashboardScreen: Starting data fetch...');
      setIsLoading(true);

      const userData = await loadUserDataWithRetry();

      if (userData && userData.Id) {
        console.log('DashboardScreen: User data loaded, loading dashboard...');
        await loadDashboardData(userData);
      } else {
        console.error('DashboardScreen: No user data available');
      }

      setIsLoading(false);
      console.log('DashboardScreen: Data fetch complete');
    };
    fetchData();
  }, []);

  const loadUserDataWithRetry = async (retries = 3, delay = 1000): Promise<User | null> => {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const userData = await StorageService.getUserData();
        console.log(`Attempt ${attempt}: User data:`, userData);

        if (userData && userData.Id) {
          setUser(userData);
          console.log('User data loaded successfully:', userData.Id);
          return userData;
        } else {
          console.warn(`Attempt ${attempt}: Invalid user data -`, userData);
        }

        if (attempt < retries) {
          console.log(`Retrying in ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      } catch (error) {
        console.error(`Attempt ${attempt}: Error loading user data:`, error);
        if (attempt < retries) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }
    console.error('Failed to load user data after retries');
    Alert.alert('Error', 'Failed to load user data. Please log in again.');
    setUser(null);
    return null;
  };

  const loadDashboardData = async (currentUser?: User | null) => {
    const userToUse = currentUser || user;

    if (!userToUse?.Id) {
      console.warn('No user ID available, skipping dashboard data fetch');
      setRefreshing(false);
      return;
    }

    try {
      setRefreshing(true);
      console.log('Fetching dashboard data for user:', userToUse.Id);
      const response = await ApiService.getUser(userToUse.Id);
      const { instagram_accounts = [], telegram_channels = [], facebook_pages = [], youtube_channels = [] } = response;

      const instagramActive = instagram_accounts.filter((acc: InstagramAccount) => acc.selected === 'Yes').length;
      const telegramActive = telegram_channels.filter((acc: TelegramAccount) => acc.selected === 'Yes').length;
      const facebookActive = facebook_pages.filter((acc: any) => acc.selected === 'Yes').length;
      const youtubeActive = youtube_channels.filter((acc: any) => acc.selected === 'Yes').length;

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
    } finally {
      setRefreshing(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    const userData = await loadUserDataWithRetry();
    if (userData) {
      await loadDashboardData(userData);
    }
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
    navigation.navigate('Upload');
  };

  const openAddModal = (type: 'instagram' | 'telegram' | 'youtube') => {
    setModalType(type);
    setFormData({
      username: '',
      passwand: '',
      email: user?.email || '',
      channel_name: '',
      google_drive_link: '',
      sch_start_range: '09:00:00',
      sch_end_range: '17:00:00',
      number_of_posts: '5',
      channel_id: '',
    });
    setModalVisible(true);
  };

  const handleAddAccount = async () => {
    try {
      const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/;
      if (!timeRegex.test(formData.sch_start_range) || !timeRegex.test(formData.sch_end_range)) {
        Alert.alert('Error', 'Please enter valid time in HH:MM:SS format (e.g., 09:00:00)');
        return;
      }

      if (isNaN(parseInt(formData.number_of_posts)) || parseInt(formData.number_of_posts) < 0) {
        Alert.alert('Error', 'Number of posts must be a non-negative number');
        return;
      }

      const commonData = {
        email: formData.email,
        google_drive_link: formData.google_drive_link,
        sch_start_range: formData.sch_start_range,
        sch_end_range: formData.sch_end_range,
        post_daily_range: parseInt(formData.number_of_posts),
        number_of_posts: 0,
        posts_left: 0,
        token_sesson: "{}",
      };

      switch (modalType) {
        case 'instagram':
          if (!formData.username || !formData.passwand || !formData.email) {
            Alert.alert('Error', 'Please fill in all required fields (Username, Password, Email)');
            return;
          }
          await ApiService.addInstagramAccount({
            username: formData.username,
            passwand: formData.passwand,
            password: formData.passwand,
            ...commonData,
          } as any);
          Alert.alert('Success', 'Instagram account added successfully!');
          break;

        case 'telegram':
          if (!formData.channel_name || !formData.email) {
            Alert.alert('Error', 'Please fill in all required fields (Channel Name, Email)');
            return;
          }
          await ApiService.addTelegramAccount({
            channel_name: formData.channel_name,
            ...commonData,
          } as any);
          Alert.alert('Success', 'Telegram channel added successfully!');
          break;

        case 'youtube':
          if (!formData.username || !formData.channel_id || !formData.email) {
            Alert.alert('Error', 'Please fill in all required fields (Channel Name, Channel ID, Email)');
            return;
          }
          await ApiService.addYouTubeAccount({
            username: formData.username,
            channel_id: formData.channel_id,
            ...commonData,
          } as any);
          Alert.alert('Success', 'YouTube channel added successfully!');
          break;
      }

      setModalVisible(false);
      await loadDashboardData();
    } catch (error: any) {
      console.error('Add account error:', error.response?.data || error.message);
      Alert.alert('Error', error.response?.data?.error || error.message || 'Failed to add account');
    }
  };

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return 'Good Morning';
    if (hour >= 12 && hour < 17) return 'Good Afternoon';
    return 'Good Evening';
  };

  const getFormattedDate = () => {
    const date = new Date();
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#1C2526" />
        <Text style={styles.loadingText}>Loading Dashboard...</Text>
      </View>
    );
  }

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
          
          <TouchableOpacity style={styles.actionButton} onPress={() => openAddModal('instagram')}>
            <FontAwesome name="instagram" size={20} color="#E4405F" style={styles.icon} />
            <Text style={styles.actionButtonText}>Add Instagram Accounts</Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.actionButton} onPress={() => openAddModal('telegram')}>
            <FontAwesome name="telegram" size={20} color="#0088cc" style={styles.icon} />
            <Text style={styles.actionButtonText}>Add Telegram Channels</Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.actionButton} onPress={() => navigation.navigate('Schedule')}>
            <Icon name="calendar-month" size={20} color="#104d29ff" style={styles.icon} />
            <Text style={styles.actionButtonText}>Update Schedules</Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.actionButton} onPress={() => navigation.navigate('Upload')}>
            <Icon name="file-upload" size={20} color="#782d85ff" style={styles.icon} />
            <Text style={styles.actionButtonText}>Upload Media</Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.actionButton} onPress={() => openAddModal('youtube')}>
            <FontAwesome name="youtube" size={20} color="#d32121ff" style={styles.icon} />
            <Text style={styles.actionButtonText}>Add YouTube Channels</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <TouchableOpacity style={styles.uploadButton} onPress={handleUploadForm}>
        <Text style={styles.uploadButtonText}>+</Text>
      </TouchableOpacity>

      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>
              Add {
                modalType === 'instagram' ? 'Instagram Account' :
                modalType === 'telegram' ? 'Telegram Channel' :
                'YouTube Channel'
              }
            </Text>
            {/* START OF UPDATED SECTION */}
            <ScrollView style={styles.modalForm}>
              {modalType === 'instagram' && (
                <>
                  <View style={styles.inputContainer}>
                    <Icon name="person" size={20} color="#666" style={styles.inputIcon} />
                    <TextInput
                      style={styles.input}
                      value={formData.username}
                      onChangeText={(text) => setFormData({ ...formData, username: text })}
                      placeholder="Username *"
                      placeholderTextColor="#999999"
                    />
                  </View>
                  <View style={styles.inputContainer}>
                    <Icon name="lock" size={20} color="#666" style={styles.inputIcon} />
                    <TextInput
                      style={styles.input}
                      value={formData.passwand}
                      onChangeText={(text) => setFormData({ ...formData, passwand: text })}
                      placeholder="Password *"
                      placeholderTextColor="#999999"
                      secureTextEntry
                    />
                  </View>
                </>
              )}

              {modalType === 'telegram' && (
                <View style={styles.inputContainer}>
                  <Icon name="chat" size={20} color="#666" style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    value={formData.channel_name}
                    onChangeText={(text) => setFormData({ ...formData, channel_name: text })}
                    placeholder="Channel Name *"
                    placeholderTextColor="#999999"
                  />
                </View>
              )}

              {modalType === 'youtube' && (
                <>
                  <View style={styles.inputContainer}>
                    <Icon name="video-library" size={20} color="#666" style={styles.inputIcon} />
                    <TextInput
                      style={styles.input}
                      value={formData.username}
                      onChangeText={(text) => setFormData({ ...formData, username: text })}
                      placeholder="Channel Name *"
                      placeholderTextColor="#999999"
                    />
                  </View>
                  <View style={styles.inputContainer}>
                    <Icon name="tag" size={20} color="#666" style={styles.inputIcon} />
                    <TextInput
                      style={styles.input}
                      value={formData.channel_id}
                      onChangeText={(text) => setFormData({ ...formData, channel_id: text })}
                      placeholder="Channel ID * (e.g., UC8sAvgYCMM7r_pVsiBkC5kw)"
                      placeholderTextColor="#999999"
                    />
                  </View>
                </>
              )}

              <View style={styles.inputContainer}>
                <Icon name="email" size={20} color="#666" style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  value={formData.email}
                  onChangeText={(text) => setFormData({ ...formData, email: text })}
                  placeholder="Email *"
                  placeholderTextColor="#999999"
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
              </View>

              <View style={styles.inputContainer}>
                <Icon name="cloud" size={20} color="#666" style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  value={formData.google_drive_link}
                  onChangeText={(text) => setFormData({ ...formData, google_drive_link: text })}
                  placeholder="Google Drive Folder Link"
                  placeholderTextColor="#999999"
                  autoCapitalize="none"
                />
              </View>

              <View style={styles.timeContainer}>
                <View style={[styles.timeInput, styles.inputContainer]}>
                  <Icon name="access-time" size={20} color="#666" style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    value={formData.sch_start_range}
                    onChangeText={(text) => setFormData({ ...formData, sch_start_range: text })}
                    placeholder="Start Time (HH:MM:SS) *"
                    placeholderTextColor="#999999"
                  />
                </View>
                <View style={[styles.timeInput, styles.inputContainer]}>
                  <Icon name="access-time" size={20} color="#666" style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    value={formData.sch_end_range}
                    onChangeText={(text) => setFormData({ ...formData, sch_end_range: text })}
                    placeholder="End Time (HH:MM:SS) *"
                    placeholderTextColor="#999999"
                  />
                </View>
              </View>

              <View style={styles.inputContainer}>
                <Icon name="format-list-numbered" size={20} color="#666" style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  value={formData.number_of_posts}
                  onChangeText={(text) => setFormData({ ...formData, number_of_posts: text })}
                  placeholder="Number of Posts *"
                  placeholderTextColor="#999999"
                  keyboardType="numeric"
                />
              </View>
            </ScrollView>
            {/* END OF UPDATED SECTION */}
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelButton} onPress={() => setModalVisible(false)}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveButton} onPress={handleAddAccount}>
                <Text style={styles.saveButtonText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#b4c5d8',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#b4c5d8',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#666',
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    width: '90%',
    maxHeight: '80%',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 16,
    textAlign: 'center',
  },
  modalForm: {
    maxHeight: 400,
  },
  // UPDATED STYLE
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 14,
    backgroundColor: '#fff',
    color: '#000000',
  },
  // NEW STYLES ADDED
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  inputIcon: {
    marginRight: 8,
  },
  timeContainer: {
    flexDirection: 'row',
    gap: 10,
  },
  timeInput: {
    flex: 1,
  },
  // END OF NEW STYLES
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 16,
    gap: 10,
  },
  cancelButton: {
    backgroundColor: '#ccc',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    flex: 1,
  },
  cancelButtonText: {
    color: '#333',
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '600',
  },
  saveButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    flex: 1,
  },
  saveButtonText: {
    color: '#fff',
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '600',
  },
});

export default DashboardScreen;