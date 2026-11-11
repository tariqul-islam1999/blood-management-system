
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

import { requestPasswordReset } from '../lib/password-reset';

export default function ForgotPasswordScreen() {
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [formError, setFormError] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isSent, setIsSent] = useState(false);

  const handleResetPassword = async () => {
    if (isSending) return;

    Keyboard.dismiss();

    const cleanEmail = email.trim().toLowerCase();

    if (!cleanEmail) {
      setEmailError('Email address is required.');
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setEmailError('Enter a valid email address.');
      return;
    }

    setEmailError('');
    setFormError('');
    setIsSending(true);

    try {
      const result = await requestPasswordReset(cleanEmail);

      if (!result.ok) {
        setFormError(result.message);
        return;
      }

      // Deliberately generic: never reveal whether the address has an account.
      setIsSent(true);
      Alert.alert(
        'Check Your Email',
        'If an account exists for this email address, a password reset link has been sent.'
      );
    } finally {
      setIsSending(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Text style={styles.icon}>🔐</Text>
          <Text style={styles.title}>Forgot Password?</Text>
          <Text style={styles.subtitle}>
            Enter your registered email address to reset your password.
          </Text>
        </View>

        <Text style={styles.label}>Email Address *</Text>

        <TextInput
          style={[
            styles.input,
            emailError ? styles.inputError : null,
          ]}
          placeholder="example@gmail.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          value={email}
          onChangeText={(value) => {
            setEmail(value);
            setEmailError('');
          }}
        />

        {emailError ? (
          <Text style={styles.errorText}>{emailError}</Text>
        ) : null}

        {formError ? <Text style={styles.errorText}>{formError}</Text> : null}

        {isSent ? (
          <View style={styles.successCard}>
            <Text style={styles.successTitle}>Check your email</Text>
            <Text style={styles.successText}>
              If an account exists for this email address, a password reset link has been
              sent. The link opens the app so you can choose a new password.
            </Text>
            <Text style={styles.successHint}>
              Didn&apos;t receive it? Check spam, wait a minute, then try again.
            </Text>
          </View>
        ) : null}

        <Pressable
          style={[styles.resetButton, isSending ? styles.disabled : null]}
          onPress={() => void handleResetPassword()}
          disabled={isSending}
          accessibilityRole="button"
        >
          {isSending ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.resetButtonText}>
              {isSent ? 'Send Again' : 'Send Reset Link'}
            </Text>
          )}
        </Pressable>

        <Pressable
          style={styles.backButton}
          onPress={() => router.replace('/login')}
        >
          <Text style={styles.backText}>← Back to Login</Text>
        </Pressable>

        <Text style={styles.demoNote}>
          For your security, we do not confirm whether an email address is registered.
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
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
    paddingBottom: 45,
  },

  header: {
    alignItems: 'center',
    marginBottom: 35,
  },

  icon: {
    fontSize: 56,
    marginBottom: 15,
  },

  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#991B1B',
    textAlign: 'center',
  },

  subtitle: {
    fontSize: 15,
    color: '#6B7280',
    textAlign: 'center',
    marginTop: 12,
    lineHeight: 22,
  },

  label: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333333',
    marginBottom: 8,
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

  resetButton: {
    backgroundColor: '#DC2626',
    padding: 17,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 26,
  },

  resetButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },

  backButton: {
    alignItems: 'center',
    marginTop: 24,
    padding: 8,
  },

  backText: {
    color: '#DC2626',
    fontSize: 15,
    fontWeight: '600',
  },

  demoNote: {
    color: '#9CA3AF',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
    marginTop: 30,
  },

  disabled: {
    opacity: 0.6,
  },

  successCard: {
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    borderRadius: 12,
    padding: 14,
    marginTop: 14,
  },

  successTitle: {
    color: '#166534',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 6,
  },

  successText: {
    color: '#166534',
    fontSize: 13,
    lineHeight: 19,
  },

  successHint: {
    color: '#4B5563',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 8,
  },
});
