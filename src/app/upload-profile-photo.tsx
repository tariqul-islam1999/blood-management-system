
import { useEffect, useState } from 'react';

import {
  View,
  Text,
  Image,
  Pressable,
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
};

export default function UploadProfilePhotoScreen() {
  const router = useRouter();

  const [photo, setPhoto] = useState<SelectedPhoto | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);

  // ========== CHECK LOGIN ==========

  useEffect(() => {
    const checkLogin = async () => {
      const { data, error } = await supabase.auth.getUser();

      setIsLoggedIn(!error && !!data.user);
    };

    checkLogin();
  }, []);

  // ========== SELECT IMAGE ==========

  const pickImage = async () => {
    if (isUploading) return;

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (result.canceled || !result.assets?.length) {
        return;
      }

      const selected = result.assets[0];
      const mimeType = selected.mimeType?.toLowerCase();

      if (
        mimeType !== 'image/jpeg' &&
        mimeType !== 'image/png'
      ) {
        Alert.alert(
          'Invalid Photo',
          'Please select a JPG or PNG image.'
        );
        return;
      }

      const localFile = new File(selected.uri);

      if (
        !localFile.exists ||
        localFile.size <= 0 ||
        localFile.size > MAX_IMAGE_SIZE
      ) {
        Alert.alert(
          'Invalid Photo',
          'Photo must be valid and 5 MB or smaller.'
        );
        return;
      }

      setPhoto({
        uri: selected.uri,
        mimeType,
      });

    } catch (error) {
      Alert.alert(
        'Photo Selection Failed',
        'Unable to select the photo. Please try again.'
      );
    }
  };

  // ========== UPLOAD IMAGE ==========

  const uploadPhoto = async () => {
    if (!photo || isUploading) return;

    setIsUploading(true);

    try {
      const { data: userData, error: userError } =
        await supabase.auth.getUser();

      if (userError || !userData.user) {
        setIsLoggedIn(false);

        Alert.alert(
          'Login Required',
          'Please log in before uploading your profile photo.'
        );
        return;
      }

      const userId = userData.user.id;
      const localFile = new File(photo.uri);

      if (
        !localFile.exists ||
        localFile.size <= 0 ||
        localFile.size > MAX_IMAGE_SIZE
      ) {
        Alert.alert(
          'Invalid Photo',
          'Please select a valid photo under 5 MB.'
        );
        return;
      }

      const imageData = await localFile.arrayBuffer();

      const extension =
        photo.mimeType === 'image/png' ? 'png' : 'jpg';

      const filePath = `${userId}/profile.${extension}`;

      // Upload to private Supabase Storage

      const { error: uploadError } = await supabase.storage
        .from('profile-photos')
        .upload(filePath, imageData, {
          contentType: photo.mimeType,
          upsert: true,
          cacheControl: '3600',
        });

      if (uploadError) {
        throw new Error(uploadError.message);
      }

      // Update profile photo path in database

      const { error: databaseError } = await supabase.rpc(
        'update_my_profile_photo',
        {
          new_photo_path: filePath,
        }
      );

      if (databaseError) {
        throw new Error(
          'Photo uploaded, but database update failed: ' +
          databaseError.message
        );
      }

      // Return to Dashboard after OK

      Alert.alert(
        'Upload Successful',
        'Your profile photo was saved successfully!',
        [
          {
            text: 'OK',
            onPress: () => {
              router.replace('/donor-dashboard');
            },
          },
        ]
      );

    } catch (error) {
      Alert.alert(
        'Upload Failed',
        error instanceof Error
          ? error.message
          : 'Something went wrong. Please try again.'
      );

    } finally {
      setIsUploading(false);
    }
  };

  // ========== SCREEN UI ==========

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>

        <Text style={styles.title}>
          Profile Photo
        </Text>

        <Text style={styles.subtitle}>
          Upload your profile picture securely
        </Text>

        {isLoggedIn === null ? (
          <ActivityIndicator
            size="large"
            color="#DC2626"
          />
        ) : !isLoggedIn ? (
          <Text style={styles.errorText}>
            Please log in to upload your photo.
          </Text>
        ) : (
          <>
            <Pressable
              onPress={pickImage}
              disabled={isUploading}
            >
              {photo ? (
                <Image
                  source={{ uri: photo.uri }}
                  style={styles.photo}
                />
              ) : (
                <View style={styles.placeholder}>
                  <Text style={styles.cameraIcon}>
                    📷
                  </Text>

                  <Text style={styles.placeholderText}>
                    Select Photo
                  </Text>
                </View>
              )}
            </Pressable>

            <Text style={styles.hint}>
              JPG / PNG — Maximum 5 MB
            </Text>

            <Pressable
              style={styles.selectButton}
              onPress={pickImage}
              disabled={isUploading}
            >
              <Text style={styles.selectText}>
                {photo ? 'Change Photo' : 'Choose Photo'}
              </Text>
            </Pressable>

            <Pressable
              style={[
                styles.uploadButton,
                (!photo || isUploading) &&
                  styles.disabledButton,
              ]}
              onPress={uploadPhoto}
              disabled={!photo || isUploading}
            >
              {isUploading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.uploadText}>
                  Upload Profile Photo
                </Text>
              )}
            </Pressable>

            {/* BACK TO DASHBOARD */}

            <Pressable
              style={styles.backButton}
              disabled={isUploading}
              onPress={() =>
                router.replace('/donor-dashboard')
              }
            >
              <Text style={styles.backText}>
                Back to Dashboard
              </Text>
            </Pressable>
          </>
        )}

      </View>
    </SafeAreaView>
  );
}

// ========== STYLES ==========

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFF5F5',
  },

  content: {
    flex: 1,
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

  errorText: {
    fontSize: 15,
    color: '#DC2626',
    textAlign: 'center',
  },
});
