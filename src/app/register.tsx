
import {
  View,
  Text,
  StyleSheet,
  Pressable,
} from 'react-native';

import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

export default function RegisterScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container}>

      <Text style={styles.title}>Create Account</Text>

      <Text style={styles.subtitle}>
        How would you like to use Blood Management?
      </Text>

      <View style={styles.cardContainer}>

        {/* Donor Registration */}
        <Pressable
          style={styles.card}
          onPress={() => router.push('/donor-register')}
        >
          <Text style={styles.icon}>❤️</Text>
          <Text style={styles.cardTitle}>
            Become a Donor
          </Text>
          <Text style={styles.cardDescription}>
            Register to donate blood and save lives.
          </Text>
        </Pressable>

        {/* Beneficiary Registration */}
        <Pressable
          style={styles.card}
          onPress={() => router.push('/beneficiary-register')}
        >
          <Text style={styles.icon}>🏥</Text>
          <Text style={styles.cardTitle}>
            Find Blood
          </Text>
          <Text style={styles.cardDescription}>
            Register to find verified blood donors.
          </Text>
        </Pressable>

      </View>

      <Text style={styles.footer}>
        Together, We Can Save Lives
      </Text>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFF5F5',
    padding: 24,
    justifyContent: 'center',
  },

  title: {
    fontSize: 30,
    fontWeight: 'bold',
    textAlign: 'center',
    color: '#991B1B',
  },

  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    color: '#666666',
    marginTop: 12,
    marginBottom: 40,
  },

  cardContainer: {
    gap: 20,
  },

  card: {
    backgroundColor: '#FFFFFF',
    padding: 25,
    borderRadius: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#FECACA',
  },

  icon: {
    fontSize: 42,
    marginBottom: 12,
  },

  cardTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#991B1B',
  },

  cardDescription: {
    fontSize: 14,
    color: '#666666',
    textAlign: 'center',
    marginTop: 8,
  },

  footer: {
    textAlign: 'center',
    color: '#999999',
    marginTop: 40,
    fontSize: 13,
  },
});
