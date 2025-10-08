import React, { useState, useEffect } from 'react';
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
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import ApiService from '../services/api';
import StorageService from '../utils/storage';
import { InstagramAccount, TelegramAccount, FacebookAccount, YouTubeAccount } from '../types';

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
}

interface ChunkProgress {
  [key: string]: { uploaded: number; total: number };
}

const CHUNK_SIZE = 2 * 1024 * 1024; // 2MB chunks
const MAX_RETRIES = 3;

const UploadScreen: React.FC = () => {
  const [platform, setPlatform] = useState<'instagram' | 'telegram' | 'facebook' | 'youtube'>('instagram');
  const [accounts, setAccounts] = useState<any[]>([]);
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [selectedMedia, setSelectedMedia] = useState<MediaFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ [key: string]: number }>({});
  const [chunkProgress, setChunkProgress] = useState<ChunkProgress>({});

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

  const pickMultipleMedia = async (mediaType: 'images' | 'videos' | 'all') => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission required', 'Sorry, we need camera roll permissions to make this work!');
        return;
      }

      let mediaTypes: any = ImagePicker.MediaTypeOptions.All;
      if (mediaType === 'images') {
        mediaTypes = ImagePicker.MediaTypeOptions.Images;
      } else if (mediaType === 'videos') {
        mediaTypes = ImagePicker.MediaTypeOptions.Videos;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes,
        allowsMultipleSelection: true,
        quality: 0.8,
        orderedSelection: true,
      });

      if (!result.canceled && result.assets) {
        const newMedia: MediaFile[] = await Promise.all(
          result.assets.map(async (asset, index) => {
            try {
              const fileInfo = await FileSystem.getInfoAsync(asset.uri);
              let fileSize = 0;
              
              if (fileInfo.exists && 'size' in fileInfo) {
                fileSize = fileInfo.size || 0;
              }

              return {
                id: `${Date.now()}-${index}`,
                uri: asset.uri,
                type: asset.type === 'video' ? 'video' : 'image',
                name: asset.fileName || `media-${Date.now()}-${index}.${asset.type === 'video' ? 'mp4' : 'jpg'}`,
                size: fileSize,
                status: 'pending',
                selected: true,
              };
            } catch (error) {
              console.error('Error getting file info:', error);
              return {
                id: `${Date.now()}-${index}`,
                uri: asset.uri,
                type: asset.type === 'video' ? 'video' : 'image',
                name: asset.fileName || `media-${Date.now()}-${index}.${asset.type === 'video' ? 'mp4' : 'jpg'}`,
                size: 0,
                status: 'pending',
                selected: true,
              };
            }
          })
        );
        setSelectedMedia(prev => [...prev, ...newMedia]);
      }
    } catch (error) {
      console.error('Error picking media:', error);
      Alert.alert('Error', 'Failed to pick media');
    }
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

    for (const batch of batches) {
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

    setUploading(false);

    if (successfulUploads > 0 && failedUploads === 0) {
      console.log(`✅ SUCCESS: All ${successfulUploads} files uploaded successfully!`);
      Alert.alert('Success', `All ${successfulUploads} files uploaded successfully to selected accounts!`);
      setSelectedMedia(prev => prev.filter(media => media.status !== 'completed'));
      if (getSelectedMedia().length === 0) setModalVisible(false);
    } else if (successfulUploads > 0) {
      console.log(`⚠️ PARTIAL: ${successfulUploads} successful, ${failedUploads} failed`);
      Alert.alert(
        'Upload Complete',
        `${successfulUploads} files uploaded successfully, ${failedUploads} failed.`,
        [{ text: 'OK' }]
      );
      setSelectedMedia(prev => prev.filter(media => media.status !== 'completed'));
    } else {
      console.log(`❌ FAILED: All ${failedUploads} files failed to upload`);
      Alert.alert('Upload Failed', 'All files failed to upload. Please try again.');
    }
  };

  const uploadMediaToAccounts = async (media: MediaFile, accountIds: string[]): Promise<{ success: boolean }> => {
    try {
      for (const accountId of accountIds) {
        await uploadMediaWithRetry(media, accountId);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      setSelectedMedia(prev =>
        prev.map(m => m.id === media.id ? { ...m, status: 'completed' } : m)
      );
      console.log(`✅ File "${media.name}" uploaded successfully to all accounts`);
      return { success: true };
    } catch (error) {
      console.error(`❌ Upload failed for "${media.name}":`, error);
      setSelectedMedia(prev =>
        prev.map(m => m.id === media.id ? { ...m, status: 'failed' } : m)
      );
      return { success: false };
    }
  };

  const uploadMediaWithRetry = async (media: MediaFile, accountId: string, retryCount = 0): Promise<void> => {
    try {
      if (media.size > CHUNK_SIZE) {
        console.log(`[CHUNKED] Using chunked upload for "${media.name}" (${formatFileSize(media.size)})`);
        await uploadInChunks(media, accountId);
      } else {
        console.log(`[SINGLE] Using single upload for "${media.name}" (${formatFileSize(media.size)})`);
        await uploadSingleFile(media, accountId);
      }
      console.log(`[SUCCESS] Successfully uploaded "${media.name}" to account ${accountId}`);
    } catch (error) {
      if (retryCount < MAX_RETRIES) {
        console.log(`[RETRY] Retrying upload for "${media.name}" (attempt ${retryCount + 1}/${MAX_RETRIES})`);
        await new Promise(resolve => setTimeout(resolve, 2000 * (retryCount + 1)));
        return uploadMediaWithRetry(media, accountId, retryCount + 1);
      } else {
        console.log(`[ERROR] All retries failed for "${media.name}":`, error);
        throw error;
      }
    }
  };

  const uploadSingleFile = async (media: MediaFile, accountId: string): Promise<void> => {
    const formData = new FormData();
    formData.append('file', {
      uri: media.uri,
      type: media.type === 'image' ? 'image/jpeg' : 'video/mp4',
      name: media.name,
    } as any);
    formData.append('account_id', accountId);
    formData.append('platform', platform);
    formData.append('user_id', user.Id.toString());

    const response = await ApiService.uploadMedia(formData);
    
    if (!response.message && !response.file_id) {
      throw new Error(response.error || 'Upload failed without specific error');
    }
  };

  const uploadInChunks = async (media: MediaFile, accountId: string): Promise<void> => {
    const fileInfo = await FileSystem.getInfoAsync(media.uri);
    if (!fileInfo.exists) throw new Error('File not found');

    const totalChunks = Math.ceil(media.size / CHUNK_SIZE);
    let uploadId = `${media.id}-${Date.now()}`;

    console.log(`[START] Starting chunked upload for "${media.name}": ${totalChunks} chunks`);

    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
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

        console.log(`[CHUNK] Chunk ${chunkIndex + 1}/${totalChunks} uploaded for "${media.name}"`);

      } catch (error) {
        console.log(`[ERROR] Chunk ${chunkIndex} upload failed for "${media.name}":`, error);
        throw error;
      }
    }

    const finalizeFormData = new FormData();
    finalizeFormData.append('upload_id', uploadId);
    finalizeFormData.append('account_id', accountId);
    finalizeFormData.append('platform', platform);
    finalizeFormData.append('user_id', user.Id.toString());
    finalizeFormData.append('original_name', media.name);
    finalizeFormData.append('total_chunks', totalChunks.toString());

    await ApiService.finalizeUpload(finalizeFormData);
    console.log(`[FINAL] All chunks finalized for "${media.name}"`);
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
        case 'completed': return { text: 'Completed', color: '#34C759', icon: '✓' };
        case 'uploading': return { text: 'Uploading', color: '#007AFF', icon: '↻' };
        case 'failed': return { text: 'Failed', color: '#FF3B30', icon: '✗' };
        default: return { text: 'Pending', color: '#8E8E93', icon: '…' };
      }
    };

    const status = getStatusDisplay();
    
    return (
      <TouchableOpacity
        style={[
          styles.mediaItem,
          item.selected && styles.mediaItemSelected,
        ]}
        onPress={() => toggleMediaSelection(item.id)}
        onLongPress={() => removeMedia(item.id)}
      >
        <View style={styles.checkboxContainer}>
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
        </View>
        <View style={styles.mediaPreview}>
          {item.type === 'image' ? (
            <Image source={{ uri: item.uri }} style={styles.mediaThumbnail} />
          ) : (
            <View style={[styles.mediaThumbnail, styles.videoThumbnail]}>
              <Text style={styles.videoIcon}>▶</Text>
            </View>
          )}
        </View>
        <View style={styles.mediaInfo}>
          <Text style={styles.mediaName} numberOfLines={1}>{item.name}</Text>
          <Text style={styles.fileSize}>{formatFileSize(item.size)}</Text>
          
          <View style={styles.statusContainer}>
            <View style={styles.statusWithIcon}>
              <Text style={styles.statusIcon}>{status.icon}</Text>
              <Text style={[styles.statusText, { color: status.color }]}>
                {status.text}
              </Text>
            </View>
            {item.status === 'uploading' && uploadProgress[item.id] && (
              <Text style={styles.progressText}>{Math.round(uploadProgress[item.id])}%</Text>
            )}
          </View>
          
          {currentChunkProgress && (
            <Text style={styles.chunkProgressText}>
              Chunk: {currentChunkProgress.uploaded}/{currentChunkProgress.total}
            </Text>
          )}
          
          {item.status === 'uploading' && (
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: `${uploadProgress[item.id] || 0}%` }]} />
            </View>
          )}
        </View>
        <TouchableOpacity
          style={styles.removeMediaButton}
          onPress={() => removeMedia(item.id)}
          disabled={item.status === 'uploading'}
        >
          <View style={styles.removeMediaButtonInner}>
            <Text style={styles.removeMediaText}>×</Text>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
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
    <View style={styles.container}>
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
      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => !uploading && setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
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
                  contentContainerStyle={styles.mediaListContent}
                  initialNumToRender={10}
                  maxToRenderPerBatch={10}
                  windowSize={5}
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
                onPress={() => setModalVisible(false)}
                disabled={uploading}
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
    maxHeight: 200,
  },
  mediaListContent: {
    paddingBottom: 10,
  },
  mediaItem: {
    flexDirection: 'row',
    backgroundColor: '#f8f8f8',
    padding: 10,
    borderRadius: 8,
    marginBottom: 8,
    alignItems: 'center',
  },
  mediaItemSelected: {
    backgroundColor: '#e8f4fd',
    borderColor: '#007AFF',
    borderWidth: 1,
  },
  checkboxContainer: {
    marginRight: 10,
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
    marginBottom: 4,
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
  removeMediaButtonInner: {
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
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
});






export default UploadScreen;