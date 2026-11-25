
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
import { supabase } from '../../lib/supabase';
import { SymbolView } from 'expo-symbols';
import { AppButton, AppCard, EmptyState } from '../../components/ui';
import {
  DesignColors,
  FontWeight,
  Layout,
  Radii,
  Space,
  TypeScale,
} from '../../constants/design-tokens';


type BeneficiaryProfile = {
  full_name: string;
  district: string;
  thana: string;
  local_area: string;
};

/** First letters of up to two words, upper-cased. Returns '' for blank input. */
function toInitials(value: string): string {
  const words = value.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (words.length === 0) return '';
  return words.map((word) => word[0]?.toUpperCase() ?? '').join('');
}

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
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.center}>
          <ActivityIndicator
            size="large"
            color={DesignColors.primary}
            accessibilityLabel="Loading your dashboard"
          />
          <Text style={styles.centeredText}>Loading your dashboard...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!profile) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.center}>
          <AppCard style={styles.fullWidth}>
            <EmptyState
              icon={{ ios: 'exclamationmark.triangle', android: 'error', web: 'error' }}
              title="Profile could not be loaded."
              action={<AppButton label="Try Again" variant="primary" onPress={loadProfile} />}
            />
          </AppCard>
        </View>
      </SafeAreaView>
    );
  }

  const initials = toInitials(profile.full_name);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

        <View style={styles.header}>
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
                {initials !== '' ? (
                  <Text style={styles.photoInitials}>{initials}</Text>
                ) : (
                  <SymbolView
                    name={{ ios: 'person.crop.circle', android: 'account_circle', web: 'account_circle' }}
                    size={44}
                    tintColor={DesignColors.primary}
                  />
                )}
              </View>
            )}
            {isPhotoLoading && (
              <ActivityIndicator
                style={styles.photoSpinner}
                color={DesignColors.primary}
                accessibilityLabel="Loading profile photo"
              />
            )}
          </Pressable>

          <View style={styles.headerText}>
            <Text style={styles.eyebrow}>Beneficiary home</Text>
            <Text style={styles.title} accessibilityRole="header" numberOfLines={2}>
              Welcome, {profile.full_name}!
            </Text>
            <Text style={styles.subtitle}>Your blood request workspace at a glance.</Text>
          </View>

          <Pressable
            style={styles.photoAction}
            accessibilityRole="button"
            accessibilityLabel="Change profile photo"
            onPress={() => router.push('/upload-profile-photo')}
          >
            <SymbolView
              name={{ ios: 'camera', android: 'photo_camera', web: 'photo_camera' }}
              size={20}
              tintColor={DesignColors.primary}
            />
          </Pressable>
        </View>

        <AppCard style={styles.profileCard}>
          <View style={styles.sectionHeaderRow}>
            <View style={styles.sectionIcon} accessible={false}>
              <SymbolView
                name={{ ios: 'person.text.rectangle', android: 'badge', web: 'badge' }}
                size={19}
                tintColor={DesignColors.primary}
              />
            </View>
            <Text style={styles.cardTitle}>Your Profile</Text>
          </View>

          <View style={styles.factRow}>
            <Text style={styles.factLabel}>District</Text>
            <Text style={styles.factValue}>{profile.district}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.factRow}>
            <Text style={styles.factLabel}>Thana</Text>
            <Text style={styles.factValue}>{profile.thana}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.factRow}>
            <Text style={styles.factLabel}>Local area</Text>
            <Text style={styles.factValue}>{profile.local_area}</Text>
          </View>

          <Text style={styles.hint}>Tap your photo or the camera button to update it.</Text>
        </AppCard>

        {photoError !== null && (
          <View style={styles.errorCard} accessibilityLiveRegion="polite">
            <SymbolView
              name={{ ios: 'exclamationmark.circle.fill', android: 'error', web: 'error' }}
              size={18}
              tintColor={DesignColors.errorText}
            />
            <View style={styles.errorBody}>
              <Text style={styles.errorText}>{photoError}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Retry loading your photo"
                onPress={() => void loadProfile()}
                style={({ pressed }) => [styles.linkButton, pressed && styles.pressed]}
              >
                <Text style={styles.linkText}>Retry Photo</Text>
              </Pressable>
            </View>
          </View>
        )}

        <AppCard style={styles.quickActionsCard}>
          <View style={styles.sectionHeaderRow}>
            <View style={styles.sectionIcon} accessible={false}>
              <SymbolView
                name={{ ios: 'drop', android: 'water_drop', web: 'water_drop' }}
                size={19}
                tintColor={DesignColors.primary}
              />
            </View>
            <Text style={styles.cardTitle}>Blood Requests</Text>
          </View>
          <Text style={styles.bodyText}>
            Create and track your blood requests. This service becomes available after its backend is
            enabled.
          </Text>
          <AppButton
            label="Create Blood Request"
            variant="primary"
            accessibilityLabel="Create a blood request"
            onPress={() => router.push('/create-blood-request' as Href)}
          />
          <AppButton
            label="My Blood Requests"
            variant="outline"
            accessibilityLabel="View my blood requests"
            onPress={() => router.push('/my-blood-requests' as Href)}
          />
        </AppCard>

        <AppCard style={styles.quickActionsCard}>
          <View style={styles.sectionHeaderRow}>
            <View style={styles.sectionIcon} accessible={false}>
              <SymbolView
                name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }}
                size={19}
                tintColor={DesignColors.primary}
              />
            </View>
            <Text style={styles.cardTitle}>Find Blood Donors</Text>
          </View>
          <Text style={styles.bodyText}>
            Search for approved and available blood donors by blood group and location.
          </Text>
          <Text style={styles.comingSoon}>Donor Search will be added next.</Text>
          <AppButton
            label="Find Blood Donors"
            variant="secondary"
            accessibilityLabel="Find blood donors"
            onPress={() => router.push('/find-donors')}
          />
        </AppCard>

        <View style={styles.accountSection}>
          <Text style={styles.sectionTitle} accessibilityRole="header">My Account</Text>
          <AppButton
            label="Upload / Change Profile Photo"
            variant="outline"
            onPress={() => router.push('/upload-profile-photo')}
          />
          <AppButton
            label="Logout"
            variant="destructive"
            onPress={handleLogout}
          />
        </View>

        <Text style={styles.footerText}>Blood Management System</Text>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: DesignColors.background,
  },

  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Space.lg,
    gap: Space.md,
  },

  fullWidth: {
    width: '100%',
    maxWidth: Layout.maxContentWidth,
  },

  content: {
    width: '100%',
    maxWidth: Layout.maxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Space.lg,
    paddingTop: Space.lg,
    paddingBottom: Space.xxxl,
    gap: Space.md,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    marginBottom: Space.xs,
  },

  headerText: {
    flex: 1,
    gap: Space.xxs,
  },

  eyebrow: {
    fontSize: TypeScale.caption,
    fontWeight: FontWeight.semibold,
    color: DesignColors.primary,
    textTransform: 'uppercase',
  },

  title: {
    fontSize: TypeScale.heading,
    fontWeight: FontWeight.bold,
    lineHeight: 30,
    color: DesignColors.text,
  },

  subtitle: {
    fontSize: TypeScale.small,
    lineHeight: 20,
    color: DesignColors.textMuted,
  },

  photoWrapper: {
    width: 64,
    height: 64,
  },

  profilePhoto: {
    width: 64,
    height: 64,
    borderRadius: Radii.full,
    borderWidth: 2,
    borderColor: DesignColors.primary,
    backgroundColor: DesignColors.surface,
  },

  photoPlaceholder: {
    width: 64,
    height: 64,
    borderRadius: Radii.full,
    backgroundColor: DesignColors.primarySoft,
    borderWidth: Layout.hairline,
    borderColor: DesignColors.primaryBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },

  photoInitials: {
    fontSize: TypeScale.subtitle,
    fontWeight: FontWeight.bold,
    color: DesignColors.primaryDeep,
  },

  photoSpinner: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },

  photoAction: {
    width: Layout.minTouchTarget,
    height: Layout.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radii.full,
    backgroundColor: DesignColors.primarySoft,
    borderWidth: Layout.hairline,
    borderColor: DesignColors.primaryBorder,
  },

  profileCard: {
    gap: Space.sm,
  },

  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
  },

  sectionIcon: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radii.full,
    backgroundColor: DesignColors.primarySoft,
  },

  cardTitle: {
    flex: 1,
    fontSize: TypeScale.subtitle,
    fontWeight: FontWeight.bold,
    lineHeight: 26,
    color: DesignColors.text,
  },

  factRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: Space.sm,
    minHeight: 24,
  },

  factLabel: {
    fontSize: TypeScale.small,
    color: DesignColors.textMuted,
  },

  factValue: {
    flexShrink: 1,
    fontSize: TypeScale.body,
    fontWeight: FontWeight.semibold,
    color: DesignColors.text,
    textAlign: 'right',
  },

  divider: {
    height: Layout.hairline,
    backgroundColor: DesignColors.border,
  },

  hint: {
    fontSize: TypeScale.caption,
    lineHeight: 18,
    color: DesignColors.textMuted,
  },

  quickActionsCard: {
    gap: Space.md,
  },

  bodyText: {
    fontSize: TypeScale.small,
    lineHeight: 20,
    color: DesignColors.textSecondary,
  },

  comingSoon: {
    fontSize: TypeScale.caption,
    fontWeight: FontWeight.semibold,
    color: DesignColors.textMuted,
  },

  accountSection: {
    gap: Space.md,
    marginTop: Space.sm,
  },

  sectionTitle: {
    fontSize: TypeScale.title,
    fontWeight: FontWeight.bold,
    lineHeight: 28,
    color: DesignColors.text,
  },

  footerText: {
    marginTop: Space.lg,
    textAlign: 'center',
    fontSize: TypeScale.caption,
    color: DesignColors.textMuted,
  },

  centeredText: {
    fontSize: TypeScale.body,
    color: DesignColors.textMuted,
    textAlign: 'center',
  },

  pressed: {
    opacity: 0.65,
  },

  errorCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Space.sm,
    padding: Space.md,
    borderRadius: Radii.lg,
    borderWidth: Layout.hairline,
    borderColor: DesignColors.errorBorder,
    backgroundColor: DesignColors.errorSurface,
  },

  errorBody: {
    flex: 1,
    gap: Space.xs,
  },

  errorText: {
    fontSize: TypeScale.small,
    lineHeight: 20,
    color: DesignColors.errorText,
  },

  linkButton: {
    alignSelf: 'flex-start',
    minHeight: Layout.minTouchTarget,
    justifyContent: 'center',
  },

  linkText: {
    fontSize: TypeScale.small,
    fontWeight: FontWeight.bold,
    color: DesignColors.errorText,
    textDecorationLine: 'underline',
  },
});
