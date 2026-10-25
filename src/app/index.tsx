
import { StyleSheet, Text, View, Pressable, StatusBar } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';


export default function HomeScreen() {

  const router = useRouter();
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />

      <View style={styles.content}>
        <View style={styles.logoCircle}>
          <Text style={styles.logo}>♥</Text>
        </View>

        <Text style={styles.title}>Blood Management</Text>
        <Text style={styles.subtitle}>Donate Blood, Save Lives</Text>

        <Text style={styles.description}>
          Connecting verified blood donors with people
          who need blood. Together, we can save lives.
        </Text>
      </View>

      <View style={styles.buttonContainer}>
         <Pressable
  style={styles.loginButton}
  onPress={() => {
    console.log('Login Button Pressed!');
    router.push('/login');
  }}
>
  <Text style={styles.loginText}>Login</Text>
</Pressable>



<Pressable
  style={styles.registerButton}
  onPress={() => router.push('/register')}
>
  <Text style={styles.registerText}>Create Account</Text>
</Pressable>

      </View>

      <Text style={styles.footer}>Every Drop Matters ❤️</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFF5F5',
    paddingHorizontal: 24,
  },

  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },

  logoCircle: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: '#DC2626',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 30,
  },

  logo: {
    fontSize: 65,
    color: '#FFFFFF',
  },

  title: {
    fontSize: 29,
    fontWeight: 'bold',
    color: '#991B1B',
    textAlign: 'center',
  },

  subtitle: {
    fontSize: 18,
    color: '#DC2626',
    marginTop: 10,
    fontWeight: '600',
  },

  description: {
    fontSize: 15,
    color: '#666666',
    textAlign: 'center',
    lineHeight: 24,
    marginTop: 25,
    paddingHorizontal: 10,
  },

  buttonContainer: {
    gap: 15,
    marginBottom: 35,
  },

  loginButton: {
    backgroundColor: '#DC2626',
    paddingVertical: 17,
    borderRadius: 12,
    alignItems: 'center',
  },

  loginText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: 'bold',
  },

  registerButton: {
    backgroundColor: '#FFFFFF',
    paddingVertical: 17,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#DC2626',
  },

  registerText: {
    color: '#DC2626',
    fontSize: 17,
    fontWeight: 'bold',
  },

  footer: {
    textAlign: 'center',
    color: '#999999',
    fontSize: 13,
    marginBottom: 15,
  },
});
