import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';

import { AppButton, AppCard, EmptyState } from '../../components/ui';
import {
  DesignColors, FontWeight, Layout, Radii, Space, TypeScale,
} from '../../constants/design-tokens';
import {
  DONOR_ELIGIBILITY_SERVICE_ACTIVE,
  DONOR_ELIGIBILITY_SERVICE_MESSAGE,
  DonationHistoryEntry,
  listMyDonationHistory,
} from '../../lib/donor-eligibility';

/**
 * Donor donation history (BMS Phase 3).
 *
 * PRESENTATION ONLY. Every value shown comes from the database:
 * - the total is `total_count` computed by `donor_list_donation_history`;
 * - each row is one `donor_donations` record (a completed donation);
 * - the location is the related engagement's blood-request area, or "-" when no
 *   engagement matches (admin-corrected or pre-workflow history). A missing
 *   location never hides a donation.
 *
 * No client-side history calculation: the count is not derived from the loaded
 * page, so pagination can never under-report it.
 */

const PAGE_SIZE = 20;

/** Bangladesh calendar date, as stored in `donor_donations.donated_on`. */
function formatDonationDate(value: string): string {
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleDateString() : value;
}

/** Location text, or an em dash when the history row has no engagement. */
function locationText(entry: DonationHistoryEntry): string {
  const parts = [entry.location_local_area, entry.location_thana, entry.location_district]
    .filter((part): part is string => typeof part === 'string' && part.trim() !== '');
  return parts.length > 0 ? parts.join(', ') : '—';
}

const SOURCE_LABELS: Record<DonationHistoryEntry['source'], string> = {
  donor: 'Recorded automatically when the donation ended',
  admin: 'Recorded by an administrator',
};

export default function DonationHistoryScreen() {
  const router = useRouter();
  const [entries, setEntries] = useState<DonationHistoryEntry[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guards against overlapping requests and stale responses after a refocus.
  const requestId = useRef(0);

  const loadPage = useCallback(async (offset: number, append: boolean) => {
    if (!DONOR_ELIGIBILITY_SERVICE_ACTIVE) {
      setEntries([]);
      setTotalCount(0);
      setIsLoading(false);
      return;
    }
    const request = ++requestId.current;
    if (append) setIsLoadingMore(true); else setIsLoading(true);
    setError(null);
    try {
      const page = await listMyDonationHistory(PAGE_SIZE, offset);
      if (request !== requestId.current) return;
      // An appended page can legitimately be empty (offset past the last row); the
      // RPC cannot report the total in that case, so keep the total already known
      // instead of overwriting it with the empty-page value. The initial page
      // always sets the total.
      if (!append || page.entries.length > 0) setTotalCount(page.total_count);
      setEntries((current) => (append ? [...current, ...page.entries] : page.entries));
    } catch (caught) {
      if (request !== requestId.current) return;
      if (!append) {
        setEntries([]);
        setTotalCount(0);
      }
      setError(caught instanceof Error ? caught.message : 'Unable to load your donation history.');
    } finally {
      if (request === requestId.current) {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void loadPage(0, false);
    return () => { ++requestId.current; };
  }, [loadPage]));

  const canLoadMore = DONOR_ELIGIBILITY_SERVICE_ACTIVE && error === null &&
    entries.length < totalCount;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <View style={styles.headerIcon} accessible={false}>
            <SymbolView
              name={{ ios: 'clock.arrow.circlepath', android: 'history', web: 'history' }}
              size={22}
              tintColor={DesignColors.primary}
            />
          </View>
          <View style={styles.headerText}>
            <Text style={styles.eyebrow}>Donor journey</Text>
            <Text style={styles.title} accessibilityRole="header">Donation History</Text>
            <Text style={styles.description}>
              Every completed donation recorded for your account, with the date and the blood
              request area it was recorded for.
            </Text>
          </View>
        </View>

        {!DONOR_ELIGIBILITY_SERVICE_ACTIVE && (
          <View style={styles.notice} accessibilityLiveRegion="polite">
            <Text style={styles.noticeTitle}>Service Not Available</Text>
            <Text style={styles.noticeText}>{DONOR_ELIGIBILITY_SERVICE_MESSAGE}</Text>
          </View>
        )}

        {DONOR_ELIGIBILITY_SERVICE_ACTIVE && (
          <>
            <AppCard>
              <Text style={styles.sectionLabel}>TOTAL COMPLETED DONATIONS</Text>
              <View style={styles.totalRow}>
                <Text
                  style={styles.totalValue}
                  accessibilityLabel={`Total completed donations: ${totalCount}`}
                >
                  {isLoading && totalCount === 0 ? '—' : totalCount}
                </Text>
                <Text style={styles.totalCaption}>
                  {totalCount === 1 ? 'completed donation' : 'completed donations'}
                </Text>
              </View>
              <Text style={styles.helperText}>
                Incomplete, cancelled or in-progress donations are never counted.
              </Text>
            </AppCard>

            {isLoading ? (
              <View style={styles.loadingCard}>
                <ActivityIndicator
                  color={DesignColors.primary}
                  accessibilityLabel="Loading donation history"
                />
                <Text style={styles.mutedText}>Loading your donation history...</Text>
              </View>
            ) : error !== null ? (
              <AppCard>
                <EmptyState
                  icon={{ ios: 'exclamationmark.triangle', android: 'error', web: 'error' }}
                  title="Unable to load history"
                  description={error}
                  action={
                    <AppButton
                      label="Try Again"
                      variant="primary"
                      onPress={() => void loadPage(0, false)}
                    />
                  }
                />
              </AppCard>
            ) : entries.length === 0 ? (
              <AppCard>
                <EmptyState
                  icon={{ ios: 'drop', android: 'bloodtype', web: 'bloodtype' }}
                  title="No donations yet"
                  description="A donation appears here automatically once a donation you made has been completed and recorded."
                />
              </AppCard>
            ) : (
              entries.map((entry) => (
                <AppCard key={entry.donation_id} style={styles.entryCard}>
                  <View style={styles.entryHeader}>
                    <Text style={styles.entryDate}>{formatDonationDate(entry.donated_on)}</Text>
                    {entry.source === 'admin' && (
                      <View style={styles.adminChip}>
                        <Text style={styles.adminChipText}>Admin recorded</Text>
                      </View>
                    )}
                  </View>
                  <View style={styles.factRow}>
                    <Text style={styles.factLabel}>Location</Text>
                    <Text style={styles.factValue} numberOfLines={2}>{locationText(entry)}</Text>
                  </View>
                  <Text style={styles.helperText}>{SOURCE_LABELS[entry.source]}</Text>
                  {entry.note !== null && entry.note !== '' && (
                    <Text style={styles.noteText}>{entry.note}</Text>
                  )}
                </AppCard>
              ))
            )}

            {canLoadMore && (
              <AppButton
                label={isLoadingMore ? 'Loading...' : `Load more (${entries.length} of ${totalCount})`}
                variant="secondary"
                loading={isLoadingMore}
                onPress={() => void loadPage(entries.length, true)}
              />
            )}

            <Text style={styles.privacyNote}>
              Only your own donations are shown. A location comes from the related blood request;
              older or admin-corrected records may not have one.
            </Text>
          </>
        )}

        <AppButton label="Back to Dashboard" variant="outline" onPress={() => router.back()} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: DesignColors.background },
  content: {
    width: '100%', maxWidth: Layout.maxContentWidth, alignSelf: 'center',
    paddingHorizontal: Space.lg, paddingTop: Space.lg, paddingBottom: Space.xxxl,
    gap: Space.md,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: Space.md, marginBottom: Space.xs },
  headerIcon: {
    width: 48, height: 48, borderRadius: Radii.full, alignItems: 'center', justifyContent: 'center',
    backgroundColor: DesignColors.primarySoft, borderWidth: Layout.hairline,
    borderColor: DesignColors.primaryBorder,
  },
  headerText: { flex: 1, gap: Space.xxs },
  eyebrow: {
    fontSize: TypeScale.caption, fontWeight: FontWeight.semibold, color: DesignColors.primary,
    textTransform: 'uppercase',
  },
  title: {
    fontSize: TypeScale.heading, fontWeight: FontWeight.bold, lineHeight: 30,
    color: DesignColors.text,
  },
  description: { fontSize: TypeScale.small, lineHeight: 20, color: DesignColors.textMuted },

  notice: {
    gap: Space.sm, padding: Space.md, borderRadius: Radii.lg, borderWidth: Layout.hairline,
    borderColor: DesignColors.warningBorder, backgroundColor: DesignColors.warningSurface,
  },
  noticeTitle: { fontSize: TypeScale.body, fontWeight: FontWeight.bold, color: DesignColors.warning },
  noticeText: { fontSize: TypeScale.small, lineHeight: 20, color: DesignColors.warning },

  sectionLabel: {
    fontSize: TypeScale.caption, fontWeight: FontWeight.semibold, letterSpacing: 0.6,
    color: DesignColors.textMuted,
  },
  totalRow: { flexDirection: 'row', alignItems: 'baseline', gap: Space.sm, marginTop: Space.xs },
  totalValue: {
    fontSize: TypeScale.displayLarge, fontWeight: FontWeight.bold, color: DesignColors.primaryDeep,
  },
  totalCaption: { fontSize: TypeScale.body, color: DesignColors.textSecondary, flexShrink: 1 },

  loadingCard: {
    alignItems: 'center', justifyContent: 'center', gap: Space.md, padding: Space.xxxl,
    backgroundColor: DesignColors.surface, borderRadius: Radii.lg, borderWidth: Layout.hairline,
    borderColor: DesignColors.border,
  },
  mutedText: { fontSize: TypeScale.body, color: DesignColors.textMuted },

  entryCard: { gap: Space.sm },
  entryHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.sm,
  },
  entryDate: {
    fontSize: TypeScale.subtitle, fontWeight: FontWeight.bold, color: DesignColors.text, flexShrink: 1,
  },
  adminChip: {
    paddingHorizontal: Space.sm, paddingVertical: Space.xxs, borderRadius: Radii.full,
    borderWidth: Layout.hairline, borderColor: DesignColors.warningBorder,
    backgroundColor: DesignColors.warningSurface,
  },
  adminChipText: {
    fontSize: TypeScale.caption, fontWeight: FontWeight.semibold, color: DesignColors.warning,
  },
  factRow: { flexDirection: 'row', gap: Space.md, alignItems: 'flex-start' },
  factLabel: { width: 84, fontSize: TypeScale.small, color: DesignColors.textMuted },
  factValue: {
    flex: 1, fontSize: TypeScale.body, fontWeight: FontWeight.medium,
    color: DesignColors.textSecondary,
  },
  helperText: { fontSize: TypeScale.small, lineHeight: 20, color: DesignColors.textMuted },
  noteText: {
    fontSize: TypeScale.small, lineHeight: 20, color: DesignColors.textSecondary,
    padding: Space.sm, borderRadius: Radii.sm, backgroundColor: DesignColors.surfaceMuted,
  },
  privacyNote: { fontSize: TypeScale.caption, lineHeight: 18, color: DesignColors.textMuted },
});
