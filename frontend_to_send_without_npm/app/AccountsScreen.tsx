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
import ApiService from '../services/api';
import StorageService from '../utils/storage';
import { InstagramAccount, TelegramAccount, User } from '../types';

const AccountsScreen: React.FC = () => {
  const [instagramAccounts, setInstagramAccounts] = useState<InstagramAccount[]>([]);
  const [telegramAccounts, setTelegramAccounts] = useState<TelegramAccount[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [modalType, setModalType] = useState<'instagram' | 'telegram'>('instagram');
  const [formData, setFormData] = useState({
    username: '',
    password: '',
    email: '',
    channel_name: '',
    token_sesson: '',
    google_drive_link: '',
    sch_start_range: '09:00:00',
    sch_end_range: '17:00:00',
    number_of_posts: '5',
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
    } catch (error: any) {
      console.error('Error loading accounts:', error.response?.data?.error || error.message);
      Alert.alert('Error', 'Failed to load accounts. Check server or network.');
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadUserData();
    setRefreshing(false);
  };

  const openAddModal = (type: 'instagram' | 'telegram') => {
    setModalType(type);
    setFormData({
      username: '',
      password: '',
      email: '',
      channel_name: '',
      token_sesson: '',
      google_drive_link: '',
      sch_start_range: '09:00:00',
      sch_end_range: '17:00:00',
      number_of_posts: '5',
    });
    setModalVisible(true);
  };

  const handleAddAccount = async () => {
    try {
      if (modalType === 'instagram') {
        if (!formData.username || !formData.password || !formData.email) {
          Alert.alert('Error', 'Please fill in all required fields (Username, Password, Email)');
          return;
        }
        const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/;
        if (!timeRegex.test(formData.sch_start_range) || !timeRegex.test(formData.sch_end_range)) {
          Alert.alert('Error', 'Please enter valid time in HH:MM:SS format (e.g., 09:00:00)');
          return;
        }
        if (isNaN(parseInt(formData.number_of_posts)) || parseInt(formData.number_of_posts) <= 0) {
          Alert.alert('Error', 'Number of posts must be a positive number');
          return;
        }
        await ApiService.addInstagramAccount({
          username: formData.username,
          password: formData.password,
          email: formData.email,
          google_drive_link: formData.google_drive_link,
          sch_start_range: formData.sch_start_range,
          sch_end_range: formData.sch_end_range,
          number_of_posts: parseInt(formData.number_of_posts),
          posts_left: parseInt(formData.number_of_posts),
        });
        Alert.alert('Success', 'Instagram account added successfully!');
      } else {
        if (!formData.channel_name || !formData.token_sesson || !formData.email) {
          Alert.alert('Error', 'Please fill in all required fields (Channel Name, Token, Email)');
          return;
        }
        if (isNaN(parseInt(formData.number_of_posts)) || parseInt(formData.number_of_posts) <= 0) {
          Alert.alert('Error', 'Number of posts must be a positive number');
          return;
        }
        await ApiService.addTelegramAccount({
          channel_name: formData.channel_name,
          token_sesson: formData.token_sesson,
          email: formData.email,
          google_drive_link: formData.google_drive_link,
          sch_start_range: formData.sch_start_range,
          sch_end_range: formData.sch_end_range,
          number_of_posts: parseInt(formData.number_of_posts),
          posts_left: parseInt(formData.number_of_posts),
        });
        Alert.alert('Success', 'Telegram account added successfully!');
      }
      setModalVisible(false);
      await loadUserData();
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to add account');
    }
  };

  const handleDeleteAccount = async (accountId: number, isInstagram: boolean) => {
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
              if (isInstagram) {
                await ApiService.deleteInstagramAccount(accountId);
              } else {
                await ApiService.deleteTelegramAccount(accountId);
              }
              await loadUserData();
              Alert.alert('Success', 'Account deleted successfully!');
            } catch (error: any) {
              Alert.alert('Error', 'Failed to delete account');
            }
          },
        },
      ]
    );
  };

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.content}>
        <Text style={styles.sectionTitle}>Instagram Accounts</Text>
        {instagramAccounts.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No Instagram accounts added yet</Text>
          </View>
        ) : (
          <View style={styles.accountsList}>
            {instagramAccounts.map((account) => {
              const now = new Date('2025-08-13T03:11:00+05:30'); // Current time: 03:11 AM IST
              const [endHours, endMinutes, endSeconds] = account.sch_end_range.split(':').map(Number);
              const endTime = new Date(now);
              endTime.setHours(endHours, endMinutes, endSeconds, 0);
              const isInactive = account.selected === 'No' || now > endTime;

              return (
                <View key={account.id} style={styles.accountCard}>
                  <View style={styles.accountHeader}>
                    <Text style={styles.accountTitle}>{account.username}</Text>
                    <View
                      style={[
                        styles.statusBadge,
                        { backgroundColor: isInactive ? '#FF9500' : '#34C759' },
                      ]}
                    >
                      <Text style={styles.statusText}>{isInactive ? 'Inactive' : 'Active'}</Text>
                    </View>
                  </View>
                  <Text style={styles.accountEmail}>{account.email}</Text>
                  <Text style={styles.accountInfo}>Posts Left: {account.posts_left}</Text>
                  <View style={styles.accountActions}>
                    <TouchableOpacity
                      style={styles.deleteButton}
                      onPress={() => handleDeleteAccount(account.id, true)}
                    >
                      <Text style={styles.deleteButtonText}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </View>
        )}
        <TouchableOpacity style={styles.addButton} onPress={() => openAddModal('instagram')}>
          <Text style={styles.addButtonText}>+ Add Instagram Account</Text>
        </TouchableOpacity>

        <Text style={styles.sectionTitle}>Telegram Channels</Text>
        {telegramAccounts.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No Telegram channels added yet</Text>
          </View>
        ) : (
          <View style={styles.accountsList}>
            {telegramAccounts.map((account) => {
              const now = new Date('2025-08-13T03:11:00+05:30'); // Current time: 03:11 AM IST
              const [endHours, endMinutes, endSeconds] = account.sch_end_range.split(':').map(Number);
              const endTime = new Date(now);
              endTime.setHours(endHours, endMinutes, endSeconds, 0);
              const isInactive = account.selected === 'No' || now > endTime;

              return (
                <View key={account.id} style={styles.accountCard}>
                  <View style={styles.accountHeader}>
                    <Text style={styles.accountTitle}>{account.channel_name}</Text>
                    <View
                      style={[
                        styles.statusBadge,
                        { backgroundColor: isInactive ? '#FF9500' : '#34C759' },
                      ]}
                    >
                      <Text style={styles.statusText}>{isInactive ? 'Inactive' : 'Active'}</Text>
                    </View>
                  </View>
                  <Text style={styles.accountEmail}>{account.email}</Text>
                  <Text style={styles.accountInfo}>Posts Left: {account.posts_left}</Text>
                  <View style={styles.accountActions}>
                    <TouchableOpacity
                      onPress={() => handleDeleteAccount(account.id, false)}
                      style={styles.deleteButton}
                    >
                      <Text style={styles.deleteButtonText}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </View>
        )}
        <TouchableOpacity style={styles.addButton} onPress={() => openAddModal('telegram')}>
          <Text style={styles.addButtonText}>+ Add Telegram Channel</Text>
        </TouchableOpacity>
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
              Add {modalType === 'instagram' ? 'Instagram Account' : 'Telegram Channel'}
            </Text>
            <ScrollView style={styles.modalForm}>
              {modalType === 'instagram' ? (
                <>
                  <TextInput
                    style={styles.input}
                    value={formData.username}
                    onChangeText={(text) => setFormData({ ...formData, username: text })}
                    placeholder="Username"
                  />
                  <TextInput
                    style={styles.input}
                    value={formData.password}
                    onChangeText={(text) => setFormData({ ...formData, password: text })}
                    placeholder="Password"
                    secureTextEntry
                  />
                </>
              ) : (
                <>
                  <TextInput
                    style={styles.input}
                    value={formData.channel_name}
                    onChangeText={(text) => setFormData({ ...formData, channel_name: text })}
                    placeholder="Channel Name"
                  />
                  <TextInput
                    style={styles.input}
                    value={formData.token_sesson}
                    onChangeText={(text) => setFormData({ ...formData, token_sesson: text })}
                    placeholder="Token"
                  />
                </>
              )}
              <TextInput
                style={styles.input}
                value={formData.email}
                onChangeText={(text) => setFormData({ ...formData, email: text })}
                placeholder="Email"
              />
              <TextInput
                style={styles.input}
                value={formData.google_drive_link}
                onChangeText={(text) => setFormData({ ...formData, google_drive_link: text })}
                placeholder="Google Drive Link (optional)"
              />
              <TextInput
                style={styles.input}
                value={formData.sch_start_range}
                onChangeText={(text) => setFormData({ ...formData, sch_start_range: text })}
                placeholder="Start Time (HH:MM:SS)"
              />
              <TextInput
                style={styles.input}
                value={formData.sch_end_range}
                onChangeText={(text) => setFormData({ ...formData, sch_end_range: text })}
                placeholder="End Time (HH:MM:SS)"
              />
              <TextInput
                style={styles.input}
                value={formData.number_of_posts}
                onChangeText={(text) => setFormData({ ...formData, number_of_posts: text })}
                placeholder="Number of Posts"
                keyboardType="numeric"
              />
            </ScrollView>
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
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  content: {
    padding: 15,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
  },
  accountsList: {
    marginBottom: 12,
  },
  addButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 15,
  },
  addButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  accountCard: {
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 10,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 3,
  },
  accountHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  accountTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  statusBadge: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 10,
  },
  statusText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '600',
  },
  accountEmail: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
  },
  accountInfo: {
    fontSize: 12,
    color: '#666',
    marginBottom: 6,
  },
  accountActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 6,
  },
  deleteButton: {
    backgroundColor: '#FF3B30',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  deleteButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  emptyState: {
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 14,
    color: '#666',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 15,
    width: '90%',
    maxHeight: '70%',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
    textAlign: 'center',
  },
  modalForm: {
    maxHeight: 300,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    marginBottom: 10,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  cancelButton: {
    backgroundColor: '#ccc',
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: 6,
    flex: 0.45,
  },
  cancelButtonText: {
    color: '#333',
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '600',
  },
  saveButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: 6,
    flex: 0.45,
  },
  saveButtonText: {
    color: '#fff',
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '600',
  },
});

export default AccountsScreen;