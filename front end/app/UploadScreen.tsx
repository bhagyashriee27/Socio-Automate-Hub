import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Image,
  ActivityIndicator,
  Modal,
  FlatList,
  Platform,
  TextInput,
  SafeAreaView,
  Dimensions,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import DateTimePicker from '@react-native-community/datetimepicker';
import ApiService from '../services/api';
import StorageService from '../utils/storage';
import { InstagramAccount, TelegramAccount, YouTubeAccount, ApiResponse } from '../types';

interface MediaFile {
  id: string;
  uri: string;
  type: 'image' | 'video';
  name: string;
  size: number;
  status: 'pending' | 'uploading' | 'completed' | 'failed';
  progress?: number;
  selected?: boolean;
  chunkProgress?: { uploaded: number; total: number };
  scheduleType: 'range' | 'datetime';
  scheduledDatetime?: string;
  caption: string;
}

interface ChunkProgress {
  [key: string]: { uploaded: number; total: number };
}

const CHUNK_SIZE = 2 * 1024 * 1024;
const MAX_RETRIES = 3;

const UploadScreen: React.FC = () => {
  const [platform, setPlatform] = useState<'instagram' | 'telegram' | 'youtube'>('instagram');
  const [accounts, setAccounts] = useState<any[]>([]);
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [selectedMedia, setSelectedMedia] = useState<MediaFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ [key: string]: number }>({});
  const [chunkProgress, setChunkProgress] = useState<ChunkProgress>({});
  
  const cancelUploadRef = useRef(false);
  const activeUploadsRef = useRef<Set<string>>(new Set());
  
  // Schedule modal states
  const [scheduleModalVisible, setScheduleModalVisible] = useState(false);
  const [currentMediaForScheduling, setCurrentMediaForScheduling] = useState<MediaFile | null>(null);
  const [selectedScheduleType, setSelectedScheduleType] = useState<'range' | 'datetime'>('range');
  const [scheduledDateTime, setScheduledDateTime] = useState<string>('');
  
  // Date/Time Picker States (MUST BE RENDERED OUTSIDE MODALS)
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedTime, setSelectedTime] = useState<Date | null>(null);
  const tempSelectedDateRef = useRef<Date | null>(null); // To hold date while selecting time
  const tempSelectedTimeRef = useRef<Date | null>(null); // To hold time while selecting date

  // Caption modal states
  const [captionModalVisible, setCaptionModalVisible] = useState(false);
  const [currentMediaForCaption, setCurrentMediaForCaption] = useState<MediaFile | null>(null);
  const [captionText, setCaptionText] = useState('');

  useEffect(() => {
    loadUserData();
  }, []);

  useEffect(() => {
    if (user?.Id) {
      loadAccounts();
    }
  }, [platform, user]);

  const loadUserData = async () => {
    try {
      const userData = await StorageService.getUserData();
      setUser(userData);
    } catch (error) {
      console.error('Error loading user data:', error);
      Alert.alert('Error', 'Failed to load user data');
    }
  };

  const loadAccounts = async () => {
    try {
      const response = await ApiService.getUser(user.Id);
      let platformAccounts: any[] = [];
      switch (platform) {
        case 'instagram':
          platformAccounts = response.instagram_accounts || [];
          break;
        case 'telegram':
          platformAccounts = response.telegram_channels || [];
          break;
        case 'youtube':
          platformAccounts = response.youtube_channels || [];
          break;
      }
      setAccounts(platformAccounts);
      setSelectedAccounts([]);
    } catch (error: any) {
      console.error('Error loading accounts:', error);
      Alert.alert('Error', 'Failed to load accounts');
    }
  };

  const updateScheduledDateTime = (date: Date | null, time: Date | null) => {
    if (date && time) {
      const scheduledDate = new Date(date);
      scheduledDate.setHours(time.getHours());
      scheduledDate.setMinutes(time.getMinutes());
      scheduledDate.setSeconds(0);
      scheduledDate.setMilliseconds(0);
      
      const year = scheduledDate.getFullYear();
      const month = String(scheduledDate.getMonth() + 1).padStart(2, '0');
      const day = String(scheduledDate.getDate()).padStart(2, '0');
      const hours = String(scheduledDate.getHours()).padStart(2, '0');
      const minutes = String(scheduledDate.getMinutes()).padStart(2, '0');
      const seconds = String(scheduledDate.getSeconds()).padStart(2, '0');
      
      const formattedDateTime = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
      setScheduledDateTime(formattedDateTime);
    }
  };

  // --- Date/Time Picker Handlers (Updated for Root Rendering) ---
  const handleDateChange = (event: any, date?: Date) => {
    setShowDatePicker(false);
    if (date) {
      const newDate = date;
      const timeToUse = tempSelectedTimeRef.current || new Date(); // Use existing time or default
      newDate.setHours(timeToUse.getHours());
      newDate.setMinutes(timeToUse.getMinutes());
      
      setSelectedDate(newDate);
      tempSelectedDateRef.current = newDate;
      updateScheduledDateTime(newDate, timeToUse);
    }
  };

  const handleTimeChange = (event: any, time?: Date) => {
    setShowTimePicker(false);
    if (time) {
      const newTime = time;
      const dateToUse = tempSelectedDateRef.current || new Date(); // Use existing date or default
      
      const newDateTime = new Date(dateToUse);
      newDateTime.setHours(newTime.getHours());
      newDateTime.setMinutes(newTime.getMinutes());

      setSelectedTime(newTime);
      tempSelectedTimeRef.current = newTime;
      updateScheduledDateTime(dateToUse, newTime);
    }
  };

  const openDatePicker = () => {
    // Initialize refs if null, using current date/time
    const now = new Date();
    if (!tempSelectedDateRef.current) tempSelectedDateRef.current = selectedDate || now;
    if (!tempSelectedTimeRef.current) tempSelectedTimeRef.current = selectedTime || now;
    setShowDatePicker(true);
  }

  const openTimePicker = () => {
    // Initialize refs if null, using current date/time
    const now = new Date();
    if (!tempSelectedDateRef.current) tempSelectedDateRef.current = selectedDate || now;
    if (!tempSelectedTimeRef.current) tempSelectedTimeRef.current = selectedTime || now;
    setShowTimePicker(true);
  }
  // --- End Date/Time Picker Handlers ---


  const pickMultipleMedia = async (mediaType: 'images' | 'videos' | 'all') => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission required', 'Sorry, we need camera roll permissions to make this work!');
        return;
      }

      let mediaTypes: ImagePicker.MediaTypeOptions[] = [ImagePicker.MediaTypeOptions.Images, ImagePicker.MediaTypeOptions.Videos];
      if (mediaType === 'images') {
        mediaTypes = [ImagePicker.MediaTypeOptions.Images];
      } else if (mediaType === 'videos') {
        mediaTypes = [ImagePicker.MediaTypeOptions.Videos];
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: mediaTypes.length === 2 ? ImagePicker.MediaTypeOptions.All : mediaTypes[0],
        allowsMultipleSelection: true,
        quality: 0.8,
        orderedSelection: true,
      });

      if (!result.canceled && result.assets) {
        const newMedia: MediaFile[] = result.assets.map((asset, index) => ({
          id: `${Date.now()}-${index}-${Math.random().toString(36).substr(2, 9)}`,
          uri: asset.uri,
          type: asset.type === 'video' ? 'video' : 'image',
          name: asset.fileName || `media-${Date.now()}-${index}.${asset.type === 'video' ? 'mp4' : 'jpg'}`,
          size: asset.fileSize || 0,
          status: 'pending',
          selected: true,
          scheduleType: 'range',
          caption: '',
        }));
        setSelectedMedia(prev => [...prev, ...newMedia]);
      }
    } catch (error) {
      console.error('Error picking media:', error);
      Alert.alert('Error', 'Failed to pick media');
    }
  };

  const openScheduleModal = (media: MediaFile) => {
    console.log('✅ Opening schedule modal for:', media.name);
    setCurrentMediaForScheduling(media);
    setSelectedScheduleType(media.scheduleType);
    
    // Set temp refs and state for date/time if available
    if (media.scheduledDatetime) {
      const date = new Date(media.scheduledDatetime);
      setSelectedDate(date);
      setSelectedTime(date);
      tempSelectedDateRef.current = date;
      tempSelectedTimeRef.current = date;
      setScheduledDateTime(media.scheduledDatetime);
    } else {
      setSelectedDate(null);
      setSelectedTime(null);
      tempSelectedDateRef.current = new Date(); // Default to now
      tempSelectedTimeRef.current = new Date(); // Default to now
      setScheduledDateTime('');
    }
    
    setScheduleModalVisible(true);
    console.log('✅ Schedule modal state set to true');
  };

  const openCaptionModal = (media: MediaFile) => {
    console.log('✅ Opening caption modal for:', media.name);
    setCurrentMediaForCaption(media);
    setCaptionText(media.caption || '');
    setCaptionModalVisible(true);
    console.log('✅ Caption modal state set to true');
  };

  const saveScheduleSettings = () => {
    if (!currentMediaForScheduling) return;

    if (selectedScheduleType === 'datetime' && !scheduledDateTime) {
      Alert.alert('Validation Error', 'Please select a scheduled date and time.');
      return;
    }

    setSelectedMedia(prev =>
      prev.map(media =>
        media.id === currentMediaForScheduling.id
          ? {
              ...media,
              scheduleType: selectedScheduleType,
              scheduledDatetime: selectedScheduleType === 'datetime' ? scheduledDateTime : undefined,
            }
          : media
      )
    );

    setScheduleModalVisible(false);
    // Reset picker-related states
    // Note: Do not reset temp refs here, keep them for next open
    setSelectedDate(null); 
    setSelectedTime(null);
    setScheduledDateTime('');
    setCurrentMediaForScheduling(null);
  };

  const saveCaption = () => {
    if (!currentMediaForCaption) return;

    setSelectedMedia(prev =>
      prev.map(media =>
        media.id === currentMediaForCaption.id
          ? { ...media, caption: captionText }
          : media
      )
    );

    setCaptionModalVisible(false);
    setCurrentMediaForCaption(null);
    setCaptionText('');
  };

  const toggleMediaSelection = (mediaId: string) => {
    setSelectedMedia(prev =>
      prev.map(media =>
        media.id === mediaId ? { ...media, selected: !media.selected } : media
      )
    );
  };

  const selectAllMedia = () => {
    setSelectedMedia(prev => prev.map(media => ({ ...media, selected: true })));
  };

  const deselectAllMedia = () => {
    setSelectedMedia(prev => prev.map(media => ({ ...media, selected: false })));
  };

  const removeMedia = (mediaId: string) => {
    setSelectedMedia(prev => prev.filter(media => media.id !== mediaId));
    setUploadProgress(prev => {
      const newProgress = { ...prev };
      delete newProgress[mediaId];
      return newProgress;
    });
    setChunkProgress(prev => {
      const newProgress = { ...prev };
      delete newProgress[mediaId];
      return newProgress;
    });
  };

  const clearAllMedia = () => {
    setSelectedMedia([]);
    setUploadProgress({});
    setChunkProgress({});
  };

  const getSelectedMedia = () => {
    return selectedMedia.filter(media => media.selected);
  };

  const handleCancelUpload = () => {
    cancelUploadRef.current = true;
    setUploading(false);
    
    setSelectedMedia(prev => 
      prev.map(media => 
        media.status === 'uploading' ? { ...media, status: 'pending' } : media
      )
    );
    
    setModalVisible(false);
    activeUploadsRef.current.clear();
  };

  const checkCancelled = () => {
    if (cancelUploadRef.current) {
      throw new Error('Upload cancelled by user');
    }
  };

  const uploadMedia = async () => {
    if (selectedAccounts.length === 0) {
      Alert.alert('Error', 'Please select at least one account first');
      return;
    }

    const mediaToUpload = getSelectedMedia();
    if (mediaToUpload.length === 0) {
      Alert.alert('Error', 'Please select at least one image or video to upload');
      return;
    }

    cancelUploadRef.current = false;
    activeUploadsRef.current.clear();
    setUploading(true);
    setSelectedMedia(prev => prev.map(media =>
      media.selected ? { ...media, status: 'uploading' } : media
    ));

    let successfulUploads = 0;
    let failedUploads = 0;

    const concurrencyLimit = 2;
    const batches = [];
    
    for (let i = 0; i < mediaToUpload.length; i += concurrencyLimit) {
      batches.push(mediaToUpload.slice(i, i + concurrencyLimit));
    }

    try {
      for (const batch of batches) {
        checkCancelled();

        const batchPromises = batch.map(media => 
          uploadMediaToAccounts(media, selectedAccounts)
            .then(result => {
              if (result.success) successfulUploads++;
              else failedUploads++;
            })
            .catch(() => failedUploads++)
        );

        await Promise.all(batchPromises);
      }

      if (cancelUploadRef.current) {
        Alert.alert('Upload Cancelled', 'Upload was cancelled by user');
        return;
      }

      if (successfulUploads > 0 && failedUploads === 0) {
        Alert.alert('Success', `All ${successfulUploads} files uploaded successfully to selected accounts!`);
        setSelectedMedia(prev => prev.filter(media => media.status !== 'completed'));
        if (getSelectedMedia().length === 0) setModalVisible(false);
      } else if (successfulUploads > 0) {
        Alert.alert(
          'Upload Complete',
          `${successfulUploads} files uploaded successfully, ${failedUploads} failed.`,
          [{ text: 'OK' }]
        );
        setSelectedMedia(prev => prev.filter(media => media.status !== 'completed'));
      } else {
        Alert.alert('Upload Failed', 'All files failed to upload. Please try again.');
      }
    } catch (error) {
      if (cancelUploadRef.current) {
        Alert.alert('Upload Cancelled', 'Upload was cancelled by user');
      } else {
        console.error('Upload error:', error);
        Alert.alert('Upload Error', 'An error occurred during upload');
      }
    } finally {
      setUploading(false);
      cancelUploadRef.current = false;
    }
  };

  const uploadMediaToAccounts = async (media: MediaFile, accountIds: string[]): Promise<{ success: boolean }> => {
    try {
      const uploadKey = `${media.id}`;
      if (activeUploadsRef.current.has(uploadKey)) {
        return { success: true };
      }

      activeUploadsRef.current.add(uploadKey);

      for (const accountId of accountIds) {
        checkCancelled();
        await uploadMediaWithRetry(media, accountId);
        checkCancelled();
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      setSelectedMedia(prev =>
        prev.map(m => m.id === media.id ? { ...m, status: 'completed' } : m)
      );
      return { success: true };
    } catch (error) {
      if (cancelUploadRef.current) {
        setSelectedMedia(prev =>
          prev.map(m => m.id === media.id ? { ...m, status: 'pending' } : m)
        );
        return { success: false };
      }
      
      console.error(`Upload failed for "${media.name}":`, error);
      setSelectedMedia(prev =>
        prev.map(m => m.id === media.id ? { ...m, status: 'failed' } : m)
      );
      return { success: false };
    } finally {
      const uploadKey = `${media.id}`;
      activeUploadsRef.current.delete(uploadKey);
    }
  };

  const uploadMediaWithRetry = async (media: MediaFile, accountId: string, retryCount = 0): Promise<void> => {
    try {
      checkCancelled();

      const uploadKey = `${media.id}-${accountId}`;
      
      if (uploadProgress[uploadKey] === 100) {
        return;
      }

      if (media.size > CHUNK_SIZE) {
        await uploadInChunks(media, accountId);
      } else {
        await uploadSingleFile(media, accountId);
      }
      
      setUploadProgress(prev => ({
        ...prev,
        [uploadKey]: 100
      }));
      
    } catch (error: any) {
      checkCancelled();

      if (error.response?.status === 400 && error.response?.data?.error?.includes('duplicate')) {
        setUploadProgress(prev => ({
          ...prev,
          [`${media.id}-${accountId}`]: 100
        }));
        return;
      }

      if (retryCount < MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, 2000 * (retryCount + 1)));
        return uploadMediaWithRetry(media, accountId, retryCount + 1);
      } else {
        throw error;
      }
    }
  };

  const uploadSingleFile = async (media: MediaFile, accountId: string): Promise<void> => {
    checkCancelled();

    const formData = new FormData();
    formData.append('file', {
      uri: media.uri,
      type: media.type === 'image' ? 'image/jpeg' : 'video/mp4',
      name: media.name,
    } as any);
    formData.append('account_id', accountId);
    formData.append('platform', platform);
    formData.append('user_id', user.Id.toString());
    
    formData.append('schedule_type', media.scheduleType);
    if (media.scheduleType === 'datetime' && media.scheduledDatetime) {
      formData.append('scheduled_datetime', media.scheduledDatetime);
    }
    
    if (media.caption) {
      formData.append('caption', media.caption);
    }

    try {
      await ApiService.uploadMedia(formData);
    } catch (error: any) {
      if (error.response?.status === 400 && error.response?.data?.error?.includes('duplicate')) {
        return;
      }
      throw error;
    }
  };

  const uploadInChunks = async (media: MediaFile, accountId: string): Promise<void> => {
    checkCancelled();

    const fileInfo = await FileSystem.getInfoAsync(media.uri);
    if (!fileInfo.exists) throw new Error('File not found');

    const totalChunks = Math.ceil(media.size / CHUNK_SIZE);
    let uploadId = `${media.id}-${Date.now()}`;

    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
      checkCancelled();

      const start = chunkIndex * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, media.size);
      
      const chunkData = await FileSystem.readAsStringAsync(media.uri, {
        encoding: FileSystem.EncodingType.Base64,
        position: start,
        length: end - start,
      } as any);

      const chunkFormData = new FormData();
      chunkFormData.append('chunk', {
        uri: `data:${media.type === 'image' ? 'image/jpeg' : 'video/mp4'};base64,${chunkData}`,
        type: media.type === 'image' ? 'image/jpeg' : 'video/mp4',
        name: `${media.name}.part${chunkIndex}`,
      } as any);
      chunkFormData.append('account_id', accountId);
      chunkFormData.append('platform', platform);
      chunkFormData.append('user_id', user.Id.toString());
      chunkFormData.append('chunk_index', chunkIndex.toString());
      chunkFormData.append('total_chunks', totalChunks.toString());
      chunkFormData.append('upload_id', uploadId);
      chunkFormData.append('original_name', media.name);
      
      chunkFormData.append('schedule_type', media.scheduleType);
      if (media.scheduleType === 'datetime' && media.scheduledDatetime) {
        chunkFormData.append('scheduled_datetime', media.scheduledDatetime);
      }
      
      if (chunkIndex === 0 && media.caption) {
        chunkFormData.append('caption', media.caption);
      }

      try {
        await ApiService.uploadMediaChunk(chunkFormData);
        
        setChunkProgress(prev => ({
          ...prev,
          [media.id]: { uploaded: chunkIndex + 1, total: totalChunks }
        }));

        const chunkProgressValue = ((chunkIndex + 1) / totalChunks) * 100;
        setUploadProgress(prev => ({
          ...prev,
          [media.id]: Math.min(prev[media.id] || 0, chunkProgressValue)
        }));

      } catch (error) {
        throw error;
      }
    }

    checkCancelled();

    const finalizeFormData = new FormData();
    finalizeFormData.append('upload_id', uploadId);
    finalizeFormData.append('account_id', accountId);
    finalizeFormData.append('platform', platform);
    finalizeFormData.append('user_id', user.Id.toString());
    finalizeFormData.append('original_name', media.name);
    finalizeFormData.append('total_chunks', totalChunks.toString());
    
    finalizeFormData.append('schedule_type', media.scheduleType);
    if (media.scheduleType === 'datetime' && media.scheduledDatetime) {
      finalizeFormData.append('scheduled_datetime', media.scheduledDatetime);
    }
    
    if (media.caption) {
      finalizeFormData.append('caption', media.caption);
    }

    try {
      await ApiService.finalizeUpload(finalizeFormData);
    } catch (error) {
      throw error;
    }
  };

  const getSelectedAccountNames = () => {
    if (selectedAccounts.length === 0) return 'No accounts selected';
    const selected = accounts.filter(acc => selectedAccounts.includes(acc.id.toString()));
    return selected.map(acc => getAccountDisplayName(acc)).join(', ');
  };

  const getAccountDisplayName = (account: any) => {
    switch (platform) {
      case 'instagram': return account.username;
      case 'telegram': return account.channel_name;
      case 'youtube': return account.username;
      default: return 'Unknown';
    }
  };

  const toggleAccountSelection = (accountId: string) => {
    setSelectedAccounts(prev => {
      if (prev.includes(accountId)) {
        return prev.filter(id => id !== accountId);
      } else {
        return [...prev, accountId];
      }
    });
  };

  const MediaItem = ({ item }: { item: MediaFile }) => {
    const currentChunkProgress = chunkProgress[item.id];
    
    const getStatusDisplay = () => {
      switch (item.status) {
        case 'completed': 
          return { text: 'Completed', color: '#34C759', icon: '✓' };
        case 'uploading': 
          return { text: 'Uploading', color: '#007AFF', icon: '↻' };
        case 'failed': 
          return { text: 'Failed', color: '#FF3B30', icon: '✗' };
        default: 
          return { text: 'Pending', color: '#8E8E93', icon: '…' };
      }
    };

    const status = getStatusDisplay();
    
    const renderScheduleText = () => {
      if (item.scheduleType === 'datetime' && item.scheduledDatetime) {
        return `📅 ${new Date(item.scheduledDatetime).toLocaleString()}`;
      } else {
        return '⏰ Range Schedule';
      }
    };

    const renderCaptionPreview = () => {
      if (item.caption) {
        const preview = item.caption.length > 30 ? `${item.caption.substring(0, 30)}...` : item.caption;
        return `💬 ${preview}`;
      } else {
        return '💬 Add Caption';
      }
    };

    return (
      <View style={[
        styles.mediaItem,
        item.selected && styles.mediaItemSelected,
      ]}>
        {/* Checkbox */}
        <TouchableOpacity 
          style={styles.checkboxContainer}
          onPress={() => toggleMediaSelection(item.id)}
        >
          <View style={[
            styles.checkbox,
            item.selected && styles.checkboxSelected,
          ]}>
            {item.selected && (
              <View style={styles.checkboxTick}>
                <Text style={styles.checkboxTickText}>✓</Text>
              </View>
            )}
          </View>
        </TouchableOpacity>

        {/* Media Preview */}
        <View style={styles.mediaPreview}>
          {item.type === 'image' ? (
            <Image source={{ uri: item.uri }} style={styles.mediaThumbnail} />
          ) : (
            <View style={[styles.mediaThumbnail, styles.videoThumbnail]}>
              <Text style={styles.videoIcon}>▶</Text>
            </View>
          )}
        </View>

        {/* Media Info */}
        <View style={styles.mediaInfo}>
          <Text style={styles.mediaName} numberOfLines={1}>
            {item.name || 'Unknown File'}
          </Text>
          
          <Text style={styles.fileSize}>
            {formatFileSize(item.size)}
          </Text>
          
          <TouchableOpacity 
            style={styles.scheduleButton}
            onPress={() => openScheduleModal(item)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={styles.scheduleButtonText}>
              {renderScheduleText()}
            </Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={styles.captionButton}
            onPress={() => openCaptionModal(item)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={styles.captionButtonText}>
              {renderCaptionPreview()}
            </Text>
          </TouchableOpacity>
          
          <View style={styles.statusContainer}>
            <View style={styles.statusWithIcon}>
              <Text style={styles.statusIcon}>
                {status.icon}
              </Text>
              <Text style={[styles.statusText, { color: status.color }]}>
                {status.text}
              </Text>
            </View>
            
            {item.status === 'uploading' && uploadProgress[item.id] !== undefined && (
              <Text style={styles.progressText}>
                {Math.round(uploadProgress[item.id])}%
              </Text>
            )}
          </View>
          
          {currentChunkProgress && (
            <Text style={styles.chunkProgressText}>
              Chunk: {currentChunkProgress.uploaded}/{currentChunkProgress.total}
            </Text>
          )}
          
          {item.status === 'uploading' && (
            <View style={styles.progressBar}>
              <View 
                style={[
                  styles.progressFill, 
                  { width: `${uploadProgress[item.id] || 0}%` }
                ]} 
              />
            </View>
          )}
        </View>

        <TouchableOpacity
          style={styles.removeMediaButton}
          onPress={() => removeMedia(item.id)}
          disabled={item.status === 'uploading'}
        >
          <Text style={styles.removeMediaText}>×</Text>
        </TouchableOpacity>
      </View>
    );
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const renderAccountSelection = () => {
    if (accounts.length === 0) {
      return (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>No {platform} accounts found</Text>
          <Text style={styles.emptySubtext}>Please add an account first to upload media</Text>
        </View>
      );
    }

    return (
      <View style={styles.accountListContainer}>
        <FlatList
          data={accounts}
          keyExtractor={(item) => item.id.toString()}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[
                styles.accountItem,
                selectedAccounts.includes(item.id.toString()) && styles.accountItemSelected,
              ]}
              onPress={() => toggleAccountSelection(item.id.toString())}
            >
              <View style={[
                styles.checkbox,
                selectedAccounts.includes(item.id.toString()) && styles.checkboxSelected,
              ]}>
                {selectedAccounts.includes(item.id.toString()) && (
                  <View style={styles.checkboxTick}>
                    <Text style={styles.checkboxTickText}>✓</Text>
                  </View>
                )}
              </View>
              <Text style={styles.accountItemText}>{getAccountDisplayName(item)}</Text>
            </TouchableOpacity>
          )}
        />
      </View>
    );
  };

  const canOpenModal = selectedAccounts.length > 0 && accounts.length > 0;
  const selectedMediaCount = getSelectedMedia().length;
  const totalMediaCount = selectedMedia.length;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Upload Media</Text>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Select Platform</Text>
          <View style={styles.platformContainer}>
            {['instagram', 'telegram', 'youtube'].map((plat) => (
              <TouchableOpacity
                key={plat}
                style={[
                  styles.platformButton,
                  platform === plat && styles.platformButtonActive,
                ]}
                onPress={() => setPlatform(plat as any)}
              >
                <Text style={[
                  styles.platformButtonText,
                  platform === plat && styles.platformButtonTextActive,
                ]}>
                  {plat.charAt(0).toUpperCase() + plat.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Select Accounts (Multiple)</Text>
          {renderAccountSelection()}
        </View>
        <View style={styles.uploadSection}>
          <View style={styles.statsContainer}>
            <View style={styles.statItem}>
              <Text style={styles.statNumber}>{totalMediaCount}</Text>
              <Text style={styles.statLabel}>Total</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statNumber}>{selectedMediaCount}</Text>
              <Text style={styles.statLabel}>Selected</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statNumber}>
                {selectedMedia.filter(m => m.status === 'completed').length}
              </Text>
              <Text style={styles.statLabel}>Completed</Text>
            </View>
          </View>
          <TouchableOpacity
            style={[
              styles.uploadButton,
              !canOpenModal && styles.uploadButtonDisabled,
            ]}
            onPress={() => setModalVisible(true)}
            disabled={!canOpenModal}
          >
            <Text style={styles.uploadButtonText}>
              {totalMediaCount > 0
                ? `Manage ${totalMediaCount} File${totalMediaCount > 1 ? 's' : ''}`
                : 'Select Media to Upload'}
            </Text>
          </TouchableOpacity>
        </View>
        {selectedAccounts.length > 0 && (
          <View style={styles.accountInfo}>
            <Text style={styles.accountInfoText}>📝 Uploading to: {getSelectedAccountNames()}</Text>
            {totalMediaCount > 0 && (
              <Text style={styles.mediaCountText}>
                📦 {selectedMediaCount}/{totalMediaCount} file{totalMediaCount > 1 ? 's' : ''} selected
              </Text>
            )}
          </View>
        )}
        {selectedAccounts.length === 0 && accounts.length > 0 && (
          <View style={styles.helpContainer}>
            <Text style={styles.helpText}>💡 Please select one or more accounts above to start uploading media</Text>
          </View>
        )}
        {accounts.length === 0 && (
          <View style={styles.helpContainer}>
            <Text style={styles.helpText}>⚠️ No {platform} accounts found. Please add accounts first.</Text>
          </View>
        )}
      </View>
      
      {/* Main Media Management Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => !uploading && setModalVisible(false)}
        supportedOrientations={['portrait', 'landscape']}
        presentationStyle="overFullScreen"
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContainer}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Upload Media</Text>
                <Text style={styles.selectedAccount}>To: {getSelectedAccountNames()}</Text>
                <Text style={styles.selectionInfo}>{selectedMediaCount} of {totalMediaCount} selected</Text>
              </View>
              {totalMediaCount > 0 && (
                <View style={styles.selectionControls}>
                  <TouchableOpacity
                    style={styles.selectionButton}
                    onPress={selectAllMedia}
                    disabled={uploading}
                  >
                    <Text style={styles.selectionButtonText}>Select All</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.selectionButton}
                    onPress={deselectAllMedia}
                    disabled={uploading}
                  >
                    <Text style={styles.selectionButtonText}>Deselect All</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.selectionButton}
                    onPress={clearAllMedia}
                    disabled={uploading}
                  >
                    <Text style={[styles.selectionButtonText, styles.clearAllText]}>Clear All</Text>
                  </TouchableOpacity>
                </View>
              )}
              {totalMediaCount > 0 ? (
                <View style={styles.mediaListContainer}>
                  <FlatList
                    data={selectedMedia}
                    renderItem={MediaItem}
                    keyExtractor={item => item.id}
                    style={styles.mediaList}
                  />
                </View>
              ) : (
                <View style={styles.noMediaContainer}>
                  <Text style={styles.noMediaText}>No media selected</Text>
                  <Text style={styles.noMediaSubtext}>Choose images or videos to upload using the buttons below</Text>
                </View>
              )}
              <View style={styles.mediaButtons}>
                <TouchableOpacity
                  style={styles.mediaButton}
                  onPress={() => pickMultipleMedia('images')}
                  disabled={uploading}
                >
                  <Text style={styles.mediaButtonText}>📸 Select Images</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.mediaButton}
                  onPress={() => pickMultipleMedia('videos')}
                  disabled={uploading}
                >
                  <Text style={styles.mediaButtonText}>🎥 Select Videos</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.mediaButton}
                  onPress={() => pickMultipleMedia('all')}
                  disabled={uploading}
                >
                  <Text style={styles.mediaButtonText}>📁 Select Both</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.actionButtons}>
                <TouchableOpacity
                  style={styles.cancelButton}
                  onPress={uploading ? handleCancelUpload : () => setModalVisible(false)}
                >
                  <Text style={styles.cancelButtonText}>
                    {uploading ? 'Cancel Upload' : 'Close'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.uploadModalButton,
                    (selectedMediaCount === 0 || uploading) && styles.uploadModalButtonDisabled,
                  ]}
                  onPress={uploadMedia}
                  disabled={selectedMediaCount === 0 || uploading}
                >
                  {uploading ? (
                    <View style={styles.uploadingContainer}>
                      <ActivityIndicator color="#fff" size="small" />
                      <Text style={styles.uploadingText}>
                        Uploading... {selectedMedia.filter(m => m.status === 'completed').length}/{selectedMediaCount}
                      </Text>
                    </View>
                  ) : (
                    <Text style={styles.uploadModalButtonText}>Upload Selected ({selectedMediaCount})</Text>
                  )}
                </TouchableOpacity>
              </View>
              
              
              {/* === FIX APPLIED: NESTED SECONDARY MODALS START HERE === */}
              
              {/* Schedule Settings Modal (NESTED) */}
              <Modal
                animationType="slide"
                transparent={true}
                visible={scheduleModalVisible}
                onRequestClose={() => setScheduleModalVisible(false)}
                supportedOrientations={['portrait', 'landscape']}
              >
                <View style={styles.modalBackdrop}>
                  <View style={styles.modalContainer}>
                    <View style={styles.scheduleModalContent}>
                      <Text style={styles.scheduleModalTitle}>Schedule Settings</Text>
                      {currentMediaForScheduling && (
                        <Text style={styles.scheduleMediaName}>{currentMediaForScheduling.name}</Text>
                      )}
                      
                      <View style={styles.scheduleTypeContainer}>
                        <Text style={styles.scheduleTypeLabel}>Schedule Type:</Text>
                        <View style={styles.scheduleTypeButtons}>
                          <TouchableOpacity
                            style={[
                              styles.scheduleTypeButton,
                              selectedScheduleType === 'range' && styles.scheduleTypeButtonActive,
                            ]}
                            onPress={() => {
                              setSelectedScheduleType('range');
                              setScheduledDateTime('');
                            }}
                          >
                            <Text style={[
                              styles.scheduleTypeButtonText,
                              selectedScheduleType === 'range' && styles.scheduleTypeButtonTextActive,
                            ]}>
                              ⏰ Range
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[
                              styles.scheduleTypeButton,
                              selectedScheduleType === 'datetime' && styles.scheduleTypeButtonActive,
                            ]}
                            onPress={() => setSelectedScheduleType('datetime')}
                          >
                            <Text style={[
                              styles.scheduleTypeButtonText,
                              selectedScheduleType === 'datetime' && styles.scheduleTypeButtonTextActive,
                            ]}>
                              📅 Date/Time
                            </Text>
                          </TouchableOpacity>
                        </View>
                      </View>

                      {selectedScheduleType === 'datetime' && (
                        <View style={styles.datetimeContainer}>
                          <Text style={styles.datetimeLabel}>Select Date & Time:</Text>
                          
                          <View style={styles.pickerContainer}>
                            <Text style={styles.pickerLabel}>Date:</Text>
                            <TouchableOpacity
                              style={styles.pickerButton}
                              onPress={openDatePicker} // Use new handler
                            >
                              <Text style={styles.pickerButtonText}>
                                {selectedDate ? selectedDate.toDateString() : 'Select Date'}
                              </Text>
                            </TouchableOpacity>
                          </View>

                          <View style={styles.pickerContainer}>
                            <Text style={styles.pickerLabel}>Time:</Text>
                            <TouchableOpacity
                              style={styles.pickerButton}
                              onPress={openTimePicker} // Use new handler
                            >
                              <Text style={styles.pickerButtonText}>
                                {selectedTime ? 
                                  selectedTime.toLocaleTimeString([], { 
                                    hour: '2-digit', 
                                    minute: '2-digit',
                                    hour12: true 
                                  }) 
                                  : 'Select Time'
                                }
                              </Text>
                            </TouchableOpacity>
                          </View>

                          {scheduledDateTime && (
                            <View style={styles.selectedDateTimeContainer}>
                              <Text style={styles.selectedDateTimeLabel}>Scheduled for:</Text>
                              <Text style={styles.selectedDateTimeText}>
                                {new Date(scheduledDateTime).toLocaleString()}
                              </Text>
                            </View>
                          )}
                          
                        </View>
                      )}

                      {selectedScheduleType === 'range' && (
                        <View style={styles.rangeInfo}>
                          <Text style={styles.rangeInfoText}>
                            This file will be posted randomly within your account's scheduled time range.
                          </Text>
                        </View>
                      )}

                      <View style={styles.scheduleModalActions}>
                        <TouchableOpacity
                          style={styles.scheduleCancelButton}
                          onPress={() => {
                            setScheduleModalVisible(false);
                          }}
                        >
                          <Text style={styles.scheduleCancelButtonText}>Cancel</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.scheduleSaveButton}
                          onPress={saveScheduleSettings}
                        >
                          <Text style={styles.scheduleSaveButtonText}>
                            Save Schedule
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                </View>
              </Modal>

              {/* Caption Modal (NESTED) */}
              <Modal
                animationType="slide"
                transparent={true}
                visible={captionModalVisible}
                onRequestClose={() => setCaptionModalVisible(false)}
                supportedOrientations={['portrait', 'landscape']}
              >
                <View style={styles.modalBackdrop}>
                  <View style={styles.modalContainer}>
                    <View style={styles.captionModalContent}>
                      <Text style={styles.captionModalTitle}>Add Caption</Text>
                      {currentMediaForCaption && (
                        <Text style={styles.captionMediaName}>{currentMediaForCaption.name}</Text>
                      )}
                      
                      <View style={styles.captionInputContainer}>
                        <Text style={styles.captionLabel}>Caption:</Text>
                        <TextInput
                          style={styles.captionInput}
                          value={captionText}
                          onChangeText={setCaptionText}
                          placeholder="Enter caption for this post..."
                          multiline
                          numberOfLines={4}
                          maxLength={500}
                        />
                        <Text style={styles.captionCounter}>
                          {captionText.length}/500 characters
                        </Text>
                      </View>

                      <View style={styles.captionModalActions}>
                        <TouchableOpacity
                          style={styles.captionCancelButton}
                          onPress={() => {
                            setCaptionModalVisible(false);
                            setCurrentMediaForCaption(null);
                            setCaptionText('');
                          }}
                        >
                          <Text style={styles.captionCancelButtonText}>Cancel</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.captionSaveButton}
                          onPress={saveCaption}
                        >
                          <Text style={styles.captionSaveButtonText}>
                            Save Caption
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                </View>
              </Modal>

            </View>
          </View>
        </View>
      </Modal>

      {/* ========================================
        FIX: DATE/TIME PICKERS MOVED TO ROOT LEVEL
        ========================================
      */}
      {showDatePicker && (
        <DateTimePicker
          value={selectedDate || new Date()}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={handleDateChange}
          minimumDate={new Date()}
        />
      )}
      
      {showTimePicker && (
        <DateTimePicker
          value={selectedTime || new Date()}
          mode="time"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={handleTimeChange}
        />
      )}
    </SafeAreaView>
  );
};

// ... (Styles object is not changed)
const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: '#f5f5f5',
    },
    content: {
      padding: 20,
    },
    title: {
      fontSize: 28,
      fontWeight: 'bold',
      color: '#333',
      marginBottom: 20,
      textAlign: 'center',
    },
    section: {
      marginBottom: 20,
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: '#333',
      marginBottom: 10,
    },
    platformContainer: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
    },
    platformButton: {
      paddingHorizontal: 16,
      paddingVertical: 8,
      backgroundColor: '#fff',
      borderRadius: 20,
      borderWidth: 1,
      borderColor: '#ddd',
    },
    platformButtonActive: {
      backgroundColor: '#007AFF',
      borderColor: '#007AFF',
    },
    platformButtonText: {
      fontSize: 14,
      color: '#666',
      fontWeight: '500',
    },
    platformButtonTextActive: {
      color: '#fff',
    },
    emptyState: {
      backgroundColor: '#fff',
      padding: 20,
      borderRadius: 10,
      alignItems: 'center',
    },
    emptyText: {
      fontSize: 14,
      color: '#666',
      marginBottom: 4,
    },
    emptySubtext: {
      fontSize: 12,
      color: '#999',
      textAlign: 'center',
    },
    accountListContainer: {
      backgroundColor: '#fff',
      borderRadius: 10,
      maxHeight: 200,
    },
    accountItem: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 15,
      borderBottomWidth: 1,
      borderBottomColor: '#f0f0f0',
    },
    accountItemSelected: {
      backgroundColor: '#f8f8f8',
    },
    accountItemText: {
      fontSize: 16,
      color: '#333',
      marginLeft: 10,
    },
    checkbox: {
      width: 20,
      height: 20,
      borderRadius: 4,
      borderWidth: 2,
      borderColor: '#ccc',
      justifyContent: 'center',
      alignItems: 'center',
    },
    checkboxSelected: {
      backgroundColor: '#007AFF',
      borderColor: '#007AFF',
    },
    checkboxTick: {
      justifyContent: 'center',
      alignItems: 'center',
    },
    checkboxTickText: {
      color: '#fff',
      fontSize: 12,
      fontWeight: 'bold',
    },
    checkboxContainer: {
      marginRight: 10,
    },
    uploadSection: {
      marginBottom: 20,
    },
    statsContainer: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      backgroundColor: '#fff',
      padding: 15,
      borderRadius: 10,
      marginBottom: 15,
    },
    statItem: {
      alignItems: 'center',
    },
    statNumber: {
      fontSize: 20,
      fontWeight: 'bold',
      color: '#007AFF',
    },
    statLabel: {
      fontSize: 12,
      color: '#666',
      marginTop: 4,
    },
    uploadButton: {
      backgroundColor: '#007AFF',
      padding: 15,
      borderRadius: 10,
      alignItems: 'center',
    },
    uploadButtonDisabled: {
      backgroundColor: '#ccc',
    },
    uploadButtonText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '600',
    },
    accountInfo: {
      backgroundColor: '#e8f4fd',
      padding: 15,
      borderRadius: 10,
      borderLeftWidth: 4,
      borderLeftColor: '#007AFF',
    },
    accountInfoText: {
      fontSize: 14,
      color: '#007AFF',
      fontWeight: '500',
    },
    mediaCountText: {
      fontSize: 13,
      color: '#007AFF',
      marginTop: 5,
      fontWeight: '400',
    },
    helpContainer: {
      backgroundColor: '#fff3cd',
      padding: 15,
      borderRadius: 10,
      borderLeftWidth: 4,
      borderLeftColor: '#ffc107',
      marginTop: 10,
    },
    helpText: {
      fontSize: 14,
      color: '#856404',
      fontWeight: '500',
    },
    modalBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 1000,
    },
    modalContainer: {
      width: '100%',
      height: '100%',
      justifyContent: 'center',
      alignItems: 'center',
      padding: Platform.OS === 'ios' ? 20 : 0,
    },
    modalContent: {
      backgroundColor: '#fff',
      borderRadius: 15,
      padding: 20,
      width: Platform.OS === 'ios' ? '90%' : '100%',
      maxHeight: Platform.OS === 'ios' ? '80%' : '100%',
      zIndex: 1001,
      elevation: Platform.OS === 'android' ? 5 : undefined,
    },
    modalHeader: {
      marginBottom: 15,
    },
    modalTitle: {
      fontSize: 20,
      fontWeight: 'bold',
      color: '#333',
      textAlign: 'center',
    },
    selectedAccount: {
      fontSize: 14,
      color: '#666',
      textAlign: 'center',
      marginTop: 5,
    },
    selectionInfo: {
      fontSize: 12,
      color: '#007AFF',
      textAlign: 'center',
      marginTop: 2,
      fontWeight: '500',
    },
    selectionControls: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 15,
      gap: 5,
    },
    selectionButton: {
      flex: 1,
      padding: 8,
      backgroundColor: '#f8f8f8',
      borderRadius: 6,
      alignItems: 'center',
    },
    selectionButtonText: {
      fontSize: 12,
      color: '#333',
      fontWeight: '500',
    },
    clearAllText: {
      color: '#FF3B30',
    },
    mediaListContainer: {
      flex: 1,
      marginBottom: 20,
    },
    mediaList: {
      maxHeight: 300,
    },
    mediaItem: {
      flexDirection: 'row',
      backgroundColor: '#f8f8f8',
      padding: 12,
      borderRadius: 8,
      marginBottom: 8,
      alignItems: 'center',
    },
    mediaItemSelected: {
      backgroundColor: '#e8f4fd',
      borderColor: '#007AFF',
      borderWidth: 1,
    },
    mediaPreview: {
      marginRight: 12,
    },
    mediaThumbnail: {
      width: 50,
      height: 50,
      borderRadius: 6,
    },
    videoThumbnail: {
      backgroundColor: '#e0e0e0',
      justifyContent: 'center',
      alignItems: 'center',
    },
    videoIcon: {
      fontSize: 16,
      color: '#666',
      fontWeight: 'bold',
    },
    mediaInfo: {
      flex: 1,
    },
    mediaName: {
      fontSize: 14,
      color: '#333',
      fontWeight: '500',
      marginBottom: 2,
    },
    fileSize: {
      fontSize: 12,
      color: '#666',
      marginBottom: 6,
    },
    scheduleButton: {
      backgroundColor: '#f0f0f0',
      paddingHorizontal: 8,
      paddingVertical: 6,
      borderRadius: 4,
      marginBottom: 4,
      alignSelf: 'flex-start',
    },
    scheduleButtonText: {
      fontSize: 11,
      color: '#666',
      fontWeight: '500',
    },
    captionButton: {
      backgroundColor: '#f0f8ff',
      paddingHorizontal: 8,
      paddingVertical: 6,
      borderRadius: 4,
      marginBottom: 6,
      alignSelf: 'flex-start',
      borderWidth: 1,
      borderColor: '#007AFF',
    },
    captionButtonText: {
      fontSize: 11,
      color: '#007AFF',
      fontWeight: '500',
    },
    statusContainer: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    statusWithIcon: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    statusIcon: {
      fontSize: 12,
    },
    statusText: {
      fontSize: 12,
      fontWeight: '500',
    },
    progressText: {
      fontSize: 12,
      color: '#007AFF',
      fontWeight: '500',
    },
    chunkProgressText: {
      fontSize: 11,
      color: '#666',
      marginTop: 2,
    },
    progressBar: {
      height: 3,
      backgroundColor: '#e0e0e0',
      borderRadius: 2,
      marginTop: 4,
      overflow: 'hidden',
    },
    progressFill: {
      height: '100%',
      backgroundColor: '#007AFF',
      borderRadius: 2,
    },
    removeMediaButton: {
      padding: 4,
    },
    removeMediaText: {
      color: '#FF3B30',
      fontSize: 18,
      fontWeight: 'bold',
    },
    noMediaContainer: {
      padding: 40,
      alignItems: 'center',
      marginBottom: 20,
    },
    noMediaText: {
      fontSize: 16,
      color: '#666',
      marginBottom: 8,
    },
    noMediaSubtext: {
      fontSize: 14,
      color: '#999',
      textAlign: 'center',
    },
    mediaButtons: {
      gap: 10,
      marginBottom: 20,
    },
    mediaButton: {
      backgroundColor: '#f8f8f8',
      padding: 15,
      borderRadius: 10,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: '#ddd',
    },
    mediaButtonText: {
      fontSize: 16,
      color: '#333',
      fontWeight: '500',
    },
    actionButtons: {
      flexDirection: 'row',
      gap: 10,
    },
    cancelButton: {
      flex: 1,
      padding: 15,
      borderRadius: 10,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: '#ddd',
    },
    cancelButtonText: {
      fontSize: 16,
      color: '#666',
      fontWeight: '500',
    },
    uploadModalButton: {
      flex: 2,
      backgroundColor: '#34C759',
      padding: 15,
      borderRadius: 10,
      alignItems: 'center',
    },
    uploadModalButtonDisabled: {
      backgroundColor: '#ccc',
    },
    uploadModalButtonText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '600',
    },
    uploadingContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    uploadingText: {
      color: '#fff',
      fontSize: 14,
      fontWeight: '500',
    },
    scheduleModalContent: {
      backgroundColor: '#fff',
      borderRadius: 15,
      padding: 20,
      width: Platform.OS === 'ios' ? '90%' : '100%',
      maxHeight: Platform.OS === 'ios' ? '80%' : '100%',
      zIndex: 1001,
      elevation: Platform.OS === 'android' ? 5 : undefined,
    },
    scheduleModalTitle: {
      fontSize: 20,
      fontWeight: 'bold',
      color: '#333',
      textAlign: 'center',
      marginBottom: 10,
    },
    scheduleMediaName: {
      fontSize: 14,
      color: '#666',
      textAlign: 'center',
      marginBottom: 20,
      fontStyle: 'italic',
    },
    scheduleTypeContainer: {
      marginBottom: 20,
    },
    scheduleTypeLabel: {
      fontSize: 16,
      fontWeight: '600',
      color: '#333',
      marginBottom: 10,
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
    datetimeContainer: {
      marginBottom: 20,
    },
    datetimeLabel: {
      fontSize: 14,
      fontWeight: '600',
      color: '#333',
      marginBottom: 8,
    },
    pickerContainer: {
      marginBottom: 15,
    },
    pickerLabel: {
      fontSize: 14,
      fontWeight: '600',
      color: '#333',
      marginBottom: 8,
    },
    pickerButton: {
      borderWidth: 1,
      borderColor: '#ddd',
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 12,
      backgroundColor: '#fff',
    },
    pickerButtonText: {
      fontSize: 14,
      color: '#333',
    },
    selectedDateTimeContainer: {
      backgroundColor: '#e8f4fd',
      padding: 12,
      borderRadius: 8,
      marginTop: 10,
    },
    selectedDateTimeLabel: {
      fontSize: 12,
      color: '#007AFF',
      fontWeight: '500',
      marginBottom: 4,
    },
    selectedDateTimeText: {
      fontSize: 14,
      color: '#333',
      fontWeight: '600',
    },
    rangeInfo: {
      backgroundColor: '#f8f8f8',
      padding: 12,
      borderRadius: 8,
      marginBottom: 20,
    },
    rangeInfoText: {
      fontSize: 14,
      color: '#666',
      textAlign: 'center',
    },
    scheduleModalActions: {
      flexDirection: 'row',
      gap: 10,
    },
    scheduleCancelButton: {
      flex: 1,
      padding: 15,
      borderRadius: 8,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: '#ddd',
    },
    scheduleCancelButtonText: {
      fontSize: 16,
      color: '#666',
      fontWeight: '500',
    },
    scheduleSaveButton: {
      flex: 1,
      backgroundColor: '#007AFF',
      padding: 15,
      borderRadius: 8,
      alignItems: 'center',
    },
    scheduleSaveButtonText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '600',
    },
    captionModalContent: {
      backgroundColor: '#fff',
      borderRadius: 15,
      padding: 20,
      width: Platform.OS === 'ios' ? '90%' : '100%',
      maxHeight: Platform.OS === 'ios' ? '60%' : '100%',
      zIndex: 1001,
      elevation: Platform.OS === 'android' ? 5 : undefined,
    },
    captionModalTitle: {
      fontSize: 20,
      fontWeight: 'bold',
      color: '#333',
      textAlign: 'center',
      marginBottom: 10,
    },
    captionMediaName: {
      fontSize: 14,
      color: '#666',
      textAlign: 'center',
      marginBottom: 20,
      fontStyle: 'italic',
    },
    captionInputContainer: {
      marginBottom: 20,
    },
    captionLabel: {
      fontSize: 16,
      fontWeight: '600',
      color: '#333',
      marginBottom: 8,
    },
    captionInput: {
      borderWidth: 1,
      borderColor: '#ddd',
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 12,
      fontSize: 14,
      backgroundColor: '#fff',
      minHeight: 100,
      textAlignVertical: 'top',
    },
    captionCounter: {
      fontSize: 12,
      color: '#666',
      textAlign: 'right',
      marginTop: 4,
    },
    captionModalActions: {
      flexDirection: 'row',
      gap: 10,
    },
    captionCancelButton: {
      flex: 1,
      padding: 15,
      borderRadius: 8,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: '#ddd',
    },
    captionCancelButtonText: {
      fontSize: 16,
      color: '#666',
      fontWeight: '500',
    },
    captionSaveButton: {
      flex: 1,
      backgroundColor: '#007AFF',
      padding: 15,
      borderRadius: 8,
      alignItems: 'center',
    },
    captionSaveButtonText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '600',
    },
  });

export default UploadScreen;