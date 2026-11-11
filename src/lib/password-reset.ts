import { Platform } from 'react-native';
import * as Linking from 'expo-linking';

import { supabase } from './supabase';

// Shared password-reset helpers. Every value is validated before use and no
// auth result reveals whether an email address belongs to an existing account.

export const PASSWORD_POLICY_MESSAGE =
  'Use at least 8 characters with an uppercase letter, a lowercase letter, a number, and a symbol.';

export class PasswordResetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PasswordResetError';
  }
}

type WebLocation = { href?: string; pathname?: string };
type WebHistory = { replaceState: (data: unknown, unused: string, url?: string) => void };

const webLocation = (globalThis as { location?: WebLocation }).location;
const webHistory = (globalThis as { history?: WebHistory }).history;

export type RecoveryLinkParams =
  | { kind: 'tokens'; accessToken: string; refreshToken: string }
  | { kind: 'code'; code: string }
  | { kind: 'token_hash'; tokenHash: string }
  | { kind: 'error'; message: string }
  | { kind: 'none' };

export function validateNewPassword(password: string): string | null {
  if (!password) return 'Password is required.';
  if (password.length < 8) return 'Password must be at least 8 characters long.';
  if (!/[a-z]/.test(password)) return 'Password must include a lowercase letter.';
  if (!/[A-Z]/.test(password)) return 'Password must include an uppercase letter.';
  if (!/[0-9]/.test(password)) return 'Password must include a number.';
  if (!/[^A-Za-z0-9\s]/.test(password)) return 'Password must include a symbol.';
  return null;
}

/**
 * Redirect target for reset emails.
 *
 * Expo Go cannot open the app's own scheme ("bloodmanagementapp://"); it only
 * understands "exp://<dev-host>/--/...". `Linking.createURL` returns the right
 * value for the current environment (Expo Go, development build or web), so the
 * URL is built at call time and never hard-coded.
 */
export function buildPasswordResetRedirectUrl(): string {
  try {
    const url = Linking.createURL('/reset-password');
    return url.length > 0 ? url : '';
  } catch {
    return '';
  }
}

export function parseRecoveryUrl(rawUrl: string | null | undefined): RecoveryLinkParams {
  if (!rawUrl) return { kind: 'none' };

  const hashIndex = rawUrl.indexOf('#');
  const hashPart = hashIndex >= 0 ? rawUrl.slice(hashIndex + 1) : '';
  const withoutHash = hashIndex >= 0 ? rawUrl.slice(0, hashIndex) : rawUrl;
  const queryIndex = withoutHash.indexOf('?');
  const queryPart = queryIndex >= 0 ? withoutHash.slice(queryIndex + 1) : '';

  const hash = new URLSearchParams(hashPart);
  const query = new URLSearchParams(queryPart);
  const read = (key: string): string | null => hash.get(key) ?? query.get(key);

  const errorDescription = read('error_description');
  const errorCode = read('error_code') ?? read('error');
  if (errorDescription || errorCode) {
    return {
      kind: 'error',
      message:
        errorDescription ??
        errorCode ??
        'This password reset link is invalid or has expired.',
    };
  }

  const accessToken = read('access_token');
  const refreshToken = read('refresh_token');
  if (accessToken && refreshToken) {
    return { kind: 'tokens', accessToken, refreshToken };
  }

  const code = read('code');
  if (code) return { kind: 'code', code };

  const tokenHash = read('token_hash');
  const type = read('type');
  const isRecovery = type === null || type === 'recovery';
  if (tokenHash && isRecovery) return { kind: 'token_hash', tokenHash };

  return { kind: 'none' };
}

function friendlyAuthError(error: { message?: string; status?: number }): string {
  const message = (error.message ?? '').toLowerCase();
  if (error.status === 429 || message.includes('rate limit') || message.includes('too many')) {
    return 'Too many requests. Please wait a little and try again.';
  }
  if (error.status === 401 || error.status === 403) {
    return 'This reset link is invalid or has expired. Request a new reset email.';
  }
  if (
    message.includes('expired') ||
    message.includes('invalid') ||
    message.includes('not found') ||
    message.includes('token')
  ) {
    return 'This reset link is invalid or has expired. Request a new reset email.';
  }
  if (message.includes('network') || message.includes('fetch')) {
    return 'Check your internet connection and try again.';
  }
  if (message.includes('password should') || message.includes('weak')) {
    return PASSWORD_POLICY_MESSAGE;
  }
  return 'The password could not be changed. Request a new reset email and try again.';
}

/**
 * Sends the reset email. The result is deliberately the same for known and
 * unknown addresses so account existence is never revealed.
 */
export async function requestPasswordReset(
  email: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: buildPasswordResetRedirectUrl() || undefined,
    });
    if (error) {
      const rawMessage = (error.message ?? '').toLowerCase();
      const status = (error as { status?: number }).status;
      // Some Supabase configurations report unknown addresses explicitly. The UI
      // must answer exactly as it does for a real account.
      if (rawMessage.includes('user not found') || rawMessage.includes('no user')) {
        return { ok: true };
      }
      if (status === 429 || rawMessage.includes('rate limit')) {
        return {
          ok: false,
          message: 'Too many reset emails were requested. Please wait a little and try again.',
        };
      }
      if (status === 400) {
        return { ok: false, message: 'Enter a valid email address and try again.' };
      }
      return {
        ok: false,
        message: 'The reset email could not be sent. Check your connection and try again.',
      };
    }
    return { ok: true };
  } catch {
    return {
      ok: false,
      message: 'The reset email could not be sent. Check your connection and try again.',
    };
  }
}

/** Turns a recovery link into a signed-in recovery session. */
export async function establishRecoverySession(params: RecoveryLinkParams): Promise<void> {
  if (params.kind === 'error') throw new PasswordResetError(params.message);
  if (params.kind === 'none') {
    throw new PasswordResetError(
      'Open this screen from the reset link in your email, or request a new link.',
    );
  }

  if (params.kind === 'tokens') {
    const { error } = await supabase.auth.setSession({
      access_token: params.accessToken,
      refresh_token: params.refreshToken,
    });
    if (error) throw new PasswordResetError(friendlyAuthError(error));
    return;
  }

  if (params.kind === 'code') {
    const { error } = await supabase.auth.exchangeCodeForSession(params.code);
    if (error) throw new PasswordResetError(friendlyAuthError(error));
    return;
  }

  const { error } = await supabase.auth.verifyOtp({
    type: 'recovery',
    token_hash: params.tokenHash,
  });
  if (error) throw new PasswordResetError(friendlyAuthError(error));
}

/** Sets the new password for the recovery session. */
export async function updatePasswordAfterRecovery(password: string): Promise<void> {
  const validation = validateNewPassword(password);
  if (validation) throw new PasswordResetError(validation);

  const { data, error } = await supabase.auth.updateUser({ password });
  if (error) throw new PasswordResetError(friendlyAuthError(error));
  if (!data.user) {
    throw new PasswordResetError(
      'The password change could not be confirmed. Request a new reset email.',
    );
  }
}

/** URL that launched the screen (web hash included, Expo Go initial URL). */
export async function getCurrentRecoveryUrl(): Promise<string | null> {
  if (Platform.OS === 'web') {
    const href = webLocation?.href;
    if (href) return href;
  }
  try {
    return await Linking.getInitialURL();
  } catch {
    return null;
  }
}

/** Removes recovery tokens from the browser address bar after use. */
export function clearRecoveryParamsFromUrl(): void {
  if (Platform.OS !== 'web') return;
  const pathname = webLocation?.pathname;
  if (!webHistory || !pathname) return;
  try {
    webHistory.replaceState(null, '', pathname);
  } catch {
    // Non-fatal: the recovery session already exists in memory.
  }
}
