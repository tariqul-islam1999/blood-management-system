import { supabase } from './supabase';

// Enable only after the donor-eligibility migration (20261027000100) and the
// reviewed M7 migration are separately deployed and verified. Every wrapper here
// fails closed: activation, inputs and responses are validated before and after
// each call.
export const DONOR_ELIGIBILITY_SERVICE_ACTIVE: boolean = false;
export const DONOR_ELIGIBILITY_SERVICE_MESSAGE =
  'Donation eligibility is not available yet because its backend is not enabled.';

// The donor-facing "Donation Ended" action is intentionally absent. Donation history
// and donor_profiles.last_donation_date are applied by the database helper
// public.apply_donation_ended(...), which the future Complete Donation Workflow must
// call inside its status-transition transaction. Admin corrections are available
// through adminCorrectDonorDonationDate() below.

export type AvailabilityStatus = 'available' | 'unavailable';
export type DonationSource = 'donor' | 'admin';

export type DonorEligibility = {
  last_donation_date: string | null;
  next_eligible_date: string | null;
  is_eligible: boolean;
  days_remaining: number;
  availability_status: AvailabilityStatus;
};

export type DonationRecord = {
  donation_id: string;
  donated_on: string;
  note: string | null;
  source: DonationSource;
  recorded_at: string;
};

export type AdminDonationCorrection = {
  donor_id: string;
  last_donation_date: string;
  next_eligible_date: string;
  availability_status: AvailabilityStatus;
};

export type DonorEligibilityErrorCode =
  | 'inactive'
  | 'expired'
  | 'unauthorized'
  | 'invalid'
  | 'ineligible'
  | 'duplicate'
  | 'request';

export class DonorEligibilityError extends Error {
  constructor(public readonly code: DonorEligibilityErrorCode, message: string) {
    super(message);
    this.name = 'DonorEligibilityError';
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && uuidPattern.test(value);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isDate = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value));
const isNullableDate = (value: unknown): value is string | null =>
  value === null || isDate(value);
const isAvailability = (value: unknown): value is AvailabilityStatus =>
  value === 'available' || value === 'unavailable';
const isSource = (value: unknown): value is DonationSource =>
  value === 'donor' || value === 'admin';

function activationError(): DonorEligibilityError {
  return new DonorEligibilityError('inactive', DONOR_ELIGIBILITY_SERVICE_MESSAGE);
}

function requireActivation(): void {
  if (!DONOR_ELIGIBILITY_SERVICE_ACTIVE) throw activationError();
}

function rpcError(error: { code?: string; message?: string; status?: number }): DonorEligibilityError {
  if (error.status === 401 || error.status === 403 ||
      ['PGRST301', 'PGRST302', 'PGRST303'].includes(error.code ?? '')) {
    return new DonorEligibilityError('expired', 'Your session has expired. Please log in again.');
  }
  switch (error.code) {
    case '42501':
      return new DonorEligibilityError('unauthorized', 'An active donor or administrator account is required.');
    case '22023':
      return new DonorEligibilityError('invalid', 'The donation details are invalid. Check the date and text lengths.');
    case '55000':
      return new DonorEligibilityError('ineligible', error.message ?? 'The donation state does not allow this action.');
    case '23505':
      return new DonorEligibilityError('duplicate', 'A donation is already recorded for that date.');
    default:
      return new DonorEligibilityError('request', 'Unable to reach the donation service. Check your connection and retry.');
  }
}

function today(): string {
  const now = new Date();
  return [
    String(now.getFullYear()).padStart(4, '0'),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
}

export function validateDonationDate(value: string): string | null {
  if (!isDate(value)) return 'Choose a valid donation date (YYYY-MM-DD).';
  if (value > today()) return 'The donation date cannot be in the future.';
  return null;
}

export function validateDonationNote(note: string): string | null {
  return Array.from(note.trim()).length > 200
    ? 'The optional note must be 200 characters or fewer.'
    : null;
}

export function validateCorrectionReason(reason: string): string | null {
  const length = Array.from(reason.trim()).length;
  return length < 10 || length > 500
    ? 'Enter a correction reason of 10–500 characters, excluding surrounding whitespace.'
    : null;
}

function toEligibility(value: unknown): DonorEligibility {
  if (!isRecord(value) ||
      !isNullableDate(value.last_donation_date) ||
      !isNullableDate(value.next_eligible_date) ||
      typeof value.is_eligible !== 'boolean' ||
      typeof value.days_remaining !== 'number' ||
      !Number.isInteger(value.days_remaining) || value.days_remaining < 0 ||
      !isAvailability(value.availability_status)) {
    throw new DonorEligibilityError('request',
      'The donation service returned unexpected eligibility data.');
  }
  return {
    last_donation_date: value.last_donation_date,
    next_eligible_date: value.next_eligible_date,
    is_eligible: value.is_eligible,
    days_remaining: value.days_remaining,
    availability_status: value.availability_status,
  };
}

export async function getMyDonorEligibility(): Promise<DonorEligibility> {
  requireActivation();
  const { data, error } = await supabase.rpc('get_my_donor_eligibility');
  if (error) throw rpcError(error);
  const rows: unknown = data;
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new DonorEligibilityError('request',
      'The donation service returned unexpected eligibility data.');
  }
  return toEligibility(rows[0]);
}

export async function listMyDonations(limit = 20, offset = 0): Promise<DonationRecord[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 ||
      !Number.isInteger(offset) || offset < 0 || offset > 100000) {
    throw new DonorEligibilityError('invalid', 'Invalid donation history pagination.');
  }
  requireActivation();
  const { data, error } = await supabase.rpc('list_my_donations', {
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw rpcError(error);
  const rows: unknown = data;
  if (!Array.isArray(rows) || rows.length > limit) {
    throw new DonorEligibilityError('request',
      'The donation service returned unexpected history data.');
  }
  return rows.map((row) => {
    if (!isRecord(row) || !isUuid(row.donation_id) || !isDate(row.donated_on) ||
        !(row.note === null || typeof row.note === 'string') ||
        !isSource(row.source) || typeof row.recorded_at !== 'string') {
      throw new DonorEligibilityError('request',
        'The donation service returned unexpected history data.');
    }
    return {
      donation_id: row.donation_id,
      donated_on: row.donated_on,
      note: row.note,
      source: row.source,
      recorded_at: row.recorded_at,
    };
  });
}


export async function adminCorrectDonorDonationDate(
  donorId: string,
  correctedDate: string,
  reason: string,
): Promise<AdminDonationCorrection> {
  if (!isUuid(donorId)) throw new DonorEligibilityError('invalid', 'Invalid donor account.');
  const dateError = validateDonationDate(correctedDate);
  if (dateError) throw new DonorEligibilityError('invalid', dateError);
  const reasonError = validateCorrectionReason(reason);
  if (reasonError) throw new DonorEligibilityError('invalid', reasonError);
  requireActivation();
  const { data, error } = await supabase.rpc('admin_correct_donor_donation_date', {
    target_user_id: donorId,
    corrected_donated_on: correctedDate,
    correction_reason: reason.trim(),
  });
  if (error) throw rpcError(error);
  const rows: unknown = data;
  if (!Array.isArray(rows) || rows.length !== 1 || !isRecord(rows[0]) ||
      !isUuid(rows[0].donor_id) || !isDate(rows[0].last_donation_date) ||
      !isDate(rows[0].next_eligible_date) || !isAvailability(rows[0].availability_status)) {
    throw new DonorEligibilityError('request',
      'The correction outcome is unknown. Refresh before trying again.');
  }
  return {
    donor_id: rows[0].donor_id,
    last_donation_date: rows[0].last_donation_date,
    next_eligible_date: rows[0].next_eligible_date,
    availability_status: rows[0].availability_status,
  };
}

