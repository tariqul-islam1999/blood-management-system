import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Href, useLocalSearchParams, useRouter } from 'expo-router';

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
        <Text style={styles.title}>Active Donation</Text>
        <Text style={styles.description}>Track the donation one step at a time. Updates are confirmed by the server.</Text>

        <View style={styles.card}>
          <Text style={styles.statusLabel}>Current status</Text>
          <Text style={styles.status}>{STATUS_LABELS[status]}</Text>
        </View>

        {!DONATION_WORKFLOW_SERVICE_ACTIVE && <Notice />}
        {error !== null && <Text style={styles.error}>{error}</Text>}

        {DONATION_WORKFLOW_SERVICE_ACTIVE && status !== 'reached_home_safely' && status !== 'donation_ended' && NEXT_ACTION[status] && (
          <Pressable
            style={[styles.primaryButton, isSubmitting && styles.disabled]}
            disabled={isSubmitting}
            accessibilityRole="button"
            onPress={transition}
          >
            {isSubmitting ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryText}>{NEXT_ACTION[status]!.label}</Text>}
          </Pressable>
        )}

        {DONATION_WORKFLOW_SERVICE_ACTIVE && status === 'donation_ended' && (
          <View style={styles.card}>
            <Text style={styles.feelingTitle}>How are you feeling now?</Text>
            {FEELING_OPTIONS.map((option) => (
              <Pressable
                key={option.value}
                style={[styles.feelingOption, feeling === option.value && styles.feelingSelected]}
                accessibilityRole="button"
                accessibilityState={{ selected: feeling === option.value }}
                disabled={isSubmitting}
                onPress={() => setFeeling(option.value)}
              >
                <Text style={[styles.feelingText, feeling === option.value && styles.feelingTextSelected]}>{option.label}</Text>
              </Pressable>
            ))}
            <Pressable
              style={[styles.primaryButton, (isSubmitting || !feeling) && styles.disabled]}
              disabled={isSubmitting || !feeling}
              accessibilityRole="button"
              onPress={recordHomeSafely}
            >
              <Text style={styles.primaryText}>{isSubmitting ? 'Updating...' : 'I have reached home safely'}</Text>
            </Pressable>
          </View>
        )}

        {status === 'reached_home_safely' && (
          <View style={styles.card}>
            <Text style={styles.statusLabel}>Donation cycle complete</Text>
            <Text style={styles.detail}>A two-day wellbeing follow-up becomes available 48 hours after you reached home safely.</Text>
            {DONATION_WORKFLOW_SERVICE_ACTIVE && (
              <Pressable style={styles.primaryButton} accessibilityRole="button" onPress={openFollowup}>
                <Text style={styles.primaryText}>Open Follow-up</Text>
              </Pressable>
            )}
          </View>
        )}

        <Text style={styles.disclaimer}>Status updates are workflow states only. No location tracking is used.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Notice() {
  return (
    <View style={styles.notice}>
      <Text style={styles.noticeTitle}>Service Not Available</Text>
      <Text style={styles.noticeText}>{DONATION_WORKFLOW_SERVICE_MESSAGE}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFF5F5' },
  content: { padding: 24, paddingBottom: 48 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 26, fontWeight: 'bold', color: '#991B1B' },
  description: { marginTop: 9, color: '#4B5563', lineHeight: 20 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 12, padding: 18, borderWidth: 1, borderColor: '#FECACA', marginTop: 16 },
  statusLabel: { fontSize: 12, fontWeight: '700', color: '#6B7280' },
  status: { fontSize: 18, fontWeight: 'bold', color: '#991B1B', marginTop: 6 },
  detail: { color: '#4B5563', marginTop: 9, lineHeight: 20 },
  feelingTitle: { fontSize: 16, fontWeight: 'bold', color: '#991B1B', marginBottom: 8 },
  feelingOption: { borderWidth: 1, borderColor: '#FCA5A5', borderRadius: 9, padding: 14, marginTop: 10, minHeight: 48, justifyContent: 'center' },
  feelingSelected: { backgroundColor: '#DC2626', borderColor: '#DC2626' },
  feelingText: { color: '#991B1B', fontWeight: '600' },
  feelingTextSelected: { color: '#FFFFFF' },
  primaryButton: { marginTop: 18, backgroundColor: '#DC2626', padding: 15, borderRadius: 10, alignItems: 'center', minHeight: 48, justifyContent: 'center' },
  primaryText: { color: '#FFFFFF', fontWeight: 'bold' },
  disabled: { opacity: 0.55 },
  notice: { marginTop: 16, backgroundColor: '#FEF3C7', padding: 16, borderRadius: 12, borderWidth: 1, borderColor: '#FDE68A' },
  noticeTitle: { color: '#92400E', fontWeight: 'bold', fontSize: 16 },
  noticeText: { color: '#92400E', marginTop: 7, lineHeight: 20 },
  error: { color: '#B91C1C', marginTop: 16, lineHeight: 21 },
  disclaimer: { marginTop: 20, color: '#6B7280', fontSize: 13, lineHeight: 19 },
});
