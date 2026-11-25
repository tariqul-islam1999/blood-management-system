import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Href, Stack, useFocusEffect, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';

import { supabase } from '../../lib/supabase';
import { isActiveAdministrator } from '../../lib/admin-donor-verification';
import { AppButton, AppCard, EmptyState, ListRow, StatusBadge } from '../../components/ui';
import {
  DesignColors,
  FontWeight,
  Layout,
  Radii,
  Space,
  TypeScale,
} from '../../constants/design-tokens';

/**
 * Admin Home.
 *
 * DATA RULES - every value rendered here comes from a real source:
 * - `full_name`, `role`, `account_status`: the signed-in admin's own `profiles`
 *   row (the only profile row RLS lets any user read: "Users can view own profile").
 * - Everything else on this screen is static explanatory copy taken from the
 *   approved donor-verification documentation. No pending-donor totals, request
 *   counts or other aggregate statistics are shown, because no Admin aggregate
 *   RPC exists to provide them.
 *
 * No navigation entry is offered for User management or Blood request
 * management: neither has a screen, a service wrapper or a backend RPC.
 */

type ScreenState = 'loading' | 'ready' | 'unauthorized' | 'expired' | 'error';

type AdminIdentity = {
  full_name: string;
  role: 'admin' | 'super_admin';
};

/** First letters of up to two words, upper-cased. */
function toInitials(value: string): string {
  const words = value.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (words.length === 0) return '?';
  return words.map((word) => word[0]?.toUpperCase() ?? '').join('');
}


export default function AdminDashboard() {
  const router = useRouter();
  const [state, setState] = useState<ScreenState>('loading');
  const [message, setMessage] = useState('');
  const [identity, setIdentity] = useState<AdminIdentity | null>(null);

  const [confirmingLogout, setConfirmingLogout] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState('');

  const generation = useRef(0);
  const focused = useRef(false);
  // Guards a second sign-out before the disabled state re-renders.
  const signingOut = useRef(false);

  const load = useCallback(async () => {
    const request = ++generation.current;
    const current = () => focused.current && request === generation.current;
    setState('loading');
    setMessage('');
    setIdentity(null);
    try {
      // getUser validates the identity with Auth; permissions come from profiles.
      const { data, error } = await supabase.auth.getUser();
      if (!current()) return;
      if (error) {
        if (error.status === 401 || error.status === 403 ||
            error.name === 'AuthSessionMissingError' ||
            ['refresh_token_not_found', 'refresh_token_already_used',
              'session_not_found', 'user_not_found'].includes(error.code ?? '')) {
          setState('expired');
          setMessage('Your session has expired or you are signed out. Please log in again.');
          return;
        }
        setState('error');
        setMessage('Unable to verify your session. Check your connection and retry.');
        return;
      }
      if (!data.user) {
        setState('expired');
        setMessage('You are signed out. Please log in again.');
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from('profiles').select('full_name, role, account_status').eq('id', data.user.id).maybeSingle();
      if (!current()) return;
      if (profileError) {
        if (profileError.code === '42501') {
          setState('unauthorized');
          setMessage('An active admin or super admin account is required.');
          return;
        }
        if (['PGRST301', 'PGRST302', 'PGRST303'].includes(profileError.code)) {
          setState('expired');
          setMessage('Your session has expired. Please log in again.');
          return;
        }
        setState('error');
        setMessage('Unable to verify your account. Check your connection and retry.');
        return;
      }
      // Same authorisation predicate used by the donor verification screen.
      if (!isActiveAdministrator(profile)) {
        setState('unauthorized');
        setMessage('An active admin or super admin account is required.');
        return;
      }
      const row = profile as { full_name: string; role: 'admin' | 'super_admin' };
      setIdentity({ full_name: row.full_name, role: row.role });
      setState('ready');
    } catch {
      if (!current()) return;
      setState('error');
      setMessage('Unable to load your dashboard. Check your connection and retry.');
    }
  }, []);

  useFocusEffect(useCallback(() => {
    focused.current = true;
    void load();
    // Returning from the background on mobile must re-check the session.
    const appSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void load();
      } else {
        ++generation.current;
        setIdentity(null);
        setState('loading');
      }
    });
    const { data: authSubscription } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT' || event === 'USER_UPDATED' || event === 'SIGNED_IN') {
        ++generation.current;
        setIdentity(null);
        if (event === 'SIGNED_OUT') {
          setState('expired');
          setMessage('You are signed out. Please log in again.');
        } else {
          setState('loading');
          // Auth calls must not run synchronously inside its change callback.
          setTimeout(() => { if (focused.current) void load(); }, 0);
        }
      }
    });
    return () => {
      focused.current = false;
      ++generation.current;
      appSubscription.remove();
      authSubscription.subscription.unsubscribe();
      setIdentity(null);
    };
  }, [load]));

  const openLogout = () => {
    if (isLoggingOut) return;
    setLogoutError('');
    setConfirmingLogout(true);
  };

  const closeLogout = () => {
    if (signingOut.current) return;
    setConfirmingLogout(false);
    setLogoutError('');
  };

  const confirmLogout = async () => {
    if (signingOut.current) return;
    signingOut.current = true;
    setIsLoggingOut(true);
    setLogoutError('');
    try {
      // Existing Supabase sign-out path, identical to the donor/beneficiary screens.
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      setConfirmingLogout(false);
      router.replace('/login');
    } catch (error) {
      // Stay signed in and keep the dialog open so the admin can retry.
      setLogoutError(
        error instanceof Error && error.message
          ? error.message
          : 'Sign out failed. Check your connection and try again.',
      );
    } finally {
      signingOut.current = false;
      setIsLoggingOut(false);
    }
  };

  const roleLabel = identity?.role === 'super_admin' ? 'Super administrator' : 'Administrator';


  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom', 'left', 'right']}>
      <Stack.Screen options={{ title: 'Admin' }} />

      {state === 'loading' ? (
        <View style={styles.centered}>
          <ActivityIndicator color={DesignColors.primary} accessibilityLabel="Loading dashboard" />
          <Text style={styles.centeredText}>Checking access...</Text>
        </View>
      ) : state === 'ready' && identity ? (
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {/* Header: identity, role, logout entry point */}
          <View style={styles.header}>
            <View style={styles.avatar} accessible={false}>
              <Text style={styles.avatarText}>{toInitials(identity.full_name)}</Text>
            </View>
            <View style={styles.headerText}>
              <Text style={styles.eyebrow}>Signed in as</Text>
              <Text style={styles.title} accessibilityRole="header" numberOfLines={2}>
                {identity.full_name}
              </Text>
              <View style={styles.badgeRow}>
                <StatusBadge status="active" label={roleLabel} />
              </View>
            </View>
          </View>

          {/* Quick actions: only implemented destinations */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle} accessibilityRole="header">Quick actions</Text>
            <AppCard style={styles.noPadding}>
              <View style={styles.cardBody}>
                <ListRow
                  title="Donor verification"
                  subtitle="Review pending donor registrations"
                  onPress={() => router.push('/admin-verification' as Href)}
                />
              </View>
            </AppCard>
            {identity.role === 'super_admin' && (
              <AppCard style={styles.noPadding}>
                <View style={styles.cardBody}>
                  <ListRow
                    title="Admin management"
                    subtitle="Appoint or revoke administrator access"
                    onPress={() => router.replace('/super-admin-dashboard')}
                  />
                </View>
              </AppCard>
            )}
          </View>

          {/* What this account can do */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle} accessibilityRole="header">Your access</Text>
            <AppCard>
              <View style={styles.definitionRow}>
                <Text style={styles.definitionLabel}>Role</Text>
                <Text style={styles.definitionValue}>{roleLabel}</Text>
              </View>
              <View style={styles.divider} />
              <View style={styles.definitionRow}>
                <Text style={styles.definitionLabel}>Account status</Text>
                <StatusBadge status="active" />
              </View>
              <View style={styles.divider} />
              <Text style={styles.bodyText}>
                {identity.role === 'super_admin'
                  ? 'You can review donor registrations and manage administrator access.'
                  : 'You can review pending donor registrations and record approval or rejection decisions.'}
              </Text>
            </AppCard>
          </View>

          {/* Approved informational content (documented facts only) */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle} accessibilityRole="header">About verification</Text>
            <AppCard>
              <View style={styles.infoHeading}>
                <SymbolView
                  name={{ ios: 'checkmark.shield', android: 'verified_user', web: 'verified_user' }}
                  size={20}
                  tintColor={DesignColors.primary}
                />
                <Text style={styles.cardTitle}>What approval means</Text>
              </View>
              <Text style={styles.bodyText}>
                Approval is an administrative review of a registration. It does not establish
                medical fitness or blood safety, and it does not change the donor's
                availability.
              </Text>
            </AppCard>

            <AppCard>
              <View style={styles.infoHeading}>
                <SymbolView
                  name={{ ios: 'person.crop.circle.badge.questionmark', android: 'person', web: 'person' }}
                  size={20}
                  tintColor={DesignColors.primary}
                />
                <Text style={styles.cardTitle}>Information shown in the queue</Text>
              </View>
              <Text style={styles.bodyText}>
                The pending queue shows the donor's name, blood group, age, district,
                thana, local area and registration date. Contact details, photos and exact
                dates of birth are intentionally excluded.
              </Text>
            </AppCard>

            <AppCard>
              <View style={styles.infoHeading}>
                <SymbolView
                  name={{ ios: 'arrow.triangle.2.circlepath', android: 'fact_check', web: 'fact_check' }}
                  size={20}
                  tintColor={DesignColors.primary}
                />
                <Text style={styles.cardTitle}>Working a shared queue</Text>
              </View>
              <Text style={styles.bodyText}>
                Several administrators can review the same queue. If another administrator has
                already decided on a registration, your decision is rejected as no longer
                pending and the queue reloads from the first page.
              </Text>
            </AppCard>
          </View>

          {/* Logout entry point */}
          <View style={styles.section}>
            <AppButton
              label="Log out"
              variant="outline"
              accessibilityLabel={`Log out of ${identity.full_name}`}
              onPress={openLogout}
            />
          </View>
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <EmptyState
            icon={{ ios: 'exclamationmark.triangle', android: 'error', web: 'error' }}
            title={
              state === 'unauthorized' ? 'Access denied' :
              state === 'expired' ? 'Login required' : 'Unable to load dashboard'
            }
            description={message}
            action={
              <AppButton
                label={state === 'expired' || state === 'unauthorized' ? 'Go to login' : 'Retry'}
                variant="primary"
                onPress={() => {
                  if (state === 'expired' || state === 'unauthorized') {
                    void router.replace('/login');
                  } else {
                    void load();
                  }
                }}
              />
            }
          />
        </ScrollView>
      )}


      {/* Logout confirmation. A Modal (not Alert) because Alert.alert is a
          no-op in react-native-web, and logout must be confirmed on web too. */}
      <Modal
        visible={confirmingLogout}
        transparent
        animationType="fade"
        onRequestClose={closeLogout}
      >
        <View style={styles.overlay}>
          <View style={styles.dialog} accessibilityViewIsModal>
            <Text style={styles.dialogTitle} accessibilityRole="header">Log out?</Text>
            <Text style={styles.bodyText}>
              You will be returned to the login screen and will need to sign in again to review
              donor registrations.
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
                style={styles.dialogButton}
              />
              <AppButton
                label="Cancel"
                variant="outline"
                disabled={isLoggingOut}
                onPress={closeLogout}
                style={styles.dialogButton}
              />
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Dismiss and stay signed in"
              disabled={isLoggingOut}
              onPress={closeLogout}
              style={styles.overlayDismiss}
            >
              <Text style={styles.overlayDismissText}>Keep me signed in</Text>
            </Pressable>
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
    paddingTop: Space.lg,
    // Clearance for the bottom tab bar.
    paddingBottom: Space.xxxl,
    gap: Space.xxl,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.md,
    padding: Space.lg,
  },
  centeredText: {
    fontSize: TypeScale.body,
    color: DesignColors.textMuted,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
  },
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
    fontSize: TypeScale.subtitle,
    fontWeight: FontWeight.bold,
    color: DesignColors.primaryDeep,
  },
  headerText: {
    flex: 1,
    gap: Space.xxs,
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
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.sm,
    marginTop: Space.xs,
  },

  section: { gap: Space.md },
  sectionTitle: {
    fontSize: TypeScale.title,
    fontWeight: FontWeight.bold,
    color: DesignColors.text,
  },
  // Let `ListRow` own the inner padding inside a card.
  noPadding: { padding: 0 },
  cardBody: {
    paddingHorizontal: Space.lg,
  },

  infoHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    marginBottom: Space.sm,
  },
  cardTitle: {
    fontSize: TypeScale.bodyLarge,
    fontWeight: FontWeight.semibold,
    color: DesignColors.text,
    flexShrink: 1,
  },
  bodyText: {
    fontSize: TypeScale.body,
    lineHeight: 22,
    color: DesignColors.textSecondary,
  },

  definitionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.md,
    minHeight: 32,
  },
  definitionLabel: {
    fontSize: TypeScale.body,
    color: DesignColors.textMuted,
  },
  definitionValue: {
    fontSize: TypeScale.body,
    fontWeight: FontWeight.semibold,
    color: DesignColors.text,
    flexShrink: 1,
    textAlign: 'right',
  },
  divider: {
    height: Layout.hairline,
    backgroundColor: DesignColors.border,
    marginVertical: Space.md,
  },

  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(17, 24, 39, 0.5)',
    padding: Space.lg,
  },
  dialog: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: DesignColors.surface,
    borderRadius: Radii.xl,
    padding: Space.xl,
    gap: Space.md,
  },
  dialogTitle: {
    fontSize: TypeScale.title,
    fontWeight: FontWeight.bold,
    color: DesignColors.text,
  },
  dialogActions: {
    gap: Space.sm,
    marginTop: Space.xs,
  },
  dialogButton: {
    alignSelf: 'stretch',
  },
  error: {
    fontSize: TypeScale.small,
    lineHeight: 20,
    color: DesignColors.errorText,
  },
  overlayDismiss: {
    alignSelf: 'center',
    paddingVertical: Space.sm,
  },
  overlayDismissText: {
    fontSize: TypeScale.small,
    fontWeight: FontWeight.medium,
    color: DesignColors.textMuted,
  },
});
