import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  RefreshControl,
  Modal,
  TextInput,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import ApiService from '../services/api';
import StorageService from '../utils/storage';
import { InstagramAccount, TelegramAccount, YouTubeAccount, User } from '../types';

const AccountsScreen: React.FC = () => {
  const [instagramAccounts, setInstagramAccounts] = useState<InstagramAccount[]>([]);
  const [telegramAccounts, setTelegramAccounts] = useState<TelegramAccount[]>([]);
  const [youtubeAccounts, setYoutubeAccounts] = useState<YouTubeAccount[]>([]);
  const [refreshing, setRefreshing] = useState(false);
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
    post_daily_range: '5',
    channel_id: '',
  });
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    loadUserData();
  }, []);

  const loadUserData = async () => {
    try {
      const userData = await StorageService.getUserData();
      if (!userData?.Id) {
        console.error('No user data or ID found in storage');
        Alert.alert('Error', 'User not logged in. Please log in again.');
        return;
      }
      const response = await ApiService.getUser(userData.Id);
      setUser(response.user);
      setInstagramAccounts(response.instagram_accounts || []);
      setTelegramAccounts(response.telegram_channels || []);
      setYoutubeAccounts(response.youtube_channels || []);
    } catch (error: any) {
      console.error('Error loading accounts:', error.response?.data?.error || error.message);
      Alert.alert('Error', error.response?.data?.error || 'Failed to load accounts. Check server or network.');
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadUserData();
    setRefreshing(false);
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
      post_daily_range: '5',
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
      
      if (isNaN(parseInt(formData.post_daily_range)) || parseInt(formData.post_daily_range) < 0) {
        Alert.alert('Error', 'No. of Posts Daily must be a non-negative number');
        return;
      }

      const commonData = {
        email: formData.email,
        google_drive_link: formData.google_drive_link,
        sch_start_range: formData.sch_start_range,
        sch_end_range: formData.sch_end_range,
        post_daily_range: parseInt(formData.post_daily_range),
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
          });
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
      await loadUserData();
    } catch (error: any) {
      console.error('Add account error:', error.response?.data || error.message);
      Alert.alert('Error', error.response?.data?.error || error.message || 'Failed to add account');
    }
  };

  const handleDeleteAccount = async (accountId: number, platform: 'instagram' | 'telegram' | 'youtube') => {
    Alert.alert(
      'Confirm Delete',
      'Are you sure you want to delete this account?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              switch (platform) {
                case 'instagram':
                  await ApiService.deleteInstagramAccount(accountId);
                  break;
                case 'telegram':
                  await ApiService.deleteTelegramAccount(accountId);
                  break;
                case 'youtube':
                  await ApiService.deleteYouTubeAccount(accountId);
                  break;
              }
              await loadUserData();
              Alert.alert('Success', 'Account deleted successfully!');
            } catch (error: any) {
              console.error('Delete error:', error.response?.data || error.message);
              Alert.alert('Error', error.response?.data?.error || error.message || 'Failed to delete account');
            }
          },
        },
      ]
    );
  };

  const isInTimeRange = (startTime: string, endTime: string) => {
    try {
      const now = new Date();
      
      const IST_OFFSET_SECONDS = 5 * 3600 + 30 * 60;
      let currentTime = (now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds() + IST_OFFSET_SECONDS) % (24 * 3600);
      
      const [startHours, startMinutes, startSeconds] = startTime.split(':').map(Number);
      const [endHours, endMinutes, endSeconds] = endTime.split(':').map(Number);
      
      const startTimeInSeconds = startHours * 3600 + startMinutes * 60 + startSeconds;
      let endTimeInSeconds = endHours * 3600 + endMinutes * 60 + endSeconds;
      
      if (endTimeInSeconds < startTimeInSeconds) {
          endTimeInSeconds += 24 * 3600; 
          
          if (currentTime < startTimeInSeconds) {
              currentTime += 24 * 3600; 
          }
      }
      
      return currentTime >= startTimeInSeconds && currentTime <= endTimeInSeconds;
    } catch (e) {
      console.error("Error calculating time range:", e);
      return true;
    }
  };

  const getAccountStatus = (account: any) => {
    const isInactiveBySelection = account.selected === 'No';
    const isOutsideTimeRange = !isInTimeRange(account.sch_start_range, account.sch_end_range);
    
    const hasDailyLimitReached = (
        (account.post_daily_range !== undefined && account.post_daily_range > 0) &&
        (account.post_daily_range_left !== undefined && account.post_daily_range_left <= 0)
    );
    
    const hasNoTotalPostsLeft = account.posts_left !== undefined && account.posts_left <= 0;
    
    const isInactive = isInactiveBySelection || isOutsideTimeRange || hasDailyLimitReached || hasNoTotalPostsLeft;
    
    let statusText = 'Active';
    let statusColor = '#34C759';

    if (isInactiveBySelection) {
      statusText = 'Inactive';
      statusColor = '#FF3B30';
    } else if (hasDailyLimitReached) {
      statusText = 'Daily Limit Reached';
      statusColor = '#FF9500';
    } else if (isOutsideTimeRange) {
      statusText = 'Outside Hours';
      statusColor = '#FF9500';
    } else if (hasNoTotalPostsLeft) {
      statusText = 'All Posts Used';
      statusColor = '#FF3B30';
    }
    
    return {
      isInactive,
      statusText,
      statusColor,
      isOutsideTimeRange,
      hasDailyLimitReached,
      isInactiveBySelection,
    };
  };

  const AccountCard = ({ account, platform }: { account: any; platform: 'instagram' | 'telegram' | 'youtube' }) => {
    const status = getAccountStatus(account);
    
    const postsLeftDaily = account.post_daily_range_left !== undefined ? account.post_daily_range_left : 'N/A';
    const totalPostsDaily = account.post_daily_range !== undefined ? account.post_daily_range : 'N/A';
    
    const postsLeft = account.posts_left !== undefined ? account.posts_left : 'N/A';
    const totalPosts = account.number_of_posts !== undefined ? account.number_of_posts : 'N/A';

    return (
      <View style={[
        styles.accountCard,
        status.isInactive && styles.inactiveAccountCard
      ]}>
        <View style={styles.accountHeader}>
          <Text style={[
            styles.accountTitle,
            status.isInactive && styles.inactiveAccountTitle
          ]}>
            {platform === 'instagram' ? account.username : 
             platform === 'telegram' ? account.channel_name :
             account.username}
          </Text>
          <View style={[styles.statusBadge, { backgroundColor: status.statusColor }]}>
            <Text style={styles.statusText}>{status.statusText}</Text>
          </View>
        </View>
        
        <Text style={[
          styles.accountEmail,
          status.isInactive && styles.inactiveText
        ]}>
          {account.email}
        </Text>
        
        <View style={styles.accountDetails}>
          <View style={styles.detailRow}>
            <Text style={[
              styles.accountInfo,
              status.isInactive && styles.inactiveText
            ]}>
              <Icon name="bar-chart" size={14} color={status.isInactive ? '#999' : '#666'} /> Posts Daily: {postsLeftDaily}/{totalPostsDaily}
            </Text>
            <Text style={[
              styles.accountInfo,
              status.isInactive && styles.inactiveText
            ]}>
              <Icon name="schedule" size={14} color={status.isInactive ? '#999' : '#666'} /> {account.sch_start_range} - {account.sch_end_range}
            </Text>
          </View>
          {account.number_of_posts > 0 && (
              <Text style={[
                styles.accountInfo,
                status.isInactive && styles.inactiveText,
                { marginTop: 4 }
              ]}>
                <Icon name="layers" size={14} color={status.isInactive ? '#999' : '#666'} /> Total Posts Left: {postsLeft}/{totalPosts}
              </Text>
          )}
        </View>

        <View style={styles.accountActions}>
          <TouchableOpacity
            style={styles.deleteButton}
            onPress={() => handleDeleteAccount(account.id, platform)}
          >
            <Icon name="delete" size={16} color="#fff" />
            <Text style={styles.deleteButtonText}>Delete</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const PlatformSection = ({ 
    title, 
    accounts, 
    platform,
    emptyMessage 
  }: { 
    title: string; 
    accounts: any[]; 
    platform: 'instagram' | 'telegram' | 'youtube';
    emptyMessage: string;
  }) => (
    <>
      <Text style={styles.sectionTitle}>{title}</Text>
      {accounts.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>{emptyMessage}</Text>
        </View>
      ) : (
        <View style={styles.accountsList}>
          {accounts.map((account) => (
            <AccountCard key={`${platform}-${account.id}`} account={account} platform={platform} />
          ))}
        </View>
      )}
      <TouchableOpacity 
        style={styles.addButton} 
        onPress={() => openAddModal(platform)}
      >
        <Icon name="add" size={16} color="#fff" />
        <Text style={styles.addButtonText}>Add {title}</Text>
      </TouchableOpacity>
    </>
  );

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.content}>
        <PlatformSection
          title="Instagram Accounts"
          accounts={instagramAccounts}
          platform="instagram"
          emptyMessage="No Instagram accounts added yet"
        />

        <PlatformSection
          title="Telegram Channels"
          accounts={telegramAccounts}
          platform="telegram"
          emptyMessage="No Telegram channels added yet"
        />

        <PlatformSection
          title="YouTube Channels"
          accounts={youtubeAccounts}
          platform="youtube"
          emptyMessage="No YouTube channels added yet"
        />
      </View>

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
                  value={formData.post_daily_range}
                  onChangeText={(text) => setFormData({ ...formData, post_daily_range: text })}
                  placeholder="No. of Posts Daily *"
                  placeholderTextColor="#999999"
                  keyboardType="numeric"
                />
              </View>
            </ScrollView>
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelButton} onPress={() => setModalVisible(false)}>
                <Icon name="cancel" size={16} color="#fff" />
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveButton} onPress={handleAddAccount}>
                <Icon name="save" size={16} color="#fff" />
                <Text style={styles.saveButtonText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  content: {
    padding: 15,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
    marginTop: 10,
  },
  accountsList: {
    marginBottom: 12,
  },
  addButton: {
    backgroundColor: '#0052cc',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 20,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  addButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  accountCard: {
    backgroundColor: '#ffffff',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    borderLeftWidth: 4,
    borderLeftColor: '#34C759',
  },
  inactiveAccountCard: {
    backgroundColor: '#f8f8f8',
    borderLeftColor: '#FF9500',
    shadowOpacity: 0.05,
  },
  accountHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  accountTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    flex: 1,
    marginRight: 8,
  },
  inactiveAccountTitle: {
    color: '#666',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    minWidth: 80,
    alignItems: 'center',
  },
  statusText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
  },
  accountEmail: {
    fontSize: 13,
    color: '#666',
    marginBottom: 8,
    fontWeight: '500',
  },
  accountDetails: {
    marginBottom: 8,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  accountInfo: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
    flex: 1,
  },
  inactiveText: {
    color: '#999',
  },
  accountActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 8,
  },
  deleteButton: {
    backgroundColor: '#b00020',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  deleteButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  emptyState: {
    backgroundColor: '#ffffff',
    padding: 20,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#ffffff',
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
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  inputIcon: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 14,
    backgroundColor: '#ffffff',
    color: '#000000', // Ensure text color is dark
  },
  timeContainer: {
    flexDirection: 'row',
    gap: 10,
  },
  timeInput: {
    flex: 1,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 16,
    gap: 10,
  },
  cancelButton: {
    backgroundColor: '#666666',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  cancelButtonText: {
    color: '#fff',
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '600',
  },
  saveButton: {
    backgroundColor: '#0052cc',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  saveButtonText: {
    color: '#fff',
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '600',
  },
});

export default AccountsScreen;