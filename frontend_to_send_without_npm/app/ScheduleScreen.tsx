import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Switch,
  Alert,
} from 'react-native';
import ApiService from '../services/api';
import { InstagramAccount, TelegramAccount } from '../types';

const ScheduleScreen: React.FC = () => {
  const [schedules, setSchedules] = useState<(InstagramAccount | TelegramAccount)[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadScheduleData();
  }, []);

  const loadScheduleData = async () => {
    try {
      setLoading(true);
      const response = await ApiService.getScheduleStatus(); // Assuming this endpoint exists
      setSchedules([...(response.instagram_accounts || []), ...(response.telegram_channels || [])]);
    } catch (error: any) {
      Alert.alert('Error', 'Failed to load schedule data. Check server or network.');
    } finally {
      setLoading(false);
    }
  };

  const toggleSchedule = async (account: InstagramAccount | TelegramAccount) => {
    try {
      const updatedAccount = { ...account, selected: account.selected === 'Yes' ? 'No' : 'Yes' };
      await ApiService.updateSchedule(account.id, updatedAccount); // Assuming update endpoint
      setSchedules(schedules.map(s => s.id === account.id ? updatedAccount : s));
    } catch (error: any) {
      Alert.alert('Error', 'Failed to update schedule. Try again.');
    }
  };

  const now = new Date('2025-08-13T03:34:00+05:30'); // Current time
  const isActive = (account: InstagramAccount | TelegramAccount) => {
    const [endHours, endMinutes, endSeconds] = account.sch_end_range.split(':').map(Number);
    const endTime = new Date(now);
    endTime.setHours(endHours, endMinutes, endSeconds, 0);
    return account.selected === 'Yes' && now <= endTime;
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerText}>Schedule Posts</Text>
      </View>
      {schedules.length === 0 ? (
        <Text style={styles.noSchedules}>No schedules available</Text>
      ) : (
        schedules.map((account) => (
          <View key={account.id} style={styles.scheduleItem}>
            <View style={styles.scheduleInfo}>
              <Text style={styles.accountName}>
                {account.hasOwnProperty('username') ? `Instagram: ${account.username}` : `Telegram: ${account.channel_name}`}
              </Text>
              <Text style={styles.timeRange}>
                {`Time: ${account.sch_start_range} - ${account.sch_end_range}`}
              </Text>
              <Text style={styles.status}>
                Status: {isActive(account) ? 'Active' : 'Inactive'}
              </Text>
            </View>
            <Switch
              onValueChange={() => toggleSchedule(account)}
              value={account.selected === 'Yes'}
              trackColor={{ false: '#ccc', true: '#007AFF' }}
              thumbColor={account.selected === 'Yes' ? '#FFD700' : '#fff'}
            />
          </View>
        ))
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 16,
    color: '#666',
  },
  header: {
    padding: 15,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#ddd',
    marginBottom: 10,
  },
  headerText: {
    fontSize: 22,
    fontWeight: '600',
    color: '#333',
  },
  noSchedules: {
    textAlign: 'center',
    fontSize: 16,
    color: '#666',
    padding: 20,
  },
  scheduleItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 15,
    backgroundColor: '#fff',
    marginBottom: 10,
    borderRadius: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  scheduleInfo: {
    flex: 1,
  },
  accountName: {
    fontSize: 18,
    fontWeight: '500',
    color: '#333',
    marginBottom: 5,
  },
  timeRange: {
    fontSize: 14,
    color: '#666',
    marginBottom: 5,
  },
  status: {
    fontSize: 14,
    color: '#666',
  },
});

export default ScheduleScreen;