import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Href, useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';

import { AppButton, AppCard, StatusBadge } from '../../components/ui';
import { DesignColors, FontWeight, Layout, Radii, Space, TypeScale } from '../../constants/design-tokens';

import {
  DONATION_WORKFLOW_SERVICE_ACTIVE,
  DONATION_WORKFLOW_SERVICE_MESSAGE,
  DonationStatus,
  FEELING_OPTIONS,
  Feeling,
  donorEndDonation,
  donorMarkReachedLocation,
  donorRecordReachedHomeSafely,
  donorStartDonation,
  verifyDonationWorkflowAccess,
} from '../../lib/donation-workflow';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value: unknown): value is string => typeof value === 'string' && uuidPattern.test(value);
const isStatus = (value: unknown): value is DonationStatus =>
  value === 'selected' || value === 'reached_location' || value === 'donation_started' ||
  value === 'donation_ended' || value === 'reached_home_safely';

const STATUS_LABELS: Record<DonationStatus, string> = {
  selected: 'Accepted — head to the location',
  reached_location: 'You have reached the location',
  donation_started: 'Donation in progress',
  donation_ended: 'Donation complete',
  reached_home_safely: 'Home safely — cycle complete',
};

type NextAction = { label: string; confirmTitle: string; confirmText: string };

const NEXT_ACTION: Partial<Record<DonationStatus, NextAction>> = {
  selected: {
    label: 'I have reached the location',
    confirmTitle: 'Reached the location?',
    confirmText: 'This records that you have arrived at the donation location.',
  },
  reached_location: {
    label: 'Start donation',
    confirmTitle: 'Start the donation?',
    confirmText: 'This records that the donation has started.',
  },
  donation_started: {
    label: 'End donation',
    confirmTitle: 'End the donation?',
    confirmText: 'This records that the blood donation is complete and starts your four-month recovery period.',
  },
};

export default function ActiveDonationScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ engagement_id?: string | string[]; status?: string | string[] }>();
  const engagementId = useMemo(() => {
    const raw = Array.isArray(params.engagement_id) ? params.engagement_id[0] : params.engagement_id;
    return raw ?? null;
  }, [params.engagement_id]);
  const initialStatus = useMemo<DonationStatus>(() => {
    const raw = Array.isArray(params.status) ? params.status[0] : params.status;
    return isStatus(raw) ? raw : 'selected';
  }, [params.status]);

  const [status, setStatus] = useState<DonationStatus>(initialStatus);
  const [feeling, setFeeling] = useState<Feeling | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [followUpDueAt, setFollowUpDueAt] = useState<string | null>(null);

  const run = useCallback(
    async (label: string, action: () => Promise<DonationStatus>) => {
      if (isSubmitting || !DONATION_WORKFLOW_SERVICE_ACTIVE || !isUuid(engagementId)) return;
      setIsSubmitting(true);
      setError(null);
      try {
        await verifyDonationWorkflowAccess();
        const next = await action();
        setStatus(next);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : `Unable to update: ${label}.`);
      } finally {
        setIsSubmitting(false);
      }
    },
    [engagementId, isSubmitting],
  );

  const confirm = (action: NextAction, runAction: () => void) => {
    Alert.alert(action.confirmTitle, action.confirmText, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm', onPress: runAction },
    ]);
  };

  const transition = () => {
    const action = NEXT_ACTION[status];
    if (!action || !engagementId) return;
    confirm(action, () => {
      void run(action.label, async () => {
        if (status === 'selected') return (await donorMarkReachedLocation(engagementId)).status;
        if (status === 'reached_location') return (await donorStartDonation(engagementId)).status;
        return (await donorEndDonation(engagementId)).status;
      });
    });
  };

  const recordHomeSafely = () => {
    if (!engagementId || !feeling) return;
    confirm(
      {
        label: 'I have reached home safely',
        confirmTitle: 'Reached home safely?',
        confirmText: 'This completes the donation cycle and starts the two-day follow-up timer.',
      },
      () => {
        void run('reached home safely', async () => {
          const result = await donorRecordReachedHomeSafely(engagementId, feeling);
          setFollowUpDueAt(result.follow_up_due_at);
          return result.status;
        });
      },
    );
  };

  const openFollowup = () => {
    if (!engagementId) return;
    router.push({
      pathname: '/donation-followup',
      params: followUpDueAt
        ? { engagement_id: engagementId, follow_up_due_at: followUpDueAt }
        : { engagement_id: engagementId },
    } as unknown as Href);
  };

  if (!isUuid(engagementId)) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.center}>
          <Text style={styles.error}>This donation link is invalid. Open your donation from the request list.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View style={styles.headerIcon} accessible={false}>
            <SymbolView
              name={{ ios: 'drop.fill', android: 'water_drop', web: 'water_drop' }}
              size={23}
              tintColor={DesignColors.primary}
            />
          </View>
          <View style={styles.headerText}>
            <Text style={styles.eyebrow}>Donor journey</Text>
            <Text style={styles.title} accessibilityRole="header">Active Donation</Text>
            <Text style={styles.description}>Track each step. Updates are confirmed by the server.</Text>
          </View>
        </View>

        <AppCard style={styles.statusCard}>
          <Text style={styles.sectionLabel}>CURRENT STATUS</Text>
          <StatusBadge status={status} label={STATUS_LABELS[status]} />
          <View style={styles.progressTrack} accessible={false}>
            {(['selected', 'reached_location', 'donation_started', 'donation_ended', 'reached_home_safely'] as const).map((step, index) => {
              const currentIndex = ['selected', 'reached_location', 'donation_started', 'donation_ended', 'reached_home_safely'].indexOf(status);
              return <View key={step} style={[styles.progressStep, index <= currentIndex && styles.progressStepComplete]} />;
            })}
          </View>
          <Text style={styles.statusDescription}>{STATUS_LABELS[status]}</Text>
        </AppCard>

        {!DONATION_WORKFLOW_SERVICE_ACTIVE && <Notice />}
        {error !== null && (
          <AppCard style={styles.errorCard}>
            <Text style={styles.errorTitle}>Update not confirmed</Text>
            <Text style={styles.error}>{error}</Text>
          </AppCard>
        )}

        {DONATION_WORKFLOW_SERVICE_ACTIVE && status !== 'reached_home_safely' && status !== 'donation_ended' && NEXT_ACTION[status] && (
          <AppButton
            label={NEXT_ACTION[status]!.label}
            variant="primary"
            loading={isSubmitting}
            disabled={isSubmitting}
            onPress={transition}
          />
        )}

        {DONATION_WORKFLOW_SERVICE_ACTIVE && status === 'donation_ended' && (
          <AppCard style={styles.actionCard}>
            <Text style={styles.cardTitle} accessibilityRole="header">How are you feeling now?</Text>
            <Text style={styles.supportingText}>Choose the option that best describes how you feel.</Text>
            {FEELING_OPTIONS.map((option) => (
              <Pressable
                key={option.value}
                style={({ pressed }) => [styles.feelingOption, feeling === option.value && styles.feelingSelected, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityState={{ selected: feeling === option.value, disabled: isSubmitting }}
                disabled={isSubmitting}
                onPress={() => setFeeling(option.value)}
              >
                <Text style={[styles.feelingText, feeling === option.value && styles.feelingTextSelected]}>{option.label}</Text>
                {feeling === option.value && (
                  <SymbolView name={{ ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' }} size={20} tintColor={DesignColors.primary} />
                )}
              </Pressable>
            ))}
            <AppButton
              label="I have reached home safely"
              variant="primary"
              loading={isSubmitting}
              disabled={isSubmitting || !feeling}
              onPress={recordHomeSafely}
            />
          </AppCard>
        )}

        {status === 'reached_home_safely' && (
          <AppCard style={styles.completionCard}>
            <View style={styles.completionIcon} accessible={false}>
              <SymbolView name={{ ios: 'checkmark', android: 'check', web: 'check' }} size={22} tintColor={DesignColors.successText} />
            </View>
            <Text style={styles.cardTitle} accessibilityRole="header">Donation cycle complete</Text>
            <Text style={styles.supportingText}>A two-day wellbeing follow-up becomes available 48 hours after you reached home safely.</Text>
            {DONATION_WORKFLOW_SERVICE_ACTIVE && (
              <AppButton label="Open Follow-up" variant="primary" onPress={openFollowup} />
            )}
          </AppCard>
        )}

        <View style={styles.disclaimerRow}>
          <SymbolView name={{ ios: 'location.slash', android: 'location_off', web: 'location_off' }} size={16} tintColor={DesignColors.textMuted} />
          <Text style={styles.disclaimer}>Status updates are workflow states only. No location tracking is used.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Notice() {
  return (
    <View style={styles.notice} accessibilityLiveRegion="polite">
      <Text style={styles.noticeTitle}>Service Not Available</Text>
      <Text style={styles.noticeText}>{DONATION_WORKFLOW_SERVICE_MESSAGE}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: DesignColors.background },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Space.lg,
  },
  content: {
    width: '100%', maxWidth: Layout.maxContentWidth, alignSelf: 'center',
    paddingHorizontal: Space.lg, paddingTop: Space.lg, paddingBottom: Space.xxxl, gap: Space.md,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: Space.md, marginBottom: Space.xs },
  headerIcon: {
    width: 48, height: 48, borderRadius: Radii.full, alignItems: 'center', justifyContent: 'center',
    backgroundColor: DesignColors.primarySoft, borderWidth: Layout.hairline, borderColor: DesignColors.primaryBorder,
  },
  headerText: { flex: 1, gap: Space.xxs },
  eyebrow: { fontSize: TypeScale.caption, fontWeight: FontWeight.semibold, color: DesignColors.primary, textTransform: 'uppercase' },
  title: { fontSize: TypeScale.heading, fontWeight: FontWeight.bold, lineHeight: 30, color: DesignColors.text },
  description: { fontSize: TypeScale.small, lineHeight: 20, color: DesignColors.textMuted },
  statusCard: { gap: Space.md },
  sectionLabel: { fontSize: TypeScale.caption, fontWeight: FontWeight.semibold, letterSpacing: 0.6, color: DesignColors.textMuted },
  progressTrack: { flexDirection: 'row', gap: Space.xs, marginTop: Space.xs },
  progressStep: { flex: 1, height: 5, borderRadius: Radii.full, backgroundColor: DesignColors.border },
  progressStepComplete: { backgroundColor: DesignColors.primary },
  statusDescription: { fontSize: TypeScale.body, fontWeight: FontWeight.medium, color: DesignColors.textSecondary },
  actionCard: { gap: Space.md },
  cardTitle: { fontSize: TypeScale.subtitle, fontWeight: FontWeight.bold, lineHeight: 26, color: DesignColors.text },
  supportingText: { fontSize: TypeScale.small, lineHeight: 20, color: DesignColors.textMuted },
  feelingOption: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.md,
    minHeight: Layout.minTouchTarget, paddingHorizontal: Space.md, paddingVertical: Space.sm,
    borderWidth: Layout.hairline, borderColor: DesignColors.border, borderRadius: Radii.md, backgroundColor: DesignColors.surface,
  },
  feelingSelected: { borderColor: DesignColors.primary, backgroundColor: DesignColors.primarySoft },
  feelingText: { flex: 1, fontSize: TypeScale.body, fontWeight: FontWeight.medium, color: DesignColors.textSecondary },
  feelingTextSelected: { fontWeight: FontWeight.semibold, color: DesignColors.primaryDeep },
  pressed: { opacity: 0.72 },
  completionCard: { alignItems: 'flex-start', gap: Space.md },
  completionIcon: {
    width: 48, height: 48, borderRadius: Radii.full, alignItems: 'center', justifyContent: 'center',
    backgroundColor: DesignColors.successSurface, borderWidth: Layout.hairline, borderColor: DesignColors.successBorder,
  },
  notice: {
    gap: Space.sm, padding: Space.md, borderRadius: Radii.lg, borderWidth: Layout.hairline,
    borderColor: DesignColors.warningBorder, backgroundColor: DesignColors.warningSurface,
  },
  noticeTitle: { fontSize: TypeScale.body, fontWeight: FontWeight.bold, color: DesignColors.warning },
  noticeText: { fontSize: TypeScale.small, lineHeight: 20, color: DesignColors.warning },
  errorCard: { borderColor: DesignColors.errorBorder, backgroundColor: DesignColors.errorSurface },
  errorTitle: { fontSize: TypeScale.body, fontWeight: FontWeight.semibold, color: DesignColors.errorText },
  error: { fontSize: TypeScale.small, lineHeight: 20, color: DesignColors.errorText },
  disclaimerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Space.sm, paddingHorizontal: Space.xs, marginTop: Space.xs },
  disclaimer: { flex: 1, fontSize: TypeScale.caption, lineHeight: 18, color: DesignColors.textMuted },
});
