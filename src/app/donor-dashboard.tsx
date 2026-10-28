
import { useCallback, useState } from 'react';

import {
  View,
  Text,
  TextInput,
  ScrollView,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Image,
  Switch,
  Keyboard,
} from 'react-native';

import { SafeAreaView } from 'react-native-safe-area-context';
import { Href, useRouter, useFocusEffect } from 'expo-router';
import { supabase } from '../lib/supabase';

type DonorProfile = {
  fullName: string;
  bloodGroup: string;
  verificationStatus: string;
  availabilityStatus: string;
  district: string;
  thana: string;
  localArea: string;
};

export default function DonorDashboard() {
  const router = useRouter();

  const [profile, setProfile] = useState<DonorProfile | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  const [showReasonBox, setShowReasonBox] = useState(false);
  const [unavailableReason, setUnavailableReason] = useState('');

  // ========== LOAD DONOR DATA ==========

  const loadProfile = useCallback(async () => {
    setIsLoading(true);

    try {
      const { data: userData, error: userError } =
        await supabase.auth.getUser();

      if (userError || !userData.user) {
        router.replace('/login');
        return;
      }

      const userId = userData.user.id;

      const { data: common, error: commonError } =
        await supabase
          .from('profiles')
          .select(
            'full_name, role, account_status, district, thana, local_area, profile_photo_path'
          )
          .eq('id', userId)
          .single();

      if (commonError || !common) {
        throw new Error('Unable to load your profile.');
      }

      if (
        common.role !== 'donor' ||
        common.account_status !== 'active'
      ) {
        await supabase.auth.signOut();

        router.replace('/login');
        return;
      }

      const { data: donor, error: donorError } =
        await supabase
          .from('donor_profiles')
          .select(
            'blood_group, verification_status, availability_status'
          )
          .eq('user_id', userId)
          .single();

      if (donorError || !donor) {
        throw new Error('Unable to load donor information.');
      }

      setProfile({
        fullName: common.full_name,
        bloodGroup: donor.blood_group,
        verificationStatus: donor.verification_status,
        availabilityStatus: donor.availability_status,
        district: common.district,
        thana: common.thana,
        localArea: common.local_area,
      });

      setPhotoUrl(null);

      if (common.profile_photo_path) {
        const { data: signed, error: signedError } =
          await supabase.storage
            .from('profile-photos')
            .createSignedUrl(
              common.profile_photo_path,
              3600
            );

        if (!signedError && signed?.signedUrl) {
          setPhotoUrl(signed.signedUrl);
        }
      }
    } catch (error) {
      Alert.alert(
        'Dashboard Error',
        error instanceof Error
          ? error.message
          : 'Something went wrong.'
      );
    } finally {
      setIsLoading(false);
    }
  }, [router]);

  useFocusEffect(
    useCallback(() => {
      loadProfile();
    }, [loadProfile])
  );

  // ========== CHANGE AVAILABILITY ==========

  const changeAvailability = async (
    newStatus: 'available' | 'unavailable',
    reason: string = ''
  ) => {
    if (!profile || isUpdating) return;

    if (profile.verificationStatus !== 'approved') {
      Alert.alert(
        'Verification Required',
        'Only approved donors can change availability.'
      );
      return;
    }

    setIsUpdating(true);

    try {
      const { error } = await supabase.rpc(
        'set_my_donor_availability',
        {
          new_status: newStatus,
          reason: reason,
        }
      );

      if (error) {
        throw new Error(error.message);
      }

      // Read the updated status from the database.

      const { data: userData, error: userError } =
        await supabase.auth.getUser();

      if (userError || !userData.user) {
        throw new Error('Your session has expired.');
      }

      const { data: updated, error: readError } =
        await supabase
          .from('donor_profiles')
          .select('availability_status')
          .eq('user_id', userData.user.id)
          .single();

      if (readError || !updated) {
        throw new Error(
          'Status was saved, but could not be reloaded.'
        );
      }

      setProfile((previous) =>
        previous
          ? {
              ...previous,
              availabilityStatus: updated.availability_status,
            }
          : previous
      );

      setShowReasonBox(false);
      setUnavailableReason('');
      Keyboard.dismiss();

      Alert.alert(
        'Availability Updated',
        newStatus === 'available'
          ? 'Your status is now Available.'
          : 'Your status is now Unavailable. Your reason has been recorded.'
      );

    } catch (error) {
      Alert.alert(
        'Update Failed',
        error instanceof Error
          ? error.message
          : 'Unable to update availability.'
      );

      // Reload the actual status after an error.
      await loadProfile();

    } finally {
      setIsUpdating(false);
    }
  };

  // ========== TOGGLE HANDLER ==========

  const handleToggle = (wantAvailable: boolean) => {
    if (!profile || isUpdating) return;

    if (profile.verificationStatus !== 'approved') {
      return;
    }

    if (wantAvailable) {
      // Unavailable -> Available
      // Reason is not required.

      changeAvailability('available', '');

    } else {
      // Available -> Unavailable
      // Show reason box before saving.

      setUnavailableReason('');
      setShowReasonBox(true);
    }
  };

  // ========== SAVE UNAVAILABLE REASON ==========

  const handleSubmitReason = () => {
    const cleanedReason = unavailableReason.trim();

    if (
      cleanedReason.length < 10 ||
      cleanedReason.length > 500
    ) {
      Alert.alert(
        'Invalid Reason',
        'Please provide a reason between 10 and 500 characters.'
      );
      return;
    }

    changeAvailability('unavailable', cleanedReason);
  };

  const handleCancelReason = () => {
    setShowReasonBox(false);
    setUnavailableReason('');
    Keyboard.dismiss();
  };

  // ========== LOGOUT ==========

  const handleLogout = async () => {
    if (isLoggingOut || isUpdating) return;

    setIsLoggingOut(true);

    try {
      const { error } = await supabase.auth.signOut();

      if (error) throw error;

      router.replace('/login');

    } catch (error) {
      Alert.alert(
        'Logout Failed',
        error instanceof Error
          ? error.message
          : 'Please try again.'
      );
    } finally {
      setIsLoggingOut(false);
    }
  };

  // ========== LOADING SCREEN ==========

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <ActivityIndicator
            size="large"
            color="#DC2626"
          />

          <Text style={styles.loadingText}>
            Loading donor dashboard...
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!profile) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <Text style={styles.errorText}>
            Donor information is unavailable.
          </Text>

          <Pressable
            style={styles.primaryButton}
            onPress={loadProfile}
          >
            <Text style={styles.primaryButtonText}>
              Try Again
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const isApproved =
    profile.verificationStatus === 'approved';

  const isAvailable =
    profile.availabilityStatus === 'available';

  // ========== DASHBOARD UI ==========

  return (
    <SafeAreaView
      style={styles.container}
      edges={['bottom']}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >

        {/* HEADER */}

        <View style={styles.header}>

          <Pressable
            onPress={() =>
              router.push('/upload-profile-photo')
            }
            style={styles.photoWrapper}
          >
            {photoUrl ? (
              <Image
                source={{ uri: photoUrl }}
                style={styles.profilePhoto}
              />
            ) : (
              <View style={styles.photoPlaceholder}>
                <Text style={styles.photoIcon}>
                  👤
                </Text>
              </View>
            )}
          </Pressable>

          <Text style={styles.title}>
            Donor Dashboard
          </Text>

          <Text style={styles.subtitle}>
            Welcome, {profile.fullName}!
          </Text>

          <Text style={styles.photoHint}>
            Tap your photo to change it
          </Text>
        </View>

        {/* DONOR INFORMATION */}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            ❤️ My Donor Information
          </Text>

          <Text style={styles.label}>
            Blood Group
          </Text>

          <Text style={styles.bloodGroup}>
            {profile.bloodGroup}
          </Text>

          <View style={styles.divider} />

          <Text style={styles.label}>
            Verification Status
          </Text>

          <Text style={styles.value}>
            {profile.verificationStatus.toUpperCase()}
          </Text>

          <Text style={styles.label}>
            Availability Status
          </Text>

          <Text style={styles.value}>
            {profile.availabilityStatus.toUpperCase()}
          </Text>

          <Text style={styles.label}>
            Location
          </Text>

          <Text style={styles.value}>
            {profile.localArea}, {profile.thana}, {profile.district}
          </Text>
        </View>

        {/* AVAILABILITY CARD */}

        <View style={styles.availabilityCard}>

          <Text style={styles.availabilityTitle}>
            Donor Availability
          </Text>

          <View style={styles.availabilityRow}>

            <View style={styles.availabilityInfo}>
              <Text style={styles.availabilityLabel}>
                {isAvailable ? 'Available' : 'Unavailable'}
              </Text>

              <Text style={styles.availabilityDescription}>
                {isApproved
                  ? 'Manage your availability status'
                  : 'Admin approval is required'}
              </Text>
            </View>

            <Switch
              value={isAvailable}
              onValueChange={handleToggle}
              disabled={
                !isApproved ||
                isUpdating ||
                showReasonBox
              }
              trackColor={{
                false: '#D1D5DB',
                true: '#86EFAC',
              }}
              thumbColor={
                isAvailable ? '#16A34A' : '#F3F4F6'
              }
            />
          </View>

          {/* UNAVAILABLE REASON FORM */}

          {showReasonBox && (
            <View style={styles.reasonSection}>

              <Text style={styles.reasonTitle}>
                Why are you unavailable? *
              </Text>

              <Text style={styles.reasonHint}>
                Please explain why you are currently
                unable to donate blood.
              </Text>

              <TextInput
                style={styles.reasonInput}
                placeholder="Enter your reason here..."
                placeholderTextColor="#9CA3AF"
                multiline
                numberOfLines={4}
                maxLength={500}
                textAlignVertical="top"
                editable={!isUpdating}
                value={unavailableReason}
                onChangeText={setUnavailableReason}
              />

              <Text style={styles.characterCount}>
                {unavailableReason.trim().length} / 500 characters
              </Text>

              <Text style={styles.privacyNote}>
                This reason is private and intended
                for you and authorized administrators.
              </Text>

              <Pressable
                style={[
                  styles.saveReasonButton,
                  isUpdating && styles.disabledButton,
                ]}
                onPress={handleSubmitReason}
                disabled={isUpdating}
              >
                {isUpdating ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.primaryButtonText}>
                    Save Unavailable Status
                  </Text>
                )}
              </Pressable>

              <Pressable
                style={styles.cancelButton}
                onPress={handleCancelReason}
                disabled={isUpdating}
              >
                <Text style={styles.cancelText}>
                  Cancel
                </Text>
              </Pressable>

            </View>
          )}

          {isUpdating && !showReasonBox && (
            <View style={styles.updatingRow}>
              <ActivityIndicator
                size="small"
                color="#DC2626"
              />

              <Text style={styles.updatingText}>
                Updating availability...
              </Text>
            </View>
          )}

          {!isApproved && (
            <Text style={styles.disabledHint}>
              Availability can be changed after
              administrator approval.
            </Text>
          )}

        </View>

        {/* VERIFICATION NOTICE */}

        {!isApproved && (
          <View style={styles.noticeCard}>
            <Text style={styles.noticeTitle}>
              Donor Verification
            </Text>

            <Text style={styles.noticeText}>
              Your donor account must be approved
              by an administrator before you can
              become an available donor.
            </Text>
          </View>
        )}

        <View style={styles.bloodRequestCard}>
          <Text style={styles.availabilityTitle}>Blood Requests</Text>
          <Text style={styles.availabilityDescription}>Browse matching open blood requests when the Blood Request backend is enabled.</Text>
          <Pressable style={styles.secondaryButton} onPress={() => router.push('/open-blood-requests' as Href)} disabled={isUpdating} accessibilityRole="button">
            <Text style={styles.secondaryButtonText}>Open Blood Requests</Text>
          </Pressable>
        </View>

        {/* MY ACCOUNT */}

        <Text style={styles.sectionTitle}>
          My Account
        </Text>

        <Pressable
          style={styles.primaryButton}
          onPress={() =>
            router.push('/upload-profile-photo')
          }
        >
          <Text style={styles.primaryButtonText}>
            📷 Upload / Change Profile Photo
          </Text>
        </Pressable>

        <Pressable
          style={styles.secondaryButton}
          onPress={loadProfile}
          disabled={isUpdating}
        >
          <Text style={styles.secondaryButtonText}>
            Refresh Dashboard
          </Text>
        </Pressable>

        <Pressable
          style={styles.logoutButton}
          onPress={handleLogout}
          disabled={isLoggingOut || isUpdating}
        >
          {isLoggingOut ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.logoutText}>
              Logout
            </Text>
          )}
        </Pressable>

        <Text style={styles.footerText}>
          Blood Management System
        </Text>

      </ScrollView>
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
    padding: 24,
    paddingBottom: 50,
  },

  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },

  loadingText: {
    marginTop: 14,
    color: '#6B7280',
  },

  errorText: {
    color: '#DC2626',
    textAlign: 'center',
    marginBottom: 20,
  },

  header: {
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 25,
  },

  photoWrapper: {
    marginBottom: 15,
  },

  profilePhoto: {
    width: 110,
    height: 110,
    borderRadius: 55,
    borderWidth: 3,
    borderColor: '#DC2626',
  },

  photoPlaceholder: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: '#FEE2E2',
    borderWidth: 2,
    borderColor: '#DC2626',
    alignItems: 'center',
    justifyContent: 'center',
  },

  photoIcon: {
    fontSize: 48,
  },

  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#991B1B',
    textAlign: 'center',
  },

  subtitle: {
    fontSize: 16,
    color: '#6B7280',
    marginTop: 8,
    textAlign: 'center',
  },

  photoHint: {
    fontSize: 12,
    color: '#DC2626',
    marginTop: 10,
  },

  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 22,
    borderWidth: 1,
    borderColor: '#FECACA',
  },

  cardTitle: {
    fontSize: 19,
    fontWeight: 'bold',
    color: '#991B1B',
    marginBottom: 20,
  },

  label: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 14,
  },

  value: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    marginTop: 5,
  },

  bloodGroup: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#DC2626',
    marginTop: 5,
  },

  divider: {
    height: 1,
    backgroundColor: '#FEE2E2',
    marginTop: 20,
  },

  availabilityCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    marginTop: 20,
    borderWidth: 1,
    borderColor: '#FECACA',
  },

  availabilityTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#991B1B',
    marginBottom: 15,
  },

  availabilityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },

  availabilityInfo: {
    flex: 1,
  },

  availabilityLabel: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#111827',
  },

  availabilityDescription: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 5,
  },

  reasonSection: {
    marginTop: 20,
    borderTopWidth: 1,
    borderTopColor: '#FEE2E2',
    paddingTop: 18,
  },

  reasonTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#991B1B',
  },

  reasonHint: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 6,
    lineHeight: 18,
  },

  reasonInput: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    borderRadius: 10,
    padding: 14,
    fontSize: 14,
    color: '#111827',
    minHeight: 110,
    marginTop: 12,
  },

  characterCount: {
    fontSize: 12,
    color: '#6B7280',
    textAlign: 'right',
    marginTop: 6,
  },

  privacyNote: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 12,
    lineHeight: 18,
  },

  saveReasonButton: {
    backgroundColor: '#DC2626',
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 18,
  },

  cancelButton: {
    padding: 14,
    alignItems: 'center',
    marginTop: 6,
  },

  cancelText: {
    color: '#991B1B',
    fontWeight: '600',
  },

  disabledButton: {
    opacity: 0.5,
  },

  updatingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 15,
  },

  updatingText: {
    color: '#6B7280',
    fontSize: 12,
  },

  disabledHint: {
    fontSize: 12,
    color: '#92400E',
    marginTop: 16,
    lineHeight: 18,
  },

  bloodRequestCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    marginTop: 20,
    borderWidth: 1,
    borderColor: '#FECACA',
  },

  noticeCard: {
    backgroundColor: '#FEF3C7',
    borderRadius: 12,
    padding: 16,
    marginTop: 20,
  },

  noticeTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#92400E',
  },

  noticeText: {
    fontSize: 13,
    color: '#92400E',
    marginTop: 8,
    lineHeight: 20,
  },

  sectionTitle: {
    fontSize: 19,
    fontWeight: 'bold',
    color: '#991B1B',
    marginTop: 30,
    marginBottom: 15,
  },

  primaryButton: {
    backgroundColor: '#DC2626',
    padding: 17,
    borderRadius: 12,
    alignItems: 'center',
  },

  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: 'bold',
    textAlign: 'center',
  },

  secondaryButton: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DC2626',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 14,
  },

  secondaryButtonText: {
    color: '#DC2626',
    fontSize: 15,
    fontWeight: '600',
  },

  logoutButton: {
    backgroundColor: '#374151',
    padding: 17,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 30,
  },

  logoutText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },

  footerText: {
    textAlign: 'center',
    color: '#9CA3AF',
    fontSize: 12,
    marginTop: 25,
  },
});
