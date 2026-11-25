
import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  Alert,
  Keyboard,
} from 'react-native';

import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { supabase } from '../../lib/supabase';
import { AppButton, AppCard, EmptyState } from '../../components/ui';
import {
  DesignColors,
  FontWeight,
  Layout,
  Radii,
  Space,
  TypeScale,
} from '../../constants/design-tokens';

type DonorResult = {
  donor_id: string;
  full_name: string;
  blood_group: string;
  district: string;
  thana: string;
  local_area: string;
};

const BLOOD_GROUPS = [
  'A+', 'A-',
  'B+', 'B-',
  'AB+', 'AB-',
  'O+', 'O-',
];

export default function FindDonorsScreen() {
  const router = useRouter();

  const [bloodGroup, setBloodGroup] = useState('');
  const [district, setDistrict] = useState('');
  const [thana, setThana] = useState('');

  const [donors, setDonors] = useState<DonorResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const handleSearch = async () => {
    if (isSearching) return;

    Keyboard.dismiss();

    if (!bloodGroup) {
      Alert.alert(
        'Blood Group Required',
        'Please select a blood group.'
      );
      return;
    }

    if (!district.trim()) {
      Alert.alert(
        'District Required',
        'Please enter a district.'
      );
      return;
    }

    setIsSearching(true);
    setHasSearched(false);
    setDonors([]);

    try {
      // Confirm the current session.
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError || !user) {
        Alert.alert(
          'Login Required',
          'Please login to search for donors.',
          [
            {
              text: 'OK',
              onPress: () => router.replace('/login'),
            },
          ]
        );
        return;
      }

      // The database function performs beneficiary
      // role checks and donor privacy filtering.
      const { data, error } = await supabase.rpc(
        'search_available_donors',
        {
          requested_blood_group: bloodGroup,
          requested_district: district.trim(),
          requested_thana: thana.trim() || null,
        }
      );

      if (error) {
        throw error;
      }

      setDonors((data ?? []) as DonorResult[]);
      setHasSearched(true);

    } catch (error) {
      Alert.alert(
        'Search Failed',
        error instanceof Error
          ? error.message
          : 'Unable to search donors. Please try again.'
      );
    } finally {
      setIsSearching(false);
    }
  };

  const displayValue = (value: string | null) =>
    value?.trim() || 'Not provided';

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Text style={styles.backText}>{'\u2190'} Back</Text>
        </Pressable>

        <View style={styles.header}>
          <View style={styles.headerIcon} accessible={false}>
            <SymbolView
              name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }}
              size={23}
              tintColor={DesignColors.primary}
            />
          </View>
          <View style={styles.headerText}>
            <Text style={styles.eyebrow}>Find donors</Text>
            <Text style={styles.title} accessibilityRole="header">
              Find Blood Donors
            </Text>
            <Text style={styles.subtitle}>
              Search approved and currently available donors by blood group and location.
            </Text>
          </View>
        </View>

        <AppCard style={styles.formCard}>
          <Text style={styles.sectionLabel}>SEARCH CRITERIA</Text>

          <Text style={styles.label}>Blood Group *</Text>
          <View style={styles.bloodGroupContainer}>
            {BLOOD_GROUPS.map((group) => {
              const selected = bloodGroup === group;
              return (
                <Pressable
                  key={group}
                  disabled={isSearching}
                  onPress={() => setBloodGroup(group)}
                  accessibilityRole="button"
                  accessibilityLabel={`Select blood group ${group}`}
                  accessibilityState={{ selected, disabled: isSearching }}
                  style={({ pressed }) => [
                    styles.groupButton,
                    selected && styles.selectedGroupButton,
                    pressed && !isSearching && styles.pressed,
                  ]}
                >
                  <Text
                    style={[
                      styles.groupText,
                      selected && styles.selectedGroupText,
                    ]}
                  >
                    {group}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.label}>District *</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Dhaka"
            placeholderTextColor={DesignColors.textMuted}
            value={district}
            editable={!isSearching}
            autoCapitalize="words"
            onChangeText={setDistrict}
            accessibilityLabel="District"
          />

          <Text style={styles.label}>Thana / Upazila (Optional)</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Mirpur"
            placeholderTextColor={DesignColors.textMuted}
            value={thana}
            editable={!isSearching}
            autoCapitalize="words"
            onChangeText={setThana}
            accessibilityLabel="Thana or upazila, optional"
          />

          <AppButton
            label="Search Donors"
            variant="primary"
            loading={isSearching}
            disabled={isSearching}
            accessibilityLabel="Search for blood donors"
            onPress={() => void handleSearch()}
            style={styles.searchButton}
          />
        </AppCard>

        {hasSearched && (
          <View style={styles.resultsSection}>
            <Text style={styles.resultsTitle} accessibilityRole="header">
              Search Results ({donors.length})
            </Text>

            {donors.length === 0 ? (
              <AppCard>
                <EmptyState
                  icon={{ ios: 'tray', android: 'inbox', web: 'inbox' }}
                  title="No Matching Donors Found"
                  description="No approved and available donors matched your search. Try another location."
                />
              </AppCard>
            ) : (
              donors.map((donor) => (
                <AppCard key={donor.donor_id} style={styles.donorCard}>
                  <View style={styles.cardHeader}>
                    <Text style={styles.donorName} numberOfLines={2}>
                      {donor.full_name}
                    </Text>

                    <View style={styles.bloodBadge}>
                      <Text style={styles.bloodBadgeText}>
                        {donor.blood_group}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.factList}>
                    <View style={styles.factRow}>
                      <Text style={styles.factLabel}>District</Text>
                      <Text style={styles.factValue} numberOfLines={2}>
                        {displayValue(donor.district)}
                      </Text>
                    </View>
                    <View style={styles.factRow}>
                      <Text style={styles.factLabel}>Thana</Text>
                      <Text style={styles.factValue} numberOfLines={2}>
                        {displayValue(donor.thana)}
                      </Text>
                    </View>
                    <View style={styles.factRow}>
                      <Text style={styles.factLabel}>Local area</Text>
                      <Text style={styles.factValue} numberOfLines={2}>
                        {displayValue(donor.local_area)}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.availableRow}>
                    <View style={styles.availableDot} accessible={false} />
                    <Text style={styles.availableText}>Available</Text>
                  </View>
                </AppCard>
              ))
            )}
          </View>
        )}

        <Text style={styles.privacyNote}>
          Donor phone numbers, email addresses, dates
          of birth and private availability remarks
          are not displayed.
          {'\n\n'}
          Search results reflect recorded availability.
          A donor's suitability must be confirmed by
          qualified healthcare professionals.
        </Text>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: DesignColors.background,
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
  backButton: {
    alignSelf: 'flex-start',
    minHeight: Layout.minTouchTarget,
    justifyContent: 'center',
    paddingRight: Space.md,
  },
  backText: {
    color: DesignColors.primary,
    fontSize: TypeScale.small,
    fontWeight: FontWeight.semibold,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    marginBottom: Space.xs,
  },
  headerIcon: {
    width: 48,
    height: 48,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: DesignColors.primarySoft,
    borderWidth: Layout.hairline,
    borderColor: DesignColors.primaryBorder,
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

  formCard: {
    gap: Space.sm,
  },
  sectionLabel: {
    fontSize: TypeScale.caption,
    fontWeight: FontWeight.semibold,
    letterSpacing: 0.6,
    color: DesignColors.textMuted,
  },
  label: {
    fontSize: TypeScale.body,
    fontWeight: FontWeight.semibold,
    color: DesignColors.text,
    marginTop: Space.xs,
  },

  bloodGroupContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.sm,
  },
  groupButton: {
    minWidth: 64,
    minHeight: Layout.minTouchTarget,
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
    backgroundColor: DesignColors.surface,
    borderRadius: Radii.md,
    borderWidth: Layout.hairline,
    borderColor: DesignColors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectedGroupButton: {
    backgroundColor: DesignColors.primarySoft,
    borderColor: DesignColors.primary,
  },
  groupText: {
    color: DesignColors.textSecondary,
    fontSize: TypeScale.body,
    fontWeight: FontWeight.semibold,
  },
  selectedGroupText: {
    color: DesignColors.primaryDeep,
    fontWeight: FontWeight.bold,
  },
  pressed: {
    opacity: 0.72,
  },

  input: {
    minHeight: Layout.inputHeight,
    paddingHorizontal: Space.md,
    paddingVertical: Space.md,
    backgroundColor: DesignColors.surface,
    borderWidth: Layout.hairline,
    borderColor: DesignColors.border,
    borderRadius: Radii.md,
    fontSize: TypeScale.bodyLarge,
    color: DesignColors.text,
  },
  searchButton: {
    marginTop: Space.sm,
  },

  resultsSection: {
    marginTop: Space.sm,
    gap: Space.md,
  },
  resultsTitle: {
    fontSize: TypeScale.title,
    fontWeight: FontWeight.bold,
    lineHeight: 28,
    color: DesignColors.text,
  },

  donorCard: {
    gap: Space.md,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Space.sm,
  },
  donorName: {
    flex: 1,
    fontSize: TypeScale.bodyLarge,
    fontWeight: FontWeight.bold,
    lineHeight: 22,
    color: DesignColors.text,
  },
  bloodBadge: {
    backgroundColor: DesignColors.primarySoft,
    borderWidth: Layout.hairline,
    borderColor: DesignColors.primaryBorder,
    paddingHorizontal: Space.md,
    paddingVertical: Space.xs,
    borderRadius: Radii.md,
  },
  bloodBadgeText: {
    color: DesignColors.primaryDeep,
    fontWeight: FontWeight.bold,
    fontSize: TypeScale.small,
  },

  factList: {
    gap: Space.sm,
  },
  factRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Space.sm,
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

  availableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
  },
  availableDot: {
    width: 8,
    height: 8,
    borderRadius: Radii.full,
    backgroundColor: DesignColors.success,
  },
  availableText: {
    fontSize: TypeScale.small,
    fontWeight: FontWeight.semibold,
    color: DesignColors.successText,
  },

  privacyNote: {
    marginTop: Space.sm,
    color: DesignColors.textMuted,
    fontSize: TypeScale.caption,
    lineHeight: 19,
    textAlign: 'center',
  },
});
