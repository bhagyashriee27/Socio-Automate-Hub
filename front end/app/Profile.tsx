import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Image,
  Animated,
  Dimensions,
  SafeAreaView,
} from 'react-native';
import ApiService from '../services/api';
import StorageService from '../utils/storage';
import { User, InstagramAccount, TelegramAccount } from '../types';

const AnimatedTouchableOpacity = Animated.createAnimatedComponent(TouchableOpacity);

const { width: screenWidth } = Dimensions.get('window');

const Profile: React.FC<{ navigation: any }> = ({ navigation }) => {
  const [user, setUser] = useState<User | null>(null);
  const [instagramAccounts, setInstagramAccounts] = useState<InstagramAccount[]>([]);
  const [telegramAccounts, setTelegramAccounts] = useState<TelegramAccount[]>([]);
  const [fadeAnim] = useState(new Animated.Value(0));
  const [slideAnim] = useState(new Animated.Value(50));
  const [logoutScaleAnim] = useState(new Animated.Value(1));
  const [profilePicSeed] = useState(Math.random().toString(36).substring(7)); // Random seed for avatar

  useEffect(() => {
    loadProfileData();
    // Animate entrance
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }),
      Animated.spring(slideAnim, {
        toValue: 0,
        tension: 10,
        friction: 8,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const loadProfileData = async () => {
    try {
      const userData = await StorageService.getUserData();
      if (!userData?.Id) {
        Alert.alert('Error', 'User not logged in. Please log in again.');
        return;
      }
      const response = await ApiService.getUser(userData.Id);
      setUser(response.user);
      setInstagramAccounts(response.instagram_accounts || []);
      setTelegramAccounts(response.telegram_channels || []);
    } catch (error: any) {
      Alert.alert('Error', 'Failed to load profile data. Check server or network.');
      console.error('Load profile error:', error); // Debug log
    }
  };

  const handleLogout = async () => {
    // Animate logout button on press
    Animated.sequence([
      Animated.timing(logoutScaleAnim, {
        toValue: 0.95,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.spring(logoutScaleAnim, {
        toValue: 1,
        tension: 10,
        friction: 8,
        useNativeDriver: true,
      }),
    ]).start();

    Alert.alert(
      'Confirm Logout',
      'Are you sure you want to log out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: async () => {
            try {
              await StorageService.removeUserData(); // Updated to removeUserData
              await StorageService.removeAuthToken(); // Clear auth token as well
              // Reset navigation to Login screen
              navigation.reset({
                index: 0,
                routes: [{ name: 'Login' }],
              });
            } catch (error) {
              Alert.alert('Error', 'Failed to log out. Try again.');
              console.error('Logout error:', error); // Debug log
            }
          },
        },
      ]
    );
  };

  const handleForgotPassword = () => {
    navigation.navigate('ForgotPassword');
  };

  const now = new Date(); // Dynamic current date

  // Generate avatar URL using DiceBear
  const getAvatarUrl = (seed: string) => `https://api.dicebear.com/7.x/avataaars/svg?seed=${seed}`;

  // Dynamic account cards with random avatars
  const AccountCard = ({ account, platform }: { account: any; platform: string }) => {
    const [accountSeed] = useState(Math.random().toString(36).substring(7));
    const accountAnim = useState(new Animated.Value(0))[0];

    useEffect(() => {
      Animated.spring(accountAnim, {
        toValue: 1,
        tension: 10,
        friction: 8,
        useNativeDriver: true,
      }).start();
    }, []);

    const [endHours, endMinutes, endSeconds] = account.sch_end_range.split(':').map(Number);
    const endTime = new Date(now);
    endTime.setHours(endHours, endMinutes, endSeconds, 0);
    const isInactive = account.selected === 'No' || now > endTime;

    return (
      <Animated.View 
        style={[
          styles.accountItem,
          {
            opacity: accountAnim,
            transform: [{
              scale: accountAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [0.9, 1],
              }),
            }],
          }
        ]}
      >
        <View style={styles.accountCardRow}>
          <Image
            style={styles.accountAvatar}
            source={{ uri: getAvatarUrl(accountSeed) }}
          />
          <View style={styles.accountInfo}>
            <Text style={styles.accountPlatform}>{platform}</Text>
            <Text style={styles.accountName}>
              {platform === 'Instagram' ? account.username : account.channel_name}
            </Text>
            <Text style={[styles.accountStatus, { color: isInactive ? '#FF3B30' : '#34C759' }]}>
              {isInactive ? 'Inactive' : 'Active'}
            </Text>
          </View>
        </View>
      </Animated.View>
    );
  };

  // Logical Recent Activity based on loaded accounts
  const RecentActivity = () => {
    const activities = [];

    // Add activities based on Instagram accounts
    instagramAccounts.forEach((account, index) => {
      activities.push({
        text: `Posted on Instagram (${account.username})`,
        time: `${index + 1}h ago`,
        icon: '📸'
      });
    });

    // Add activities based on Telegram accounts
    telegramAccounts.forEach((account, index) => {
      const igCount = instagramAccounts.length;
      activities.push({
        text: `Scheduled post on Telegram (${account.channel_name})`,
        time: `${igCount + index + 1}h ago`,
        icon: '📢'
      });
    });

    // Add a generic upload activity if no accounts
    if (activities.length === 0) {
      activities.push({
        text: 'Uploaded media to library',
        time: '2h ago',
        icon: '📤'
      });
    }

    return (
      <View style={styles.activitySection}>
        <Text style={styles.sectionTitle}>Recent Activity</Text>
        <View style={styles.activityList}>
          {activities.slice(0, 5).map((activity, index) => (
            <Animated.View 
              key={index} 
              style={[
                styles.activityItem,
                {
                  opacity: fadeAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, 1],
                  }),
                  transform: [{ translateX: slideAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }],
                }
              ]}
            >
              <Text style={styles.activityIcon}>{activity.icon}</Text>
              <View style={styles.activityContent}>
                <Text style={styles.activityText}>{activity.text}</Text>
                <Text style={styles.activityTime}>{activity.time}</Text>
              </View>
            </Animated.View>
          ))}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <Animated.View style={[
        styles.container,
        {
          opacity: fadeAnim,
          transform: [{ translateY: slideAnim }],
        }
      ]}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scrollContent}>
          {/* Header Section */}
          <Animated.View style={[
            styles.header,
            {
              opacity: fadeAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [0.5, 1],
              }),
              transform: [{
                scale: fadeAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.95, 1],
                }),
              }],
            }
          ]}>
            <Animated.Image
              style={[
                styles.avatar,
                {
                  opacity: fadeAnim,
                  transform: [{
                    scale: fadeAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.8, 1],
                    }),
                  }],
                }
              ]}
              source={{ uri: getAvatarUrl(profilePicSeed) }}
            />
            <Animated.Text style={[
              styles.name,
              {
                opacity: fadeAnim,
                transform: [{ translateY: slideAnim }],
              }
            ]}>
              {user?.Name || 'User'}
            </Animated.Text>
            <Animated.Text style={[
              styles.email,
              {
                opacity: fadeAnim,
                transform: [{ translateY: slideAnim }],
              }
            ]}>
              {user?.email || 'email@example.com'}
            </Animated.Text>
          </Animated.View>

          {/* Linked Accounts Section */}
          <View style={styles.section}>
            <Animated.Text style={[
              styles.sectionTitle,
              {
                opacity: fadeAnim,
              }
            ]}>
              Linked Accounts
            </Animated.Text>
            {[...instagramAccounts, ...telegramAccounts].length === 0 ? (
              <Animated.Text style={[
                styles.noAccounts,
                {
                  opacity: fadeAnim,
                }
              ]}>
                No accounts linked yet
              </Animated.Text>
            ) : (
              <Animated.View style={[
                styles.accountsList,
                {
                  opacity: fadeAnim,
                }
              ]}>
                {instagramAccounts.map((account) => (
                  <AccountCard key={account.id} account={account} platform="Instagram" />
                ))}
                {telegramAccounts.map((account) => (
                  <AccountCard key={account.id} account={account} platform="Telegram" />
                ))}
              </Animated.View>
            )}
          </View>

          {/* Recent Activity Section */}
          <RecentActivity />

          {/* Settings Section */}
          <View style={styles.section}>
            <Animated.Text style={[
              styles.sectionTitle,
              {
                opacity: fadeAnim,
              }
            ]}>
              Settings
            </Animated.Text>
            <View style={styles.settingItem}>
              <Text style={styles.settingText}>Account Stats</Text>
              <Text style={styles.statValue}>
                {instagramAccounts.length + telegramAccounts.length} Accounts
              </Text>
            </View>
            <View style={styles.passwordLinkContainer}>
              <Text 
                style={styles.passwordLinkText}
                onPress={handleForgotPassword}
              >
                Forgot your password? Reset it here.
              </Text>
            </View>
          </View>

          {/* Logout Button */}
          <AnimatedTouchableOpacity 
            style={[
              styles.logoutButton,
              {
                opacity: fadeAnim,
                transform: [{
                  scale: logoutScaleAnim,
                }],
              }
            ]} 
            onPress={handleLogout}
            activeOpacity={0.7}
          >
            <Animated.Text style={[
              styles.logoutText,
              {
                opacity: fadeAnim,
              }
            ]}>
              Logout
            </Animated.Text>
          </AnimatedTouchableOpacity>
        </ScrollView>
      </Animated.View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#b4c5d8',
  },
  container: {
    flex: 1,
    backgroundColor: '#b4c5d8',
  },
  scrollContent: {
    paddingBottom: 20,
  },
  header: {
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#ddd',
    marginBottom: 20,
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  avatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    marginBottom: 15,
    borderWidth: 2,
    borderColor: '#007AFF',
  },
  name: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#333',
    textAlign: 'center',
  },
  email: {
    fontSize: 18,
    color: '#666',
    marginBottom: 10,
    textAlign: 'center',
  },
  section: {
    padding: 15,
    backgroundColor: '#fff',
    marginHorizontal: 15,
    marginBottom: 15,
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#333',
    marginBottom: 15,
  },
  noAccounts: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    padding: 10,
  },
  accountsList: {
    marginBottom: 10,
  },
  accountItem: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    backgroundColor: '#f9f9f9',
    borderRadius: 8,
    marginBottom: 5,
  },
  accountCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  accountAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 12,
  },
  accountInfo: {
    flex: 1,
  },
  accountPlatform: {
    fontSize: 12,
    color: '#666',
    marginBottom: 2,
  },
  accountName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 2,
  },
  accountStatus: {
    fontSize: 12,
    fontWeight: '500',
  },
  activitySection: {
    padding: 15,
    backgroundColor: '#fff',
    marginHorizontal: 15,
    marginBottom: 15,
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  activityList: {
    marginTop: 10,
  },
  activityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  activityIcon: {
    fontSize: 16,
    marginRight: 12,
  },
  activityContent: {
    flex: 1,
  },
  activityText: {
    fontSize: 14,
    color: '#333',
    marginBottom: 2,
  },
  activityTime: {
    fontSize: 12,
    color: '#666',
  },
  settingItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  settingText: {
    fontSize: 18,
    color: '#333',
  },
  statValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#007AFF',
  },
  passwordLinkContainer: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  passwordLinkText: {
    fontSize: 16,
    color: '#007AFF',
    textAlign: 'center',
    textDecorationLine: 'underline',
  },
  logoutButton: {
    paddingVertical: 15,
    backgroundColor: '#FF3B30',
    borderRadius: 8,
    margin: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 5,
  },
  logoutText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
});

export default Profile;