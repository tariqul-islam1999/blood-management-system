import { supabase } from './supabase';

// Enable only after a separately approved backend deployment and integration test.
// Both wrappers fail closed, including calls made outside the dashboard.
export const VERIFICATION_SERVICE_ACTIVE: boolean = false;
export const VERIFICATION_SERVICE_MESSAGE = 'Verification service not yet activated';

export type PendingDonor = {
  donor_id: string;
  full_name: string;
  blood_group: string;
  age_years: number | null;
  last_donation_date: string | null;
  district: string;
  thana: string;
  local_area: string | null;
  registered_at: string;
};

export type ReviewDecision = 'approved' | 'rejected';
export type DonorReview = {
  donor_id: string;
  verification_status: ReviewDecision;
  reviewed_at: string;
  history_id: string;
};
export type VerificationErrorCode =
  | 'inactive' | 'expired' | 'unauthorized' | 'invalid' | 'stale' | 'request';

export class VerificationError extends Error {
  constructor(public readonly code: VerificationErrorCode, message: string) {
    super(message);
    this.name = 'VerificationError';
  }
}

export function isActiveAdministrator(profile: unknown): boolean {
  return isRecord(profile) && profile.account_status === 'active' &&
    (profile.role === 'admin' || profile.role === 'super_admin');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && uuidPattern.test(value);
const isDate = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value));
const isNullableText = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';

export function validateRejectionReason(reason: string): string | null {
  const length = Array.from(reason.trim()).length;
  return length < 10 || length > 500
    ? 'Enter a rejection reason of 10–500 characters, excluding surrounding whitespace.'
    : null;
}

function requireActivation(): void {
  if (!VERIFICATION_SERVICE_ACTIVE) {
    throw new VerificationError('inactive', VERIFICATION_SERVICE_MESSAGE);
  }
}

// Never surface raw server errors: these may contain private administrative data.
function rpcError(error: { code: string }): VerificationError {
  if (['PGRST301', 'PGRST302', 'PGRST303', '28000'].includes(error.code)) {
    return new VerificationError('expired', 'Your session has expired. Please log in again.');
  }
  if (error.code === '42501') {
    return new VerificationError('unauthorized', 'An active administrator account is required.');
  }
  if (['PGRST202', '42883'].includes(error.code)) {
    return new VerificationError('inactive', VERIFICATION_SERVICE_MESSAGE);
  }
  if (['55000', 'P0002'].includes(error.code)) {
    return new VerificationError('stale', 'This donor is no longer pending or available. Refresh the queue.');
  }
  if (error.code === '22023') {
    return new VerificationError('invalid', 'The verification service rejected this request. Check the inputs.');
  }
  return new VerificationError('request', 'Unable to load verification data. Please retry.');
}

function isPendingDonor(value: unknown): value is PendingDonor {
  return isRecord(value) && isUuid(value.donor_id) &&
    typeof value.full_name === 'string' &&
    typeof value.blood_group === 'string' &&
    ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].includes(value.blood_group) &&
    (value.age_years === null || (typeof value.age_years === 'number' &&
      Number.isInteger(value.age_years) && value.age_years >= 0)) &&
    (value.last_donation_date === null || isDate(value.last_donation_date)) &&
    typeof value.district === 'string' && typeof value.thana === 'string' &&
    isNullableText(value.local_area) && isDate(value.registered_at);
}

export async function adminListPendingDonors(
  pageSize = 20,
  pageOffset = 0,
): Promise<PendingDonor[]> {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50 ||
      !Number.isInteger(pageOffset) || pageOffset < 0 || pageOffset > 100000) {
    throw new VerificationError('invalid', 'Invalid donor queue pagination.');
  }
  requireActivation();
  const { data, error } = await supabase.rpc('admin_list_pending_donors', {
    page_size: pageSize, page_offset: pageOffset,
  });
  if (error) throw rpcError(error);
  const rows: unknown = data;
  if (!Array.isArray(rows) || !rows.every(isPendingDonor) || rows.length > pageSize) {
    throw new VerificationError('request', 'The verification service returned unexpected donor data.');
  }
  return rows;
}

export async function adminReviewDonor(
  donorId: string,
  decision: ReviewDecision,
  rejectionReason: string | null = null,
): Promise<DonorReview> {
  if (!isUuid(donorId) || (decision !== 'approved' && decision !== 'rejected')) {
    throw new VerificationError('invalid', 'Invalid donor review.');
  }
  const reason = rejectionReason?.trim() ?? '';
  const reasonError = validateRejectionReason(reason);
  if (decision === 'rejected' && reasonError) {
    throw new VerificationError('invalid', reasonError);
  }
  if (decision === 'approved' && reason) {
    throw new VerificationError('invalid', 'Approval must not include a rejection reason.');
  }
  requireActivation();
  const { data, error } = await supabase.rpc('admin_review_donor', {
    target_donor_id: donorId, decision,
    rejection_reason: decision === 'rejected' ? reason : null,
  });
  if (error) throw rpcError(error);
  const rows: unknown = data;
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new VerificationError('request', 'Review outcome is unknown. Refresh before trying again.');
  }
  const row: unknown = rows[0];
  if (!isRecord(row) || row.donor_id !== donorId || row.verification_status !== decision ||
      !isDate(row.reviewed_at) || !isUuid(row.history_id)) {
    throw new VerificationError('request', 'Review outcome is unknown. Refresh before trying again.');
  }
  return { donor_id: donorId, verification_status: decision,
    reviewed_at: row.reviewed_at, history_id: row.history_id };
}
