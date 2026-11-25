import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Href, useFocusEffect, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';

import {
  DONATION_WORKFLOW_SERVICE_ACTIVE,
  DonationWorkflowError,
  donorAcceptBloodRequest,
} from '../../lib/donation-workflow';

import {
  BLOOD_REQUEST_SERVICE_ACTIVE,
  BLOOD_REQUEST_SERVICE_MESSAGE,
  OpenBloodRequest,
  donorExpressInterest,
  donorListOpenBloodRequests,
  verifyBloodRequestAccess,
} from '../../lib/blood-requests';
import { AppButton, AppCard, EmptyState } from '../../components/ui';
import {
  DesignColors, FontWeight, Layout, Radii, Space, TypeScale,
} from '../../constants/design-tokens';

/**
 * Open blood requests for a donor.
 *
 * PRESENTATION ONLY. The access check, RPC wrappers, accept/interest
 * confirmation flows, error mapping and list contents are unchanged. The RPC
 * contract still omits beneficiary identity; nothing extra is displayed.
 */

const formatDate = (value: string): string => {
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleDateString() : value;
};

export default function OpenBloodRequestsScreen() {
  const router = useRouter();
  const [requests, setRequests] = useState<OpenBloodRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [interestId, setInterestId] = useState<string | null>(null);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true); setError(null);
    try {
      await verifyBloodRequestAccess('donor');
      if (!BLOOD_REQUEST_SERVICE_ACTIVE) return;
      setRequests(await donorListOpenBloodRequests());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load open requests.');
    } finally { setIsLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const accept = (request: OpenBloodRequest) => {
    if (acceptingId || !DONATION_WORKFLOW_SERVICE_ACTIVE) return;
    Alert.alert(
      'Accept This Request?',
      'Accepting means you will donate for this request. The beneficiary will then see your identity. You can have only one active donation at a time.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Accept', onPress: () => void confirmAccept(request.request_id) },
      ],
    );
  };
  const confirmAccept = async (requestId: string) => {
    setAcceptingId(requestId);
    try {
      const accepted = await donorAcceptBloodRequest(requestId);
      Alert.alert('Request Accepted', 'You have accepted this request. Continue with the donation steps.');
      router.push({
        pathname: '/active-donation',
        params: { engagement_id: accepted.engagement_id, status: accepted.status },
      } as unknown as Href);
    } catch (caught) {
      const message = caught instanceof DonationWorkflowError && caught.code === 'duplicate'
        ? 'This request already has a donation. Refresh the list.'
        : caught instanceof Error ? caught.message : 'Unable to accept this request.';
      Alert.alert('Acceptance Not Confirmed', message);
      await load();
    } finally { setAcceptingId(null); }
  };

  const expressInterest = (request: OpenBloodRequest) => {
    if (interestId || !BLOOD_REQUEST_SERVICE_ACTIVE || request.has_expressed_interest) return;
    Alert.alert('Express Interest?', 'This records your willingness to help. It is not a completed donation and does not confirm medical eligibility.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Express Interest', onPress: () => void confirmInterest(request.request_id) },
    ]);
  };
  const confirmInterest = async (requestId: string) => {
    setInterestId(requestId);
    try {
      await donorExpressInterest(requestId);
      Alert.alert('Interest Recorded', 'Your willingness to help was recorded. This is not a completed donation.');
      await load();
    } catch (caught) {
      Alert.alert('Interest Not Confirmed', caught instanceof Error ? caught.message : 'Unable to record your interest.');
    } finally { setInterestId(null); }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>

        <View style={styles.header}>
          <View style={styles.headerIcon}>
            <SymbolView
              name={{ ios: 'drop', android: 'water_drop', web: 'water_drop' }}
              size={22}
              tintColor={DesignColors.primary}
            />
          </View>
          <View style={styles.headerText}>
            <Text style={styles.title} accessibilityRole="header">Open Blood Requests</Text>
            <Text style={styles.description}>
              Only open, non-expired requests matching your blood group are shown. The server
              confirms eligibility.
            </Text>
          </View>
        </View>

        {!BLOOD_REQUEST_SERVICE_ACTIVE ? (
          <View style={styles.notice} accessibilityLiveRegion="polite">
            <Text style={styles.noticeTitle}>Service Not Available</Text>
            <Text style={styles.noticeText}>{BLOOD_REQUEST_SERVICE_MESSAGE}</Text>
          </View>
        ) : isLoading ? (
          <View style={styles.loadingCard}>
            <ActivityIndicator color={DesignColors.primary} accessibilityLabel="Loading open requests" />
            <Text style={styles.mutedText}>Loading open requests...</Text>
          </View>
        ) : error ? (
          <AppCard>
            <EmptyState
              icon={{ ios: 'exclamationmark.triangle', android: 'error', web: 'error' }}
              title="Unable to load requests"
              description={error}
              action={<AppButton label="Try Again" variant="primary" onPress={() => void load()} />}
            />
          </AppCard>
        ) : requests.length === 0 ? (
          <AppCard>
            <EmptyState
              icon={{ ios: 'tray', android: 'inbox', web: 'inbox' }}
              title="No matching open requests"
              description="Requests may be unavailable, expired, or not match your blood group."
              action={<AppButton label="Refresh" variant="primary" onPress={() => void load()} />}
            />
          </AppCard>
        ) : (
          requests.map((request) => {
            const isAccepting = acceptingId === request.request_id;
            const isRecording = interestId === request.request_id;
            return (
              <AppCard key={request.request_id} style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={styles.bloodGroupPill}>
                    <Text style={styles.bloodGroup}>{request.blood_group}</Text>
                  </View>
                  <View style={[
                    styles.urgencyBadge,
                    request.urgency === 'urgent' ? styles.urgencyBadgeUrgent : styles.urgencyBadgeRoutine,
                  ]}>
                    <Text style={[
                      styles.urgencyText,
                      request.urgency === 'urgent' ? styles.urgencyTextUrgent : styles.urgencyTextRoutine,
                    ]}>
                      {request.urgency === 'urgent' ? 'Urgent' : 'Routine'}
                    </Text>
                  </View>
                </View>

                <View style={styles.factList}>
                  <View style={styles.factRow}>
                    <Text style={styles.factLabel}>Units</Text>
                    <Text style={styles.factValue}>
                      {request.units_requested} unit{request.units_requested === 1 ? '' : 's'}
                    </Text>
                  </View>
                  <View style={styles.factRow}>
                    <Text style={styles.factLabel}>Needed by</Text>
                    <Text style={styles.factValue}>{formatDate(request.needed_by)}</Text>
                  </View>
                  <View style={styles.factRow}>
                    <Text style={styles.factLabel}>Area</Text>
                    <Text style={styles.factValue} numberOfLines={2}>
                      {request.local_area}, {request.thana}, {request.district}
                    </Text>
                  </View>
                </View>

                {request.has_expressed_interest ? (
                  DONATION_WORKFLOW_SERVICE_ACTIVE ? (
                    <AppButton
                      label={isAccepting ? 'Accepting...' : 'Accept Request'}
                      variant="primary"
                      loading={isAccepting}
                      disabled={acceptingId !== null}
                      accessibilityLabel={
                        isAccepting ? 'Accepting this request' : 'Accept this blood request'
                      }
                      onPress={() => accept(request)}
                    />
                  ) : (
                    <View style={styles.interestedRow}>
                      <SymbolView
                        name={{ ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' }}
                        size={18}
                        tintColor={DesignColors.successText}
                      />
                      <Text style={styles.interestedText}>Interest recorded</Text>
                    </View>
                  )
                ) : (
                  <AppButton
                    label={isRecording ? 'Recording Interest...' : 'Express Interest'}
                    variant={isRecording ? 'secondary' : 'primary'}
                    loading={isRecording}
                    disabled={interestId !== null}
                    accessibilityLabel={
                      isRecording ? 'Recording your interest' : 'Express interest in this request'
                    }
                    onPress={() => expressInterest(request)}
                  />
                )}
              </AppCard>
            );
          })
        )}

        {BLOOD_REQUEST_SERVICE_ACTIVE && (
          <Text style={styles.disclaimer}>
            Expressing interest means willingness to help only. It does not complete a donation or
            confirm medical eligibility.
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: DesignColors.background },
  content: {
    width: '100%',
    maxWidth: Layout.maxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Space.lg,
    paddingTop: Space.lg,
    paddingBottom: Space.xxxl,
    gap: Space.md,
  },

  header: { flexDirection: 'row', alignItems: 'center', gap: Space.md, marginBottom: Space.xs },
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
  description: {
    fontSize: TypeScale.small,
    lineHeight: 20,
    color: DesignColors.textMuted,
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
  mutedText: { fontSize: TypeScale.body, color: DesignColors.textMuted },

  notice: {
    gap: Space.sm,
    padding: Space.md,
    borderRadius: Radii.lg,
    borderWidth: Layout.hairline,
    borderColor: DesignColors.warningBorder,
    backgroundColor: DesignColors.warningSurface,
  },
  noticeTitle: {
    fontSize: TypeScale.body,
    fontWeight: FontWeight.bold,
    color: DesignColors.warning,
  },
  noticeText: {
    fontSize: TypeScale.small,
    lineHeight: 20,
    color: DesignColors.warning,
  },

  card: { gap: Space.md },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.sm,
  },
  bloodGroupPill: {
    minWidth: 64,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Space.sm,
    paddingHorizontal: Space.md,
    borderRadius: Radii.md,
    backgroundColor: DesignColors.primarySoft,
    borderWidth: Layout.hairline,
    borderColor: DesignColors.primaryBorder,
  },
  bloodGroup: {
    fontSize: TypeScale.subtitle,
    fontWeight: FontWeight.bold,
    color: DesignColors.primaryDeep,
  },

  urgencyBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: Space.sm,
    paddingVertical: Space.xxs,
    borderRadius: Radii.full,
    borderWidth: Layout.hairline,
  },
  urgencyBadgeUrgent: {
    backgroundColor: DesignColors.errorSurface,
    borderColor: DesignColors.errorBorder,
  },
  urgencyBadgeRoutine: {
    backgroundColor: DesignColors.successSurface,
    borderColor: DesignColors.successBorder,
  },
  urgencyText: { fontSize: TypeScale.caption, fontWeight: FontWeight.semibold },
  urgencyTextUrgent: { color: DesignColors.errorText },
  urgencyTextRoutine: { color: DesignColors.successText },

  factList: { gap: Space.sm },
  factRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Space.md,
    paddingVertical: Space.xs,
    borderBottomWidth: Layout.hairline,
    borderBottomColor: DesignColors.border,
  },
  factLabel: { fontSize: TypeScale.body, color: DesignColors.textMuted },
  factValue: {
    fontSize: TypeScale.body,
    fontWeight: FontWeight.medium,
    color: DesignColors.text,
    flexShrink: 1,
    textAlign: 'right',
  },

  interestedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.sm,
    minHeight: Layout.minTouchTarget,
    paddingHorizontal: Space.lg,
    borderRadius: Radii.md,
    backgroundColor: DesignColors.successSurface,
    borderWidth: Layout.hairline,
    borderColor: DesignColors.successBorder,
  },
  interestedText: {
    fontSize: TypeScale.body,
    fontWeight: FontWeight.semibold,
    color: DesignColors.successText,
  },

  disclaimer: {
    marginTop: Space.sm,
    fontSize: TypeScale.caption,
    lineHeight: 19,
    color: DesignColors.textMuted,
  },
});
