
import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Keyboard,
} from 'react-native';

import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { supabase } from '../lib/supabase';

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
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <Text style={styles.backText}>
            ← Back
          </Text>
        </Pressable>

        <Text style={styles.title}>
          Find Blood Donors
        </Text>

        <Text style={styles.subtitle}>
          Search approved and currently available donors
          by blood group and location.
        </Text>

        <Text style={styles.label}>
          Blood Group *
        </Text>

        <View style={styles.bloodGroupContainer}>
          {BLOOD_GROUPS.map((group) => (
            <Pressable
              key={group}
              disabled={isSearching}
              onPress={() => setBloodGroup(group)}
              style={[
                styles.groupButton,
                bloodGroup === group &&
                  styles.selectedGroupButton,
              ]}
            >
              <Text
                style={[
                  styles.groupText,
                  bloodGroup === group &&
                    styles.selectedGroupText,
                ]}
              >
                {group}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>
          District *
        </Text>

        <TextInput
          style={styles.input}
          placeholder="e.g. Dhaka"
          value={district}
          editable={!isSearching}
          autoCapitalize="words"
          onChangeText={setDistrict}
        />

        <Text style={styles.label}>
          Thana / Upazila (Optional)
        </Text>

        <TextInput
          style={styles.input}
          placeholder="e.g. Mirpur"
          value={thana}
          editable={!isSearching}
          autoCapitalize="words"
          onChangeText={setThana}
        />

        <Pressable
          style={[
            styles.searchButton,
            isSearching && styles.disabledButton,
          ]}
          onPress={handleSearch}
          disabled={isSearching}
        >
          {isSearching ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.searchButtonText}>
              Search Donors
            </Text>
          )}
        </Pressable>

        {hasSearched && (
          <View style={styles.resultsSection}>
            <Text style={styles.resultsTitle}>
              Search Results ({donors.length})
            </Text>

            {donors.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>
                  No Matching Donors Found
                </Text>
                <Text style={styles.emptyText}>
                  No approved and available donors matched
                  your search. Try another location.
                </Text>
              </View>
            ) : (
              donors.map((donor) => (
                <View
                  key={donor.donor_id}
                  style={styles.donorCard}
                >
                  <View style={styles.cardHeader}>
                    <Text style={styles.donorName}>
                      {donor.full_name}
                    </Text>

                    <View style={styles.bloodBadge}>
                      <Text style={styles.bloodBadgeText}>
                        {donor.blood_group}
                      </Text>
                    </View>
                  </View>

                  <Text style={styles.locationText}>
                    District: {displayValue(donor.district)}
                  </Text>

                  <Text style={styles.locationText}>
                    Thana: {displayValue(donor.thana)}
                  </Text>

                  <Text style={styles.locationText}>
                    Area: {displayValue(donor.local_area)}
                  </Text>

                  <Text style={styles.availableText}>
                    ● Available
                  </Text>
                </View>
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
    backgroundColor: '#FFF5F5',
  },
  content: {
    padding: 24,
    paddingBottom: 50,
  },
  backButton: {
    marginBottom: 16,
    alignSelf: 'flex-start',
  },
  backText: {
    color: '#DC2626',
    fontSize: 15,
    fontWeight: '600',
  },
  title: {
    fontSize: 27,
    fontWeight: 'bold',
    color: '#991B1B',
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 14,
    color: '#6B7280',
    lineHeight: 21,
    marginBottom: 25,
  },
  label: {
    fontSize: 15,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 9,
    marginTop: 15,
  },
  bloodGroupContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 8,
  },
  groupButton: {
    width: '22%',
    paddingVertical: 13,
    backgroundColor: '#FFFFFF',
    borderRadius: 9,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center',
  },
  selectedGroupButton: {
    backgroundColor: '#DC2626',
    borderColor: '#DC2626',
  },
  groupText: {
    color: '#374151',
    fontSize: 15,
    fontWeight: 'bold',
  },
  selectedGroupText: {
    color: '#FFFFFF',
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    padding: 14,
    fontSize: 15,
    color: '#111827',
  },
  searchButton: {
    backgroundColor: '#DC2626',
    padding: 17,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 28,
  },
  disabledButton: {
    opacity: 0.6,
  },
  searchButtonText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 16,
  },
  resultsSection: {
    marginTop: 32,
  },
  resultsTitle: {
    fontSize: 19,
    fontWeight: 'bold',
    color: '#991B1B',
    marginBottom: 15,
  },
  donorCard: {
    backgroundColor: '#FFFFFF',
    padding: 18,
    borderRadius: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    gap: 10,
  },
  donorName: {
    fontSize: 17,
    fontWeight: 'bold',
    color: '#374151',
    flex: 1,
  },
  bloodBadge: {
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 9,
  },
  bloodBadgeText: {
    color: '#991B1B',
    fontWeight: 'bold',
    fontSize: 16,
  },
  locationText: {
    color: '#4B5563',
    fontSize: 14,
    marginBottom: 6,
  },
  availableText: {
    color: '#15803D',
    fontWeight: '600',
    marginTop: 8,
  },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    padding: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  emptyTitle: {
    color: '#374151',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 9,
  },
  emptyText: {
    color: '#6B7280',
    fontSize: 14,
    lineHeight: 21,
  },
  privacyNote: {
    color: '#6B7280',
    fontSize: 12,
    lineHeight: 19,
    textAlign: 'center',
    marginTop: 25,
  },
});
