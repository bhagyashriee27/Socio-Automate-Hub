import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Modal,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  Switch,
} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import ApiService from '../services/api';
import StorageService from '../utils/storage';
import { InstagramAccount, TelegramAccount, User } from '../types';

const ScheduleScreen: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [instagramAccounts, setInstagramAccounts] = useState<InstagramAccount[]>([]);
  const [telegramAccounts, setTelegramAccounts] = useState<TelegramAccount[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingAccount, setEditingAccount] = useState<any>(null);
  const [formData, setFormData] = useState({
    username: '',
    password: '',
    channel_name: '',
    google_drive_link: '',
    sch_start_range: '',
    sch_end_range: '',
    number_of_posts: '',
    selected: false,
  });

  useEffect(() => {
    loadUserData();
  }, []);

  const loadUserData = async () => {
    try {
      const userData = await StorageService.getUserData();
      if (!userData?.Id) {
        Alert.alert('Error', 'User not logged in. Please log in again.');
        return;
      }
      setUser(userData);
      await loadScheduleData(userData.Id);
    } catch (error) {
      console.error('Error loading user data:', error);
      Alert.alert('Error', 'Failed to load user data');
    }
  };
  
  const loadScheduleData = async (userId: number) => {
    try {
      setLoading(true);
      console.log('Fetching user data for ID:', userId);
      const response = await ApiService.getUser(userId);
      console.log('Backend Response:', response);
      
      console.log('Instagram accounts:', response.instagram_accounts);
      console.log('Telegram channels:', response.telegram_channels);
      
      setInstagramAccounts(response.instagram_accounts || []);
      setTelegramAccounts(response.telegram_channels || []);
      
      if (response.instagram_accounts?.length > 0) {
        debugAccountData(response.instagram_accounts, 'Instagram');
      }
      if (response.telegram_channels?.length > 0) {
        debugAccountData(response.telegram_channels, 'Telegram');
      }
      
    } catch (error: any) {
      console.error('API Error Details:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status
      });
      Alert.alert('Error', error.response?.data?.error || 'Failed to load schedule data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const debugAccountData = (accounts: any[], platform: string) => {
    console.log(`${platform} Accounts Debug:`);
    accounts.forEach((acc, index) => {
      console.log(`Account ${index + 1}:`, {
        id: acc.id,
        username: acc.username,
        channel_name: acc.channel_name,
        email: acc.email,
        selected: acc.selected,
        posts_left: acc.posts_left,
        number_of_posts: acc.number_of_posts,
        google_drive_link: acc.google_drive_link,
        sch_start_range: acc.sch_start_range,
        sch_end_range: acc.sch_end_range,
        hasPassword: !!(acc.passwand && acc.passwand.trim() !== '')
      });
    });
  };

  const onRefresh = async () => {
    setRefreshing(true);
    if (user?.Id) {
      await loadScheduleData(user.Id);
    }
  };

  const openEditModal = (account: any, platform: 'instagram' | 'telegram') => {
    setEditingAccount({ ...account, platform });
    setFormData({
      username: account.username || account.channel_name || '',
      password: account.passwand || '',
      channel_name: account.channel_name || '',
      google_drive_link: account.google_drive_link || '',
      sch_start_range: account.sch_start_range || '09:00:00',
      sch_end_range: account.sch_end_range || '17:00:00',
      number_of_posts: account.number_of_posts?.toString() || '5',
      selected: account.selected === 'Yes',
    });
    setModalVisible(true);
  };

  const handleUpdateAccount = async () => {
    if (!editingAccount) return;

    try {
      if (!formData.username && !formData.channel_name) {
        Alert.alert('Error', 'Username/Channel Name is required');
        return;
      }

      if (formData.sch_start_range && !/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/.test(formData.sch_start_range)) {
        Alert.alert('Error', 'Start time must be in HH:MM:SS format');
        return;
      }

      if (formData.sch_end_range && !/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/.test(formData.sch_end_range)) {
        Alert.alert('Error', 'End time must be in HH:MM:SS format');
        return;
      }

      if (isNaN(parseInt(formData.number_of_posts)) || parseInt(formData.number_of_posts) <= 0) {
        Alert.alert('Error', 'Number of posts must be a positive number');
        return;
      }

      const updateData: any = {
        email: editingAccount.email,
        sch_start_range: formData.sch_start_range,
        sch_end_range: formData.sch_end_range,
        number_of_posts: parseInt(formData.number_of_posts),
        selected: formData.selected ? 'Yes' : 'No',
      };

      if (editingAccount.platform === 'instagram') {
        if (formData.username) updateData.username = formData.username;
        if (formData.password) updateData.password = formData.password;
        if (formData.google_drive_link) updateData.google_drive_link = formData.google_drive_link;
        
        console.log('Updating Instagram account:', updateData);
        await ApiService.updateInstagramAccount(editingAccount.id, updateData);
      } else {
        if (formData.channel_name) updateData.channel_name = formData.channel_name;
        if (formData.google_drive_link) updateData.google_drive_link = formData.google_drive_link;
        if (editingAccount.token_sesson) updateData.token_sesson = editingAccount.token_sesson;
        
        console.log('Updating Telegram account:', updateData);
        await ApiService.updateTelegramAccount(editingAccount.id, updateData);
      }

      Alert.alert('Success', 'Account updated successfully!');
      setModalVisible(false);
      if (user?.Id) {
        await loadScheduleData(user.Id);
      }
    } catch (error: any) {
      console.error('Update Error:', error.response?.data);
      Alert.alert('Error', error.response?.data?.error || 'Failed to update account');
    }
  };

  const toggleAccountStatus = async (account: any, platform: 'instagram' | 'telegram') => {
    try {
      const newStatus = account.selected === 'Yes' ? 'No' : 'Yes';
      
      const updateData: any = {
        email: account.email,
        sch_start_range: account.sch_start_range || '09:00:00',
        sch_end_range: account.sch_end_range || '17:00:00',
        number_of_posts: parseInt(account.number_of_posts) || 5,
        selected: newStatus
      };

      if (platform === 'instagram') {
        updateData.username = account.username;
        if (account.passwand && account.passwand.trim() !== '') {
          updateData.password = account.passwand;
        }
      } else {
        updateData.channel_name = account.channel_name;
        updateData.token_sesson = account.token_sesson;
      }

      console.log(`Toggling ${platform} account:`, updateData);

      let response;
      if (platform === 'instagram') {
        response = await ApiService.updateInstagramAccount(account.id, updateData);
      } else {
        response = await ApiService.updateTelegramAccount(account.id, updateData);
      }

      console.log('Toggle response:', response);

      if (platform === 'instagram') {
        setInstagramAccounts(prev => 
          prev.map(acc => 
            acc.id === account.id ? { ...acc, selected: newStatus } : acc
          )
        );
      } else {
        setTelegramAccounts(prev => 
          prev.map(acc => 
            acc.id === account.id ? { ...acc, selected: newStatus } : acc
          )
        );
      }

      Alert.alert('Success', `Account ${newStatus === 'Yes' ? 'activated' : 'deactivated'} successfully!`);
    } catch (error: any) {
      console.error('Toggle Error Details:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status
      });
      
      const errorMessage = error.response?.data?.error || 'Failed to update account status';
      Alert.alert('Update Failed', errorMessage);
      
      if (platform === 'instagram') {
        setInstagramAccounts(prev => 
          prev.map(acc => 
            acc.id === account.id ? { ...acc, selected: account.selected } : acc
          )
        );
      } else {
        setTelegramAccounts(prev => 
          prev.map(acc => 
            acc.id === account.id ? { ...acc, selected: account.selected } : acc
          )
        );
      }
    }
  };

  const deleteAccount = async (accountId: number, platform: 'instagram' | 'telegram') => {
    Alert.alert(
      'Confirm Delete',
      'Are you sure you want to delete this account? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              if (platform === 'instagram') {
                await ApiService.deleteInstagramAccount(accountId);
                setInstagramAccounts(prev => prev.filter(acc => acc.id !== accountId));
              } else {
                await ApiService.deleteTelegramAccount(accountId);
                setTelegramAccounts(prev => prev.filter(acc => acc.id !== accountId));
              }
              Alert.alert('Success', 'Account deleted successfully!');
            } catch (error: any) {
              console.error('Delete Error:', error.response?.data);
              Alert.alert('Error', error.response?.data?.error || 'Failed to delete account');
            }
          },
        },
      ]
    );
  };

  const isInTimeRange = (startTime: string, endTime: string) => {
    if (!startTime || !endTime) return false;
    
    const now = new Date();
    const currentTime = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    
    try {
      const [startHours, startMinutes, startSeconds] = startTime.split(':').map(Number);
      const [endHours, endMinutes, endSeconds] = endTime.split(':').map(Number);
      
      const startTimeInSeconds = startHours * 3600 + startMinutes * 60 + startSeconds;
      const endTimeInSeconds = endHours * 3600 + endMinutes * 60 + endSeconds;
      
      return currentTime >= startTimeInSeconds && currentTime <= endTimeInSeconds;
    } catch (error) {
      console.error('Error parsing time range:', error);
      return false;
    }
  };

  const getAccountStatus = (account: any) => {
    const postsLeft = parseInt(account.posts_left) || 0;
    const totalPosts = parseInt(account.number_of_posts) || 0;
    const isInactiveBySelection = account.selected !== 'Yes';
    const isOutsideTimeRange = !isInTimeRange(account.sch_start_range, account.sch_end_range);
    const hasNoPosts = postsLeft <= 0;
    
    const isInactive = isInactiveBySelection || isOutsideTimeRange || hasNoPosts;
    
    let statusText = 'Active';
    let statusColor = '#34C759';
    let statusIcon = 'checkmark-circle';
    
    if (hasNoPosts) {
      statusText = 'No Posts';
      statusColor = '#FF9500';
      statusIcon = 'alert-circle';
    } else if (isOutsideTimeRange) {
      statusText = 'Outside Hours';
      statusColor = '#FF9500';
      statusIcon = 'alert-circle';
    } else if (isInactiveBySelection) {
      statusText = 'Inactive';
      statusColor = '#FF3B30';
      statusIcon = 'close-circle';
    }
    
    return {
      isInactive,
      statusText,
      statusColor,
      statusIcon,
      isOutsideTimeRange,
      hasNoPosts,
      isInactiveBySelection,
    };
  };

  const AccountCard = ({ account, platform }: { account: any; platform: 'instagram' | 'telegram' }) => {
    const status = getAccountStatus(account);
    const postsLeft = parseInt(account.posts_left) || 0;
    const totalPosts = parseInt(account.number_of_posts) || 0;
    
    return (
      <View style={[
        styles.accountCard,
        status.isInactive && styles.inactiveAccountCard
      ]}>
        <View style={styles.accountHeader}>
          <View style={styles.accountTitleContainer}>
            <Text style={[
              styles.accountName,
              status.isInactive && styles.inactiveAccountName
            ]}>
              {platform === 'instagram' ? account.username : account.channel_name}
            </Text>
            <View style={[styles.statusBadge, { backgroundColor: status.statusColor }]}>
              <Ionicons name={status.statusIcon} size={14} color="#fff" style={styles.statusIcon} />
              <Text style={styles.statusText}>{status.statusText}</Text>
            </View>
          </View>
          {/* <Switch
            value={account.selected === 'Yes'}
            onValueChange={() => toggleAccountStatus(account, platform)}
            trackColor={{ false: '#6B7280', true: '#1C2526' }}
            thumbColor={account.selected === 'Yes' ? '#1C2526' : '#6B7280'}
          /> */}
        </View>

        <View style={styles.accountDetails}>
          <Text style={[
            styles.detailText,
            status.isInactive && styles.inactiveText
          ]}>
            <Ionicons name="mail" size={14} color={status.isInactive ? '#6B7280' : '#1C2526'} /> {account.email}
          </Text>
          <View style={styles.detailRow}>
            <Text style={[
              styles.detailText,
              status.isInactive && styles.inactiveText
            ]}>
              <Ionicons name="time" size={14} color={status.isInactive ? '#6B7280' : '#1C2526'} /> {account.sch_start_range || '09:00:00'} - {account.sch_end_range || '17:00:00'}
            </Text>
            <Text style={[
              styles.detailText,
              status.isInactive && styles.inactiveText
            ]}>
              <Ionicons name="stats-chart" size={14} color={status.isInactive ? '#6B7280' : '#1C2526'} /> {postsLeft}/{totalPosts} posts
            </Text>
          </View>
          
          {status.hasNoPosts && (
            <Text style={styles.warningText}>
              <Ionicons name="alert-circle" size={14} color="#FF9500" /> No posts remaining
            </Text>
          )}
          
          {status.isOutsideTimeRange && account.selected === 'Yes' && (
            <Text style={styles.warningText}>
              <Ionicons name="alert-circle" size={14} color="#FF9500" /> Outside scheduled hours
            </Text>
          )}
          
          {account.google_drive_link ? (
            <Text style={styles.driveLink} numberOfLines={1}>
              <Ionicons name="folder" size={14} color="#007AFF" /> Drive: {account.google_drive_link}
            </Text>
          ) : (
            <Text style={styles.warningText}>
              <Ionicons name="alert-circle" size={14} color="#FF9500" /> No Google Drive configured
            </Text>
          )}
        </View>

        <View style={styles.accountActions}>
          <TouchableOpacity
            style={styles.editButton}
            onPress={() => openEditModal(account, platform)}
          >
            <Ionicons name="create" size={14} color="#fff" />
            <Text style={styles.editButtonText}> Edit</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.deleteButton}
            onPress={() => deleteAccount(account.id, platform)}
          >
            <Ionicons name="trash" size={14} color="#fff" />
            <Text style={styles.deleteButtonText}> Delete</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#1C2526" />
        <Text style={styles.loadingText}>Loading schedule data...</Text>
      </View>
    );
  }

  const allAccounts = [...instagramAccounts, ...telegramAccounts];
  const activeAccounts = allAccounts.filter(acc => acc.selected === 'Yes');
  const accountsInTimeRange = allAccounts.filter(acc => 
    acc.selected === 'Yes' && isInTimeRange(acc.sch_start_range, acc.sch_end_range)
  );
  const totalPostsLeft = allAccounts.reduce((sum, acc) => sum + (parseInt(String(acc.posts_left)) || 0), 0);

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <View style={styles.header}>
          <Text style={styles.headerTitle}>
            <Ionicons name="calendar" size={20} color="#1C2526" /> Schedule Management
          </Text>
          <View style={styles.statsContainer}>
            <View style={styles.statItem}>
              <Text style={styles.statNumber}>{allAccounts.length}</Text>
              <Text style={styles.statLabel}>Total Accounts</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statNumber}>{activeAccounts.length}</Text>
              <Text style={styles.statLabel}>Active</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statNumber}>{accountsInTimeRange.length}</Text>
              <Text style={styles.statLabel}>In Time Range</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statNumber}>{totalPostsLeft}</Text>
              <Text style={styles.statLabel}>Posts Left</Text>
            </View>
          </View>
        </View>
        <View style={styles.helpSection}>
          <Text style={styles.helpTitle}>
            <Ionicons name="bulb" size={16} color="#007AFF" /> Scheduling Tips
          </Text>
          <View style={styles.tipItem}>
            <Text style={styles.tipText}>• Accounts will only post during their scheduled time ranges</Text>
          </View>
          <View style={styles.tipItem}>
            <Text style={styles.tipText}>• Make sure Google Drive links are properly configured</Text>
          </View>
          <View style={styles.tipItem}>
            <Text style={styles.tipText}>• Monitor post counts to avoid running out of scheduled posts</Text>
          </View>
        </View>
        {/* <View style={styles.quickActions}>
          <Text style={styles.sectionTitle}>Quick Actions</Text>
          <View style={styles.actionButtons}>
            <TouchableOpacity style={styles.quickActionButton}>
              <Ionicons name="refresh" size={14} color="#1C2526" />
              <Text style={styles.quickActionText}> Reset All</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.quickActionButton}>
              <Ionicons name="play" size={14} color="#1C2526" />
              <Text style={styles.quickActionText}> Activate All</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.quickActionButton}>
              <Ionicons name="pause" size={14} color="#1C2526" />
              <Text style={styles.quickActionText}> Pause All</Text>
            </TouchableOpacity>
          </View>
        </View> */}

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>
              <Ionicons name="logo-instagram" size={20} color="#1C2526" /> Instagram Accounts
            </Text>
            <Text style={styles.sectionSubtitle}>
              {instagramAccounts.filter(acc => acc.selected === 'Yes').length} active • {' '}
              {instagramAccounts.filter(acc => acc.selected === 'Yes' && isInTimeRange(acc.sch_start_range, acc.sch_end_range)).length} in time range
            </Text>
          </View>
          {instagramAccounts.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No Instagram accounts added</Text>
              <Text style={styles.emptySubtext}>Add accounts to start scheduling posts</Text>
            </View>
          ) : (
            instagramAccounts.map((account) => (
              <AccountCard key={`ig-${account.id}`} account={account} platform="instagram" />
            ))
          )}
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>
              <Ionicons name="paper-plane" size={20} color="#1C2526" /> Telegram Channels
            </Text>
            <Text style={styles.sectionSubtitle}>
              {telegramAccounts.filter(acc => acc.selected === 'Yes').length} active • {' '}
              {telegramAccounts.filter(acc => acc.selected === 'Yes' && isInTimeRange(acc.sch_start_range, acc.sch_end_range)).length} in time range
            </Text>
          </View>
          {telegramAccounts.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No Telegram channels added</Text>
              <Text style={styles.emptySubtext}>Add channels to start scheduling posts</Text>
            </View>
          ) : (
            telegramAccounts.map((account) => (
              <AccountCard key={`tg-${account.id}`} account={account} platform="telegram" />
            ))
          )}
        </View>

        {/* <View style={styles.helpSection}>
          <Text style={styles.helpTitle}>
            <Ionicons name="bulb" size={16} color="#007AFF" /> Scheduling Tips
          </Text>
          <View style={styles.tipItem}>
            <Text style={styles.tipText}>• Accounts will only post during their scheduled time ranges</Text>
          </View>
          <View style={styles.tipItem}>
            <Text style={styles.tipText}>• Make sure Google Drive links are properly configured</Text>
          </View>
          <View style={styles.tipItem}>
            <Text style={styles.tipText}>• Monitor post counts to avoid running out of scheduled posts</Text>
          </View>
        </View> */}
      </ScrollView>

      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <ScrollView style={styles.modalScroll}>
              <Text style={styles.modalTitle}>
                <Ionicons name="create" size={20} color="#1C2526" /> Edit {editingAccount?.platform === 'instagram' ? 'Instagram' : 'Telegram'} Account
              </Text>

              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>
                  {editingAccount?.platform === 'instagram' ? 'Username' : 'Channel Name'} *
                </Text>
                <TextInput
                  style={styles.input}
                  value={editingAccount?.platform === 'instagram' ? formData.username : formData.channel_name}
                  onChangeText={(text) => 
                    editingAccount?.platform === 'instagram' 
                      ? setFormData({...formData, username: text})
                      : setFormData({...formData, channel_name: text})
                  }
                  placeholder={editingAccount?.platform === 'instagram' ? 'Enter username' : 'Enter channel name'}
                />
              </View>

              {editingAccount?.platform === 'instagram' && (
                <View style={styles.inputContainer}>
                  <Text style={styles.inputLabel}>Password</Text>
                  <TextInput
                    style={styles.input}
                    value={formData.password}
                    onChangeText={(text) => setFormData({...formData, password: text})}
                    placeholder="Enter new password (leave blank to keep current)"
                    secureTextEntry
                  />
                </View>
              )}

              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>Google Drive Link</Text>
                <TextInput
                  style={styles.input}
                  value={formData.google_drive_link}
                  onChangeText={(text) => setFormData({...formData, google_drive_link: text})}
                  placeholder="https://drive.google.com/drive/folders/..."
                />
              </View>

              <View style={styles.timeContainer}>
                <View style={styles.timeInput}>
                  <Text style={styles.inputLabel}>Start Time *</Text>
                  <TextInput
                    style={styles.input}
                    value={formData.sch_start_range}
                    onChangeText={(text) => setFormData({...formData, sch_start_range: text})}
                    placeholder="09:00:00"
                  />
                </View>
                <View style={styles.timeInput}>
                  <Text style={styles.inputLabel}>End Time *</Text>
                  <TextInput
                    style={styles.input}
                    value={formData.sch_end_range}
                    onChangeText={(text) => setFormData({...formData, sch_end_range: text})}
                    placeholder="17:00:00"
                  />
                </View>
              </View>

              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>Number of Posts *</Text>
                <TextInput
                  style={styles.input}
                  value={formData.number_of_posts}
                  onChangeText={(text) => setFormData({...formData, number_of_posts: text})}
                  placeholder="5"
                  keyboardType="numeric"
                />
              </View>

              <View style={styles.switchContainer}>
                <Text style={styles.inputLabel}>Active Schedule</Text>
                <Switch
                  value={formData.selected}
                  onValueChange={(value) => setFormData({...formData, selected: value})}
                  trackColor={{ false: '#6B7280', true: '#1C2526' }}
                  thumbColor={formData.selected ? '#1C2526' : '#6B7280'}
                />
              </View>

              {formData.sch_start_range && formData.sch_end_range && (
                <View style={styles.statusPreview}>
                  <Text style={styles.statusPreviewTitle}>Status Preview:</Text>
                  <View style={styles.statusPreviewContent}>
                    <Ionicons
                      name={formData.selected 
                        ? (isInTimeRange(formData.sch_start_range, formData.sch_end_range) 
                            ? 'checkmark-circle' 
                            : 'alert-circle')
                        : 'close-circle'}
                      size={14}
                      color={isInTimeRange(formData.sch_start_range, formData.sch_end_range) && formData.selected ? '#34C759' : '#FF9500'}
                    />
                    <Text style={[
                      styles.statusPreviewText,
                      { 
                        color: isInTimeRange(formData.sch_start_range, formData.sch_end_range) && formData.selected ? '#34C759' : '#FF9500' 
                      }
                    ]}>
                      {formData.selected 
                        ? (isInTimeRange(formData.sch_start_range, formData.sch_end_range) 
                            ? ' Active and in time range' 
                            : ' Active but outside time range')
                        : ' Inactive'}
                    </Text>
                  </View>
                </View>
              )}

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={styles.cancelButton}
                  onPress={() => setModalVisible(false)}
                >
                  <Ionicons name="close" size={16} color="#333" />
                  <Text style={styles.cancelButtonText}> Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.saveButton}
                  onPress={handleUpdateAccount}
                >
                  <Ionicons name="save" size={16} color="#fff" />
                  <Text style={styles.saveButtonText}> Save Changes</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  scrollView: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 20,
    gap: 10,
  },
  cancelButton: {
    backgroundColor: '#f8f8f8',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderColor: '#ddd',
    marginRight: 10,
  },
  saveButton: {
    backgroundColor: '#34C759',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  cancelButtonText: {
    color: '#333',
    fontSize: 13,
    fontWeight: '600',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#6B7280',
  },
  header: {
    backgroundColor: '#fff',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 15,
    textAlign: 'center',
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statItem: {
    alignItems: 'center',
    flex: 1,
  },
  statNumber: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1C2526',
  },
  statLabel: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 4,
    textAlign: 'center',
  },
  quickActions: {
    padding: 15,
    backgroundColor: '#fff',
    margin: 15,
    borderRadius: 12,
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  quickActionButton: {
    flex: 1,
    backgroundColor: '#f8f8f8',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 5,
  },
  quickActionText: {
    fontSize: 12,
    color: '#333',
    fontWeight: '500',
  },
  section: {
    padding: 15,
  },
  sectionHeader: {
    marginBottom: 15,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
  },
  sectionSubtitle: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 4,
  },
  accountCard: {
    backgroundColor: '#fff',
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
  },
  accountHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  accountTitleContainer: {
    flex: 1,
  },
  accountName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
  },
  inactiveAccountName: {
    color: '#6B7280',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  statusIcon: {
    marginRight: 5,
  },
  statusText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  accountDetails: {
    marginBottom: 12,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  detailText: {
    fontSize: 13,
    color: '#666',
    marginBottom: 4,
  },
  inactiveText: {
    color: '#999',
  },
  warningText: {
    fontSize: 12,
    color: '#FF9500',
    marginBottom: 4,
    fontStyle: 'italic',
  },
  driveLink: {
    fontSize: 11,
    color: '#007AFF',
    marginBottom: 4,
    fontStyle: 'italic',
  },
  accountActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  editButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  editButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  deleteButton: {
    backgroundColor: '#FF3B30',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  deleteButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  emptyState: {
    backgroundColor: '#fff',
    padding: 30,
    borderRadius: 12,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: '#6B7280',
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
  },
  helpSection: {
    backgroundColor: '#e8f4fd',
    margin: 15,
    padding: 15,
    borderRadius: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#007AFF',
  },
  helpTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#007AFF',
    marginBottom: 10,
  },
  tipItem: {
    marginBottom: 8,
  },
  tipText: {
    fontSize: 13,
    color: '#007AFF',
    lineHeight: 18,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 15,
    padding: 20,
    width: '90%',
    maxHeight: '80%',
  },
  modalScroll: {
    maxHeight: '100%',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 20,
    textAlign: 'center',
  },
  inputContainer: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 16,
    fontWeight: '500',
    color: '#333',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    backgroundColor: '#fff',
  },
  timeContainer: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  timeInput: {
    flex: 1,
  },
  switchContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  statusPreview: {
    backgroundColor: '#f8f8f8',
    padding: 12,
    borderRadius: 8,
    marginBottom: 20,
  },
  statusPreviewContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  statusPreviewTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  statusPreviewText: {
    fontSize: 13,
    fontWeight: '500',
  },
});

export default ScheduleScreen;