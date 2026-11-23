import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import {
  DesignColors,
  FontWeight,
  Layout,
  Radii,
  Space,
  TypeScale,
} from '@/constants/design-tokens';

/**
 * Small status pill (Phase 2 redesign).
 *
 * IMPORTANT — the allowed status values are taken ONLY from status vocabularies
 * that already exist in this project:
 * - donor verification: `pending` | `approved` | `rejected`
 *   (`donor_profiles.verification_status`, `20261023000400_admin_donor_verification.sql`)
 * - account status: `active` | `suspended` | `deactivated`
 *   (`profiles.account_status`)
 * - blood request status: `open` | `cancelled`
 *   (`blood_requests.status`)
 * - donation engagement lifecycle: `selected` | `reached_location` |
 *   `donation_started` | `donation_ended` | `reached_home_safely`
 *   (`DONATION_STATUSES` in `src/lib/donation-workflow.ts`)
 *
 * `completed` is a PRESENTATION-ONLY key: no database column stores the literal
 * string 'completed'. It exists because a finished record needs one short label
 * in a list. A screen must derive it from a real database value (a donation
 * engagement at `reached_home_safely`, for example) and must not use it to imply
 * a workflow step or a status the backend does not have.
 *
 * Do not add labels here for a status the database does not have. A screen that
 * needs different wording should pass the database value and render its own
 * accompanying text, not a new badge key.
 */
export type StatusBadgeStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'active'
  | 'suspended'
  | 'deactivated'
  | 'open'
  | 'cancelled'
  | 'selected'
  | 'reached_location'
  | 'donation_started'
  | 'donation_ended'
  | 'reached_home_safely'
  | 'completed';

export type StatusBadgeProps = {
  status: StatusBadgeStatus;
  /** Override the visible text, e.g. a shortened form. The colour stays keyed to `status`. */
  label?: string;
  style?: StyleProp<ViewStyle>;
};

type Tone = { surface: string; border: string; text: string };

/** Semantic tone per status, mapped onto the existing token families. */
const TONES: Record<StatusBadgeStatus, Tone> = {
  // Neutral — waiting for a human action.
  pending: {
    surface: DesignColors.warningSurface,
    border: DesignColors.warningBorder,
    text: DesignColors.warning,
  },
  // Success — positive, verified or finished-on-track.
  approved: {
    surface: DesignColors.successSurface,
    border: DesignColors.successBorder,
    text: DesignColors.successText,
  },
  active: {
    surface: DesignColors.successSurface,
    border: DesignColors.successBorder,
    text: DesignColors.successText,
  },
  open: {
    surface: DesignColors.successSurface,
    border: DesignColors.successBorder,
    text: DesignColors.successText,
  },
  donation_ended: {
    surface: DesignColors.successSurface,
    border: DesignColors.successBorder,
    text: DesignColors.successText,
  },
  reached_home_safely: {
    surface: DesignColors.successSurface,
    border: DesignColors.successBorder,
    text: DesignColors.successText,
  },
  completed: {
    surface: DesignColors.successSurface,
    border: DesignColors.successBorder,
    text: DesignColors.successText,
  },
  // Error — refused or withdrawn.
  rejected: {
    surface: DesignColors.errorSurface,
    border: DesignColors.errorBorder,
    text: DesignColors.errorText,
  },
  cancelled: {
    surface: DesignColors.errorSurface,
    border: DesignColors.errorBorder,
    text: DesignColors.errorText,
  },
  deactivated: {
    surface: DesignColors.errorSurface,
    border: DesignColors.errorBorder,
    text: DesignColors.errorText,
  },
  // In progress / in flight — neutral emphasis, not a success or a failure.
  suspended: {
    surface: DesignColors.surfaceMuted,
    border: DesignColors.borderStrong,
    text: DesignColors.textSecondary,
  },
  selected: {
    surface: DesignColors.primarySoft,
    border: DesignColors.primaryBorder,
    text: DesignColors.primaryDeep,
  },
  reached_location: {
    surface: DesignColors.primarySoft,
    border: DesignColors.primaryBorder,
    text: DesignColors.primaryDeep,
  },
  donation_started: {
    surface: DesignColors.primarySoft,
    border: DesignColors.primaryBorder,
    text: DesignColors.primaryDeep,
  },
};

/** Human-readable text for the raw database values. `snake_case` is never shown. */
const LABELS: Record<StatusBadgeStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  active: 'Active',
  suspended: 'Suspended',
  deactivated: 'Deactivated',
  open: 'Open',
  cancelled: 'Cancelled',
  selected: 'Selected',
  reached_location: 'At location',
  donation_started: 'Donation started',
  donation_ended: 'Donation ended',
  reached_home_safely: 'Reached home safely',
  completed: 'Completed',
};

export function StatusBadge({ status, label, style }: StatusBadgeProps) {
  const tone = TONES[status];

  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: tone.surface, borderColor: tone.border },
        style,
      ]}
    >
      <Text style={[styles.text, { color: tone.text }]} numberOfLines={1}>
        {label ?? LABELS[status]}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    // Align to content so the pill never stretches inside a row or column.
    alignSelf: 'flex-start',
    borderWidth: Layout.hairline,
    borderRadius: Radii.full,
    paddingHorizontal: Space.sm,
    paddingVertical: Space.xxs,
  },
  text: {
    fontSize: TypeScale.caption,
    fontWeight: FontWeight.semibold,
    lineHeight: 16,
  },
});
