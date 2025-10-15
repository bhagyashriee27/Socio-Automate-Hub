import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Animated,
  Dimensions,
  SafeAreaView,
  ActivityIndicator,
  Image, // Ensure Image is imported from react-native
} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import ApiService from '../services/api';
import StorageService from '../utils/storage';
import { User, InstagramAccount, TelegramAccount, YouTubeAccount } from '../types';

const AnimatedTouchableOpacity = Animated.createAnimatedComponent(TouchableOpacity);

const { width: screenWidth } = Dimensions.get('window');

const Profile: React.FC<{ navigation: any }> = ({ navigation }) => {
  const [user, setUser] = useState<User | null>(null);
  const [instagramAccounts, setInstagramAccounts] = useState<InstagramAccount[]>([]);
  const [telegramAccounts, setTelegramAccounts] = useState<TelegramAccount[]>([]);
  const [youtubeAccounts, setYoutubeAccounts] = useState<YouTubeAccount[]>([]); // Add this line
  const [fadeAnim] = useState(new Animated.Value(0));
  const [slideAnim] = useState(new Animated.Value(50));
  const [logoutScaleAnim] = useState(new Animated.Value(1));
  const [logoutPulseAnim] = useState(new Animated.Value(1));
  const [isLoggingOut, setIsLoggingOut] = useState(false);
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
      setYoutubeAccounts(response.youtube_channels || []); // Add this line
    } catch (error: any) {
      Alert.alert('Error', 'Failed to load profile data. Check server or network.');
      console.error('Load profile error:', error);
    }
  };

  const handleLogout = async () => {
    // Animate logout button with scale and pulse
    Animated.parallel([
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
      ]),
      Animated.sequence([
        Animated.timing(logoutPulseAnim, {
          toValue: 1.1,
          duration: 150,
          useNativeDriver: true,
        }),
        Animated.timing(logoutPulseAnim, {
          toValue: 1,
          duration: 150,
          useNativeDriver: true,
        }),
      ]),
    ]).start();

    setIsLoggingOut(true);

    Alert.alert(
      'Confirm Logout',
      'Are you sure you want to log out?',
      [
        { text: 'Cancel', style: 'cancel', onPress: () => setIsLoggingOut(false) },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: async () => {
            try {
              await StorageService.removeUserData();
              await StorageService.removeAuthToken();
              // Reset navigation to Login screen
              navigation.reset({
                index: 0,
                routes: [{ name: 'Login' }],
              });
            } catch (error) {
              setIsLoggingOut(false);
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

  // User Badge Component
  const UserBadge = () => {
    const getInitials = (name: string) => {
      const nameParts = name?.trim().split(' ') || ['U'];
      return nameParts.length > 1
        ? `${nameParts[0][0]}${nameParts[nameParts.length - 1][0]}`
        : nameParts[0][0];
    };

    const getBadgeColor = (name: string) => {
      const colors = ['#007AFF', '#34C759', '#FF9500', '#FF3B30', '#5856D6'];
      const hash = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
      return colors[hash % colors.length];
    };

    return (
      <Animated.View
        style={[
          styles.badgeContainer,
          {
            opacity: fadeAnim,
            transform: [
              {
                scale: fadeAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.8, 1],
                }),
              },
            ],
            backgroundColor: user?.Name ? getBadgeColor(user.Name) : '#007AFF',
          },
        ]}
      >
        <Text style={styles.badgeText}>
          {user?.Name ? getInitials(user.Name) : 'U'}
        </Text>
      </Animated.View>
    );
  };

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

    // Get platform icon and display name
    const getPlatformInfo = () => {
      switch (platform) {
        case 'Instagram':
          return { icon: 'logo-instagram', name: account.username };
        case 'Telegram':
          return { icon: 'paper-plane', name: account.channel_name };
        case 'YouTube':
          return { icon: 'logo-youtube', name: account.username };
        default:
          return { icon: 'help-circle', name: 'Unknown' };
      }
    };

    const platformInfo = getPlatformInfo();

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
            source={{ uri: `https://api.dicebear.com/7.x/avataaars/svg?seed=${accountSeed}` }}
          />
          <View style={styles.accountInfo}>
            <Text style={styles.accountPlatform}>
              <Ionicons
                name={platformInfo.icon}
                size={12}
                color="#1C2526"
              /> {platform}
            </Text>
            <Text style={styles.accountName}>
              {platformInfo.name}
            </Text>
            <Text style={[styles.accountStatus, { color: isInactive ? '#FF3B30' : '#34C759' }]}>
              <Ionicons
                name={isInactive ? 'close-circle' : 'checkmark-circle'}
                size={12}
                color={isInactive ? '#FF3B30' : '#34C759'}
              /> {isInactive ? 'Inactive' : 'Active'}
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
        time: `${index + 1}2m ago`,
        icon: 'logo-instagram',
      });
    });

    // Add activities based on Telegram accounts
    telegramAccounts.forEach((account, index) => {
      const igCount = instagramAccounts.length;
      activities.push({
        text: `Scheduled post on Telegram (${account.channel_name})`,
        time: `${igCount + index + 3}h ago`,
        icon: 'paper-plane',
      });
    });

    // Add activities based on YouTube accounts
    youtubeAccounts.forEach((account, index) => { // Add this section
      const totalCount = instagramAccounts.length + telegramAccounts.length;
      activities.push({
        text: `Uploaded video on YouTube (${account.username})`,
        time: `${totalCount + index + 5}h ago`,
        icon: 'logo-youtube',
      });
    });

    // Add a generic upload activity if no accounts
    if (activities.length === 0) {
      activities.push({
        text: 'Uploaded media to library',
        time: '2h ago',
        icon: 'cloud-upload',
      });
    }

    return (
      <View style={styles.activitySection}>
        <Text style={styles.sectionTitle}>
          <Ionicons name="time" size={20} color="#1C2526" /> Recent Activity
        </Text>
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
              <Ionicons name={activity.icon} size={16} color="#1C2526" style={styles.activityIcon} />
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
            <UserBadge />
            <Animated.Text style={[
              styles.name,
              {
                opacity: fadeAnim,
                transform: [{ translateY: slideAnim }],
              }
            ]}>
              <Ionicons name="person" size={28} color="#1C2526" /> {user?.Name || 'User'}
            </Animated.Text>
            <Animated.Text style={[
              styles.email,
              {
                opacity: fadeAnim,
                transform: [{ translateY: slideAnim }],
              }
            ]}>
              <Ionicons name="mail" size={18} color="#6B7280" /> {user?.email || 'email@example.com'}
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
              <Ionicons name="link" size={20} color="#1C2526" /> Linked Accounts
            </Animated.Text>
            {[...instagramAccounts, ...telegramAccounts, ...youtubeAccounts].length === 0 ? ( // Update this line
              <Animated.Text style={[
                styles.noAccounts,
                {
                  opacity: fadeAnim,
                }
              ]}>
                <Ionicons name="alert-circle" size={16} color="#6B7280" /> No accounts linked yet
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
                {youtubeAccounts.map((account) => ( // Add this section
                  <AccountCard key={account.id} account={account} platform="YouTube" />
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
              <Ionicons name="settings" size={20} color="#1C2526" /> Settings
            </Animated.Text>
            <View style={styles.settingItem}>
              <Text style={styles.settingText}>
                <Ionicons name="stats-chart" size={18} color="#1C2526" /> Account Stats
              </Text>
              <Text style={styles.statValue}>
                {instagramAccounts.length + telegramAccounts.length + youtubeAccounts.length} Accounts {/* Update this line */}
              </Text>
            </View>
            <View style={styles.passwordLinkContainer}>
              <Text
                style={styles.passwordLinkText}
                onPress={handleForgotPassword}
              >
                <Ionicons name="lock-closed" size={16} color="#007AFF" /> Forgot your password? Reset it here.
              </Text>
            </View>
          </View>

          {/* Dynamic Logout Button */}
          <AnimatedTouchableOpacity
            style={[
              styles.logoutButton,
              {
                opacity: fadeAnim,
                transform: [
                  { scale: logoutScaleAnim },
                  { scale: logoutPulseAnim },
                ],
                backgroundColor: isLoggingOut ? '#ccc' : '#FF3B30',
              }
            ]}
            onPress={handleLogout}
            activeOpacity={0.7}
            disabled={isLoggingOut}
          >
            <Animated.View style={[
              styles.logoutButtonContent,
              {
                opacity: fadeAnim,
              }
            ]}>
              {isLoggingOut ? (
                <>
                  <ActivityIndicator size="small" color="#6B7280" />
                  <Text style={styles.logoutText}>Logging Out...</Text>
                </>
              ) : (
                <>
                  <Ionicons name="log-out" size={18} color="#fff" />
                  <Text style={styles.logoutText}>Logout</Text>
                </>
              )}
            </Animated.View>
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
  badgeContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    marginBottom: 15,
    borderWidth: 2,
    borderColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeText: {
    fontSize: 48,
    fontWeight: 'bold',
    color: '#fff',
    textTransform: 'uppercase',
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
    borderRadius: 8,
    margin: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 5,
  },
  logoutButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  logoutText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
});

export default Profile;