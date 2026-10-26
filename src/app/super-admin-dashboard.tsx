import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator, AppState, FlatList, KeyboardAvoidingView, Modal,
  Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { supabase } from '../lib/supabase';
import {
  ADMIN_MANAGEMENT_ACTIVE, ADMIN_MANAGEMENT_MESSAGE, AdminCandidate, AdminListEntry,
  AdminManagementError, isAdminAccountId, superAdminAppointAdmin, superAdminGetAdminCandidate,
  superAdminListAdmins, superAdminRevokeAdmin, validateAdminManagementReason, verifySuperAdminAccess,
} from '../lib/admin-management';

type ScreenState = 'loading' | 'ready' | 'inactive' | 'error' | 'unauthorized' | 'expired';
type Confirmation = { action: 'appoint' | 'revoke'; user_id: string; full_name: string };
const PAGE_SIZE = 20;

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
  const focused = useRef(false);
  const generation = useRef(0);
  const busy = useRef(false);
  const caller = useRef<string | null>(null);

  const clearPrivateData = useCallback(() => {
    setAdmins([]);
    setCandidate(null);
    setTargetId('');
    setReason('');
    setConfirmation(null);
    setFormError('');
    setHasNext(false);
    setWorking(false);
    busy.current = false;
    caller.current = null;
  }, []);

  const load = useCallback(async (requestedPage = 0) => {
    const request = ++generation.current;
    const current = () => focused.current && request === generation.current;
    clearPrivateData();
    setAuthorized(false);
    setState('loading');
    setMessage('');
    try {
      const userId = await verifySuperAdminAccess();
      if (!current()) return;
      caller.current = userId;
      setAuthorized(true);
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

  const closeConfirmation = () => {
    if (busy.current) return;
    setConfirmation(null);
    setReason('');
    setFormError('');
  };

  return (
    <SafeAreaView style={styles.screen} edges={['bottom', 'left', 'right']}>
      <Stack.Screen options={{ title: 'Super Admin Dashboard' }} />
      <FlatList
        data={authorized && state === 'ready' ? admins : []}
        keyExtractor={(item) => item.user_id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={styles.section}>
            <Text style={styles.title} accessibilityRole="header">Super Admin Dashboard</Text>
            <Text style={styles.text}>Manage dedicated admin access and review donors.</Text>
            {!ADMIN_MANAGEMENT_ACTIVE && <View style={styles.notice} accessibilityLiveRegion="polite">
              <Text style={styles.noticeTitle}>{ADMIN_MANAGEMENT_MESSAGE}</Text>
              <Text style={styles.text}>Admin lookup, listing, appointment and revocation are disabled until the backend is separately deployed and verified. No admin changes can be submitted.</Text>
            </View>}
            {authorized && (
              <>
                <Pressable accessibilityRole="link" style={styles.secondaryButton}
                  onPress={() => router.push('./admin-dashboard')}>
                  <Text style={styles.secondaryText}>Donor verification</Text>
                </Pressable>
                <View style={styles.card}>
                  <Text style={styles.heading} accessibilityRole="header">Appoint Admin</Text>
                  <Text style={styles.text}>Use the UUID of a dedicated, email-verified account registered as a beneficiary. Confirm ownership and dedicated use before appointment. Donor and super admin accounts cannot be appointed.</Text>
                  <Text style={styles.label}>Account UUID</Text>
                  <TextInput accessibilityLabel="Dedicated account UUID" style={styles.input}
                    placeholder="Enter account UUID" placeholderTextColor="#6B7280" autoCapitalize="none"
                    autoCorrect={false} value={targetId} editable={!working}
                    onChangeText={(value) => { setTargetId(value); setCandidate(null); setFormError(''); }} />
                  {!!targetId && !validId && <Text style={styles.error}>Enter a valid account UUID.</Text>}
                  <Pressable accessibilityRole="button" disabled={!available || !validId}
                    accessibilityState={{ disabled: !available || !validId }}
                    style={[styles.secondaryButton, (!available || !validId) && styles.disabled]}
                    onPress={() => void lookupCandidate()}>
                    <Text style={styles.secondaryText}>Look up account</Text>
                  </Pressable>
                  {candidate && (
                    <View style={styles.section} accessibilityLiveRegion="polite">
                      <Text style={styles.heading}>{candidate.full_name}</Text>
                      <Text selectable style={styles.text}>{candidate.user_id}</Text>
                      <Text style={styles.text}>Role: {candidate.current_role} · Status: {candidate.account_status}</Text>
                      <Text style={styles.text}>{candidate.eligible
                        ? 'Eligible for appointment. The server will recheck before making changes.'
                        : 'This account is not eligible for appointment. Use a verified dedicated account; unrelated suspensions and deactivations cannot be reversed here.'}</Text>
                    </View>
                  )}
                  <Text style={styles.label}>Appointment reason (required)</Text>
                  <Text style={styles.text}>Use 10–500 characters. Keep the reason brief; avoid medical details, contact information and secrets.</Text>
                  <TextInput accessibilityLabel="Appointment reason, required, 10 to 500 characters" multiline
                    textAlignVertical="top" style={[styles.input, styles.reason]} placeholder="Reason for granting admin access"
                    placeholderTextColor="#6B7280" value={reason} editable={!working && !confirmation}
                    onChangeText={setReason} />
                  <Text style={styles.text}>{Array.from(reason.trim()).length}/500 characters</Text>
                  {!!reason && reasonError && <Text accessibilityLiveRegion="polite" style={styles.error}>{reasonError}</Text>}
                  <Pressable accessibilityRole="button" disabled={!canAppoint}
                    accessibilityState={{ disabled: !canAppoint }} style={[styles.button, !canAppoint && styles.disabled]}
                    onPress={() => { if (canAppoint && candidate) setConfirmation({ action: 'appoint', ...candidate }); }}>
                    <Text style={styles.buttonText}>Appoint Admin</Text>
                  </Pressable>
                  {!!formError && <Text accessibilityLiveRegion="polite" style={styles.error}>{formError}</Text>}
                  {working && <ActivityIndicator color="#991B1B" accessibilityLabel="Processing admin request" />}
                </View>
              </>
            )}
            <Text style={styles.heading} accessibilityRole="header">Admin List</Text>
            {state === 'ready' && admins.length > 0 && <Text style={styles.text}>Page {page + 1} · {admins.length} admins on this page</Text>}
          </View>
        }
        ListEmptyComponent={
          <View style={styles.card} accessibilityLiveRegion="polite">
            {state === 'loading' ? <>
              <ActivityIndicator color="#991B1B" accessibilityLabel="Checking super admin access" />
              <Text style={styles.text}>Checking access and loading admins…</Text>
            </> : <>
              <Text style={styles.heading}>{state === 'ready' ? 'No admins on this page' :
                state === 'unauthorized' ? 'Access denied' : state === 'expired' ? 'Login required' :
                state === 'inactive' ? 'Admin list unavailable' : 'Unable to load admins'}</Text>
              <Text style={styles.text}>{state === 'ready' ? 'No admin accounts were returned for this page.' : message}</Text>
              {state === 'inactive' && <Text style={styles.text}>The list has not been loaded. This does not mean there are no admins.</Text>}
              <Pressable accessibilityRole="button" style={[styles.secondaryButton, working && styles.disabled]}
                disabled={working} accessibilityState={{ disabled: working }}
                onPress={() => state === 'expired' || state === 'unauthorized' ? router.replace('/login') : void load()}>
                <Text style={styles.secondaryText}>{state === 'expired' || state === 'unauthorized' ? 'Go to login' : 'Retry / refresh'}</Text>
              </Pressable>
            </>}
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.heading}>{item.full_name}</Text>
            <Text selectable style={styles.text}>Account ID: {item.user_id}</Text>
            <Text style={styles.text}>Status: {item.account_status}</Text>
            <Text style={styles.text}>{item.last_action && item.last_changed_at
              ? `Last action: ${item.last_action} · ${new Date(item.last_changed_at).toLocaleString()}`
              : 'No management history recorded for this account.'}</Text>
            <Pressable accessibilityRole="button" disabled={!available || item.account_status !== 'active'}
              accessibilityState={{ disabled: !available || item.account_status !== 'active' }}
              style={[styles.button, (!available || item.account_status !== 'active') && styles.disabled]}
              onPress={() => {
                if (!available || item.account_status !== 'active') return;
                setReason(''); setFormError(''); setConfirmation({ action: 'revoke', ...item });
              }}>
              <Text style={styles.buttonText}>Revoke Admin Access</Text>
            </Pressable>
          </View>
        )}
        ListFooterComponent={state === 'ready' ? (
          <View style={styles.actions}>
            <Pressable accessibilityRole="button" style={[styles.secondaryButton, working && styles.disabled]}
              disabled={working} accessibilityState={{ disabled: working }} onPress={() => void load()}>
              <Text style={styles.secondaryText}>Refresh admins</Text>
            </Pressable>
            <Pressable accessibilityRole="button" disabled={working || page === 0}
              accessibilityState={{ disabled: working || page === 0 }}
              style={[styles.secondaryButton, (working || page === 0) && styles.disabled]} onPress={() => void load(page - 1)}>
              <Text style={styles.secondaryText}>Previous</Text>
            </Pressable>
            <Pressable accessibilityRole="button" disabled={working || !hasNext}
              accessibilityState={{ disabled: working || !hasNext }}
              style={[styles.secondaryButton, (working || !hasNext) && styles.disabled]} onPress={() => void load(page + 1)}>
              <Text style={styles.secondaryText}>Next</Text>
            </Pressable>
          </View>
        ) : undefined}
      />
      <Modal visible={confirmation !== null && authorized} transparent animationType="fade" onRequestClose={closeConfirmation}>
        <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <SafeAreaView style={styles.dialog} accessibilityViewIsModal>
            <ScrollView contentContainerStyle={styles.section} keyboardShouldPersistTaps="handled">
              <Text style={styles.heading} accessibilityRole="header">
                {confirmation?.action === 'appoint' ? 'Confirm admin appointment' : 'Confirm admin revocation'}
              </Text>
              <Text style={styles.text}>{confirmation?.full_name}</Text>
              <Text selectable style={styles.text}>{confirmation?.user_id}</Text>
              <Text style={styles.text}>{confirmation?.action === 'appoint'
                ? 'This dedicated account will gain permission to verify donors. It will not be allowed to manage admins.'
                : 'This admin account will be deactivated and lose donor review access. Account records and audit history will be preserved. This does not delete the account or cancel reviews already in progress.'}</Text>
              <Text style={styles.label}>Reason (required, 10–500 characters)</Text>
              <TextInput accessibilityLabel="Admin access change reason, required" multiline textAlignVertical="top"
                style={[styles.input, styles.reason]} value={reason} onChangeText={setReason} editable={!working} />
              <Text style={styles.text}>{Array.from(reason.trim()).length}/500 characters</Text>
              {reasonError && <Text style={styles.error} accessibilityLiveRegion="polite">{reasonError}</Text>}
              {!ADMIN_MANAGEMENT_ACTIVE && <Text style={styles.error}>{ADMIN_MANAGEMENT_MESSAGE}</Text>}
              <Pressable accessibilityRole="button" disabled={!available || !!reasonError}
                accessibilityState={{ disabled: !available || !!reasonError }}
                style={[styles.button, (!available || !!reasonError) && styles.disabled]} onPress={() => void submitChange()}>
                <Text style={styles.buttonText}>{working ? 'Submitting…' :
                  confirmation?.action === 'appoint' ? 'Confirm appointment' : 'Confirm revocation'}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" disabled={working} accessibilityState={{ disabled: working }}
                style={[styles.secondaryButton, working && styles.disabled]} onPress={closeConfirmation}>
                <Text style={styles.secondaryText}>Cancel</Text>
              </Pressable>
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FFF5F5' },
  content: { flexGrow: 1, width: '100%', maxWidth: 960, alignSelf: 'center', padding: 20, gap: 16 },
  section: { gap: 14 },
  title: { fontSize: 28, fontWeight: '700', color: '#991B1B' },
  heading: { fontSize: 19, fontWeight: '600', color: '#111827' },
  label: { fontSize: 16, fontWeight: '600', color: '#111827' },
  text: { fontSize: 16, lineHeight: 24, color: '#374151', flexShrink: 1 },
  notice: { padding: 16, gap: 8, borderWidth: 1, borderColor: '#D97706', borderRadius: 12, backgroundColor: '#FFFBEB' },
  noticeTitle: { fontSize: 17, fontWeight: '700', color: '#78350F' },
  card: { padding: 20, gap: 12, borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#FFFFFF' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  button: { minHeight: 48, padding: 14, justifyContent: 'center', alignItems: 'center', borderRadius: 10, backgroundColor: '#991B1B' },
  buttonText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF', textAlign: 'center' },
  secondaryButton: { minHeight: 48, padding: 14, justifyContent: 'center', alignItems: 'center', borderRadius: 10, borderWidth: 1, borderColor: '#991B1B' },
  secondaryText: { fontSize: 16, fontWeight: '600', color: '#991B1B', textAlign: 'center' },
  disabled: { opacity: 0.5 },
  input: { minHeight: 48, borderWidth: 1, borderColor: '#6B7280', padding: 12, borderRadius: 8, fontSize: 16, color: '#111827' },
  reason: { minHeight: 110 },
  error: { fontSize: 15, color: '#991B1B' },
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.5)', padding: 20 },
  dialog: { width: '100%', maxWidth: 600, maxHeight: '100%', padding: 20, borderRadius: 16, backgroundColor: '#FFFFFF' },
});
