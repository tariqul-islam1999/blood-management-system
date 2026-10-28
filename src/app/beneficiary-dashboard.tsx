
import { useCallback, useRef, useState } from 'react';

import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
} from 'react-native';

import { SafeAreaView } from 'react-native-safe-area-context';
import { Href, useFocusEffect, useRouter } from 'expo-router';
import { supabase } from '../lib/supabase';

type BeneficiaryProfile = {
  full_name: string;
  district: string;
  thana: string;
  local_area: string;
};

export default function BeneficiaryDashboardScreen() {
  const router = useRouter();

  const [profile, setProfile] =
    useState<BeneficiaryProfile | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [isPhotoLoading, setIsPhotoLoading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const loadIdRef = useRef(0);

  const loadProfile = useCallback(async () => {
    const loadId = ++loadIdRef.current;
    const isCurrent = () => loadId === loadIdRef.current;

    setIsLoading(true);
    setProfile(null);
    setPhotoUrl(null);
    setPhotoError(null);
    setIsPhotoLoading(false);

    try {
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (!isCurrent()) return;
      if (authError || !user) {
        router.replace('/login');
        return;
      }

      const { data, error } = await supabase
        .from('profiles')
        .select(
          'full_name, district, thana, local_area, role, account_status, profile_photo_path'
        )
        .eq('id', user.id)
        .single();

      if (!isCurrent()) return;
      if (error || !data) {
        throw new Error('Unable to load your profile. Please try again.');
      }
      if (data.role !== 'beneficiary' || data.account_status !== 'active') {
        await supabase.auth.signOut();
        if (isCurrent()) router.replace('/login');
        return;
      }

      setProfile({
        full_name: data.full_name,
        district: data.district,
        thana: data.thana,
        local_area: data.local_area,
      });

      if (data.profile_photo_path) {
        // Renew this temporary URL on every focus; never persist or log it.
        // A photo failure should not hide the rest of the dashboard.
        try {
          const { data: signed, error: signedError } = await supabase.storage
            .from('profile-photos')
            .createSignedUrl(data.profile_photo_path, 3600);

          if (!isCurrent()) return;
          if (signedError || !signed?.signedUrl) {
            setPhotoError('Your photo could not be loaded. Please retry.');
          } else {
            setIsPhotoLoading(true);
            setPhotoUrl(signed.signedUrl);
          }
        } catch {
          if (isCurrent()) {
            setPhotoError('Your photo could not be loaded. Please retry.');
          }
        }
      }
    } catch (error) {
      if (isCurrent()) {
        Alert.alert(
          'Profile Error',
          error instanceof Error ? error.message : 'Unable to load your profile.'
        );
      }
    } finally {
      if (isCurrent()) setIsLoading(false);
    }
  }, [router]);

  useFocusEffect(
    useCallback(() => {
      void loadProfile();
      return () => {
        // Ignore responses from a screen that lost focus.
        loadIdRef.current += 1;
        setPhotoUrl(null);
        setIsPhotoLoading(false);
      };
    }, [loadProfile])
  );

  const handleLogout = async () => {
    const { error } = await supabase.auth.signOut();

    if (error) {
      Alert.alert('Logout Failed', error.message);
      return;
    }

    router.replace('/login');
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color="#DC2626" />
        <Text style={styles.loadingText}>
          Loading your dashboard...
        </Text>
      </SafeAreaView>
    );
  }

  if (!profile) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.errorText}>
          Profile could not be loaded.
        </Text>

        <Pressable
          style={styles.button}
          onPress={loadProfile}
        >
          <Text style={styles.buttonText}>Try Again</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>

        <Text style={styles.title}>
          Beneficiary Dashboard
        </Text>

        <Text style={styles.welcome}>
          Welcome, {profile.full_name}!
        </Text>

        <View style={styles.photoSection}>
          <Pressable
            style={styles.photoWrapper}
            accessibilityRole="button"
            accessibilityLabel="Upload or change your profile photo"
            onPress={() => router.push('/upload-profile-photo')}
          >
            {photoUrl ? (
              <Image
                key={photoUrl}
                source={{ uri: photoUrl, cache: 'reload' }}
                style={styles.profilePhoto}
                accessibilityLabel="Your profile photo"
                onLoadEnd={() => setIsPhotoLoading(false)}
                onError={() => {
                  setPhotoUrl(null);
                  setIsPhotoLoading(false);
                  setPhotoError('Your photo could not be displayed. Please retry.');
                }}
              />
            ) : (
              <View style={styles.photoPlaceholder}>
                <Text style={styles.photoPlaceholderText}>No photo</Text>
              </View>
            )}
            {isPhotoLoading && (
              <ActivityIndicator
                style={styles.photoSpinner}
                color="#DC2626"
                accessibilityLabel="Loading profile photo"
              />
            )}
          </Pressable>

          <Pressable
            style={styles.button}
            accessibilityRole="button"
            onPress={() => router.push('/upload-profile-photo')}
          >
            <Text style={styles.buttonText}>Upload / Change Profile Photo</Text>
          </Pressable>

          {photoError && (
            <>
              <Text style={styles.photoError}>{photoError}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => void loadProfile()}
                style={styles.retryPhotoButton}
              >
                <Text style={styles.retryPhotoText}>Retry Photo</Text>
              </Pressable>
            </>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            Your Profile
          </Text>

          <Text style={styles.detail}>
            District: {profile.district}
          </Text>

          <Text style={styles.detail}>
            Thana: {profile.thana}
          </Text>

          <Text style={styles.detail}>
            Local Area: {profile.local_area}
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            Find Blood Donors
          </Text>

          <Text style={styles.description}>
            Search for approved and available blood
            donors by blood group and location.
          </Text>

          <Text style={styles.comingSoon}>
            Donor Search will be added next.
          </Text>
        </View>

        <Pressable
  style={styles.button}
  onPress={() => router.push('/find-donors')}
>
  <Text style={styles.buttonText}>
    Find Blood Donors
  </Text>
</Pressable>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Blood Requests</Text>
          <Text style={styles.description}>Create and track your blood requests. This service becomes available after its backend is enabled.</Text>
          <Pressable style={styles.button} onPress={() => router.push('/create-blood-request' as Href)} accessibilityRole="button">
            <Text style={styles.buttonText}>Create Blood Request</Text>
          </Pressable>
          <Pressable style={styles.secondaryAction} onPress={() => router.push('/my-blood-requests' as Href)} accessibilityRole="button">
            <Text style={styles.secondaryActionText}>My Blood Requests</Text>
          </Pressable>
        </View>

        <Pressable
          style={styles.logoutButton}
          onPress={handleLogout}
        >
          <Text style={styles.logoutText}>
            Logout
          </Text>
        </Pressable>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFF5F5',
  },

  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFF5F5',
    padding: 24,
  },

  content: {
    flexGrow: 1,
    padding: 24,
  },

  photoSection: {
    alignItems: 'center',
    marginBottom: 24,
  },

  photoWrapper: {
    width: 110,
    height: 110,
  },

  profilePhoto: {
    width: 110,
    height: 110,
    borderRadius: 55,
    borderWidth: 2,
    borderColor: '#DC2626',
  },

  photoPlaceholder: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: '#FEE2E2',
    justifyContent: 'center',
    alignItems: 'center',
  },

  photoPlaceholderText: {
    color: '#991B1B',
    fontSize: 14,
  },

  photoSpinner: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },

  photoError: {
    color: '#DC2626',
    textAlign: 'center',
    marginTop: 12,
  },

  retryPhotoButton: {
    padding: 12,
  },

  retryPhotoText: {
    color: '#991B1B',
    fontWeight: '600',
  },

  loadingText: {
    marginTop: 12,
    color: '#6B7280',
  },

  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#991B1B',
    marginBottom: 12,
  },

  welcome: {
    fontSize: 18,
    color: '#374151',
    marginBottom: 24,
  },

  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 20,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: '#FEE2E2',
  },

  cardTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#991B1B',
    marginBottom: 12,
  },

  detail: {
    fontSize: 15,
    color: '#374151',
    marginBottom: 8,
  },

  description: {
    fontSize: 14,
    color: '#6B7280',
    lineHeight: 21,
  },

  comingSoon: {
    fontSize: 13,
    color: '#DC2626',
    marginTop: 12,
    fontWeight: '600',
  },

  button: {
    backgroundColor: '#DC2626',
    padding: 14,
    borderRadius: 10,
    marginTop: 15,
  },

  buttonText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
  },

  secondaryAction: {
    borderWidth: 1,
    borderColor: '#DC2626',
    padding: 14,
    borderRadius: 10,
    marginTop: 10,
    alignItems: 'center',
  },

  secondaryActionText: {
    color: '#DC2626',
    fontWeight: 'bold',
  },

  logoutButton: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DC2626',
    padding: 15,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 12,
  },

  logoutText: {
    color: '#DC2626',
    fontWeight: 'bold',
    fontSize: 16,
  },

  errorText: {
    color: '#DC2626',
    fontSize: 15,
    textAlign: 'center',
  },
});
