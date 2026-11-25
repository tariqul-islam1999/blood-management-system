import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { SymbolView } from 'expo-symbols';

import { AppButton, AppCard, EmptyState, StatusBadge } from '../../components/ui';
import {
  DesignColors,
  FontWeight,
  Layout,
  Radii,
  Space,
  TypeScale,
} from '../../constants/design-tokens';

import {
  BLOOD_REQUEST_SERVICE_ACTIVE,
  BLOOD_REQUEST_SERVICE_MESSAGE,
  BloodRequestError,
  MyBloodRequest,
  beneficiaryCancelBloodRequest,
  beneficiaryListMyBloodRequests,
  verifyBloodRequestAccess,
} from '../../lib/blood-requests';

export default function MyBloodRequestsScreen() {
  const [requests, setRequests] = useState<MyBloodRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const activeRequests = requests.filter(
    (request) => request.status === 'open'
  );

  const load = useCallback(async () => {
    setIsLoading(true); setError(null);
    try {
      await verifyBloodRequestAccess('beneficiary');
      if (!BLOOD_REQUEST_SERVICE_ACTIVE) return;
      setRequests(await beneficiaryListMyBloodRequests());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load your requests.');
    } finally { setIsLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const cancel = (request: MyBloodRequest) => {
    if (cancellingId || !BLOOD_REQUEST_SERVICE_ACTIVE) return;
    Alert.alert('Cancel Blood Request?', 'This request will no longer accept donor interest.', [
      { text: 'Keep Request', style: 'cancel' },
      { text: 'Cancel Request', style: 'destructive', onPress: () => void confirmCancel(request.request_id) },
    ]);
  };
  const confirmCancel = async (requestId: string) => {
    setCancellingId(requestId);
    try {
      await beneficiaryCancelBloodRequest(requestId);
      Alert.alert('Request Cancelled', 'Your blood request was cancelled.');
      await load();
    } catch (caught) {
      Alert.alert('Cancellation Not Confirmed', caught instanceof Error ? caught.message : 'Unable to cancel this request.');
    } finally { setCancellingId(null); }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>

        <View style={styles.header}>
          <View style={styles.headerIcon} accessible={false}>
            <SymbolView
              name={{ ios: 'list.bullet.rectangle', android: 'receipt_long', web: 'receipt_long' }}
              size={23}
              tintColor={DesignColors.primary}
            />
          </View>
          <View style={styles.headerText}>
            <Text style={styles.eyebrow}>Blood requests</Text>
            <Text style={styles.title} accessibilityRole="header">My Blood Requests</Text>
            <Text style={styles.description}>
              Active requests you created. Cancelled requests leave this list.
            </Text>
          </View>
        </View>

        {!BLOOD_REQUEST_SERVICE_ACTIVE ? (
          <Notice />
        ) : isLoading ? (
          <Loading />
        ) : error ? (
          <AppCard>
            <EmptyState
              icon={{ ios: 'exclamationmark.triangle', android: 'error', web: 'error' }}
              title="Unable to load requests"
              description={error}
              action={<AppButton label="Try Again" variant="primary" onPress={() => void load()} />}
            />
          </AppCard>
        ) : activeRequests.length === 0 ? (
          <AppCard>
            <EmptyState
              icon={{ ios: 'tray', android: 'inbox', web: 'inbox' }}
              title="No Requests"
              description="Active requests you create will appear here."
              action={<AppButton label="Refresh" variant="primary" onPress={() => void load()} />}
            />
          </AppCard>
        ) : (
          activeRequests.map((request) => {
            const isCancelling = cancellingId === request.request_id;
            return (
              <AppCard key={request.request_id} style={styles.requestCard}>
                <View style={styles.cardHeader}>
                  <View style={styles.bloodGroupPill}>
                    <Text style={styles.bloodGroup}>{request.blood_group}</Text>
                  </View>
                  <View style={styles.statusColumn}>
                    <StatusBadge
                      status={request.status}
                      label={request.status === 'open' ? 'Open' : 'Cancelled'}
                    />
                    <View style={styles.urgencyRow}>
                      <SymbolView
                        name={
                          request.urgency === 'urgent'
                            ? { ios: 'exclamationmark.triangle.fill', android: 'warning', web: 'warning' }
                            : { ios: 'clock', android: 'schedule', web: 'schedule' }
                        }
                        size={14}
                        tintColor={
                          request.urgency === 'urgent' ? DesignColors.errorText : DesignColors.textMuted
                        }
                      />
                      <Text
                        style={[
                          styles.urgencyText,
                          request.urgency === 'urgent' && styles.urgencyTextUrgent,
                        ]}
                      >
                        {request.urgency === 'urgent' ? 'Urgent' : 'Routine'}
                      </Text>
                    </View>
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
                    <Text style={styles.factValue}>{request.needed_by}</Text>
                  </View>
                  <View style={styles.factRow}>
                    <Text style={styles.factLabel}>Location</Text>
                    <Text style={styles.factValue} numberOfLines={2}>
                      {request.local_area}, {request.thana}, {request.district}
                    </Text>
                  </View>
                  <View style={styles.factRow}>
                    <Text style={styles.factLabel}>Donor interest</Text>
                    <Text style={styles.factValue}>
                      {request.interest_count} donor interest
                      {request.interest_count === 1 ? '' : 's'}
                    </Text>
                  </View>
                </View>

                {request.status === 'open' && (
                  <AppButton
                    label={isCancelling ? 'Cancelling...' : 'Cancel Request'}
                    variant="destructive"
                    loading={isCancelling}
                    disabled={cancellingId !== null}
                    accessibilityLabel={isCancelling ? 'Cancelling this request' : 'Cancel this blood request'}
                    onPress={() => cancel(request)}
                  />
                )}
              </AppCard>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Notice() {
  return (
    <View style={styles.notice} accessibilityLiveRegion="polite">
      <Text style={styles.noticeTitle}>Service Not Available</Text>
      <Text style={styles.noticeText}>{BLOOD_REQUEST_SERVICE_MESSAGE}</Text>
    </View>
  );
}

function Loading() {
  return (
    <View style={styles.loadingCard}>
      <ActivityIndicator
        size="large"
        color={DesignColors.primary}
        accessibilityLabel="Loading your blood requests"
      />
      <Text style={styles.mutedText}>Loading your requests...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: DesignColors.background },
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
  eyebrow: {
    fontSize: TypeScale.caption, fontWeight: FontWeight.semibold, color: DesignColors.primary,
    textTransform: 'uppercase',
  },
  title: { fontSize: TypeScale.heading, fontWeight: FontWeight.bold, lineHeight: 30, color: DesignColors.text },
  description: { fontSize: TypeScale.small, lineHeight: 20, color: DesignColors.textMuted },

  loadingCard: {
    alignItems: 'center', justifyContent: 'center', gap: Space.md, padding: Space.xxxl,
    backgroundColor: DesignColors.surface, borderRadius: Radii.lg,
    borderWidth: Layout.hairline, borderColor: DesignColors.border,
  },
  mutedText: { fontSize: TypeScale.body, color: DesignColors.textMuted },

  requestCard: { gap: Space.md },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Space.sm },
  bloodGroupPill: {
    minWidth: 68, alignItems: 'center', justifyContent: 'center',
    paddingVertical: Space.sm, paddingHorizontal: Space.md,
    borderRadius: Radii.md, backgroundColor: DesignColors.primarySoft,
    borderWidth: Layout.hairline, borderColor: DesignColors.primaryBorder,
  },
  bloodGroup: { fontSize: TypeScale.subtitle, fontWeight: FontWeight.bold, color: DesignColors.primaryDeep },
  statusColumn: { flexShrink: 1, alignItems: 'flex-end', gap: Space.xs },
  urgencyRow: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  urgencyText: { fontSize: TypeScale.caption, fontWeight: FontWeight.semibold, color: DesignColors.textMuted },
  urgencyTextUrgent: { color: DesignColors.errorText },

  factList: { gap: Space.sm },
  factRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    flexWrap: 'wrap', gap: Space.sm,
  },
  factLabel: { fontSize: TypeScale.small, color: DesignColors.textMuted },
  factValue: {
    flexShrink: 1, fontSize: TypeScale.body, fontWeight: FontWeight.semibold,
    color: DesignColors.text, textAlign: 'right',
  },

  notice: {
    gap: Space.sm, padding: Space.md, borderRadius: Radii.lg, borderWidth: Layout.hairline,
    borderColor: DesignColors.warningBorder, backgroundColor: DesignColors.warningSurface,
  },
  noticeTitle: { fontSize: TypeScale.body, fontWeight: FontWeight.bold, color: DesignColors.warning },
  noticeText: { fontSize: TypeScale.small, lineHeight: 20, color: DesignColors.warning },
});
