import { useCallback, useEffect, useRef, useState } from 'react';

import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { SafeAreaView } from 'react-native-safe-area-context';
import { Href, useRouter } from 'expo-router';
import * as Linking from 'expo-linking';

import { supabase } from '../lib/supabase';
import {
  PASSWORD_POLICY_MESSAGE,
  PasswordResetError,
  clearRecoveryParamsFromUrl,
  establishRecoverySession,
  getCurrentRecoveryUrl,
  parseRecoveryUrl,
  updatePasswordAfterRecovery,
  validateNewPassword,
} from '../lib/password-reset';

type Status = 'checking' | 'ready' | 'invalid';

export default function ResetPasswordScreen() {
  const router = useRouter();

  const [status, setStatus] = useState<Status>('checking');
  const [linkMessage, setLinkMessage] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [formError, setFormError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const mountedRef = useRef(true);
  const processedRef = useRef<string | null>(null);

  const applyRecoveryUrl = useCallback(async (url: string | null) => {
    if (!url || processedRef.current === url) return;
    const params = parseRecoveryUrl(url);
    if (params.kind === 'none') return;
    processedRef.current = url;
    try {
      await establishRecoverySession(params);
      clearRecoveryParamsFromUrl();
      if (mountedRef.current) {
        setFormError('');
        setStatus('ready');
      }
    } catch (error) {
      if (mountedRef.current) {
        setLinkMessage(
          error instanceof PasswordResetError
            ? error.message
            : 'This reset link is invalid or has expired. Request a new reset email.',
        );
        setStatus('invalid');
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    void (async () => {
      const initialUrl = await getCurrentRecoveryUrl();
      if (cancelled) return;
      await applyRecoveryUrl(initialUrl);
      if (!cancelled && processedRef.current === null) {
        setLinkMessage(
          'Open this screen from the reset link in your email, or request a new link.',
        );
        setStatus('invalid');
      }
    })();

    const subscription = Linking.addEventListener('url', (event) => {
      void applyRecoveryUrl(event.url);
    });

    return () => {
      cancelled = true;
      mountedRef.current = false;
      subscription.remove();
    };
  }, [applyRecoveryUrl]);

  const submit = async () => {
    if (isSaving) return;
    Keyboard.dismiss();

    const policyError = validateNewPassword(password);
    if (policyError) {
      setFormError(policyError);
      return;
    }
    if (password !== confirmPassword) {
      setFormError('Passwords do not match.');
      return;
    }

    setFormError('');
    setIsSaving(true);

    try {
      await updatePasswordAfterRecovery(password);
      try {
        await supabase.auth.signOut();
      } catch {
        // The password is already changed; sign-out failure is not fatal.
      }
      Alert.alert(
        'Password Updated',
        'Your password has been changed. Please log in with your new password.',
        [{ text: 'Go to Login', onPress: () => router.replace('/login' as Href) }],
      );
    } catch (error) {
      setFormError(
        error instanceof PasswordResetError
          ? error.message
          : 'The password could not be changed. Request a new reset email and try again.',
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Set a New Password</Text>

        {status === 'checking' ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#DC2626" />
            <Text style={styles.subtitle}>Checking your reset link...</Text>
          </View>
        ) : null}

        {status === 'invalid' ? (
          <>
            <Text style={styles.subtitle}>{linkMessage}</Text>
            <Pressable
              style={styles.primaryButton}
              onPress={() => router.replace('/forgot-password' as Href)}
              accessibilityRole="button"
            >
              <Text style={styles.primaryText}>Request a New Link</Text>
            </Pressable>
            <Pressable style={styles.backButton} onPress={() => router.replace('/login' as Href)}>
              <Text style={styles.backText}>Back to Login</Text>
            </Pressable>
          </>
        ) : null}

        {status === 'ready' ? (
          <>
            <Text style={styles.subtitle}>Choose a strong password for your BMS account.</Text>

            <Text style={styles.label}>New Password *</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={(value) => {
                setPassword(value);
                setFormError('');
              }}
              secureTextEntry={!showPasswords}
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="newPassword"
            />

            <Text style={styles.label}>Confirm Password *</Text>
            <TextInput
              style={styles.input}
              value={confirmPassword}
              onChangeText={(value) => {
                setConfirmPassword(value);
                setFormError('');
              }}
              secureTextEntry={!showPasswords}
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="newPassword"
            />

            <Pressable
              style={styles.toggleRow}
              onPress={() => setShowPasswords((previous) => !previous)}
              accessibilityRole="button"
            >
              <Text style={styles.toggleText}>
                {showPasswords ? 'Hide passwords' : 'Show passwords'}
              </Text>
            </Pressable>

            <Text style={styles.hint}>{PASSWORD_POLICY_MESSAGE}</Text>

            {formError ? <Text style={styles.errorText}>{formError}</Text> : null}

            <Pressable
              style={[styles.primaryButton, isSaving ? styles.disabled : null]}
              onPress={() => void submit()}
              disabled={isSaving}
              accessibilityRole="button"
            >
              {isSaving ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.primaryText}>Update Password</Text>
              )}
            </Pressable>

            <Pressable style={styles.backButton} onPress={() => router.replace('/login' as Href)}>
              <Text style={styles.backText}>Cancel and return to Login</Text>
            </Pressable>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFF5F5' },
  content: { flexGrow: 1, justifyContent: 'center', padding: 24, paddingBottom: 45 },
  center: { alignItems: 'center', marginTop: 24 },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#991B1B',
    textAlign: 'center',
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 15,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  label: { fontSize: 15, fontWeight: '600', color: '#333333', marginBottom: 8, marginTop: 8 },
  input: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    padding: 14,
    fontSize: 15,
    color: '#111827',
  },
  toggleRow: { alignSelf: 'flex-start', paddingVertical: 8, marginTop: 4 },
  toggleText: { color: '#DC2626', fontSize: 13, fontWeight: '600' },
  hint: { color: '#6B7280', fontSize: 12, lineHeight: 18, marginTop: 4 },
  errorText: { color: '#DC2626', fontSize: 13, marginTop: 12, lineHeight: 19 },
  primaryButton: {
    backgroundColor: '#DC2626',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 20,
  },
  disabled: { opacity: 0.6 },
  primaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: 'bold' },
  backButton: { alignItems: 'center', marginTop: 20, padding: 8 },
  backText: { color: '#DC2626', fontSize: 15, fontWeight: '600' },
});
