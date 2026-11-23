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
  adminListPendingDonors, adminReviewDonor, isActiveAdministrator, PendingDonor,
  ReviewDecision, validateRejectionReason, VerificationError,
} from '../../lib/admin-donor-verification';
import { AppButton, AppCard, EmptyState, ListRow, StatusBadge } from '../../components/ui';
import {
  DesignColors, FontWeight, Layout, Radii, Space, TypeScale,
} from '../../constants/design-tokens';

/**
 * Admin donor verification queue.
 *
 * Presentation only: the RPC calls (`admin_list_pending_donors`,
 * `admin_review_donor`), pagination, refresh, stale/concurrent handling,
 * authorization checks and error mapping are unchanged from the previous
 * implementation. No donor field beyond the existing RPC contract is shown.
 */

type ScreenState = 'loading' | 'ready' | 'inactive' | 'error' | 'unauthorized' | 'expired';
const PAGE_SIZE = 20;

/** First letters of up to two words, upper-cased. */
function toInitials(value: string): string {
  const words = value.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (words.length === 0) return '?';
  return words.map((word) => word[0]?.toUpperCase() ?? '').join('');
}

export default function AdminVerification() {
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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [dialogError, setDialogError] = useState('');
  const [bannerMessage, setBannerMessage] = useState('');
  // Presentation-only step: donor details first, then explicit confirmation.
  const [reviewStep, setReviewStep] = useState<'details' | 'confirm'>('details');
  const generation = useRef(0);
  const focused = useRef(false);
  // Guards against a second submit before the disabled state re-renders.
  const submitting = useRef(false);

  const clearPrivateData = useCallback(() => {
    setIsSuperAdmin(false);
    setDonors([]);
    setSelected(null);
    setReason('');
    setHasNextPage(false);
    setReviewStep('details');
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

  const openReview = (donor: PendingDonor, initialDecision: ReviewDecision = 'approved') => {
    if (submitting.current) return;
    setDecision(initialDecision);
    setReason('');
    setDialogError('');
    setBannerMessage('');
    // Preselecting Approve/Reject jumps straight to confirmation; "Review
    // details" (the default) opens the details step first.
    setReviewStep(initialDecision === 'rejected' ? 'confirm' : 'details');
    setSelected(donor);
  };
  const closeReview = () => {
    if (submitting.current) return;
    setSelected(null);
    setReason('');
    setDialogError('');
    setReviewStep('details');
  };
  const reasonError = decision === 'rejected' ? validateRejectionReason(reason) : null;

  const submitReview = async () => {
    if (!selected || submitting.current) return;
    if (decision === 'rejected' && reasonError !== null) {
      setDialogError(reasonError);
      return;
    }
    submitting.current = true;
    setIsSubmitting(true);
    setDialogError('');
    try {
      // Identity, reviewer role and timestamps are derived server-side.
      await adminReviewDonor(
        selected.donor_id,
        decision,
        decision === 'rejected' ? reason.trim() : null,
      );
      const approved = decision === 'approved';
      setSelected(null);
      setReason('');
      setBannerMessage(approved
        ? 'Donor approved. The donor is now verified and can set their own availability.'
        : 'Donor rejected. The registration stays unverified and unavailable.');
      // A reviewed donor leaves the pending queue, so restart from the first page.
      setPage(0);
      void load(0);
    } catch (error) {
      if (error instanceof VerificationError) {
        if (error.code === 'invalid' || error.code === 'request') {
          setDialogError(error.message);
        } else if (error.code === 'stale') {
          // Someone else already reviewed this donor: refresh the queue.
          setSelected(null);
          setReason('');
          setBannerMessage(error.message);
          setPage(0);
          void load(0);
        } else {
          // expired / unauthorized / inactive fall back to the existing screen states.
          setSelected(null);
          setReason('');
          if (error.code === 'inactive') {
            setState('inactive');
          } else {
            setIsSuperAdmin(false);
            setState(error.code === 'expired' ? 'expired' : 'unauthorized');
          }
          setMessage(error.message);
        }
      } else {
        setDialogError('The review could not be submitted. Check your connection and retry.');
      }
    } finally {
      submitting.current = false;
      setIsSubmitting(false);
    }
  };

  const reviewStateLabel =
    state === 'ready' ? 'No pending donors' :
    state === 'unauthorized' ? 'Access denied' :
    state === 'expired' ? 'Login required' :
    state === 'inactive' ? 'Queue unavailable' : 'Unable to load donors';

  return (
    <SafeAreaView style={styles.screen} edges={['bottom', 'left', 'right']}>
      <Stack.Screen options={{ title: 'Donor Verification' }} />
      <FlatList
        data={state === 'ready' ? donors : []}
        keyExtractor={(donor) => donor.donor_id}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.headerRow}>
              <View style={styles.headerIcon}>
                <SymbolView
                  name={{ ios: 'checkmark.shield', android: 'verified_user', web: 'verified_user' }}
                  size={22}
                  tintColor={DesignColors.primary}
                />
              </View>
              <View style={styles.headerText}>
                <Text style={styles.title} accessibilityRole="header">Donor verification</Text>
                <Text style={styles.subtitle}>Review pending donor registrations.</Text>
              </View>
            </View>

            {isSuperAdmin && (
              <AppCard style={styles.noPadding}>
                <View style={styles.cardBody}>
                  <ListRow
                    title="Super Admin Dashboard"
                    subtitle="Manage administrator access"
                    onPress={() => router.replace('/super-admin-dashboard')}
                  />
                </View>
              </AppCard>
            )}

            {bannerMessage !== '' && (
              <View style={styles.successBanner} accessibilityLiveRegion="polite">
                <SymbolView
                  name={{ ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' }}
                  size={20}
                  tintColor={DesignColors.successText}
                />
                <Text style={styles.successText}>{bannerMessage}</Text>
              </View>
            )}

            <View style={styles.sectionHeadingRow}>
              <Text style={styles.sectionTitle} accessibilityRole="header">Pending donors</Text>
              {state === 'ready' && donors.length > 0 && (
                <Text style={styles.pageMeta}>Page {page + 1} · {donors.length} on this page</Text>
              )}
            </View>
          </View>
        }
        ListEmptyComponent={
          state === 'loading' ? (
            <View style={styles.loadingCard}>
              <ActivityIndicator color={DesignColors.primary} accessibilityLabel="Checking admin access" />
              <Text style={styles.loadingText}>Checking access and loading the queue...</Text>
            </View>
          ) : (
            <AppCard>
              <EmptyState
                icon={
                  state === 'ready'
                    ? { ios: 'tray', android: 'inbox', web: 'inbox' }
                    : { ios: 'exclamationmark.triangle', android: 'error', web: 'error' }
                }
                title={reviewStateLabel}
                description={
                  state === 'ready'
                    ? 'There are no pending registrations on this page.'
                    : message
                }
                action={
                  <View style={styles.emptyActions}>
                    {state === 'inactive' && (
                      <Text style={styles.noticeText}>
                        The pending queue cannot be loaded before activation. This does not mean
                        the queue is empty.
                      </Text>
                    )}
                    <AppButton
                      label={
                        state === 'expired' || state === 'unauthorized' ? 'Go to login' :
                        state === 'ready' ? 'Refresh' : 'Retry'
                      }
                      variant="primary"
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
          <AppCard style={styles.donorCard}>
            <View style={styles.donorHeaderRow}>
              <View style={styles.avatar} accessible={false}>
                <Text style={styles.avatarText}>{toInitials(item.full_name)}</Text>
              </View>
              <View style={styles.donorHeaderText}>
                <Text style={styles.donorName} numberOfLines={2}>{item.full_name}</Text>
                <Text style={styles.donorMeta}>
                  {item.blood_group} · Age {item.age_years ?? 'not provided'}
                </Text>
              </View>
            </View>

            <View style={styles.badgeRow}>
              <StatusBadge status="pending" label="Pending verification" />
            </View>

            <View style={styles.factGrid}>
              <View style={styles.fact}>
                <Text style={styles.factLabel}>Location</Text>
                <Text style={styles.factValue} numberOfLines={2}>
                  {[item.thana, item.district].filter(Boolean).join(', ')}
                </Text>
              </View>
              <View style={styles.fact}>
                <Text style={styles.factLabel}>Registered</Text>
                <Text style={styles.factValue}>
                  {new Date(item.registered_at).toLocaleDateString()}
                </Text>
              </View>
            </View>

            <View style={styles.actions}>
              <AppButton
                label="Approve"
                variant="primary"
                disabled={isSubmitting}
                accessibilityLabel={`Approve ${item.full_name}`}
                style={styles.actionButton}
                onPress={() => openReview(item, 'approved')}
              />
              <AppButton
                label="Reject"
                variant="destructive"
                disabled={isSubmitting}
                accessibilityLabel={`Reject ${item.full_name}`}
                style={styles.actionButton}
                onPress={() => openReview(item, 'rejected')}
              />
            </View>
            <AppButton
              label="Review details"
              variant="outline"
              disabled={isSubmitting}
              accessibilityLabel={`Review details for ${item.full_name}`}
              onPress={() => openReview(item)}
            />
          </AppCard>
        )}
        ListFooterComponent={state === 'ready' ? (
          <View style={styles.pagination}>
            <View style={styles.paginationRow}>
              <AppButton
                label="Previous"
                variant="outline"
                disabled={page === 0}
                style={styles.paginationButton}
                onPress={() => void load(page - 1)}
              />
              <AppButton
                label="Next"
                variant="outline"
                disabled={!hasNextPage}
                style={styles.paginationButton}
                onPress={() => void load(page + 1)}
              />
            </View>
            <AppButton label="Refresh queue" variant="secondary" onPress={() => void load()} />
          </View>
        ) : undefined}
      />
      <Modal visible={selected !== null} transparent animationType="fade" onRequestClose={closeReview}>
        <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <SafeAreaView style={styles.dialog} accessibilityViewIsModal>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.dialogContent}>
              {reviewStep === 'details' && selected ? (
                <>
                  <View style={styles.dialogHeaderRow}>
                    <View style={styles.avatar} accessible={false}>
                      <Text style={styles.avatarText}>{toInitials(selected.full_name)}</Text>
                    </View>
                    <View style={styles.donorHeaderText}>
                      <Text style={styles.dialogTitle} accessibilityRole="header" numberOfLines={2}>
                        {selected.full_name}
                      </Text>
                      <Text style={styles.donorMeta}>
                        {selected.blood_group} · Age {selected.age_years ?? 'not provided'}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.badgeRow}>
                    <StatusBadge status="pending" label="Pending verification" />
                  </View>

                  <View style={styles.detailList}>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>District</Text>
                      <Text style={styles.detailValue} selectable>{selected.district}</Text>
                    </View>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Thana</Text>
                      <Text style={styles.detailValue} selectable>{selected.thana}</Text>
                    </View>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Local area</Text>
                      <Text style={styles.detailValue} selectable>
                        {selected.local_area || 'Not provided'}
                      </Text>
                    </View>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Last donation</Text>
                      <Text style={styles.detailValue}>
                        {selected.last_donation_date ?? 'Not provided'}
                      </Text>
                    </View>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Registered</Text>
                      <Text style={styles.detailValue}>
                        {new Date(selected.registered_at).toLocaleDateString()}
                      </Text>
                    </View>
                  </View>

                  <Text style={styles.hintText}>
                    This is an administrative registration review, not medical fitness. Approval
                    does not confirm blood safety or change the donor&apos;s availability.
                  </Text>

                  <View style={styles.actions}>
                    <AppButton
                      label="Approve"
                      variant="primary"
                      style={styles.actionButton}
                      onPress={() => { setDecision('approved'); setReason(''); setDialogError(''); setReviewStep('confirm'); }}
                    />
                    <AppButton
                      label="Reject"
                      variant="destructive"
                      style={styles.actionButton}
                      onPress={() => { setDecision('rejected'); setReason(''); setDialogError(''); setReviewStep('confirm'); }}
                    />
                  </View>
                  <AppButton label="Close" variant="outline" onPress={closeReview} />
                </>
              ) : (
                <>
                  <Text style={styles.dialogTitle} accessibilityRole="header">Confirm donor review</Text>
                  <Text style={styles.dialogSubject} numberOfLines={2}>{selected?.full_name}</Text>
                  {isSubmitting && (
                    <Text style={styles.dialogStatus} accessibilityLiveRegion="polite">
                      Submitting the {decision === 'approved' ? 'approval' : 'rejection'}...
                    </Text>
                  )}
                  {dialogError !== '' && (
                    <Text style={styles.error} accessibilityLiveRegion="polite">{dialogError}</Text>
                  )}
                  <View style={styles.actions}>
                    {(['approved', 'rejected'] as const).map((value) => (
                      <Pressable key={value} accessibilityRole="radio"
                        accessibilityState={{ checked: decision === value, disabled: isSubmitting }}
                        style={[styles.choice, decision === value && styles.choiceSelected]}
                        onPress={() => { setDecision(value); setReason(''); setDialogError(''); }}
                        disabled={isSubmitting}>
                        <Text style={[styles.choiceText, decision === value && styles.choiceTextSelected]}>
                          {value === 'approved' ? 'Approval' : 'Rejection'}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  {decision === 'rejected' ? (
                    <>
                      <Text style={styles.fieldLabel}>Rejection reason (required)</Text>
                      <Text style={styles.helperText}>
                        Use 10-500 characters. Give a brief operational reason; avoid medical
                        details and unnecessary personal information.
                      </Text>
                      <TextInput accessibilityLabel="Rejection reason, required, 10 to 500 characters"
                        style={styles.input} multiline textAlignVertical="top" value={reason}
                        onChangeText={setReason} editable={!isSubmitting}
                        placeholder="Explain why this registration needs to be rejected"
                        placeholderTextColor={DesignColors.textMuted} />
                      <Text style={styles.helperText}>{Array.from(reason.trim()).length}/500 characters</Text>
                      {reasonError && <Text style={styles.error} accessibilityLiveRegion="polite">{reasonError}</Text>}
                      <Text style={styles.helperText}>Confirming rejection would remove this registration from the pending queue.</Text>
                    </>
                  ) : (
                    <Text style={styles.helperText}>
                      Confirming approval would verify this registration. Approval does not establish
                      medical fitness or change donor availability.
                    </Text>
                  )}
                  <AppButton
                    label={
                      isSubmitting ? 'Submitting...' :
                      decision === 'approved' ? 'Confirm approval' : 'Confirm rejection'
                    }
                    variant="primary"
                    loading={isSubmitting}
                    disabled={reasonError !== null}
                    onPress={() => void submitReview()}
                  />
                  <View style={styles.actions}>
                    <AppButton
                      label="Back"
                      variant="outline"
                      disabled={isSubmitting}
                      style={styles.actionButton}
                      onPress={() => { setReviewStep('details'); setDialogError(''); }}
                    />
                    <AppButton
                      label="Cancel"
                      variant="outline"
                      disabled={isSubmitting}
                      style={styles.actionButton}
                      onPress={closeReview}
                    />
                  </View>
                </>
              )}
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
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
    paddingTop: Space.lg,
    paddingBottom: Space.xxxl,
    gap: Space.md,
  },

  header: { gap: Space.md, marginBottom: Space.xs },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  headerIcon: {
    width: 44,
    height: 44,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: DesignColors.primarySoft,
    borderWidth: Layout.hairline,
    borderColor: DesignColors.primaryBorder,
  },
  headerText: { flex: 1, gap: Space.xxs },
  title: {
    fontSize: TypeScale.heading,
    fontWeight: FontWeight.bold,
    lineHeight: 30,
    color: DesignColors.text,
  },
  subtitle: {
    fontSize: TypeScale.body,
    lineHeight: 22,
    color: DesignColors.textMuted,
  },

  noPadding: { padding: 0 },
  cardBody: { paddingHorizontal: Space.lg },

  successBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Space.sm,
    padding: Space.md,
    borderRadius: Radii.lg,
    borderWidth: Layout.hairline,
    borderColor: DesignColors.successBorder,
    backgroundColor: DesignColors.successSurface,
  },
  successText: {
    flex: 1,
    fontSize: TypeScale.small,
    lineHeight: 20,
    color: DesignColors.successText,
  },
  noticeText: {
    fontSize: TypeScale.small,
    lineHeight: 20,
    color: DesignColors.warning,
  },

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

  donorCard: { gap: Space.md },
  donorHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  donorHeaderText: { flex: 1, gap: Space.xxs },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: DesignColors.primarySoft,
    borderWidth: Layout.hairline,
    borderColor: DesignColors.primaryBorder,
  },
  avatarText: {
    fontSize: TypeScale.body,
    fontWeight: FontWeight.bold,
    color: DesignColors.primaryDeep,
  },
  donorName: {
    fontSize: TypeScale.bodyLarge,
    fontWeight: FontWeight.semibold,
    lineHeight: 22,
    color: DesignColors.text,
  },
  donorMeta: { fontSize: TypeScale.small, color: DesignColors.textMuted },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },

  factGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.md },
  fact: { flexGrow: 1, flexBasis: 140, gap: Space.xxs },
  factLabel: {
    fontSize: TypeScale.caption,
    fontWeight: FontWeight.medium,
    color: DesignColors.textMuted,
  },
  factValue: { fontSize: TypeScale.body, lineHeight: 22, color: DesignColors.textSecondary },

  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  actionButton: { flexGrow: 1, flexBasis: 120 },

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
  },
  dialogContent: { padding: Space.xl, gap: Space.md },
  dialogHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
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
  dialogStatus: { fontSize: TypeScale.small, color: DesignColors.textMuted },

  detailList: { gap: Space.sm },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Space.md,
    paddingVertical: Space.xs,
    borderBottomWidth: Layout.hairline,
    borderBottomColor: DesignColors.border,
  },
  detailLabel: { fontSize: TypeScale.body, color: DesignColors.textMuted },
  detailValue: {
    fontSize: TypeScale.body,
    fontWeight: FontWeight.medium,
    color: DesignColors.text,
    flexShrink: 1,
    textAlign: 'right',
  },

  hintText: {
    fontSize: TypeScale.small,
    lineHeight: 20,
    color: DesignColors.textMuted,
  },
  helperText: {
    fontSize: TypeScale.small,
    lineHeight: 20,
    color: DesignColors.textSecondary,
  },
  fieldLabel: {
    fontSize: TypeScale.body,
    fontWeight: FontWeight.semibold,
    color: DesignColors.text,
  },
  error: {
    fontSize: TypeScale.small,
    lineHeight: 20,
    color: DesignColors.errorText,
  },

  choice: {
    minHeight: Layout.minTouchTarget,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
    borderRadius: Radii.md,
    borderWidth: Layout.hairline,
    borderColor: DesignColors.borderStrong,
    backgroundColor: DesignColors.surface,
    flexGrow: 1,
    flexBasis: 120,
  },
  choiceSelected: {
    borderColor: DesignColors.primary,
    backgroundColor: DesignColors.primarySoft,
  },
  choiceText: {
    fontSize: TypeScale.body,
    fontWeight: FontWeight.semibold,
    color: DesignColors.textSecondary,
  },
  choiceTextSelected: { color: DesignColors.primaryDeep },

  input: {
    minHeight: 120,
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

