import { useCallback, useEffect, useRef, useState } from 'react';

import {
  View,
  Text,
  Image,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from 'react-native';

import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { File } from 'expo-file-system';
import { supabase } from '../lib/supabase';

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

type SelectedPhoto = {
  uri: string;
  mimeType: 'image/jpeg' | 'image/png';
  userId: string;
};

class PhotoAccessError extends Error {}

type VerifiedPhotoAccess = {
  userId: string;
  dashboard: '/donor-dashboard' | '/beneficiary-dashboard';
};

async function getVerifiedPhotoAccess(): Promise<VerifiedPhotoAccess | null> {
  const { data, error } = await supabase.auth.getUser();

  if (error) {
    throw new PhotoAccessError('Unable to verify your login. Retry or return to Login.');
  }
  if (!data.user) return null;

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role, account_status')
    .eq('id', data.user.id)
    .single();

  if (profileError || !profile) {
    throw new PhotoAccessError('Unable to verify your profile. Please try again.');
  }
  if (
    profile.account_status !== 'active' ||
    (profile.role !== 'donor' && profile.role !== 'beneficiary')
  ) {
    throw new PhotoAccessError('Photo upload requires an active donor or beneficiary account.');
  }

  return {
    userId: data.user.id,
    // Only the authenticated user's database profile determines this route.
    dashboard:
      profile.role === 'donor' ? '/donor-dashboard' : '/beneficiary-dashboard',
  };
}

export default function UploadProfilePhotoScreen() {
  const router = useRouter();
  const [photo, setPhoto] = useState<SelectedPhoto | null>(null);
  const [access, setAccess] = useState<VerifiedPhotoAccess | null>(null);
  const [isCheckingAccess, setIsCheckingAccess] = useState(true);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isSelecting, setIsSelecting] = useState(false);
  const [isReturning, setIsReturning] = useState(false);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const busyRef = useRef(false);
  const mountedRef = useRef(false);
  const checkIdRef = useRef(0);
  const isBusy = isUploading || isSelecting || isReturning;

  const checkAccess = useCallback(async () => {
    const checkId = ++checkIdRef.current;
    setIsCheckingAccess(true);
    setAccess(null);
    setAccessError(null);

    try {
      const verified = await getVerifiedPhotoAccess();
      if (!mountedRef.current || checkId !== checkIdRef.current) return;
      setAccess(verified);
      setPhoto((previous) =>
        previous?.userId === verified?.userId ? previous : null
      );
    } catch (error) {
      if (mountedRef.current && checkId === checkIdRef.current) {
        setPhoto(null);
        setAccessError(
          error instanceof PhotoAccessError ? error.message : 'Unable to verify your account. Please retry.'
        );
      }
    } finally {
      if (mountedRef.current && checkId === checkIdRef.current) {
        setIsCheckingAccess(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void checkAccess();
    return () => {
      mountedRef.current = false;
      checkIdRef.current += 1;
    };
  }, [checkAccess]);

  const returnToDashboard = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setIsReturning(true);

    try {
      // Re-read the database role even after a successful upload.
      const verified = await getVerifiedPhotoAccess();
      if (!mountedRef.current) return;
      if (!verified) {
        setAccess(null);
        setPhoto(null);
        router.replace('/login');
        return;
      }
      router.replace(verified.dashboard);
    } catch (error) {
      if (mountedRef.current) {
        setAccess(null);
        setPhoto(null);
        setAccessError(
          error instanceof PhotoAccessError ? error.message : 'Unable to verify your dashboard. Please retry.'
        );
      }
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setIsReturning(false);
    }
  };

  const pickImage = async () => {
    if (!access || busyRef.current) return;
    busyRef.current = true;
    setIsSelecting(true);

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      if (!mountedRef.current || result.canceled || !result.assets?.length) return;

      const selected = result.assets[0];
      const mimeType = selected.mimeType?.toLowerCase();
      if (mimeType !== 'image/jpeg' && mimeType !== 'image/png') {
        Alert.alert('Invalid Photo', 'Please select a JPG or PNG image.');
        return;
      }

      const localFile = new File(selected.uri);
      if (
        !localFile.exists ||
        localFile.size <= 0 ||
        localFile.size > MAX_IMAGE_SIZE
      ) {
        Alert.alert('Invalid Photo', 'Photo must be valid and 5 MB or smaller.');
        return;
      }

      setPhoto({ uri: selected.uri, mimeType, userId: access.userId });
    } catch {
      if (mountedRef.current) {
        Alert.alert('Photo Selection Failed', 'Unable to select the photo. Please try again.');
      }
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setIsSelecting(false);
    }
  };

  const uploadPhoto = async () => {
    if (!photo || !access || busyRef.current) return;
    busyRef.current = true;
    setIsUploading(true);
    setUploadNotice(null);
    let uploaded = false;

    try {
      const verified = await getVerifiedPhotoAccess();
      if (!mountedRef.current) return;

      if (!verified) {
        setAccess(null);
        setPhoto(null);
        Alert.alert('Login Required', 'Please log in before uploading your photo.');
        return;
      }
      setAccess(verified);
      if (verified.userId !== photo.userId) {
        setPhoto(null);
        Alert.alert('Account Changed', 'Please select a photo for your current account.');
        return;
      }

      const localFile = new File(photo.uri);
      if (
        !localFile.exists ||
        localFile.size <= 0 ||
        localFile.size > MAX_IMAGE_SIZE
      ) {
        Alert.alert('Invalid Photo', 'Please select a valid photo of 5 MB or smaller.');
        return;
      }

      const imageData = await localFile.arrayBuffer();
      if (!mountedRef.current) return;
      if (imageData.byteLength <= 0 || imageData.byteLength > MAX_IMAGE_SIZE) {
        Alert.alert('Invalid Photo', 'Please select a valid photo of 5 MB or smaller.');
        return;
      }

      const extension = photo.mimeType === 'image/png' ? 'png' : 'jpg';
      const filePath = verified.userId + '/profile.' + extension;

      const { error: uploadError } = await supabase.storage
        .from('profile-photos')
        .upload(filePath, imageData, {
          contentType: photo.mimeType,
          upsert: true,
          // Replacements should be fetched again rather than cached for an hour.
          cacheControl: '0',
        });

      if (uploadError) {
        throw new Error('The upload could not be confirmed. Please check your connection and retry.');
      }
      uploaded = true;

      const { error: databaseError } = await supabase.rpc('update_my_profile_photo', {
        new_photo_path: filePath,
      });
      if (databaseError) throw new Error('Profile update could not be confirmed.');

      if (!mountedRef.current) return;
      setUploadNotice('Your profile photo was saved successfully.');
      Alert.alert('Upload Successful', 'Your profile photo was saved successfully!', [
        { text: 'OK', onPress: () => void returnToDashboard() },
      ]);
    } catch (error) {
      if (!mountedRef.current) return;

      if (uploaded) {
        const message =
          'The photo was uploaded, but saving its profile link could not be confirmed. ' +
          'It may already have replaced your previous photo. No automatic rollback occurred. ' +
          'You can retry uploading to save the profile link again.';
        setUploadNotice(message);
        Alert.alert('Photo Uploaded, Profile Update Not Confirmed', message);
      } else {
        if (error instanceof PhotoAccessError) {
          setAccess(null);
          setPhoto(null);
          setAccessError(error.message);
        }
        Alert.alert(
          'Upload Not Completed',
          error instanceof PhotoAccessError
            ? error.message
            : 'The upload could not be confirmed. Please check your connection and retry.'
        );
      }
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setIsUploading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Profile Photo</Text>
        <Text style={styles.subtitle}>Upload your profile picture securely</Text>

        {uploadNotice && (
          <Text style={styles.notice} accessibilityLiveRegion="polite">
            {uploadNotice}
          </Text>
        )}

        {isCheckingAccess ? (
          <ActivityIndicator
            size="large"
            color="#DC2626"
            accessibilityLabel="Checking your account"
          />
        ) : !access ? (
          <>
            <Text style={styles.errorText}>
              {accessError ?? 'Please log in to upload your photo.'}
            </Text>
            <Pressable
              style={styles.selectButton}
              accessibilityRole="button"
              onPress={() => void checkAccess()}
            >
              <Text style={styles.selectText}>Retry Account Check</Text>
            </Pressable>
            <Pressable
              style={styles.backButton}
              accessibilityRole="button"
              onPress={() => router.replace('/login')}
            >
              <Text style={styles.backText}>Go to Login</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Pressable
              onPress={() => void pickImage()}
              disabled={isBusy}
              accessibilityRole="button"
              accessibilityLabel="Choose your profile photo"
            >
              {photo ? (
                <Image
                  source={{ uri: photo.uri }}
                  style={styles.photo}
                  accessibilityLabel="Selected profile photo preview"
                />
              ) : (
                <View style={styles.placeholder}>
                  <Text style={styles.placeholderText}>Select Photo</Text>
                </View>
              )}
            </Pressable>

            <Text style={styles.hint}>JPG / PNG - Maximum 5 MB</Text>
            <Pressable
              style={styles.selectButton}
              onPress={() => void pickImage()}
              disabled={isBusy}
              accessibilityRole="button"
            >
              <Text style={styles.selectText}>
                {isSelecting ? 'Opening Photos...' : photo ? 'Change Photo' : 'Choose Photo'}
              </Text>
            </Pressable>

            <Pressable
              style={[styles.uploadButton, (!photo || isBusy) && styles.disabledButton]}
              onPress={() => void uploadPhoto()}
              disabled={!photo || isBusy}
              accessibilityRole="button"
            >
              {isUploading ? (
                <ActivityIndicator color="#FFFFFF" accessibilityLabel="Uploading profile photo" />
              ) : (
                <Text style={styles.uploadText}>Upload Profile Photo</Text>
              )}
            </Pressable>

            <Pressable
              style={styles.backButton}
              disabled={isBusy}
              onPress={() => void returnToDashboard()}
              accessibilityRole="button"
            >
              <Text style={styles.backText}>
                {isReturning ? 'Checking Dashboard...' : 'Back to Dashboard'}
              </Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFF5F5',
  },

  content: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },

  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#991B1B',
    marginBottom: 10,
  },

  subtitle: {
    color: '#6B7280',
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 30,
  },

  placeholder: {
    width: 150,
    height: 150,
    borderRadius: 75,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#DC2626',
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
    justifyContent: 'center',
  },

  photo: {
    width: 150,
    height: 150,
    borderRadius: 75,
    borderWidth: 2,
    borderColor: '#DC2626',
  },

  cameraIcon: {
    fontSize: 40,
  },

  placeholderText: {
    color: '#991B1B',
    fontSize: 14,
    marginTop: 8,
  },

  hint: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 14,
  },

  selectButton: {
    borderWidth: 1,
    borderColor: '#DC2626',
    padding: 14,
    borderRadius: 10,
    marginTop: 25,
    width: '100%',
    alignItems: 'center',
  },

  selectText: {
    color: '#DC2626',
    fontWeight: '600',
  },

  uploadButton: {
    backgroundColor: '#DC2626',
    padding: 17,
    borderRadius: 12,
    marginTop: 16,
    width: '100%',
    alignItems: 'center',
  },

  disabledButton: {
    opacity: 0.5,
  },

  uploadText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },

  backButton: {
    padding: 15,
    marginTop: 15,
  },

  backText: {
    color: '#991B1B',
    fontSize: 14,
    fontWeight: '600',
  },

  notice: {
    color: '#374151',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 20,
  },

  errorText: {
    fontSize: 15,
    color: '#DC2626',
    textAlign: 'center',
  },
});
