import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator, AppState, FlatList, KeyboardAvoidingView, Modal,
  Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { supabase } from '../lib/supabase';
import {
  adminListPendingDonors, isActiveAdministrator, PendingDonor, ReviewDecision,
  validateRejectionReason, VerificationError, VERIFICATION_SERVICE_MESSAGE,
} from '../lib/admin-donor-verification';

type ScreenState = 'loading' | 'ready' | 'inactive' | 'error' | 'unauthorized' | 'expired';
const PAGE_SIZE = 20;

export default function AdminDashboard() {
  const router = useRouter();
  const [state, setState] = useState<ScreenState>('loading');
  const [message, setMessage] = useState('');
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [donors, setDonors] = useState<PendingDonor[]>([]);
  const [page, setPage] = useState(0);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [selected, setSelected] = useState<PendingDonor | null>(null);
  const [decision, setDecision] = useState<ReviewDecision>('approved');
  const [reason, setReason] = useState('');
  const generation = useRef(0);
  const focused = useRef(false);

  const clearPrivateData = useCallback(() => {
    setIsSuperAdmin(false);
    setDonors([]);
    setSelected(null);
    setReason('');
    setHasNextPage(false);
  }, []);

  const load = useCallback(async (requestedPage = 0) => {
    const request = ++generation.current;
    const current = () => focused.current && request === generation.current;
    clearPrivateData();
    setState('loading');
    setMessage('');
    try {
      // getUser validates the identity with Auth; permissions come from profiles.
      const { data, error } = await supabase.auth.getUser();
      if (!current()) return;
      if (error) {
        if (error.status === 401 || error.status === 403 ||
            error.name === 'AuthSessionMissingError' ||
            ['refresh_token_not_found', 'refresh_token_already_used',
              'session_not_found', 'user_not_found'].includes(error.code ?? '')) {
          throw new VerificationError('expired', 'Your session has expired or you are signed out. Please log in again.');
        }
        throw new Error('Unable to verify your session. Check your connection and retry.');
      }
      if (!data.user) {
        throw new VerificationError('expired', 'You are signed out. Please log in again.');
      }
      const { data: profile, error: profileError } = await supabase
        .from('profiles').select('role, account_status').eq('id', data.user.id).maybeSingle();
      if (!current()) return;
      if (profileError) {
        if (profileError.code === '42501') {
          throw new VerificationError('unauthorized', 'An active admin or super admin account is required.');
        }
        if (['PGRST301', 'PGRST302', 'PGRST303'].includes(profileError.code)) {
          throw new VerificationError('expired', 'Your session has expired. Please log in again.');
        }
        throw new Error('Unable to verify your account. Check your connection and retry.');
      }
      if (!isActiveAdministrator(profile)) {
        throw new VerificationError('unauthorized', 'An active admin or super admin account is required.');
      }
      setIsSuperAdmin(profile?.role === 'super_admin');
      // The wrapper refuses to call the undeployed RPC. Never fall back to table reads.
      const rows = await adminListPendingDonors(PAGE_SIZE, requestedPage * PAGE_SIZE);
      if (!current()) return;
      setDonors(rows);
      setPage(requestedPage);
      setHasNextPage(rows.length === PAGE_SIZE && (requestedPage + 1) * PAGE_SIZE <= 100000);
      setState('ready');
    } catch (error) {
      if (!current()) return;
      if (error instanceof VerificationError) {
        if (error.code === 'expired' || error.code === 'unauthorized') setIsSuperAdmin(false);
        setState(error.code === 'inactive' || error.code === 'expired' ||
          error.code === 'unauthorized' ? error.code : 'error');
        setMessage(error.message);
      } else {
        setState('error');
        setMessage('Unable to load the dashboard. Check your connection and retry.');
      }
    }
  }, [clearPrivateData]);

  useFocusEffect(useCallback(() => {
    focused.current = true;
    void load();
    // Route focus alone does not cover returning from the background on mobile.
    const appSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void load();
      } else {
        ++generation.current;
        clearPrivateData();
        setState('loading');
      }
    });
    const { data: authSubscription } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT' || event === 'USER_UPDATED' || event === 'SIGNED_IN') {
        ++generation.current;
        clearPrivateData();
        if (event === 'SIGNED_OUT') {
          setState('expired');
          setMessage('You are signed out. Please log in again.');
        } else {
          // Avoid calling Auth methods synchronously inside its change callback.
          setState('loading');
          setTimeout(() => { if (focused.current) void load(); }, 0);
        }
      }
    });
    return () => {
      focused.current = false;
      ++generation.current;
      appSubscription.remove();
      authSubscription.subscription.unsubscribe();
      clearPrivateData();
    };
  }, [load, clearPrivateData]));

  const openReview = (donor: PendingDonor) => {
    setDecision('approved');
    setReason('');
    setSelected(donor);
  };
  const closeReview = () => {
    setSelected(null);
    setReason('');
  };
  const reasonError = decision === 'rejected' ? validateRejectionReason(reason) : null;

  return (
    <SafeAreaView style={styles.screen} edges={['bottom', 'left', 'right']}>
      <Stack.Screen options={{ title: 'Admin Dashboard' }} />
      <FlatList
        data={state === 'ready' ? donors : []}
        keyExtractor={(donor) => donor.donor_id}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={styles.section}>
            <Text style={styles.title} accessibilityRole="header">Donor verification</Text>
            <Text style={styles.text}>Review pending donor registrations.</Text>
            {isSuperAdmin && (
              <Pressable accessibilityRole="link" style={styles.secondaryButton}
                onPress={() => router.replace('./super-admin-dashboard')}>
                <Text style={styles.secondaryText}>Return to Super Admin Dashboard</Text>
              </Pressable>
            )}
            <View style={styles.notice} accessibilityLiveRegion="polite">
              <Text style={styles.noticeTitle}>{VERIFICATION_SERVICE_MESSAGE}</Text>
              <Text style={styles.text}>Approvals and rejections are disabled until the backend is deployed and tested. No verification changes can be submitted.</Text>
            </View>
            <Text style={styles.heading} accessibilityRole="header">Pending donors</Text>
            {state === 'ready' && donors.length > 0 && (
              <Text style={styles.text}>Page {page + 1} · {donors.length} registrations on this page</Text>
            )}
          </View>
        }
        ListEmptyComponent={
          <View style={styles.card} accessibilityLiveRegion="polite">
            {state === 'loading' ? (
              <><ActivityIndicator color="#991B1B" accessibilityLabel="Checking admin access" />
                <Text style={styles.text}>Checking access and loading the queue…</Text></>
            ) : (
              <>
                <Text style={styles.heading}>
                  {state === 'ready' ? 'No pending donors' :
                    state === 'unauthorized' ? 'Access denied' :
                    state === 'expired' ? 'Login required' :
                    state === 'inactive' ? 'Queue unavailable' : 'Unable to load donors'}
                </Text>
                <Text style={styles.text}>
                  {state === 'ready' ? 'There are no pending registrations on this page.' : message}
                </Text>
                {state === 'inactive' && <Text style={styles.text}>The pending queue cannot be loaded before activation. This does not mean the queue is empty.</Text>}
                <Pressable accessibilityRole="button" style={styles.button}
                  onPress={() => state === 'expired' || state === 'unauthorized'
                    ? router.replace('/login') : void load()}>
                  <Text style={styles.buttonText}>
                    {state === 'expired' || state === 'unauthorized' ? 'Go to login' :
                      state === 'ready' ? 'Refresh' : 'Retry'}
                  </Text>
                </Pressable>
              </>
            )}
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.heading}>{item.full_name}</Text>
            <Text style={styles.text}>Blood group: {item.blood_group} · Age: {item.age_years ?? 'Not provided'}</Text>
            <Text style={styles.text}>District: {item.district}</Text>
            <Text style={styles.text}>Thana: {item.thana}</Text>
            <Text style={styles.text}>Local area: {item.local_area || 'Not provided'}</Text>
            <Text style={styles.text}>Last donation: {item.last_donation_date ?? 'Not provided'}</Text>
            <Text style={styles.text}>Registered: {new Date(item.registered_at).toLocaleDateString()}</Text>
            <Text style={styles.pending}>Pending verification</Text>
            <View style={styles.actions}>
              <Pressable disabled accessibilityRole="button" accessibilityState={{ disabled: true }}
                style={[styles.button, styles.disabled]}><Text style={styles.buttonText}>Approve</Text></Pressable>
              <Pressable disabled accessibilityRole="button" accessibilityState={{ disabled: true }}
                style={[styles.button, styles.disabled]}><Text style={styles.buttonText}>Reject</Text></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={`Review details for ${item.full_name}`}
                style={styles.secondaryButton} onPress={() => openReview(item)}>
                <Text style={styles.secondaryText}>Review details</Text>
              </Pressable>
            </View>
          </View>
        )}
        ListFooterComponent={state === 'ready' ? (
          <View style={styles.actions}>
            <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={() => void load()}>
              <Text style={styles.secondaryText}>Refresh queue</Text>
            </Pressable>
            <Pressable accessibilityRole="button" disabled={page === 0}
              accessibilityState={{ disabled: page === 0 }}
              style={[styles.secondaryButton, page === 0 && styles.disabled]} onPress={() => void load(page - 1)}>
              <Text style={styles.secondaryText}>Previous</Text>
            </Pressable>
            <Pressable accessibilityRole="button" disabled={!hasNextPage}
              accessibilityState={{ disabled: !hasNextPage }}
              style={[styles.secondaryButton, !hasNextPage && styles.disabled]} onPress={() => void load(page + 1)}>
              <Text style={styles.secondaryText}>Next</Text>
            </Pressable>
          </View>
        ) : undefined}
      />
      <Modal visible={selected !== null} transparent animationType="fade" onRequestClose={closeReview}>
        <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <SafeAreaView style={styles.dialog} accessibilityViewIsModal>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.section}>
              <Text style={styles.heading} accessibilityRole="header">Confirm donor review</Text>
              <Text style={styles.text}>{selected?.full_name}</Text>
              <Text style={styles.text}>{VERIFICATION_SERVICE_MESSAGE}. This review cannot be submitted.</Text>
              <View style={styles.actions}>
                {(['approved', 'rejected'] as const).map((value) => (
                  <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: decision === value }}
                    style={[styles.secondaryButton, decision === value && styles.chosen]}
                    onPress={() => { setDecision(value); setReason(''); }}>
                    <Text style={styles.secondaryText}>{value === 'approved' ? 'Approval' : 'Rejection'}</Text>
                  </Pressable>
                ))}
              </View>
              {decision === 'rejected' ? (
                <>
                  <Text style={styles.heading}>Rejection reason (required)</Text>
                  <Text style={styles.text}>Use 10–500 characters. Give a brief operational reason; avoid medical details and unnecessary personal information.</Text>
                  <TextInput accessibilityLabel="Rejection reason, required, 10 to 500 characters"
                    style={styles.input} multiline textAlignVertical="top" value={reason} onChangeText={setReason}
                    placeholder="Explain why this registration needs to be rejected" placeholderTextColor="#6B7280" />
                  <Text style={styles.text}>{Array.from(reason.trim()).length}/500 characters</Text>
                  {reasonError && <Text style={styles.error} accessibilityLiveRegion="polite">{reasonError}</Text>}
                  <Text style={styles.text}>Confirming rejection would remove this registration from the pending queue.</Text>
                </>
              ) : <Text style={styles.text}>Confirming approval would verify this registration. Approval does not establish medical fitness or change donor availability.</Text>}
              {/* Intentionally no mutation handler while backend activation is blocked. */}
              <Pressable disabled accessibilityRole="button" accessibilityState={{ disabled: true }}
                style={[styles.button, styles.disabled]}>
                <Text style={styles.buttonText}>{decision === 'approved' ? 'Confirm approval' : 'Confirm rejection'}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={closeReview}>
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
  text: { fontSize: 16, lineHeight: 24, color: '#374151', flexShrink: 1 },
  notice: { padding: 16, gap: 8, borderWidth: 1, borderColor: '#D97706', borderRadius: 12, backgroundColor: '#FFFBEB' },
  noticeTitle: { fontSize: 17, fontWeight: '700', color: '#78350F' },
  card: { padding: 20, gap: 12, borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#FFFFFF' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  button: { minHeight: 48, justifyContent: 'center', alignItems: 'center', padding: 14, borderRadius: 10, backgroundColor: '#991B1B' },
  buttonText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF', textAlign: 'center' },
  secondaryButton: { minHeight: 48, padding: 14, justifyContent: 'center', alignItems: 'center', borderRadius: 10, borderWidth: 1, borderColor: '#991B1B' },
  secondaryText: { fontSize: 16, fontWeight: '600', color: '#991B1B', textAlign: 'center' },
  disabled: { opacity: 0.5 },
  pending: { fontSize: 15, fontWeight: '600', color: '#78350F' },
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.5)', padding: 20 },
  dialog: { width: '100%', maxWidth: 600, maxHeight: '100%', padding: 20, borderRadius: 16, backgroundColor: '#FFFFFF' },
  chosen: { backgroundColor: '#FEE2E2', borderWidth: 2 },
  input: { minHeight: 120, borderWidth: 1, borderColor: '#6B7280', padding: 12, borderRadius: 8, fontSize: 16, color: '#111827' },
  error: { fontSize: 15, color: '#991B1B' },
});
