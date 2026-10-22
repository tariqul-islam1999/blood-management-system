
import { useCallback, useEffect, useState } from 'react';

import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Alert,
} from 'react-native';

import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
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

  const loadProfile = useCallback(async () => {
    setIsLoading(true);

    try {
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError || !user) {
        router.replace('/login');
        return;
      }

      const { data, error } = await supabase
        .from('profiles')
        .select(
          'full_name, district, thana, local_area, role, account_status'
        )
        .eq('id', user.id)
        .single();

      if (error || !data) {
        throw new Error('Unable to load your profile.');
      }

      if (
        data.role !== 'beneficiary' ||
        data.account_status !== 'active'
      ) {
        await supabase.auth.signOut();

        router.replace('/login');
        return;
      }

      setProfile({
        full_name: data.full_name,
        district: data.district,
        thana: data.thana,
        local_area: data.local_area,
      });

    } catch (error) {
      Alert.alert(
        'Profile Error',
        error instanceof Error
          ? error.message
          : 'Something went wrong.'
      );

    } finally {
      setIsLoading(false);
    }
  }, [router]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

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
      <View style={styles.content}>

        <Text style={styles.title}>
          Beneficiary Dashboard
        </Text>

        <Text style={styles.welcome}>
          Welcome, {profile.full_name}!
        </Text>

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

        <Pressable
          style={styles.logoutButton}
          onPress={handleLogout}
        >
          <Text style={styles.logoutText}>
            Logout
          </Text>
        </Pressable>

      </View>
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
    flex: 1,
    padding: 24,
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
