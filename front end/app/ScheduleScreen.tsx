import React, { useState, useEffect, useCallback } from 'react';
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
    FlatList,
    Image,
    Platform,
} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import DateTimePicker from '@react-native-community/datetimepicker';
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
        number_of_posts: 0, 
        selected: 'No' as 'Yes' | 'No',
    });

    // New states for datetime edit modal
    const [datetimeModalVisible, setDatetimeModalVisible] = useState(false);
    const [selectedAccountForDatetime, setSelectedAccountForDatetime] = useState<any>(null);
    const [scheduledMedia, setScheduledMedia] = useState<any[]>([]);
    const [selectedMedia, setSelectedMedia] = useState<any>(null);
    const [mediaModalVisible, setMediaModalVisible] = useState(false);
    const [mediaFormData, setMediaFormData] = useState({
        schedule_type: 'datetime',
        scheduled_datetime: '',
        caption: '', 
    });

    // Date/Time Picker States
    const [showDatePicker, setShowDatePicker] = useState(false);
    const [showTimePicker, setShowTimePicker] = useState(false);
    const [selectedDate, setSelectedDate] = useState(new Date());
    const [selectedTime, setSelectedTime] = useState(new Date());

    // Delete confirmation modal
    const [deleteModalVisible, setDeleteModalVisible] = useState(false);
    const [mediaToDelete, setMediaToDelete] = useState<any>(null);

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
            const response = await ApiService.getUser(userId);

            setInstagramAccounts(response.instagram_accounts || []);
            setTelegramAccounts(response.telegram_channels || []);

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

    const onRefresh = async () => {
        setRefreshing(true);
        if (user?.Id) {
            await loadScheduleData(user.Id);
        }
    };

    const loadScheduledMedia = async (account: any, platform: 'instagram' | 'telegram') => {
        try {
            setSelectedAccountForDatetime({ ...account, platform });

            const response = await ApiService.getCustomSchedule(platform, account.id);
            const mediaData = response.custom_schedule_data || [];

            setScheduledMedia(mediaData);
            setDatetimeModalVisible(true);

        } catch (error: any) {
            console.error('Error loading scheduled media:', error);
            Alert.alert('Error', 'Failed to load scheduled media');
        }
    };

    const updateMediaSchedule = async (mediaItem: any) => {
        try {
            if (!selectedAccountForDatetime) return;

            const updatedMedia = scheduledMedia.map(item =>
                item.media_name === mediaItem.media_name ? mediaItem : item
            );

            await ApiService.updateCustomSchedule(
                selectedAccountForDatetime.platform,
                selectedAccountForDatetime.id,
                updatedMedia
            );

            Alert.alert('Success', 'Schedule updated successfully!');
            setScheduledMedia(updatedMedia);
            setMediaModalVisible(false);

        } catch (error: any) {
            console.error('Error updating media schedule:', error);
            Alert.alert('Error', 'Failed to update schedule');
        }
    };

    const deleteMedia = async (mediaItem: any) => {
        try {
            if (!selectedAccountForDatetime) return;

            const updatedMedia = scheduledMedia.filter(item =>
                item.media_name !== mediaItem.media_name || item.file_id !== mediaItem.file_id
            );

            await ApiService.updateCustomSchedule(
                selectedAccountForDatetime.platform,
                selectedAccountForDatetime.id,
                updatedMedia
            );

            await ApiService.deleteMediaFromDrive(
                selectedAccountForDatetime.platform,
                selectedAccountForDatetime.id,
                mediaItem.file_id
            );

            Alert.alert('Success', 'Media deleted successfully!');
            setScheduledMedia(updatedMedia);
            setDeleteModalVisible(false);
            setMediaToDelete(null);

        } catch (error: any) {
            console.error('Error deleting media:', error);
            Alert.alert('Error', 'Failed to delete media');
        }
    };

    const openDeleteConfirmation = (media: any) => {
        setMediaToDelete(media);
        setDeleteModalVisible(true);
    };

    // === FIX APPLIED HERE: Close parent modal before opening child modal ===
    const openMediaEdit = (media: any) => {
        // 1. Close the parent modal (Media Grid) immediately
        setDatetimeModalVisible(false); 
        
        // 2. Set the media data
        setSelectedMedia(media);

        let initialDate = new Date();
        
        if (media.scheduled_datetime) {
            const dateTime = new Date(media.scheduled_datetime.replace(' ', 'T'));
            if (!isNaN(dateTime.getTime())) {
                initialDate = dateTime;
            }
        }
        
        setSelectedDate(initialDate);
        setSelectedTime(initialDate);

        setMediaFormData({
            schedule_type: media.schedule_type || 'datetime',
            scheduled_datetime: media.scheduled_datetime || formatAPIDateTime(initialDate),
            caption: media.caption || '', 
        });
        
        // 3. Use a slight delay before opening the new modal to allow iOS to dismiss the parent
        setTimeout(() => {
            setMediaModalVisible(true);
        }, 350); // 350ms delay usually works for the default 'slide' animation
    };

    const handleMediaScheduleTypeChange = (scheduleType: 'range' | 'datetime') => {
        setMediaFormData(prev => ({
            ...prev,
            schedule_type: scheduleType,
            scheduled_datetime: scheduleType === 'range' ? '' : prev.scheduled_datetime,
        }));
    };

    const formatDate = (date: Date) => {
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        });
    };

    const formatTime = (date: Date) => {
        return date.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        });
    };
    
    const formatAPIDateTime = (date: Date): string => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');
        return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    };

    const onDateChange = (event: any, date?: Date) => {
        setShowDatePicker(false);
        if (date) {
            setSelectedTime(prevTime => { 
                const newDateTime = new Date(date);
                newDateTime.setHours(prevTime.getHours());
                newDateTime.setMinutes(prevTime.getMinutes());
                newDateTime.setSeconds(0);
                
                setSelectedDate(newDateTime);
                
                const formattedDateTime = formatAPIDateTime(newDateTime);
                setMediaFormData(prev => ({...prev, scheduled_datetime: formattedDateTime}));
                return newDateTime; 
            });
        }
    };

    const onTimeChange = (event: any, time?: Date) => {
        setShowTimePicker(false);
        if (time) {
            setSelectedDate(prevDate => { 
                const newDateTime = new Date(prevDate);
                newDateTime.setHours(time.getHours());
                newDateTime.setMinutes(time.getMinutes());
                newDateTime.setSeconds(0);

                setSelectedTime(newDateTime);
                
                const formattedDateTime = formatAPIDateTime(newDateTime);
                setMediaFormData(prev => ({...prev, scheduled_datetime: formattedDateTime}));
                return newDateTime; 
            });
        }
    };

    const saveMediaSchedule = () => {
        if (!selectedMedia) return;
        
        if (mediaFormData.schedule_type === 'datetime' && !mediaFormData.scheduled_datetime) {
             Alert.alert('Validation Error', 'Please select a scheduled date and time.');
             return;
        }

        const updatedMedia = {
            ...selectedMedia,
            schedule_type: mediaFormData.schedule_type,
            scheduled_datetime: mediaFormData.schedule_type === 'datetime' ? mediaFormData.scheduled_datetime : null,
            caption: mediaFormData.caption, 
        };

        updateMediaSchedule(updatedMedia);
    };

    const getDrivePreviewUrl = (fileId: string, isVideo: boolean = false) => {
        if (isVideo) {
            return `https://drive.google.com/thumbnail?id=${fileId}&sz=w200`;
        }
        return `https://drive.google.com/thumbnail?id=${fileId}&sz=w200`;
    };

    const isImageFile = (fileName: string) => {
        const match = fileName.toLowerCase().match(/\.(jpg|jpeg|png|gif|bmp|webp)$/);
        return Boolean(match);
    };

    const isVideoFile = (fileName: string) => {
        const match = fileName.toLowerCase().match(/\.(mp4|mov|avi|mkv|webm|flv|wmv|m4v|3gp)$/);
        return Boolean(match);
    };

    const getAccountStatus = (account: any) => {
        const postsLeft = parseInt(account.posts_left) || 0;
        const totalPosts = parseInt(account.number_of_posts) || 0;
        const isInactive = postsLeft <= 0;

        return {
            isInactive,
            statusColor: isInactive ? '#FF9500' : '#34C759',
            statusIcon: isInactive ? 'pause-circle' : 'checkmark-circle',
            statusText: isInactive ? 'Inactive' : 'Active'
        };
    };

    const openEditModal = (account: any, platform: 'instagram' | 'telegram') => {
        setEditingAccount({ ...account, platform });
        setFormData({
            username: account.username || '',
            password: '',
            channel_name: account.channel_name || '',
            google_drive_link: account.google_drive_link || '',
            sch_start_range: account.sch_start_range || '',
            sch_end_range: account.sch_end_range || '',
            number_of_posts: parseInt(account.number_of_posts) || 0,
            selected: account.selected || 'No',
        });
        setModalVisible(true);
    };

    const deleteAccount = async (accountId: string, platform: 'instagram' | 'telegram') => {
        Alert.alert(
            'Delete Account',
            'Are you sure you want to delete this account?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            if (platform === 'instagram') {
                                await ApiService.deleteInstagramAccount(parseInt(accountId));
                                setInstagramAccounts(prev => prev.filter(acc => acc.id.toString() !== accountId.toString()));
                            } else {
                                await ApiService.deleteTelegramAccount(parseInt(accountId));
                                setTelegramAccounts(prev => prev.filter(acc => acc.id.toString() !== accountId.toString()));
                            }
                            Alert.alert('Success', 'Account deleted successfully!');
                        } catch (error: any) {
                            console.error('Error deleting account:', error);
                            Alert.alert('Error', 'Failed to delete account');
                        }
                    },
                },
            ]
        );
    };

    const handleUpdateAccount = async () => {
        if (!editingAccount) return;

        try {
            if (editingAccount.platform === 'instagram') {
                await ApiService.updateInstagramAccount(editingAccount.id, formData);
                setInstagramAccounts(prev =>
                    prev.map(acc =>
                        acc.id === editingAccount.id
                            ? { ...acc, ...formData }
                            : acc
                    )
                );
            } else {
                await ApiService.updateTelegramAccount(editingAccount.id, formData);
                setTelegramAccounts(prev =>
                    prev.map(acc =>
                        acc.id === editingAccount.id
                            ? { ...acc, ...formData }
                            : acc
                    )
                );
            }

            Alert.alert('Success', 'Account updated successfully!');
            setModalVisible(false);
            setEditingAccount(null);
        } catch (error: any) {
            console.error('Error updating account:', error);
            Alert.alert('Error', 'Failed to update account');
        }
    };

    // Media Grid Item Component
    const MediaGridItem: React.FC<{ item: any }> = ({ item }) => {
        const isImage = isImageFile(item.media_name);
        const isVideo = isVideoFile(item.media_name);
        const previewUrl = getDrivePreviewUrl(item.file_id, isVideo);
        const [imageError, setImageError] = useState(false);

        return (
            <View style={styles.mediaGridItem}>
                <TouchableOpacity
                    style={styles.mediaThumbnailContainer}
                    onPress={() => openMediaEdit(item)}
                    onLongPress={() => openDeleteConfirmation(item)}
                >
                    {isImage && !imageError ? (
                        <Image
                            source={{ uri: previewUrl }}
                            style={styles.mediaThumbnail}
                            resizeMode="cover"
                            onError={() => setImageError(true)}
                        />
                    ) : isImage ? (
                        <View style={[styles.mediaThumbnail, styles.fallbackThumbnail]}>
                            <Ionicons name="image" size={32} color="#666" />
                            <Text style={styles.fallbackLabel}>Image</Text>
                        </View>
                    ) : isVideo ? (
                        <View style={[styles.mediaThumbnail, styles.videoThumbnail]}>
                            <Ionicons name="play-circle" size={32} color="#fff" />
                            <Text style={styles.videoLabel}>Video</Text>
                        </View>
                    ) : (
                        <View style={[styles.mediaThumbnail, styles.unknownThumbnail]}>
                            <Ionicons name="document" size={32} color="#666" />
                            <Text style={styles.unknownLabel}>File</Text>
                        </View>
                    )}

                    {/* Schedule Type Badge */}
                    <View style={[
                        styles.scheduleTypeBadge,
                        { backgroundColor: item.schedule_type === 'datetime' ? '#007AFF' : '#34C759' }
                    ]}>
                        <Text style={styles.scheduleTypeText}>
                            {item.schedule_type === 'datetime' ? '📅' : '⏰'}
                        </Text>
                    </View>

                    {/* Delete Button */}
                    <TouchableOpacity
                        style={styles.deleteMediaButton}
                        onPress={() => openDeleteConfirmation(item)}
                    >
                        <Ionicons name="close-circle" size={20} color="#FF3B30" />
                    </TouchableOpacity>
                </TouchableOpacity>

                <Text style={styles.mediaName} numberOfLines={1}>
                    {item.media_name}
                </Text>
                
                {item.caption ? (
                    <Text style={styles.captionPreview} numberOfLines={1}>
                        💬 {item.caption.substring(0, 30)}...
                    </Text>
                ) : (
                    <Text style={[styles.captionPreview, { color: '#FF9500' }]} numberOfLines={1}>
                        💬 No Caption
                    </Text>
                )}

                {item.scheduled_datetime && (
                    <Text style={styles.scheduleTime} numberOfLines={1}>
                        {new Date(item.scheduled_datetime).toLocaleString()}
                    </Text>
                )}

                <Text style={[
                    styles.mediaStatus,
                    { color: item.status === 'pending' ? '#FF9500' : '#34C759' }
                ]}>
                    {item.status || 'pending'}
                </Text>
            </View>
        );

    };

    const AccountCard: React.FC<{ account: any; platform: 'instagram' | 'telegram' }> = ({ account, platform }) => {
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
                        style={styles.scheduleButton}
                        onPress={() => loadScheduledMedia(account, platform)}
                    >
                        <Ionicons name="calendar" size={14} color="#fff" />
                        <Text style={styles.scheduleButtonText}> schedule_post</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={styles.editButton}
                        onPress={() => openEditModal(account, platform)}
                    >
                        <Ionicons name="create" size={14} color="#fff" />
                        <Text style={styles.editButtonText}> Edit</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={styles.deleteButton}
                        onPress={() => deleteAccount(account.id.toString(), platform)}
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

    return (
        <View style={styles.container}>
            <ScrollView
                style={styles.scrollView}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
                }
            >
                <View style={styles.header}>
                    <Text style={styles.headerTitle}>Schedule Management</Text>
                </View>

                {/* Instagram Accounts Section */}
                <View style={styles.section}>
                    <View style={styles.sectionHeader}>
                        <Text style={styles.sectionTitle}>
                            <Ionicons name="logo-instagram" size={20} color="#E1306C" /> Instagram Accounts
                        </Text>
                    </View>

                    {instagramAccounts.length === 0 ? (
                        <View style={styles.emptyState}>
                            <Ionicons name="logo-instagram" size={48} color="#6B7280" />
                            <Text style={styles.emptyText}>No Instagram accounts</Text>
                            <Text style={styles.emptySubtext}>Add Instagram accounts to start scheduling posts</Text>
                        </View>
                    ) : (
                        instagramAccounts.map(account => (
                            <AccountCard key={account.id} account={account} platform="instagram" />
                        ))
                    )}
                </View>

                {/* Telegram Accounts Section */}
                <View style={styles.section}>
                    <View style={styles.sectionHeader}>
                        <Text style={styles.sectionTitle}>
                            <Ionicons name="paper-plane" size={20} color="#0088CC" /> Telegram Channels
                        </Text>
                    </View>

                    {telegramAccounts.length === 0 ? (
                        <View style={styles.emptyState}>
                            <Ionicons name="paper-plane" size={48} color="#6B7280" />
                            <Text style={styles.emptyText}>No Telegram channels</Text>
                            <Text style={styles.emptySubtext}>Add Telegram channels to start scheduling messages</Text>
                        </View>
                    ) : (
                        telegramAccounts.map(account => (
                            <AccountCard key={account.id} account={account} platform="telegram" />
                        ))
                    )}
                </View>
            </ScrollView>

            {/* Account Edit Modal (Top Level Modal 1) */}
            <Modal
                animationType="slide"
                transparent={true}
                visible={modalVisible}
                onRequestClose={() => setModalVisible(false)}
            >
                <View style={styles.modalOverlay}>
                    <View style={styles.modalContent}>
                        <Text style={styles.modalTitle}>
                            Edit {editingAccount?.platform === 'instagram' ? 'Instagram Account' : 'Telegram Channel'}
                        </Text>

                        <ScrollView style={styles.modalScroll}>
                            {editingAccount?.platform === 'instagram' ? (
                                <>
                                    <View style={styles.inputContainer}>
                                        <Text style={styles.inputLabel}>Username</Text>
                                        <TextInput
                                            style={styles.input}
                                            value={formData.username}
                                            onChangeText={(text) => setFormData({ ...formData, username: text })}
                                            placeholder="Enter username"
                                        />
                                    </View>

                                    <View style={styles.inputContainer}>
                                        <Text style={styles.inputLabel}>Password</Text>
                                        <TextInput
                                            style={styles.input}
                                            value={formData.password}
                                            onChangeText={(text) => setFormData({ ...formData, password: text })}
                                            placeholder="Enter password"
                                            secureTextEntry
                                        />
                                        <Text style={styles.helperText}>Leave blank to keep current password</Text>
                                    </View>
                                </>
                            ) : (
                                <View style={styles.inputContainer}>
                                    <Text style={styles.inputLabel}>Channel Name</Text>
                                    <TextInput
                                        style={styles.input}
                                        value={formData.channel_name}
                                        onChangeText={(text) => setFormData({ ...formData, channel_name: text })}
                                        placeholder="Enter channel name"
                                    />
                                </View>
                            )}

                            <View style={styles.inputContainer}>
                                <Text style={styles.inputLabel}>Google Drive Link</Text>
                                <TextInput
                                    style={styles.input}
                                    value={formData.google_drive_link}
                                    onChangeText={(text) => setFormData({ ...formData, google_drive_link: text })}
                                    placeholder="Enter Google Drive folder link"
                                />
                            </View>

                            <View style={styles.inputContainer}>
                                <Text style={styles.inputLabel}>Schedule Start Time</Text>
                                <TextInput
                                    style={styles.input}
                                    value={formData.sch_start_range}
                                    onChangeText={(text) => setFormData({ ...formData, sch_start_range: text })}
                                    placeholder="HH:MM:SS (e.g., 09:00:00)"
                                />
                            </View>

                            <View style={styles.inputContainer}>
                                <Text style={styles.inputLabel}>Schedule End Time</Text>
                                <TextInput
                                    style={styles.input}
                                    value={formData.sch_end_range}
                                    onChangeText={(text) => setFormData({ ...formData, sch_end_range: text })}
                                    placeholder="HH:MM:SS (e.g., 17:00:00)"
                                />
                            </View>

                            <View style={styles.inputContainer}>
                                <Text style={styles.inputLabel}>Number of Posts</Text>
                                <TextInput
                                    style={styles.input}
                                    value={formData.number_of_posts.toString()}
                                    onChangeText={(text) => setFormData({ ...formData, number_of_posts: parseInt(text) || 0 })}
                                    placeholder="Enter number of posts"
                                    keyboardType="numeric"
                                />
                            </View>

                            <View style={styles.inputContainer}>
                                <Text style={styles.inputLabel}>Selected</Text>
                                <View style={styles.switchContainer}>
                                    <Switch
                                        value={formData.selected === 'Yes'}
                                        onValueChange={(value) => setFormData({ ...formData, selected: value ? 'Yes' : 'No' })}
                                        trackColor={{ false: '#767577', true: '#81b0ff' }}
                                        thumbColor={formData.selected === 'Yes' ? '#007AFF' : '#f4f3f4'}
                                    />
                                    <Text style={styles.switchLabel}>
                                        {formData.selected === 'Yes' ? 'Active' : 'Inactive'}
                                    </Text>
                                </View>
                            </View>
                        </ScrollView>

                        <View style={styles.modalActions}>
                            <TouchableOpacity
                                style={styles.cancelButton}
                                onPress={() => setModalVisible(false)}
                            >
                                <Text style={styles.cancelButtonText}>Cancel</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={styles.saveButton}
                                onPress={handleUpdateAccount}
                            >
                                <Text style={styles.saveButtonText}>Save Changes</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>

            {/* Datetime Edit Modal (Top Level Modal 2) */}
            <Modal
                animationType="slide"
                transparent={true}
                visible={datetimeModalVisible}
                onRequestClose={() => setDatetimeModalVisible(false)}
            >
                <View style={styles.modalOverlay}>
                    <View style={[styles.modalContent, styles.datetimeModalContent]}>
                        <View style={styles.modalHeader}>
                            <Text style={styles.modalTitle}>
                                <Ionicons name="images" size={20} color="#1C2526" /> Scheduled Media
                            </Text>
                            <Text style={styles.modalSubtitle}>
                                {selectedAccountForDatetime?.platform === 'instagram'
                                    ? selectedAccountForDatetime?.username
                                    : selectedAccountForDatetime?.channel_name}
                            </Text>
                            <TouchableOpacity
                                style={styles.closeButton}
                                onPress={() => setDatetimeModalVisible(false)}
                            >
                                <Ionicons name="close" size={24} color="#1C2526" />
                            </TouchableOpacity>
                        </View>

                        {scheduledMedia.length === 0 ? (
                            <View style={styles.noMediaContainer}>
                                <Ionicons name="images-outline" size={64} color="#6B7280" />
                                <Text style={styles.noMediaText}>No scheduled media found</Text>
                                <Text style={styles.noMediaSubtext}>
                                    Upload media to this account to see it here
                                </Text>
                            </View>
                        ) : (
                            <FlatList
                                data={scheduledMedia}
                                renderItem={({ item }) => <MediaGridItem item={item} />}
                                keyExtractor={(item) => `${item.media_name}-${item.file_id}-${Math.random()}`}
                                numColumns={2}
                                contentContainerStyle={styles.mediaGrid}
                                showsVerticalScrollIndicator={false}
                            />
                        )}
                    </View>
                </View>
            </Modal>

            {/* Media Edit Modal (Top Level Modal 3 - Accessed from Modal 2) */}
            <Modal
                animationType="slide"
                transparent={true}
                visible={mediaModalVisible}
                onRequestClose={() => setMediaModalVisible(false)}
            >
                <View style={styles.modalOverlay}>
                    <View style={[styles.modalContent, styles.mediaEditModal]}>
                        <Text style={styles.modalTitle}>
                            <Ionicons name="calendar" size={20} color="#1C2526" /> Edit Schedule & Caption
                        </Text>

                        {selectedMedia && (
                            <ScrollView>
                                <View style={styles.mediaPreview}>
                                    {isImageFile(selectedMedia.media_name) ? (
                                        <Image
                                            source={{
                                                uri: getDrivePreviewUrl(selectedMedia.file_id, false)
                                            }}
                                            style={styles.largeMediaPreview}
                                            resizeMode="contain"
                                            onError={() => console.log('Preview failed to load')}
                                        />
                                    ) : isVideoFile(selectedMedia.media_name) ? (
                                        <View style={[styles.largeMediaPreview, styles.largeVideoThumbnail]}>
                                            <Ionicons name="play-circle" size={64} color="#fff" />
                                            <Text style={styles.videoText}>Video Preview Unavailable</Text>
                                            <Text style={styles.videoFileName}>{selectedMedia.media_name}</Text>
                                        </View>
                                    ) : (
                                        <View style={[styles.largeMediaPreview, styles.unknownFileThumbnail]}>
                                            <Ionicons name="document" size={64} color="#666" />
                                            <Text style={styles.unknownFileText}>File Preview Unavailable</Text>
                                            <Text style={styles.unknownFileName}>{selectedMedia.media_name}</Text>
                                        </View>
                                    )}
                                    <Text style={styles.mediaFileName}>{selectedMedia.media_name}</Text>
                                </View>

                                {/* Caption Input */}
                                <View style={styles.inputContainer}>
                                    <Text style={styles.inputLabel}>Caption</Text>
                                    <TextInput
                                        style={[styles.input, styles.captionInput]}
                                        value={mediaFormData.caption}
                                        onChangeText={(text) => setMediaFormData({...mediaFormData, caption: text})}
                                        placeholder="Enter post caption..."
                                        multiline
                                    />
                                </View>
                                
                                {/* Schedule Type Selection */}
                                <View style={styles.scheduleTypeContainer}>
                                    <Text style={styles.inputLabel}>Schedule Type</Text>
                                    <View style={styles.scheduleTypeButtons}>
                                        <TouchableOpacity
                                            style={[
                                                styles.scheduleTypeButton,
                                                mediaFormData.schedule_type === 'datetime' && styles.scheduleTypeButtonActive,
                                            ]}
                                            onPress={() => handleMediaScheduleTypeChange('datetime')}
                                        >
                                            <Text style={[
                                                styles.scheduleTypeButtonText,
                                                mediaFormData.schedule_type === 'datetime' && styles.scheduleTypeButtonTextActive,
                                            ]}>
                                                📅 Date/Time
                                            </Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            style={[
                                                styles.scheduleTypeButton,
                                                mediaFormData.schedule_type === 'range' && styles.scheduleTypeButtonActive,
                                            ]}
                                            onPress={() => handleMediaScheduleTypeChange('range')}
                                        >
                                            <Text style={[
                                                styles.scheduleTypeButtonText,
                                                mediaFormData.schedule_type === 'range' && styles.scheduleTypeButtonTextActive,
                                            ]}>
                                                ⏰ Time Range
                                            </Text>
                                        </TouchableOpacity>
                                    </View>
                                </View>

                                {mediaFormData.schedule_type === 'datetime' && (
                                    <View style={styles.datetimeInputContainer}>
                                        <Text style={styles.inputLabel}>Scheduled Date & Time</Text>

                                        <View style={styles.datetimeRow}>
                                            <TouchableOpacity
                                                style={styles.dateTimeSelectButton}
                                                onPress={() => setShowDatePicker(true)}
                                            >
                                                <Ionicons name="calendar" size={16} color="#007AFF" />
                                                <Text style={styles.dateTimeSelectButtonText}>
                                                    {formatDate(selectedDate)}
                                                </Text>
                                            </TouchableOpacity>

                                            <TouchableOpacity
                                                style={styles.dateTimeSelectButton}
                                                onPress={() => setShowTimePicker(true)}
                                            >
                                                <Ionicons name="time" size={16} color="#007AFF" />
                                                <Text style={styles.dateTimeSelectButtonText}>
                                                    {formatTime(selectedTime)}
                                                </Text>
                                            </TouchableOpacity>
                                        </View>

                                        <Text style={styles.selectedDateTime}>
                                            Selected: {mediaFormData.scheduled_datetime || 'Not set'}
                                        </Text>
                                    </View>
                                )}
                            </ScrollView>
                        )}

                        <View style={styles.modalActions}>
                            <TouchableOpacity
                                style={[styles.cancelButton, styles.dangerButton, { flex: 1 }]}
                                onPress={() => selectedMedia && openDeleteConfirmation(selectedMedia)}
                            >
                                <Ionicons name="trash" size={16} color="#fff" />
                                <Text style={styles.dangerButtonText}> Delete</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={[styles.cancelButton, { flex: 1 }]}
                                onPress={() => setMediaModalVisible(false)}
                            >
                                <Text style={styles.cancelButtonText}>Cancel</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={styles.saveButton}
                                onPress={saveMediaSchedule}
                            >
                                <Text style={styles.saveButtonText}>Save Changes</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>
            
            {/* DATE/TIME PICKERS (Rendered at root level) */}
            
            {showDatePicker && (
                <DateTimePicker
                    value={selectedDate}
                    mode="date"
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    onChange={onDateChange}
                    minimumDate={new Date()}
                />
            )}

            {showTimePicker && (
                <DateTimePicker
                    value={selectedTime}
                    mode="time"
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    onChange={onTimeChange}
                />
            )}

            {/* Delete Confirmation Modal (Top Level Modal 4) */}
            <Modal
                animationType="fade"
                transparent={true}
                visible={deleteModalVisible}
                onRequestClose={() => setDeleteModalVisible(false)}
            >
                <View style={styles.modalOverlay}>
                    <View style={[styles.modalContent, styles.deleteModal]}>
                        <Ionicons name="warning" size={48} color="#FF3B30" style={styles.warningIcon} />
                        <Text style={styles.deleteTitle}>Delete Media</Text>
                        <Text style={styles.deleteMessage}>
                            Are you sure you want to delete "{mediaToDelete?.media_name}"?
                            This will remove it from both the schedule and Google Drive.
                        </Text>
                        <View style={styles.deleteActions}>
                            <TouchableOpacity
                                style={styles.deleteCancelButton}
                                onPress={() => setDeleteModalVisible(false)}
                            >
                                <Text style={styles.deleteCancelText}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={styles.deleteConfirmButton}
                                onPress={() => mediaToDelete && deleteMedia(mediaToDelete)}
                            >
                                <Text style={styles.deleteConfirmText}>Delete</Text>
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
        textAlign: 'center',
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
    fallbackThumbnail: {
        backgroundColor: '#f0f0f0',
        justifyContent: 'center',
        alignItems: 'center',
    },
    fallbackLabel: {
        color: '#666',
        fontSize: 12,
        marginTop: 4,
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
    scheduleButton: {
        backgroundColor: '#5856D6',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 6,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
    },
    scheduleButtonText: {
        color: '#fff',
        fontSize: 12,
        fontWeight: '600',
    },
    editButton: {
        backgroundColor: '#007AFF',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 6,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
    },
    editButtonText: {
        color: '#fff',
        fontSize: 12,
        fontWeight: '600',
    },
    deleteButton: {
        backgroundColor: '#FF3B30',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 6,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
    },
    deleteButtonText: {
        color: '#fff',
        fontSize: 12,
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
    datetimeModalContent: {
        width: '95%',
        height: '90%',
    },
    mediaEditModal: {
        width: '90%',
        maxHeight: '85%',
    },
    deleteModal: {
        width: '80%',
        alignItems: 'center',
        padding: 30,
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
    modalHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 20,
    },
    modalSubtitle: {
        fontSize: 16,
        color: '#666',
        flex: 1,
        marginLeft: 10,
    },
    closeButton: {
        padding: 5,
    },
    // Media Grid Styles
    mediaGrid: {
        padding: 5,
    },
    mediaGridItem: {
        flex: 1,
        margin: 8,
        backgroundColor: '#fff',
        borderRadius: 12,
        padding: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
        maxWidth: '46%',
    },
    mediaThumbnailContainer: {
        position: 'relative',
        marginBottom: 8,
    },
    mediaThumbnail: {
        width: '100%',
        height: 120,
        borderRadius: 8,
    },
    videoThumbnail: {
        backgroundColor: '#333',
        justifyContent: 'center',
        alignItems: 'center',
    },
    unknownThumbnail: {
        backgroundColor: '#f0f0f0',
        justifyContent: 'center',
        alignItems: 'center',
    },
    videoLabel: {
        color: '#fff',
        fontSize: 12,
        marginTop: 4,
    },
    unknownLabel: {
        color: '#666',
        fontSize: 12,
        marginTop: 4,
    },
    scheduleTypeBadge: {
        position: 'absolute',
        top: 8,
        right: 8,
        padding: 4,
        borderRadius: 6,
    },
    scheduleTypeText: {
        fontSize: 12,
        color: '#fff',
        fontWeight: 'bold',
    },
    deleteMediaButton: {
        position: 'absolute',
        top: -5,
        right: -5,
        backgroundColor: '#fff',
        borderRadius: 10,
        padding: 2,
    },
    mediaName: {
        fontSize: 12,
        fontWeight: '600',
        color: '#333',
        marginBottom: 4,
    },
    captionPreview: {
        fontSize: 10,
        color: '#666',
        marginBottom: 4,
        fontStyle: 'italic',
    },
    scheduleTime: {
        fontSize: 10,
        color: '#666',
        marginBottom: 4,
    },
    mediaStatus: {
        fontSize: 10,
        fontWeight: '600',
    },
    noMediaContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 40,
    },
    noMediaText: {
        fontSize: 18,
        color: '#6B7280',
        marginTop: 16,
        marginBottom: 8,
    },
    noMediaSubtext: {
        fontSize: 14,
        color: '#999',
        textAlign: 'center',
    },
    // Media Edit Styles
    mediaPreview: {
        alignItems: 'center',
        marginBottom: 20,
    },
    largeMediaPreview: {
        width: '100%',
        height: 200,
        borderRadius: 12,
        marginBottom: 12,
    },
    largeVideoThumbnail: {
        backgroundColor: '#333',
        justifyContent: 'center',
        alignItems: 'center',
    },
    unknownFileThumbnail: {
        backgroundColor: '#f0f0f0',
        justifyContent: 'center',
        alignItems: 'center',
    },
    videoText: {
        color: '#fff',
        marginTop: 8,
        fontSize: 14,
    },
    videoFileName: {
        color: '#fff',
        fontSize: 12,
        marginTop: 4,
    },
    unknownFileText: {
        color: '#666',
        marginTop: 8,
        fontSize: 14,
    },
    unknownFileName: {
        color: '#666',
        fontSize: 12,
        marginTop: 4,
    },
    mediaFileName: {
        fontSize: 14,
        color: '#666',
        textAlign: 'center',
    },
    scheduleTypeContainer: {
        marginBottom: 20,
    },
    scheduleTypeButtons: {
        flexDirection: 'row',
        gap: 10,
    },
    scheduleTypeButton: {
        flex: 1,
        padding: 12,
        backgroundColor: '#f8f8f8',
        borderRadius: 8,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#ddd',
    },
    scheduleTypeButtonActive: {
        backgroundColor: '#007AFF',
        borderColor: '#007AFF',
    },
    scheduleTypeButtonText: {
        fontSize: 14,
        color: '#666',
        fontWeight: '500',
    },
    scheduleTypeButtonTextActive: {
        color: '#fff',
    },
    datetimeInputContainer: {
        marginBottom: 20,
    },
    datetimeRow: {
        flexDirection: 'row',
        gap: 10,
        marginBottom: 10,
    },
    dateTimeSelectButton: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        padding: 12,
        backgroundColor: '#f8f8f8',
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#ddd',
    },
    dateTimeSelectButtonText: {
        fontSize: 14,
        color: '#007AFF',
        fontWeight: '500',
    },
    selectedDateTime: {
        fontSize: 12,
        color: '#666',
        textAlign: 'center',
        fontStyle: 'italic',
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
    captionInput: {
        minHeight: 80,
        textAlignVertical: 'top',
    },
    helperText: {
        fontSize: 12,
        color: '#666',
        marginTop: 4,
        fontStyle: 'italic',
    },
    switchContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    switchLabel: {
        fontSize: 16,
        color: '#333',
    },
    modalActions: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginTop: 20,
        gap: 10,
    },
    cancelButton: {
        flex: 1,
        backgroundColor: '#f8f8f8',
        padding: 15,
        borderRadius: 8,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#ddd',
        flexDirection: 'row',
        justifyContent: 'center',
    },
    dangerButton: {
        backgroundColor: '#FF3B30',
        borderColor: '#FF3B30',
    },
    dangerButtonText: {
        color: '#fff',
        fontSize: 14,
        fontWeight: '600',
    },
    cancelButtonText: {
        color: '#333',
        fontSize: 16,
        fontWeight: '600',
    },
    saveButton: {
        flex: 2,
        backgroundColor: '#007AFF',
        padding: 15,
        borderRadius: 8,
        alignItems: 'center',
    },
    saveButtonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '600',
    },
    // Delete Modal Styles
    warningIcon: {
        marginBottom: 16,
    },
    deleteTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#333',
        marginBottom: 12,
        textAlign: 'center',
    },
    deleteMessage: {
        fontSize: 16,
        color: '#666',
        textAlign: 'center',
        marginBottom: 24,
        lineHeight: 22,
    },
    deleteActions: {
        flexDirection: 'row',
        gap: 12,
        width: '100%',
    },
    deleteCancelButton: {
        flex: 1,
        backgroundColor: '#f8f8f8',
        padding: 15,
        borderRadius: 8,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#ddd',
    },
    deleteCancelText: {
        color: '#333',
        fontSize: 16,
        fontWeight: '600',
    },
    deleteConfirmButton: {
        flex: 1,
        backgroundColor: '#FF3B30',
        padding: 15,
        borderRadius: 8,
        alignItems: 'center',
    },
    deleteConfirmText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '600',
    },
});

export default ScheduleScreen;




