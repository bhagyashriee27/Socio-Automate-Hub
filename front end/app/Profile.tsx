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
  TextInput,
  Modal,
  LayoutAnimation,
  Platform,
  UIManager,
} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import ApiService from '../services/api';
import StorageService from '../utils/storage';
import { User, InstagramAccount, TelegramAccount, YouTubeAccount } from '../types';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const AnimatedTouchableOpacity = Animated.createAnimatedComponent(TouchableOpacity);

const { width: screenWidth } = Dimensions.get('window');

const manualData = [
  {
    key: 'dashboard',
    title: 'Dashboard',
    icon: 'stats-chart-outline',
    content: `The Dashboard provides a real-time snapshot of your social media activity.\n\n• Top Cards: View key metrics like your total number of linked accounts, how many are actively posting, and the number of posts completed today.\n\n• Quick Actions: Use these buttons to jump directly to adding new accounts or managing your schedules.\n\n• Pull to Refresh: Swipe down from the top of the screen to refresh all stats instantly.`,
  },
  {
    key: 'accounts',
    title: 'Accounts',
    icon: 'people-outline',
    content: `This screen is for connecting and managing your social media profiles.\n\n• Adding Accounts: Tap the "Add" button for the desired platform (Instagram, Telegram, etc.). You'll need to provide your account credentials, a Google Drive link where your media is stored, the daily posting times (e.g., from 09:00 to 17:00), and the maximum number of posts per day.\n\n• Account Status: Each account card displays its current status. "Active" means it's ready to post. Other statuses include "Inactive" (disabled by you), "Outside Hours" (not within its posting schedule), or "Daily Limit Reached".\n\n• Deleting Accounts: You can permanently remove an account by tapping the "Delete" button. This action cannot be undone.`,
  },
  {
    key: 'schedule',
    title: 'Schedule',
    icon: 'calendar-outline',
    content: `This screen gives you fine-grained control over your posting strategy.\n\n• General Schedule: Tap "Edit" on any account to modify its overall posting window (start and end times) and the daily post limit.\n\n• Media-Specific Scheduling: Tap the "Schedule" button on an account to see all the media uploaded for it. From this grid view:\n  - Tap any media item to open the editor.\n  - Set Schedule Type: Choose "Range" to let the app post it randomly within the account's active hours, or "Date/Time" to schedule it for a precise moment.\n  - Edit Caption: You can add, edit, or remove the caption for each individual post.\n  - Delete Media: Long-press a media item or use the delete button in the editor to permanently remove it from the schedule and your Google Drive.`,
  },
  {
    key: 'upload',
    title: 'Upload',
    icon: 'cloud-upload-outline',
    content: `This is your content hub for getting media into the system.\n\n1. Select Platform & Accounts: First, choose a platform (like Instagram), then select which of your linked accounts you want to upload content to.\n\n2. Open the Uploader: Tap the "Select Media to Upload" button.\n\n3. Pick Files: Choose images and videos from your device's library.\n\n4. Manage & Schedule: Before uploading, you can add captions and set specific schedules for each file right from the upload list.\n\n5. Start Upload: Tap "Upload Selected" to begin transferring the files to the Google Drive folder associated with each selected account. You can monitor the progress of each file.`,
  },
  {
    key: 'profile',
    title: 'Profile',
    icon: 'person-circle-outline',
    content: `Manage your application settings and personal details here.\n\n• Edit Credentials: Update your name, display email, or phone number. Note: Changing your primary email requires an OTP verification sent to your current email address for security.\n\n• Change Password: Use this feature to securely reset your account password.\n\n• Account Stats: Get a quick count of how many accounts you have linked across all platforms.\n\n• Logout: Securely sign out of your SocioMate account.`,
  },
];


const Profile: React.FC<{ navigation: any }> = ({ navigation }) => {
  const [user, setUser] = useState<User | null>(null);
  const [instagramAccounts, setInstagramAccounts] = useState<InstagramAccount[]>([]);
  const [telegramAccounts, setTelegramAccounts] = useState<TelegramAccount[]>([]);
  const [youtubeAccounts, setYoutubeAccounts] = useState<YouTubeAccount[]>([]);
  const [fadeAnim] = useState(new Animated.Value(0));
  const [slideAnim] = useState(new Animated.Value(50));
  const [logoutScaleAnim] = useState(new Animated.Value(1));
  const [logoutPulseAnim] = useState(new Animated.Value(1));
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [profilePicSeed] = useState(Math.random().toString(36).substring(7)); // Random seed for avatar

  // States for edit functionality
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editData, setEditData] = useState({
    name: '',
    email: '',
    phone_number: '',
  });
  const [loading, setLoading] = useState(false);

  // States for OTP flow
  const [otpModalVisible, setOtpModalVisible] = useState(false);
  const [otp, setOtp] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [currentEmail, setCurrentEmail] = useState('');
  // New states for OTP resend timer
  const [resendCooldown, setResendCooldown] = useState(0);
  const [canResendOtp, setCanResendOtp] = useState(false);

  // New state for User Manual Modal
  const [manualModalVisible, setManualModalVisible] = useState(false);
  const [activeManualSection, setActiveManualSection] = useState<string | null>(null);


  // Effect for OTP resend cooldown timer
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    if (resendCooldown > 0) {
      timer = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000);
    } else {
      setCanResendOtp(true);
    }
    return () => clearTimeout(timer);
  }, [resendCooldown]);


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
      setYoutubeAccounts(response.youtube_channels || []);
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

  const handleEditProfile = () => {
    setEditData({
      name: user?.Name || '',
      email: user?.email || '',
      phone_number: user?.phone_number || '',
    });
    setEditModalVisible(true);
  };

  const handleSaveProfile = async () => {
    if (!editData.name || !editData.email) {
      Alert.alert('Error', 'Name and Email are required');
      return;
    }

    if (!editData.email.includes('@')) {
      Alert.alert('Error', 'Please enter a valid email address');
      return;
    }

    setLoading(true);
    try {
      // If email is being changed, send OTP
      if (editData.email !== user?.email) {
        const response = await ApiService.sendProfileUpdateOtp(user!.Id, editData.email);
        setCurrentEmail(response.current_email);
        setEditModalVisible(false); // Close the edit modal
        setOtpModalVisible(true);   // Open the OTP modal
        setResendCooldown(60);     // Start the resend timer
        setCanResendOtp(false);
      } else {
        // If only name/phone is changing, update directly
        await ApiService.updateUser(user!.Id, {
          name: editData.name,
          email: editData.email,
          phone_number: editData.phone_number,
        });

        Alert.alert('Success', 'Profile updated successfully');
        setEditModalVisible(false);
        loadProfileData();
      }
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to update profile');
    } finally {
      setLoading(false);
    }
  };

  const handleResendOtp = async () => {
    if (!canResendOtp) return;

    try {
      setCanResendOtp(false);
      await ApiService.sendProfileUpdateOtp(user!.Id, editData.email);
      Alert.alert('Success', 'A new OTP has been sent to your email.');
      setResendCooldown(60); // Restart cooldown
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to resend OTP');
      setCanResendOtp(true); // Allow retry if it failed
    }
  };

  const handleVerifyOtp = async () => {
    if (!otp || otp.length !== 6) {
      Alert.alert('Error', 'Please enter a valid 6-digit OTP');
      return;
    }

    setSavingProfile(true);
    try {
      await ApiService.verifyProfileUpdateOtp(user!.Id, otp, editData.name, editData.phone_number);

      Alert.alert('Success', 'Profile updated successfully');
      setOtpModalVisible(false);
      setOtp('');
      loadProfileData();
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to verify OTP');
    } finally {
      setSavingProfile(false);
    }
  };


  const handleChangePassword = () => {
    setEditModalVisible(false);
    navigation.navigate('ForgotPassword');
  };

  const toggleManualSection = (key: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setActiveManualSection(prev => (prev === key ? null : key));
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
            }]}>
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

            {/* Add Phone Number Display */}
            {user?.phone_number && (
              <Animated.Text style={[
                styles.phone,
                {
                  opacity: fadeAnim,
                  transform: [{ translateY: slideAnim }],
                }
              ]}>
                <Ionicons name="call" size={16} color="#6B7280" /> {user.phone_number}
              </Animated.Text>
            )}
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

            {/* Add Edit Credentials Button here */}
            <TouchableOpacity
              style={styles.editCredentialsButton}
              onPress={handleEditProfile}
            >
              <Ionicons name="create-outline" size={20} color="#007AFF" />
              <Text style={styles.editCredentialsText}>Edit Credentials</Text>
            </TouchableOpacity>

            {/* Customer Care / User Manual Button */}
            <TouchableOpacity
              style={styles.editCredentialsButton}
              onPress={() => setManualModalVisible(true)}
            >
              <Ionicons name="book-outline" size={20} color="#007AFF" />
              <Text style={styles.editCredentialsText}>User Manual</Text>
            </TouchableOpacity>


            <View style={styles.settingItem}>
              <Text style={styles.settingText}>
                <Ionicons name="stats-chart" size={18} color="#1C2526" /> Account Stats
              </Text>
              <Text style={styles.statValue}>
                {instagramAccounts.length + telegramAccounts.length + youtubeAccounts.length} Accounts
              </Text>
            </View>

            <View style={styles.passwordLinkContainer}>
              <Text
                style={styles.passwordLinkText}
                onPress={handleChangePassword}
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
      <Modal
        animationType="slide"
        transparent={true}
        visible={editModalVisible}
        onRequestClose={() => setEditModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Edit Profile</Text>

            <View style={styles.inputContainer}>
              <Text style={styles.label}>Name *</Text>
              <TextInput
                style={styles.input}
                value={editData.name}
                onChangeText={(text) => setEditData({ ...editData, name: text })}
                placeholder="Enter your name"
              />
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.label}>Email *</Text>
              <TextInput
                style={styles.input}
                value={editData.email}
                onChangeText={(text) => setEditData({ ...editData, email: text })}
                placeholder="Enter your email"
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.label}>Phone Number</Text>
              <TextInput
                style={styles.input}
                value={editData.phone_number}
                onChangeText={(text) => setEditData({ ...editData, phone_number: text })}
                placeholder="Enter your phone number"
                keyboardType="phone-pad"
              />
            </View>

            <TouchableOpacity
              style={styles.passwordChangeButton}
              onPress={handleChangePassword}
            >
              <Ionicons name="lock-closed" size={16} color="#007AFF" />
              <Text style={styles.passwordChangeText}>Change Password</Text>
            </TouchableOpacity>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => setEditModalVisible(false)}
                disabled={loading}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveButton, loading && styles.buttonDisabled]}
                onPress={handleSaveProfile}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.saveButtonText}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* OTP Verification Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={otpModalVisible}
        onRequestClose={() => setOtpModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Verify Email Change</Text>
            <Text style={styles.otpMessage}>
              We've sent a 6-digit OTP to your current email: {currentEmail}
            </Text>

            <View style={styles.inputContainer}>
              <Text style={styles.label}>Enter OTP *</Text>
              <TextInput
                style={styles.input}
                value={otp}
                onChangeText={setOtp}
                placeholder="Enter 6-digit OTP"
                keyboardType="number-pad"
                maxLength={6}
              />
            </View>

            <TouchableOpacity
              style={styles.resendButton}
              onPress={handleResendOtp}
              disabled={!canResendOtp}
            >
              <Text style={[styles.resendButtonText, !canResendOtp && styles.resendButtonTextDisabled]}>
                {canResendOtp ? 'Resend OTP' : `Resend OTP in ${resendCooldown}s`}
              </Text>
            </TouchableOpacity>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => {
                  setOtpModalVisible(false);
                  setOtp('');
                }}
                disabled={savingProfile}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveButton, savingProfile && styles.buttonDisabled]}
                onPress={handleVerifyOtp}
                disabled={savingProfile}
              >
                {savingProfile ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.saveButtonText}>Verify & Save</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* User Manual Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={manualModalVisible}
        onRequestClose={() => setManualModalVisible(false)}
      >
        <SafeAreaView style={styles.manualModalOverlay}>
          <View style={styles.manualModalContent}>
            <View style={styles.manualHeader}>
              <Text style={styles.manualTitle}>
                <Ionicons name="book" size={24} /> User Manual
              </Text>
              <TouchableOpacity onPress={() => setManualModalVisible(false)}>
                <Ionicons name="close-circle" size={30} color="#333" />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.manualScrollView}>
              {manualData.map((item) => {
                const isActive = activeManualSection === item.key;
                return (
                  <View key={item.key} style={styles.manualSection}>
                    <TouchableOpacity
                      style={styles.manualAccordionHeader}
                      onPress={() => toggleManualSection(item.key)}
                      activeOpacity={0.8}
                    >
                      <Ionicons name={item.icon as any} size={22} color={isActive ? '#007AFF' : '#333'} />
                      <Text style={[styles.manualSectionTitle, isActive && styles.manualSectionTitleActive]}>
                        {item.title}
                      </Text>
                      <Ionicons
                        name={isActive ? 'chevron-up-outline' : 'chevron-down-outline'}
                        size={22}
                        color={isActive ? '#007AFF' : '#333'}
                      />
                    </TouchableOpacity>
                    {isActive && (
                      <View style={styles.manualAccordionContent}>
                        <Text style={styles.manualText}>{item.content}</Text>
                      </View>
                    )}
                  </View>
                );
              })}
            </ScrollView>
          </View>
        </SafeAreaView>
      </Modal>

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
  phone: {
    fontSize: 16,
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
  },
  passwordLinkText: {
    fontSize: 16,
    color: '#007AFF',
    textAlign: 'center',
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
  editCredentialsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f0f8ff',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    marginBottom: 15,
    gap: 8,
    borderWidth: 1,
    borderColor: '#007AFF',
  },
  editCredentialsText: {
    color: '#007AFF',
    fontSize: 16,
    fontWeight: '600',
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
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 20,
    textAlign: 'center',
  },
  inputContainer: {
    marginBottom: 15,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 5,
    color: '#333',
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
  passwordChangeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#007AFF',
    borderRadius: 8,
    marginBottom: 15,
    gap: 8,
  },
  passwordChangeText: {
    color: '#007AFF',
    fontSize: 16,
    fontWeight: '500',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  cancelButton: {
    flex: 1,
    backgroundColor: '#ccc',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: '#333',
    fontSize: 16,
    fontWeight: '600',
  },
  saveButton: {
    flex: 1,
    backgroundColor: '#007AFF',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  buttonDisabled: {
    backgroundColor: '#ccc',
  },
  otpMessage: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 20,
  },
  resendButton: {
    alignItems: 'center',
    marginBottom: 15,
  },
  resendButtonText: {
    color: '#007AFF',
    fontSize: 14,
    fontWeight: '500',
  },
  resendButtonTextDisabled: {
    color: '#999',
  },
  // User Manual Styles
  manualModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  manualModalContent: {
    backgroundColor: '#f9f9f9',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    height: '90%',
  },
  manualHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    padding: 20,
  },
  manualTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
  },
  manualScrollView: {
    flex: 1,
  },
  manualSection: {
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  manualAccordionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    justifyContent: 'space-between',
  },
  manualSectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    flex: 1,
    marginLeft: 15,
  },
  manualSectionTitleActive: {
    color: '#007AFF',
  },
  manualAccordionContent: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  manualText: {
    fontSize: 15,
    color: '#555',
    lineHeight: 22,
  },
  manualHighlight: {
    fontWeight: 'bold',
    color: '#1C2526',
  },
});

export default Profile;




