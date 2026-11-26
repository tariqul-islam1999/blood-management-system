import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator, AppState, FlatList, KeyboardAvoidingView, Modal,
  Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';

import { supabase } from '../../lib/supabase';
import {
  ADMIN_MANAGEMENT_ACTIVE, ADMIN_MANAGEMENT_MESSAGE, AdminCandidate, AdminListEntry,
  AdminManagementError, isAdminAccountId, superAdminAppointAdmin, superAdminGetAdminCandidate,
  superAdminListAdmins, superAdminRevokeAdmin, validateAdminManagementReason, verifySuperAdminAccess,
} from '../../lib/admin-management';
import { AppButton, AppCard, EmptyState, StatusBadge } from '../../components/ui';
import {
  AdminCreationError, AdminCreationInput, superAdminCreateAdmin, validateAdminCreationInput,
} from '../../lib/admin-creation';
import {
  DesignColors, FontWeight, Layout, Radii, Space, TypeScale,
} from '../../constants/design-tokens';

/**
 * Super Admin dashboard: donor-verification access and dedicated admin management.
 *
 * PRESENTATION ONLY. Every service call, feature gate, pagination rule,
 * confirmation step and authorization check below is unchanged from the
 * previous implementation:
 * - `verifySuperAdminAccess()` still gates the screen (active super admin only).
 * - `ADMIN_MANAGEMENT_ACTIVE` remains false, so lookup/appoint/revoke stay
 *   disabled and no RPC is ever called while it is off.
 * - No donor or other-user information is displayed; the only new read is the
 *   caller's own `profiles.full_name` for the header.
 */

type ScreenState = 'loading' | 'ready' | 'inactive' | 'error' | 'unauthorized' | 'expired';
type Confirmation = { action: 'appoint' | 'revoke'; user_id: string; full_name: string };
const PAGE_SIZE = 20;

/** First letters of up to two words, upper-cased. */
function toInitials(value: string): string {
  const words = value.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (words.length === 0) return '?';
  return words.map((word) => word[0]?.toUpperCase() ?? '').join('');
}

export default function SuperAdminDashboard() {
  const router = useRouter();
  const [state, setState] = useState<ScreenState>('loading');
  const [message, setMessage] = useState('');
  const [authorized, setAuthorized] = useState(false);
  const [admins, setAdmins] = useState<AdminListEntry[]>([]);
  const [page, setPage] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [targetId, setTargetId] = useState('');
  const [candidate, setCandidate] = useState<AdminCandidate | null>(null);
  const [reason, setReason] = useState('');
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [formError, setFormError] = useState('');
  const [working, setWorking] = useState(false);
  // Own profile name for the header. Read from `profiles` (own row only).
  const [displayName, setDisplayName] = useState('');
  // Logout dialog state (separate from the admin-management confirmation).
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  // Admin-creation form. Every field starts empty; nothing is prefilled and no
  // placeholder identity is ever submitted.
  const [newAdmin, setNewAdmin] = useState<AdminCreationInput>({
    full_name: '', email: '', password: '', phone: '',
    district: '', thana: '', local_area: '', reason: '',
  });
  const [creationErrors, setCreationErrors] = useState<Record<string, string>>({});
  const [creationMessage, setCreationMessage] = useState('');
  const [creationSucceeded, setCreationSucceeded] = useState('');
  const focused = useRef(false);
  const generation = useRef(0);
  const busy = useRef(false);
  const caller = useRef<string | null>(null);

  // `keepCreationResult` is used only by the list refresh that runs right after a
  // successful Admin creation, so the confirmation stays visible. Every other
  // caller (logout, focus loss, authorization failure, unmount) keeps the default
  // and still clears the notice along with the form data.
  const clearPrivateData = useCallback((options?: { keepCreationResult?: boolean }) => {
    setAdmins([]);
    setCandidate(null);
    setTargetId('');
    setReason('');
    setConfirmation(null);
    setFormError('');
    setHasNext(false);
    setWorking(false);
    // The new-Admin form holds a password and personal details, so it is
    // cleared on sign-out, on focus loss and on any authorization failure.
    setNewAdmin({
      full_name: '', email: '', password: '', phone: '',
      district: '', thana: '', local_area: '', reason: '',
    });
    setCreationErrors({});
    setCreationMessage('');
    if (!options?.keepCreationResult) setCreationSucceeded('');
    busy.current = false;
    caller.current = null;
  }, []);

  const load = useCallback(async (
    requestedPage = 0,
    options?: { keepCreationResult?: boolean },
  ) => {
    const request = ++generation.current;
    const current = () => focused.current && request === generation.current;
    clearPrivateData(options);
    setAuthorized(false);
    setState('loading');
    setMessage('');
    try {
      const userId = await verifySuperAdminAccess();
      if (!current()) return;
      caller.current = userId;
      setAuthorized(true);
      // Header name only: the caller's own profiles row (RLS "Users can view
      // own profile"). A failure here must never block admin management, so it
      // is best-effort and leaves the header without a name.
      try {
        const { data: ownProfile } = await supabase
          .from('profiles').select('full_name').eq('id', userId).maybeSingle();
        if (current() && ownProfile && typeof ownProfile.full_name === 'string') {
          setDisplayName(ownProfile.full_name);
        }
      } catch {
        // Non-fatal: the dashboard still works without the display name.
      }
      if (!current()) return;
      // No fallback reads from Auth, audit tables or an unprotected user directory.
      const rows = await superAdminListAdmins(PAGE_SIZE, requestedPage * PAGE_SIZE);
      if (!current()) return;
      setAdmins(rows);
      setPage(requestedPage);
      setHasNext(rows.length === PAGE_SIZE && (requestedPage + 1) * PAGE_SIZE <= 100000);
      setState('ready');
    } catch (error) {
      if (!current()) return;
      const failure = error instanceof AdminManagementError ? error
        : new AdminManagementError('request', 'Unable to load the dashboard. Check your connection and retry.');
      if (failure.code === 'expired' || failure.code === 'unauthorized') {
        clearPrivateData();
        setAuthorized(false);
      }
      setState(failure.code === 'inactive' || failure.code === 'expired' || failure.code === 'unauthorized'
        ? failure.code : 'error');
      setMessage(failure.message);
    }
  }, [clearPrivateData]);

  useFocusEffect(useCallback(() => {
    focused.current = true;
    void load();
    let authTimer: ReturnType<typeof setTimeout> | undefined;
    const hide = () => {
      ++generation.current;
      clearPrivateData();
      setAuthorized(false);
      setState('loading');
    };
    const appSubscription = AppState.addEventListener('change', (nextState) => {
      if (authTimer !== undefined) clearTimeout(authTimer);
      if (nextState === 'active') void load();
      else hide();
    });
    const { data: authSubscription } = supabase.auth.onAuthStateChange((event) => {
      if (!['SIGNED_OUT', 'SIGNED_IN', 'USER_UPDATED', 'TOKEN_REFRESHED'].includes(event)) return;
      if (authTimer !== undefined) clearTimeout(authTimer);
      hide();
      if (event === 'SIGNED_OUT') {
        setState('expired');
        setMessage('You are signed out. Please log in again.');
      } else {
        // Auth calls must not run synchronously in its change callback.
        authTimer = setTimeout(() => {
          if (focused.current && AppState.currentState !== 'background' && AppState.currentState !== 'inactive') void load();
        }, 0);
      }
    });
    return () => {
      focused.current = false;
      ++generation.current;
      if (authTimer !== undefined) clearTimeout(authTimer);
      appSubscription.remove();
      authSubscription.subscription.unsubscribe();
      clearPrivateData();
      setAuthorized(false);
    };
  }, [load, clearPrivateData]));

  const available = ADMIN_MANAGEMENT_ACTIVE && authorized && state === 'ready' && !working;
  const reasonError = validateAdminManagementReason(reason);
  const validId = isAdminAccountId(targetId.trim());
  const canAppoint = available && candidate?.eligible === true &&
    candidate.user_id.toLowerCase() === targetId.trim().toLowerCase() && !reasonError;

  const handleActionError = (error: unknown) => {
    const failure = error instanceof AdminManagementError ? error
      : new AdminManagementError('request', 'Unable to complete this request. Refresh and retry.');
    if (['expired', 'unauthorized', 'inactive', 'unknown-outcome'].includes(failure.code)) {
      ++generation.current;
      clearPrivateData();
      if (failure.code === 'expired' || failure.code === 'unauthorized') setAuthorized(false);
      setState(failure.code === 'expired' || failure.code === 'unauthorized' || failure.code === 'inactive'
        ? failure.code : 'error');
      setMessage(failure.message);
    } else {
      setCandidate(null);
      setConfirmation(null);
      setFormError(failure.message);
    }
  };

  const lookupCandidate = async () => {
    if (!available || busy.current || !validId) return;
    busy.current = true;
    setWorking(true);
    setCandidate(null);
    setFormError('');
    const request = generation.current;
    const current = () => focused.current && request === generation.current;
    try {
      const userId = await verifySuperAdminAccess();
      if (!current()) return;
      if (userId !== caller.current) throw new AdminManagementError('expired', 'Your account changed. Please log in again.');
      const result = await superAdminGetAdminCandidate(targetId);
      if (current()) setCandidate(result);
    } catch (error) {
      if (current()) handleActionError(error);
    } finally {
      if (current()) { busy.current = false; setWorking(false); }
    }
  };

  const submitChange = async () => {
    // Independent UI and service gates: no undeployed RPC can be called.
    if (!ADMIN_MANAGEMENT_ACTIVE || !available || busy.current || !confirmation || reasonError) return;
    if (confirmation.action === 'appoint' && (!canAppoint || confirmation.user_id !== candidate?.user_id)) return;
    const selected = confirmation;
    busy.current = true;
    setWorking(true);
    setFormError('');
    const request = generation.current;
    const current = () => focused.current && request === generation.current;
    try {
      const userId = await verifySuperAdminAccess();
      if (!current()) return;
      if (userId !== caller.current) throw new AdminManagementError('expired', 'Your account changed. Please log in again.');
      if (selected.action === 'appoint') await superAdminAppointAdmin(selected.user_id, reason);
      else await superAdminRevokeAdmin(selected.user_id, reason);
      if (!current()) return;
      // Only a validated server response reaches here. Refresh authoritative data.
      await load();
    } catch (error) {
      if (current()) handleActionError(error);
    } finally {
      if (current()) { busy.current = false; setWorking(false); }
    }
  };

  const updateNewAdmin = (field: keyof AdminCreationInput, value: string) => {
    setNewAdmin((current) => ({ ...current, [field]: value }));
    setCreationErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
    setCreationMessage('');
    setCreationSucceeded('');
  };

  const resetNewAdmin = () => {
    setNewAdmin({
      full_name: '', email: '', password: '', phone: '',
      district: '', thana: '', local_area: '', reason: '',
    });
    setCreationErrors({});
    setCreationMessage('');
  };

  const submitNewAdmin = async () => {
    // Independent UI and service gates: no request is made while the feature is
    // disabled, the screen is not ready, or a request is already in flight.
    if (!ADMIN_MANAGEMENT_ACTIVE || !available || busy.current) return;

    const fieldErrors = validateAdminCreationInput(newAdmin);
    if (Object.keys(fieldErrors).length > 0) {
      setCreationErrors(fieldErrors);
      setCreationMessage('');
      setCreationSucceeded('');
      return;
    }

    busy.current = true;
    setWorking(true);
    setCreationErrors({});
    setCreationMessage('');
    setCreationSucceeded('');
    const request = generation.current;
    const current = () => focused.current && request === generation.current;
    try {
      const userId = await verifySuperAdminAccess();
      if (!current()) return;
      if (userId !== caller.current) {
        throw new AdminCreationError('expired', 'Your account changed. Please log in again.');
      }
      const result = await superAdminCreateAdmin(newAdmin);
      if (!current()) return;
      setCreationSucceeded(
        result.result === 'already_created'
          ? `This Admin account already exists (${result.target_user_id}). The admin list has been refreshed.`
          : `Admin account created (${result.target_user_id}).`,
      );
      resetNewAdmin();
      // Refresh authoritative data so the new Admin appears in the list. The
      // refresh must not wipe the success notice it was triggered after.
      await load(0, { keepCreationResult: true });
    } catch (error) {
      if (!current()) return;
      const failure = error instanceof AdminCreationError ? error
        : new AdminCreationError('request', 'Unable to create the Admin account. Check your connection and retry.');
      if (['expired', 'unauthorized', 'inactive'].includes(failure.code)) {
        ++generation.current;
        clearPrivateData();
        setAuthorized(false);
        setState(failure.code === 'expired' || failure.code === 'unauthorized'
          ? failure.code : 'inactive');
        setMessage(failure.message);
      } else {
        // Keep the form values so the Super Admin can correct and resubmit, but
        // never imply the request succeeded.
        setCreationMessage(failure.message);
      }
    } finally {
      if (current()) { busy.current = false; setWorking(false); }
    }
  };

  const closeConfirmation = () => {
    if (busy.current) return;
    setConfirmation(null);
    setReason('');
    setFormError('');
  };

  const openLogout = () => {
    if (isLoggingOut || busy.current) return;
    setLogoutError('');
    setConfirmingLogout(true);
  };

  const closeLogout = () => {
    if (isLoggingOut) return;
    setConfirmingLogout(false);
    setLogoutError('');
  };

  const confirmLogout = async () => {
    // `isLoggingOut` blocks a second tap before React re-renders the button.
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    setLogoutError('');
    try {
      // Existing Supabase sign-out path, identical to the Admin/donor screens.
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      setConfirmingLogout(false);
      router.replace('/login');
    } catch (error) {
      // Stay signed in and keep the dialog open so the action can be retried.
      setLogoutError(
        error instanceof Error && error.message
          ? error.message
          : 'Sign out failed. Check your connection and try again.',
      );
    } finally {
      setIsLoggingOut(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom', 'left', 'right']}>
      <Stack.Screen options={{ title: 'Super Admin' }} />
      <FlatList
        data={authorized && state === 'ready' ? admins : []}
        keyExtractor={(item) => item.user_id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.headerRow}>
              <View style={styles.avatar} accessible={false}>
                <Text style={styles.avatarText}>{toInitials(displayName)}</Text>
              </View>
              <View style={styles.headerText}>
                <Text style={styles.eyebrow}>Signed in as</Text>
                <Text style={styles.title} accessibilityRole="header" numberOfLines={2}>
                  {displayName || 'Super Administrator'}
                </Text>
                <View style={styles.badgeRow}>
                  <StatusBadge status="active" label="Super administrator" />
                </View>
              </View>
            </View>

            <View style={styles.actions}>
              <AppButton
                label="Donor verification"
                variant="outline"
                accessibilityLabel="Open donor verification"
                style={styles.actionButton}
                onPress={() => router.push('/admin-dashboard')}
              />
              <AppButton
                label="Log out"
                variant="outline"
                accessibilityLabel="Log out of the Super Admin dashboard"
                style={styles.actionButton}
                onPress={openLogout}
              />
            </View>

            {!ADMIN_MANAGEMENT_ACTIVE && (
              <View style={styles.notice} accessibilityLiveRegion="polite">
                <View style={styles.noticeHeading}>
                  <SymbolView
                    name={{ ios: 'exclamationmark.triangle', android: 'error', web: 'error' }}
                    size={20}
                    tintColor={DesignColors.warning}
                  />
                  <Text style={styles.noticeTitle}>{ADMIN_MANAGEMENT_MESSAGE}</Text>
                </View>
                <Text style={styles.noticeText}>
                  Admin lookup, listing, appointment and revocation are disabled until the backend
                  is separately deployed and verified. No admin changes can be submitted.
                </Text>
              </View>
            )}

            {authorized && (
              <AppCard>
                <View style={styles.cardHeadingRow}>
                  <SymbolView
                    name={{ ios: 'person.crop.circle.badge.plus', android: 'person', web: 'person' }}
                    size={20}
                    tintColor={DesignColors.primary}
                  />
                  <Text style={styles.heading} accessibilityRole="header">Create Admin Account</Text>
                </View>
                <Text style={styles.text}>
                  Creates a new account with the Admin role. Confirm the email address with the
                  person directly before submitting: this app does not send an invitation, and the
                  address is not verified by email. Give the password to them in person, never by
                  message or email.
                </Text>

                <Text style={styles.label}>Full name *</Text>
                <TextInput accessibilityLabel="Admin full name" style={styles.input}
                  placeholder="Full name" placeholderTextColor={DesignColors.textMuted}
                  value={newAdmin.full_name} editable={!working}
                  onChangeText={(value) => updateNewAdmin('full_name', value)} />
                {!!creationErrors.full_name && (
                  <Text accessibilityLiveRegion="polite" style={styles.error}>{creationErrors.full_name}</Text>
                )}

                <Text style={styles.label}>Email *</Text>
                <TextInput accessibilityLabel="Admin email address" style={styles.input}
                  placeholder="name@example.com" placeholderTextColor={DesignColors.textMuted}
                  autoCapitalize="none" autoCorrect={false} keyboardType="email-address"
                  value={newAdmin.email} editable={!working}
                  onChangeText={(value) => updateNewAdmin('email', value)} />
                {!!creationErrors.email && (
                  <Text accessibilityLiveRegion="polite" style={styles.error}>{creationErrors.email}</Text>
                )}

                <Text style={styles.label}>Temporary password *</Text>
                <TextInput accessibilityLabel="Temporary password, at least 8 characters" style={styles.input}
                  placeholder="At least 8 characters" placeholderTextColor={DesignColors.textMuted}
                  secureTextEntry autoCapitalize="none" autoCorrect={false}
                  value={newAdmin.password} editable={!working}
                  onChangeText={(value) => updateNewAdmin('password', value)} />
                {!!creationErrors.password && (
                  <Text accessibilityLiveRegion="polite" style={styles.error}>{creationErrors.password}</Text>
                )}

                <Text style={styles.label}>Mobile number *</Text>
                <TextInput accessibilityLabel="Admin mobile number" style={styles.input}
                  placeholder="01XXXXXXXXX" placeholderTextColor={DesignColors.textMuted}
                  keyboardType="phone-pad" value={newAdmin.phone} editable={!working}
                  onChangeText={(value) => updateNewAdmin('phone', value)} />
                {!!creationErrors.phone && (
                  <Text accessibilityLiveRegion="polite" style={styles.error}>{creationErrors.phone}</Text>
                )}

                <Text style={styles.label}>District *</Text>
                <TextInput accessibilityLabel="Admin district" style={styles.input}
                  placeholder="District" placeholderTextColor={DesignColors.textMuted}
                  value={newAdmin.district} editable={!working}
                  onChangeText={(value) => updateNewAdmin('district', value)} />
                {!!creationErrors.district && (
                  <Text accessibilityLiveRegion="polite" style={styles.error}>{creationErrors.district}</Text>
                )}

                <Text style={styles.label}>Thana / Upazila *</Text>
                <TextInput accessibilityLabel="Admin thana or upazila" style={styles.input}
                  placeholder="Thana / Upazila" placeholderTextColor={DesignColors.textMuted}
                  value={newAdmin.thana} editable={!working}
                  onChangeText={(value) => updateNewAdmin('thana', value)} />
                {!!creationErrors.thana && (
                  <Text accessibilityLiveRegion="polite" style={styles.error}>{creationErrors.thana}</Text>
                )}

                <Text style={styles.label}>Local area *</Text>
                <TextInput accessibilityLabel="Admin local area" style={styles.input}
                  placeholder="Local area" placeholderTextColor={DesignColors.textMuted}
                  value={newAdmin.local_area} editable={!working}
                  onChangeText={(value) => updateNewAdmin('local_area', value)} />
                {!!creationErrors.local_area && (
                  <Text accessibilityLiveRegion="polite" style={styles.error}>{creationErrors.local_area}</Text>
                )}

                <Text style={styles.label}>Reason (required)</Text>
                <Text style={styles.helperText}>
                  Use 10-500 characters. Keep it brief; avoid medical details, contact information
                  and secrets.
                </Text>
                <TextInput accessibilityLabel="Reason for creating this admin account, required"
                  multiline textAlignVertical="top" style={styles.reasonInput}
                  placeholder="Reason for creating this admin" placeholderTextColor={DesignColors.textMuted}
                  value={newAdmin.reason} editable={!working}
                  onChangeText={(value) => updateNewAdmin('reason', value)} />
                <Text style={styles.helperText}>{Array.from(newAdmin.reason.trim()).length}/500 characters</Text>
                {!!creationErrors.reason && (
                  <Text accessibilityLiveRegion="polite" style={styles.error}>{creationErrors.reason}</Text>
                )}

                {!!creationMessage && (
                  <Text accessibilityLiveRegion="polite" style={styles.error}>{creationMessage}</Text>
                )}
                {!!creationSucceeded && (
                  <Text accessibilityLiveRegion="polite" style={styles.success}>{creationSucceeded}</Text>
                )}
                {working && (
                  <ActivityIndicator color={DesignColors.primary} accessibilityLabel="Creating admin account" />
                )}

                <AppButton
                  label={working ? 'Creating...' : 'Create Admin Account'}
                  variant="primary"
                  loading={working}
                  disabled={!available}
                  onPress={() => void submitNewAdmin()}
                />
              </AppCard>
            )}

            {authorized && (
              <AppCard>
                <View style={styles.cardHeadingRow}>
                  <SymbolView
                    name={{ ios: 'person.badge.plus', android: 'person', web: 'person' }}
                    size={20}
                    tintColor={DesignColors.primary}
                  />
                  <Text style={styles.heading} accessibilityRole="header">Appoint Admin</Text>
                </View>
                <Text style={styles.text}>
                  Use the UUID of a dedicated, email-verified account registered as a beneficiary.
                  Confirm ownership and dedicated use before appointment. Donor and super admin
                  accounts cannot be appointed.
                </Text>
                <Text style={styles.label}>Account UUID</Text>
                <TextInput accessibilityLabel="Dedicated account UUID" style={styles.input}
                  placeholder="Enter account UUID" placeholderTextColor={DesignColors.textMuted}
                  autoCapitalize="none" autoCorrect={false} value={targetId} editable={!working}
                  onChangeText={(value) => { setTargetId(value); setCandidate(null); setFormError(''); }} />
                {!!targetId && !validId && (
                  <Text style={styles.error} accessibilityLiveRegion="polite">
                    Enter a valid account UUID.
                  </Text>
                )}
                <AppButton
                  label="Look up account"
                  variant="secondary"
                  disabled={!available || !validId}
                  onPress={() => void lookupCandidate()}
                />
                {candidate && (
                  <View style={styles.candidateBox} accessibilityLiveRegion="polite">
                    <Text style={styles.candidateName}>{candidate.full_name}</Text>
                    <Text selectable style={styles.monoText}>{candidate.user_id}</Text>
                    <View style={styles.badgeRow}>
                      <StatusBadge
                        status={candidate.account_status}
                        label={`Role: ${candidate.current_role}`}
                      />
                    </View>
                    <Text style={styles.text}>{candidate.eligible
                      ? 'Eligible for appointment. The server will recheck before making changes.'
                      : 'This account is not eligible for appointment. Use a verified dedicated account; unrelated suspensions and deactivations cannot be reversed here.'}</Text>
                  </View>
                )}
                <Text style={styles.label}>Appointment reason (required)</Text>
                <Text style={styles.helperText}>
                  Use 10-500 characters. Keep the reason brief; avoid medical details, contact
                  information and secrets.
                </Text>
                <TextInput accessibilityLabel="Appointment reason, required, 10 to 500 characters" multiline
                  textAlignVertical="top" style={styles.reasonInput} placeholder="Reason for granting admin access"
                  placeholderTextColor={DesignColors.textMuted} value={reason} editable={!working && !confirmation}
                  onChangeText={setReason} />
                <Text style={styles.helperText}>{Array.from(reason.trim()).length}/500 characters</Text>
                {!!reason && reasonError && (
                  <Text accessibilityLiveRegion="polite" style={styles.error}>{reasonError}</Text>
                )}
                <AppButton
                  label="Appoint Admin"
                  variant="primary"
                  disabled={!canAppoint}
                  onPress={() => { if (canAppoint && candidate) setConfirmation({ action: 'appoint', ...candidate }); }}
                />
                {!!formError && (
                  <Text accessibilityLiveRegion="polite" style={styles.error}>{formError}</Text>
                )}
                {working && (
                  <ActivityIndicator color={DesignColors.primary} accessibilityLabel="Processing admin request" />
                )}
              </AppCard>
            )}

            <View style={styles.sectionHeadingRow}>
              <Text style={styles.sectionTitle} accessibilityRole="header">Admin accounts</Text>
              {state === 'ready' && admins.length > 0 && (
                <Text style={styles.pageMeta}>Page {page + 1} · {admins.length} on this page</Text>
              )}
            </View>
          </View>
        }
        ListEmptyComponent={
          state === 'loading' ? (
            <View style={styles.loadingCard}>
              <ActivityIndicator color={DesignColors.primary} accessibilityLabel="Checking super admin access" />
              <Text style={styles.loadingText}>Checking access and loading admins...</Text>
            </View>
          ) : (
            <AppCard>
              <EmptyState
                icon={
                  state === 'ready'
                    ? { ios: 'person.2', android: 'groups', web: 'groups' }
                    : { ios: 'exclamationmark.triangle', android: 'error', web: 'error' }
                }
                title={
                  state === 'ready' ? 'No admins on this page' :
                  state === 'unauthorized' ? 'Access denied' :
                  state === 'expired' ? 'Login required' :
                  state === 'inactive' ? 'Admin list unavailable' : 'Unable to load admins'
                }
                description={
                  state === 'ready'
                    ? 'No admin accounts were returned for this page.'
                    : message
                }
                action={
                  <View style={styles.emptyActions}>
                    {state === 'inactive' && (
                      <Text style={styles.noticeText}>
                        The list has not been loaded. This does not mean there are no admins.
                      </Text>
                    )}
                    <AppButton
                      label={state === 'expired' || state === 'unauthorized' ? 'Go to login' : 'Retry / refresh'}
                      variant="primary"
                      disabled={working}
                      onPress={() => state === 'expired' || state === 'unauthorized'
                        ? void router.replace('/login') : void load()}
                    />
                  </View>
                }
              />
            </AppCard>
          )
        }
        renderItem={({ item }) => (
          <AppCard style={styles.adminCard}>
            <View style={styles.donorHeaderRow}>
              <View style={styles.smallAvatar} accessible={false}>
                <Text style={styles.smallAvatarText}>{toInitials(item.full_name)}</Text>
              </View>
              <View style={styles.adminHeaderText}>
                <Text style={styles.adminName} numberOfLines={2}>{item.full_name}</Text>
                <Text style={styles.monoText} numberOfLines={1}>ID: {item.user_id}</Text>
              </View>
            </View>

            <View style={styles.badgeRow}>
              <StatusBadge status={item.account_status} />
            </View>

            <Text style={styles.helperText}>
              {item.last_action && item.last_changed_at
                ? `Last action: ${item.last_action} · ${new Date(item.last_changed_at).toLocaleString()}`
                : 'No management history recorded for this account.'}
            </Text>

            <AppButton
              label="Revoke Admin Access"
              variant="destructive"
              disabled={!available || item.account_status !== 'active'}
              accessibilityLabel={`Revoke admin access for ${item.full_name}`}
              onPress={() => {
                if (!available || item.account_status !== 'active') return;
                setReason(''); setFormError(''); setConfirmation({ action: 'revoke', ...item });
              }}
            />
          </AppCard>
        )}
        ListFooterComponent={state === 'ready' ? (
          <View style={styles.pagination}>
            <View style={styles.paginationRow}>
              <AppButton
                label="Previous"
                variant="outline"
                disabled={working || page === 0}
                style={styles.paginationButton}
                onPress={() => void load(page - 1)}
              />
              <AppButton
                label="Next"
                variant="outline"
                disabled={working || !hasNext}
                style={styles.paginationButton}
                onPress={() => void load(page + 1)}
              />
            </View>
            <AppButton
              label="Refresh admins"
              variant="secondary"
              disabled={working}
              onPress={() => void load()}
            />
          </View>
        ) : undefined}
      />
      <Modal visible={confirmation !== null && authorized} transparent animationType="fade" onRequestClose={closeConfirmation}>
        <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <SafeAreaView style={styles.dialog} accessibilityViewIsModal>
            <ScrollView contentContainerStyle={styles.dialogContent} keyboardShouldPersistTaps="handled">
              <Text style={styles.dialogTitle} accessibilityRole="header">
                {confirmation?.action === 'appoint' ? 'Confirm admin appointment' : 'Confirm admin revocation'}
              </Text>
              <Text style={styles.dialogSubject}>{confirmation?.full_name}</Text>
              <Text selectable style={styles.monoText}>{confirmation?.user_id}</Text>
              <Text style={styles.text}>{confirmation?.action === 'appoint'
                ? 'This dedicated account will gain permission to verify donors. It will not be allowed to manage admins.'
                : 'This admin account will be deactivated and lose donor review access. Account records and audit history will be preserved. This does not delete the account or cancel reviews already in progress.'}</Text>
              <Text style={styles.label}>Reason (required, 10-500 characters)</Text>
              <TextInput accessibilityLabel="Admin access change reason, required" multiline textAlignVertical="top"
                style={styles.reasonInput} value={reason} onChangeText={setReason} editable={!working} />
              <Text style={styles.helperText}>{Array.from(reason.trim()).length}/500 characters</Text>
              {reasonError && <Text style={styles.error} accessibilityLiveRegion="polite">{reasonError}</Text>}
              {!ADMIN_MANAGEMENT_ACTIVE && <Text style={styles.error}>{ADMIN_MANAGEMENT_MESSAGE}</Text>}
              <AppButton
                label={working ? 'Submitting...' :
                  confirmation?.action === 'appoint' ? 'Confirm appointment' : 'Confirm revocation'}
                variant={confirmation?.action === 'appoint' ? 'primary' : 'destructive'}
                loading={working}
                disabled={!available || !!reasonError}
                onPress={() => void submitChange()}
              />
              <AppButton
                label="Cancel"
                variant="outline"
                disabled={working}
                onPress={closeConfirmation}
              />
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>

      {/* Logout confirmation. A Modal (not Alert) because Alert.alert is a no-op
          in react-native-web, so confirmation must work on web as well. */}
      <Modal
        visible={confirmingLogout}
        transparent
        animationType="fade"
        onRequestClose={closeLogout}
      >
        <View style={styles.overlay}>
          <View style={styles.dialog} accessibilityViewIsModal>
            <Text style={styles.dialogTitle} accessibilityRole="header">Log out?</Text>
            <Text style={styles.text}>
              You will be returned to the login screen and will need to sign in again to manage
              administrator access.
            </Text>
            {logoutError !== '' && (
              <Text style={styles.error} accessibilityLiveRegion="polite">{logoutError}</Text>
            )}
            <View style={styles.dialogActions}>
              <AppButton
                label="Log out"
                variant="primary"
                loading={isLoggingOut}
                onPress={() => void confirmLogout()}
              />
              <AppButton
                label="Cancel"
                variant="outline"
                disabled={isLoggingOut}
                onPress={closeLogout}
              />
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: DesignColors.background },
  content: {
    flexGrow: 1,
    width: '100%',
    maxWidth: Layout.maxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Space.lg,
    // The SafeAreaView now supplies the device top inset ('top' edge), so this
    // is a plain content gutter. The previous Space.xxxl value was a manual
    // stand-in for the omitted inset and is no longer needed.
    paddingTop: Space.lg,
    paddingBottom: Space.xxxl,
    gap: Space.md,
  },

  header: { gap: Space.md, marginBottom: Space.xs },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  headerText: { flex: 1, gap: Space.xxs },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: DesignColors.primarySoft,
    borderWidth: Layout.hairline,
    borderColor: DesignColors.primaryBorder,
  },
  avatarText: {
    fontSize: TypeScale.title,
    fontWeight: FontWeight.bold,
    color: DesignColors.primaryDeep,
  },
  eyebrow: {
    fontSize: TypeScale.caption,
    fontWeight: FontWeight.medium,
    color: DesignColors.textMuted,
    letterSpacing: 0.6,
  },
  title: {
    fontSize: TypeScale.heading,
    fontWeight: FontWeight.bold,
    lineHeight: 30,
    color: DesignColors.text,
  },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm, marginTop: Space.xxs },

  sectionHeadingRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: Space.md,
    marginTop: Space.xs,
  },
  sectionTitle: {
    fontSize: TypeScale.title,
    fontWeight: FontWeight.bold,
    color: DesignColors.text,
  },
  pageMeta: {
    fontSize: TypeScale.caption,
    color: DesignColors.textMuted,
    flexShrink: 1,
    textAlign: 'right',
  },

  notice: {
    gap: Space.sm,
    padding: Space.md,
    borderRadius: Radii.lg,
    borderWidth: Layout.hairline,
    borderColor: DesignColors.warningBorder,
    backgroundColor: DesignColors.warningSurface,
  },
  noticeHeading: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  noticeTitle: {
    flex: 1,
    fontSize: TypeScale.body,
    fontWeight: FontWeight.bold,
    color: DesignColors.warning,
  },
  noticeText: {
    fontSize: TypeScale.small,
    lineHeight: 20,
    color: DesignColors.warning,
  },

  cardHeadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    marginBottom: Space.sm,
  },
  heading: {
    fontSize: TypeScale.bodyLarge,
    fontWeight: FontWeight.semibold,
    color: DesignColors.text,
    flexShrink: 1,
  },
  label: {
    fontSize: TypeScale.body,
    fontWeight: FontWeight.semibold,
    color: DesignColors.text,
  },
  text: {
    fontSize: TypeScale.body,
    lineHeight: 22,
    color: DesignColors.textSecondary,
    flexShrink: 1,
  },
  helperText: {
    fontSize: TypeScale.small,
    lineHeight: 20,
    color: DesignColors.textMuted,
  },
  error: {
    fontSize: TypeScale.small,
    lineHeight: 20,
    color: DesignColors.errorText,
  },
  success: {
    fontSize: TypeScale.small,
    lineHeight: 20,
    fontWeight: FontWeight.semibold,
    color: DesignColors.successText,
  },
  monoText: {
    fontSize: TypeScale.caption,
    color: DesignColors.textMuted,
  },

  candidateBox: {
    gap: Space.xs,
    padding: Space.md,
    borderRadius: Radii.md,
    borderWidth: Layout.hairline,
    borderColor: DesignColors.primaryBorder,
    backgroundColor: DesignColors.primarySoft,
  },
  candidateName: {
    fontSize: TypeScale.bodyLarge,
    fontWeight: FontWeight.semibold,
    color: DesignColors.text,
  },

  loadingCard: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.md,
    padding: Space.xxxl,
    backgroundColor: DesignColors.surface,
    borderRadius: Radii.lg,
    borderWidth: Layout.hairline,
    borderColor: DesignColors.border,
  },
  loadingText: { fontSize: TypeScale.body, color: DesignColors.textMuted },
  emptyActions: { gap: Space.sm, alignSelf: 'stretch' },

  adminCard: { gap: Space.md },
  donorHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  adminHeaderText: { flex: 1, gap: Space.xxs },
  smallAvatar: {
    width: 44,
    height: 44,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: DesignColors.surfaceMuted,
    borderWidth: Layout.hairline,
    borderColor: DesignColors.border,
  },
  smallAvatarText: {
    fontSize: TypeScale.small,
    fontWeight: FontWeight.bold,
    color: DesignColors.textSecondary,
  },
  adminName: {
    fontSize: TypeScale.bodyLarge,
    fontWeight: FontWeight.semibold,
    lineHeight: 22,
    color: DesignColors.text,
  },

  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  actionButton: { flexGrow: 1, flexBasis: 140 },

  pagination: { gap: Space.sm, marginTop: Space.sm },
  paginationRow: { flexDirection: 'row', gap: Space.sm },
  paginationButton: { flex: 1 },

  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(17, 24, 39, 0.5)',
    padding: Space.lg,
  },
  dialog: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '100%',
    backgroundColor: DesignColors.surface,
    borderRadius: Radii.xl,
    padding: Space.xl,
    gap: Space.md,
  },
  dialogContent: { padding: Space.xl, gap: Space.md },
  dialogTitle: {
    fontSize: TypeScale.title,
    fontWeight: FontWeight.bold,
    color: DesignColors.text,
  },
  dialogSubject: {
    fontSize: TypeScale.bodyLarge,
    fontWeight: FontWeight.semibold,
    color: DesignColors.text,
  },
  dialogActions: { gap: Space.sm, marginTop: Space.xs },

  input: {
    minHeight: Layout.inputHeight,
    borderWidth: Layout.hairline,
    borderColor: DesignColors.borderStrong,
    borderRadius: Radii.sm,
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
    fontSize: TypeScale.bodyLarge,
    color: DesignColors.text,
    backgroundColor: DesignColors.surface,
  },
  reasonInput: {
    minHeight: 110,
    borderWidth: Layout.hairline,
    borderColor: DesignColors.borderStrong,
    borderRadius: Radii.sm,
    padding: Space.md,
    fontSize: TypeScale.bodyLarge,
    lineHeight: 22,
    color: DesignColors.text,
    backgroundColor: DesignColors.surface,
  },
});
