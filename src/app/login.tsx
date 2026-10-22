
import { useState } from 'react';

import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  Keyboard,
  Alert,
  ActivityIndicator,
} from 'react-native';

import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { supabase } from '../lib/supabase';

// ========== TYPES ==========

type FormErrors = {
  email?: string;
  password?: string;
};

// ========== LOGIN SCREEN ==========

export default function LoginScreen() {
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  const [errors, setErrors] = useState<FormErrors>({});
  const [isLoading, setIsLoading] = useState(false);

  // ========== CLEAR ERRORS ==========

  const clearError = (field: keyof FormErrors) => {
    setErrors((previous) => ({
      ...previous,
      [field]: undefined,
    }));
  };

  // ========== VALIDATE FORM ==========

  const validateForm = (): boolean => {
    const newErrors: FormErrors = {};

    const cleanEmail = email.trim();

    if (!cleanEmail) {
      newErrors.email = 'Email address is required.';
    } else if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)
    ) {
      newErrors.email = 'Enter a valid email address.';
    }

    if (!password) {
      newErrors.password = 'Password is required.';
    }

    setErrors(newErrors);

    return Object.keys(newErrors).length === 0;
  };

  // ========== REAL SUPABASE LOGIN ==========

  const handleLogin = async () => {
    if (isLoading) {
      return;
    }

    Keyboard.dismiss();

    if (!validateForm()) {
      return;
    }

    setIsLoading(true);

    try {
      const cleanEmail = email.trim().toLowerCase();

      const { data, error } =
        await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password: password,
        });

      if (error) {
        if (
          error.message.toLowerCase().includes(
            'email not confirmed'
          )
        ) {
          Alert.alert(
            'Email Not Verified',
            'Please verify your email address before logging in.'
          );
        } else {
          Alert.alert(
            'Login Failed',
            error.message
          );
        }

        return;
      }

      if (!data.user || !data.session) {
        Alert.alert(
          'Login Failed',
          'Unable to establish a login session.'
        );
        return;
      }

      // Get current user's profile

      const { data: profile, error: profileError } =
        await supabase
          .from('profiles')
          .select('full_name, role, account_status')
          .eq('id', data.user.id)
          .single();

      if (profileError || !profile) {
        await supabase.auth.signOut();

        Alert.alert(
          'Profile Error',
          'Your account was found, but your profile could not be loaded.'
        );

        return;
      }

      // Check account status

      if (profile.account_status !== 'active') {
        await supabase.auth.signOut();

        Alert.alert(
          'Account Unavailable',
          'Your account is currently not active. Please contact support.'
        );

        return;
      }

      // Check supported roles

      if (
        profile.role !== 'donor' &&
        profile.role !== 'beneficiary'
      ) {
        await supabase.auth.signOut();

        Alert.alert(
          'Access Unavailable',
          'This account requires a different login workflow.'
        );

        return;
      }

      // ========== ROLE-BASED NAVIGATION ==========

      if (profile.role === 'donor') {
        router.replace('/donor-dashboard');
      } else if (profile.role === 'beneficiary') {
        router.replace('/beneficiary-dashboard');
      }

    } catch (error) {
      console.error('Login error:', error);

      Alert.alert(
        'Connection Error',
        'Something went wrong. Please check your internet connection and try again.'
      );

    } finally {
      setIsLoading(false);
    }
  };

  // ========== FORGOT PASSWORD ==========

  const handleForgotPassword = () => {
    router.push('/forgot-password');
  };

  // ========== SCREEN UI ==========

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
          <Text style={styles.logo}>❤️</Text>

          <Text style={styles.title}>
            Welcome Back
          </Text>

          <Text style={styles.subtitle}>
            Login to Blood Management
          </Text>
        </View>

        {/* EMAIL */}

        <Text style={styles.label}>
          Email Address *
        </Text>

        <TextInput
          style={[
            styles.input,
            errors.email && styles.inputError,
          ]}
          placeholder="example@gmail.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          editable={!isLoading}
          value={email}
          onChangeText={(value) => {
            setEmail(value);
            clearError('email');
          }}
        />

        {errors.email && (
          <Text style={styles.errorText}>
            {errors.email}
          </Text>
        )}

        {/* PASSWORD */}

        <Text style={styles.label}>
          Password *
        </Text>

        <View
          style={[
            styles.passwordContainer,
            errors.password && styles.inputError,
          ]}
        >
          <TextInput
            style={styles.passwordInput}
            placeholder="Enter your password"
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="current-password"
            editable={!isLoading}
            value={password}
            onChangeText={(value) => {
              setPassword(value);
              clearError('password');
            }}
          />

          <Pressable
            style={styles.visibilityButton}
            disabled={isLoading}
            onPress={() =>
              setShowPassword(!showPassword)
            }
          >
            <Text style={styles.visibilityText}>
              {showPassword ? 'Hide' : 'Show'}
            </Text>
          </Pressable>
        </View>

        {errors.password && (
          <Text style={styles.errorText}>
            {errors.password}
          </Text>
        )}

        {/* REMEMBER ME / FORGOT PASSWORD */}

        <View style={styles.optionsRow}>
          <Pressable
            style={styles.rememberContainer}
            disabled={isLoading}
            onPress={() =>
              setRememberMe(!rememberMe)
            }
            accessibilityRole="checkbox"
            accessibilityState={{
              checked: rememberMe,
            }}
          >
            <View
              style={[
                styles.checkbox,
                rememberMe && styles.checkboxSelected,
              ]}
            >
              {rememberMe && (
                <Text style={styles.checkmark}>
                  ✓
                </Text>
              )}
            </View>

            <Text style={styles.rememberText}>
              Remember Me
            </Text>
          </Pressable>

          <Pressable
            disabled={isLoading}
            onPress={handleForgotPassword}
          >
            <Text style={styles.forgotText}>
              Forgot Password?
            </Text>
          </Pressable>
        </View>

        {/* LOGIN BUTTON */}

        <Pressable
          style={[
            styles.loginButton,
            isLoading && styles.disabledButton,
          ]}
          onPress={handleLogin}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.loginButtonText}>
              Login
            </Text>
          )}
        </Pressable>

        {/* CREATE ACCOUNT */}

        <View style={styles.registerRow}>
          <Text style={styles.registerText}>
            Don't have an account?{' '}
          </Text>

          <Pressable
            disabled={isLoading}
            onPress={() =>
              router.push('/register')
            }
          >
            <Text style={styles.registerLink}>
              Create Account
            </Text>
          </Pressable>
        </View>

        {/* INFORMATION NOTE */}

        <Text style={styles.demoNote}>
          Secure login powered by Supabase.
          {'\n'}
          Email verification is required.
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
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
    paddingBottom: 45,
  },

  header: {
    alignItems: 'center',
    marginBottom: 35,
  },

  logo: {
    fontSize: 54,
    marginBottom: 12,
  },

  title: {
    fontSize: 30,
    fontWeight: 'bold',
    color: '#991B1B',
    textAlign: 'center',
  },

  subtitle: {
    fontSize: 15,
    color: '#6B7280',
    marginTop: 10,
    textAlign: 'center',
  },

  label: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333333',
    marginBottom: 8,
    marginTop: 16,
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

  inputError: {
    borderColor: '#DC2626',
    borderWidth: 1.5,
  },

  errorText: {
    color: '#DC2626',
    fontSize: 12,
    marginTop: 6,
  },

  passwordContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
  },

  passwordInput: {
    flex: 1,
    padding: 14,
    fontSize: 15,
    color: '#111827',
  },

  visibilityButton: {
    padding: 12,
  },

  visibilityText: {
    color: '#DC2626',
    fontSize: 13,
    fontWeight: '600',
  },

  optionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 18,
    gap: 10,
  },

  rememberContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },

  checkbox: {
    width: 20,
    height: 20,
    borderWidth: 1.5,
    borderColor: '#DC2626',
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },

  checkboxSelected: {
    backgroundColor: '#DC2626',
  },

  checkmark: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: 'bold',
  },

  rememberText: {
    fontSize: 13,
    color: '#374151',
  },

  forgotText: {
    fontSize: 13,
    color: '#DC2626',
    fontWeight: '600',
  },

  loginButton: {
    backgroundColor: '#DC2626',
    padding: 17,
    alignItems: 'center',
    borderRadius: 12,
    marginTop: 30,
  },

  disabledButton: {
    opacity: 0.6,
  },

  loginButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: 'bold',
  },

  registerRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 25,
    flexWrap: 'wrap',
  },

  registerText: {
    color: '#6B7280',
    fontSize: 14,
  },

  registerLink: {
    color: '#DC2626',
    fontWeight: 'bold',
    fontSize: 14,
  },

  demoNote: {
    textAlign: 'center',
    color: '#9CA3AF',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 30,
  },
});
