import { supabase } from './supabase';

// Enable only after the Blood Request migration has been separately deployed and
// verified in the intended Supabase environment. Every RPC wrapper fails closed.
export const BLOOD_REQUEST_SERVICE_ACTIVE: boolean = false;
export const BLOOD_REQUEST_SERVICE_MESSAGE =
  'Blood Request service is not available yet because its backend is not enabled.';

export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;
export type BloodGroup = (typeof BLOOD_GROUPS)[number];
export type RequestUrgency = 'routine' | 'urgent';
export type BloodRequestStatus = 'open' | 'cancelled';
export type BloodRequestRole = 'beneficiary' | 'donor';

export type CreatedBloodRequest = {
  request_id: string;
  blood_group: BloodGroup;
  district: string;
  thana: string;
  local_area: string;
  units_requested: number;
  urgency: RequestUrgency;
  needed_by: string;
  status: BloodRequestStatus;
  created_at: string;
  interest_count: number;
};

export type MyBloodRequest = CreatedBloodRequest & {
  updated_at: string;
  cancelled_at: string | null;
};

export type CancelledBloodRequest = {
  request_id: string;
  status: 'cancelled';
  cancelled_at: string;
};

// This is intentionally limited to the donor-list RPC contract. It has no
// beneficiary ID, name, phone number, photo, notes, or donor identities.
export type OpenBloodRequest = {
  request_id: string;
  blood_group: BloodGroup;
  district: string;
  thana: string;
  local_area: string;
  units_requested: number;
  urgency: RequestUrgency;
  needed_by: string;
  created_at: string;
  has_expressed_interest: boolean;
};

export type InterestResult = {
  request_id: string;
  interest_id: string;
  interest_status: 'interested';
  expressed_at: string;
};

export type BloodRequestErrorCode =
  | 'inactive'
  | 'expired'
  | 'unauthorized'
  | 'invalid'
  | 'stale'
  | 'duplicate'
  | 'busy'
  | 'request'
  | 'unknown-outcome';

export class BloodRequestError extends Error {
  constructor(public readonly code: BloodRequestErrorCode, message: string) {
    super(message);
    this.name = 'BloodRequestError';
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && uuidPattern.test(value);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isBloodGroup = (value: unknown): value is BloodGroup =>
  typeof value === 'string' && (BLOOD_GROUPS as readonly string[]).includes(value);
const isUrgency = (value: unknown): value is RequestUrgency =>
  value === 'routine' || value === 'urgent';
const isStatus = (value: unknown): value is BloodRequestStatus =>
  value === 'open' || value === 'cancelled';
const isDate = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(`${value}T00:00:00Z`));
const isTimestamp = (value: unknown): value is string =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));
const isText = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;
const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

function requireActivation(): void {
  if (!BLOOD_REQUEST_SERVICE_ACTIVE) {
    throw new BloodRequestError('inactive', BLOOD_REQUEST_SERVICE_MESSAGE);
  }
}

function rpcError(code: string, mutation = false): BloodRequestError {
  if (['PGRST301', 'PGRST302', 'PGRST303', '28000'].includes(code)) {
    return new BloodRequestError('expired', 'Your session has expired. Please log in again.');
  }
  if (code === '42501') {
    return new BloodRequestError('unauthorized', 'Your active account is not allowed to perform this action.');
  }
  if (['PGRST202', '42883'].includes(code)) {
    return new BloodRequestError('inactive', BLOOD_REQUEST_SERVICE_MESSAGE);
  }
  if (code === '22023' || code === '22P02') {
    return new BloodRequestError('invalid', 'Check the request details and try again.');
  }
  if (code === 'P0002') {
    return new BloodRequestError('stale', 'This request is no longer available. Refresh the list.');
  }
  if (code === '55000') {
    return new BloodRequestError('stale', 'This request is no longer eligible. Refresh the list.');
  }
  if (code === '23505') {
    return new BloodRequestError('duplicate', 'You have already expressed interest in this request.');
  }
  if (['55P03', '40P01'].includes(code)) {
    return new BloodRequestError('busy', 'This request is being updated. Refresh and try again.');
  }
  return new BloodRequestError(
    mutation ? 'unknown-outcome' : 'request',
    mutation
      ? 'The result could not be confirmed. Refresh before trying again.'
      : 'Unable to load Blood Request data. Check your connection and retry.',
  );
}

function validatePagination(pageSize: number, pageOffset: number): void {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50 ||
      !Number.isInteger(pageOffset) || pageOffset < 0 || pageOffset > 100000) {
    throw new BloodRequestError('invalid', 'Invalid request pagination.');
  }
}

function rows(data: unknown, errorMessage: string): unknown[] {
  if (!Array.isArray(data)) throw new BloodRequestError('request', errorMessage);
  return data;
}

function isCreatedRequest(value: unknown): value is CreatedBloodRequest {
  return isRecord(value) && isUuid(value.request_id) && isBloodGroup(value.blood_group) &&
    isText(value.district) && isText(value.thana) && isText(value.local_area) &&
    isCount(value.units_requested) && value.units_requested >= 1 && value.units_requested <= 10 &&
    isUrgency(value.urgency) && isDate(value.needed_by) && isStatus(value.status) &&
    isTimestamp(value.created_at) && isCount(value.interest_count);
}

function isMyRequest(value: unknown): value is MyBloodRequest {
  if (!isRecord(value)) return false;
  const record = value;
  if (!isCreatedRequest(value)) return false;
  return isTimestamp(record.updated_at) &&
    (record.cancelled_at === null || isTimestamp(record.cancelled_at));
}

function isOpenRequest(value: unknown): value is OpenBloodRequest {
  return isRecord(value) && isUuid(value.request_id) && isBloodGroup(value.blood_group) &&
    isText(value.district) && isText(value.thana) && isText(value.local_area) &&
    isCount(value.units_requested) && value.units_requested >= 1 && value.units_requested <= 10 &&
    isUrgency(value.urgency) && isDate(value.needed_by) && isTimestamp(value.created_at) &&
    typeof value.has_expressed_interest === 'boolean';
}

function isCancelledRequest(value: unknown): value is CancelledBloodRequest {
  return isRecord(value) && isUuid(value.request_id) && value.status === 'cancelled' &&
    isTimestamp(value.cancelled_at);
}

function isInterestResult(value: unknown): value is InterestResult {
  return isRecord(value) && isUuid(value.request_id) && isUuid(value.interest_id) &&
    value.interest_status === 'interested' && isTimestamp(value.expressed_at);
}

export async function verifyBloodRequestAccess(expectedRole: BloodRequestRole): Promise<string> {
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw new BloodRequestError('expired', 'You are signed out or your session has expired. Please log in again.');
    }
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role, account_status')
      .eq('id', data.user.id)
      .maybeSingle();
    if (profileError) throw rpcError(profileError.code);
    if (!isRecord(profile) || profile.role !== expectedRole || profile.account_status !== 'active') {
      throw new BloodRequestError('unauthorized', 'An active account with the required role is required.');
    }
    return data.user.id;
  } catch (error) {
    if (error instanceof BloodRequestError) throw error;
    throw new BloodRequestError('request', 'Unable to verify your account. Check your connection and retry.');
  }
}

export function validateCreateBloodRequest(
  bloodGroup: string,
  units: number,
  urgency: string,
  neededBy: string,
): string | null {
  if (!isBloodGroup(bloodGroup) || !Number.isInteger(units) || units < 1 || units > 10 ||
      !isUrgency(urgency) || !isDate(neededBy)) {
    return 'Choose a blood group, 1ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“10 units, urgency, and a valid needed-by date.';
  }
  const date = new Date(`${neededBy}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const latest = new Date(today);
  latest.setDate(latest.getDate() + 90);
  if (date < today || date > latest) {
    return 'The needed-by date must be today through 90 days from today.';
  }
  return null;
}

export async function beneficiaryCreateBloodRequest(
  bloodGroup: BloodGroup,
  units: number,
  urgency: RequestUrgency,
  neededBy: string,
): Promise<CreatedBloodRequest> {
  const validation = validateCreateBloodRequest(bloodGroup, units, urgency, neededBy);
  if (validation) throw new BloodRequestError('invalid', validation);
  requireActivation();
  try {
    const { data, error } = await supabase.rpc('beneficiary_create_blood_request', {
      requested_blood_group: bloodGroup,
      requested_units: units,
      requested_urgency: urgency,
      requested_needed_by: neededBy,
    });
    if (error) throw rpcError(error.code, true);
    const result = rows(data, 'The created request could not be confirmed.')[0];
    if (!result || !isCreatedRequest(result)) {
      throw new BloodRequestError('unknown-outcome', 'The created request could not be confirmed. Refresh before trying again.');
    }
    return result;
  } catch (error) {
    if (error instanceof BloodRequestError) throw error;
    throw rpcError('', true);
  }
}

export async function beneficiaryListMyBloodRequests(pageSize = 20, pageOffset = 0): Promise<MyBloodRequest[]> {
  validatePagination(pageSize, pageOffset);
  requireActivation();
  try {
    const { data, error } = await supabase.rpc('beneficiary_list_my_blood_requests', {
      page_size: pageSize,
      page_offset: pageOffset,
    });
    if (error) throw rpcError(error.code);
    const result = rows(data, 'The service returned unexpected request data.');
    if (result.length > pageSize || !result.every(isMyRequest)) {
      throw new BloodRequestError('request', 'The service returned unexpected request data.');
    }
    return result;
  } catch (error) {
    if (error instanceof BloodRequestError) throw error;
    throw rpcError('');
  }
}

export async function beneficiaryCancelBloodRequest(requestId: string): Promise<CancelledBloodRequest> {
  if (!isUuid(requestId)) throw new BloodRequestError('invalid', 'Invalid blood request.');
  requireActivation();
  try {
    const { data, error } = await supabase.rpc('beneficiary_cancel_blood_request', {
      target_request_id: requestId,
    });
    if (error) throw rpcError(error.code, true);
    const result = rows(data, 'The cancellation could not be confirmed.');
    if (result.length !== 1 || !isCancelledRequest(result[0]) || result[0].request_id !== requestId) {
      throw new BloodRequestError('unknown-outcome', 'The cancellation could not be confirmed. Refresh before trying again.');
    }
    return result[0];
  } catch (error) {
    if (error instanceof BloodRequestError) throw error;
    throw rpcError('', true);
  }
}

export async function donorListOpenBloodRequests(pageSize = 20, pageOffset = 0): Promise<OpenBloodRequest[]> {
  validatePagination(pageSize, pageOffset);
  requireActivation();
  try {
    const { data, error } = await supabase.rpc('donor_list_open_blood_requests', {
      page_size: pageSize,
      page_offset: pageOffset,
    });
    if (error) throw rpcError(error.code);
    const result = rows(data, 'The service returned unexpected request data.');
    if (result.length > pageSize || !result.every(isOpenRequest)) {
      throw new BloodRequestError('request', 'The service returned unexpected request data.');
    }
    return result;
  } catch (error) {
    if (error instanceof BloodRequestError) throw error;
    throw rpcError('');
  }
}

export async function donorExpressInterest(requestId: string): Promise<InterestResult> {
  if (!isUuid(requestId)) throw new BloodRequestError('invalid', 'Invalid blood request.');
  requireActivation();
  try {
    const { data, error } = await supabase.rpc('donor_express_interest', {
      target_request_id: requestId,
    });
    if (error) throw rpcError(error.code, true);
    const result = rows(data, 'Your interest could not be confirmed.');
    if (result.length !== 1 || !isInterestResult(result[0]) || result[0].request_id !== requestId) {
      throw new BloodRequestError('unknown-outcome', 'Your interest could not be confirmed. Refresh before trying again.');
    }
    return result[0];
  } catch (error) {
    if (error instanceof BloodRequestError) throw error;
    throw rpcError('', true);
  }
}
