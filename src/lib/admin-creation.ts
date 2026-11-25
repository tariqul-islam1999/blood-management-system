import { supabase } from './supabase';
import { ADMIN_MANAGEMENT_ACTIVE, ADMIN_MANAGEMENT_MESSAGE } from './admin-management';

/**
 * Super Admin Admin-account creation service.
 *
 * Wire format
 *   Mobile -> Edge Function (admin-create) -> Postgres RPCs.
 *
 * Why an Edge Function instead of a direct RPC
 *   Creating an Auth user requires the service-role key, which must never reach
 *   the app. The function holds that key server-side and uses it ONLY for
 *   auth.admin.createUser/deleteUser. Every state change is still authorized by
 *   the database against the caller's own Super Admin JWT.
 *
 * Activation
 *   `ADMIN_MANAGEMENT_ACTIVE` gates this feature, exactly like appointment and
 *   revocation. While it is false no request is ever sent.
 */

export type AdminCreationInput = {
  full_name: string;
  email: string;
  password: string;
  phone: string;
  district: string;
  thana: string;
  local_area: string;
  reason: string;
};

export type AdminCreationResult = {
  result: 'created' | 'already_created';
  target_user_id: string;
  history_id?: string;
};

export type AdminCreationErrorCode =
  | 'inactive'
  | 'expired'
  | 'unauthorized'
  | 'invalid'
  | 'conflict'
  | 'not-found'
  | 'busy'
  | 'orphan'
  | 'request'
  | 'unknown-outcome';

export class AdminCreationError extends Error {
  constructor(public readonly code: AdminCreationErrorCode, message: string) {
    super(message);
    this.name = 'AdminCreationError';
  }
}

const BANGLADESH_PHONE = /^01[3-9]\d{8}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SERVER_CODES = new Set([
  'unauthorized', 'invalid', 'conflict', 'not-found', 'busy',
  'orphan', 'expired', 'method', 'misconfigured', 'create-failed',
  'cleanup_refused', 'cleanup_failed', 'cleanup_unconfirmed',
  'commit_unconfirmed', 'inconsistent', 'unknown-outcome',
]);

/** Field-level messages, in the order the form presents them. */
export function validateAdminCreationInput(input: AdminCreationInput): Record<string, string> {
  const errors: Record<string, string> = {};

  if (!input.full_name.trim()) errors.full_name = 'Full name is required.';

  const email = input.email.trim();
  if (!email) errors.email = 'Email is required.';
  else if (!EMAIL.test(email)) errors.email = 'Enter a valid email address.';

  if (!input.password) errors.password = 'Password is required.';
  else if (input.password.length < 8) errors.password = 'Use at least 8 characters.';

  const phone = input.phone.trim();
  if (!phone) errors.phone = 'Phone number is required.';
  else if (!BANGLADESH_PHONE.test(phone)) {
    errors.phone = 'Enter an 11-digit Bangladesh mobile number, for example 01712345678.';
  }

  if (!input.district.trim()) errors.district = 'District is required.';
  if (!input.thana.trim()) errors.thana = 'Thana / Upazila is required.';
  if (!input.local_area.trim()) errors.local_area = 'Local area is required.';

  const reasonLength = Array.from(input.reason.trim()).length;
  if (reasonLength < 10 || reasonLength > 500) {
    errors.reason = 'Enter a reason of 10-500 characters, excluding surrounding whitespace.';
  }

  return errors;
}

function safeServerCode(value: unknown): string | null {
  return typeof value === 'string' && SERVER_CODES.has(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const UNCONFIRMED =
  'The result could not be confirmed. Refresh the admin list before trying again.';

/**
 * Maps a server code to a user-facing error.
 *
 * 'orphan' is deliberately distinct: the account may exist but the database
 * could not prove it is safe to remove. It must be reported for operator
 * follow-up, never retried automatically.
 */
function serverError(code: string): AdminCreationError {
  switch (code) {
    case 'unauthorized':
      return new AdminCreationError('unauthorized',
        'An active Super Admin account is required. Sign in again.');
    case 'expired':
      return new AdminCreationError('expired',
        'This creation request expired before an account was created. Start again.');
    case 'invalid':
      return new AdminCreationError('invalid', 'Check the form values and try again.');
    case 'not-found':
      return new AdminCreationError('not-found',
        'The creation request could not be found. Start again.');
    case 'busy':
      return new AdminCreationError('busy',
        'Another operation is in progress for this request. Refresh before retrying.');
    case 'orphan':
      return new AdminCreationError('orphan',
        'The result could not be confirmed. An administrator must review this request before another attempt.');
    case 'conflict':
      return new AdminCreationError('conflict',
        'The request could not be completed in its current state.');
    default:
      return new AdminCreationError('unknown-outcome', UNCONFIRMED);
  }
}

async function readFailureCode(response: Response): Promise<string> {
  try {
    const body: unknown = await response.clone().json();
    if (isRecord(body)) {
      const code = safeServerCode(body.code);
      if (code) return code;
      if (body.result === 'orphan') return 'orphan';
    }
  } catch {
    // Fall through to the generic outcome below.
  }
  return 'unknown-outcome';
}

/**
 * Creates an Admin account through the admin-create Edge Function.
 *
 * Throws AdminCreationError for every failure, including an unconfirmed
 * outcome. It never reports success without a positive server confirmation.
 */
export async function superAdminCreateAdmin(
  input: AdminCreationInput,
): Promise<AdminCreationResult> {
  // Fail closed at the service layer, not only in the screen. This mirrors the
  // `requireActivation()` guard used by every wrapper in admin-management.ts, so
  // the feature cannot be reached by any future caller while it is disabled.
  if (!ADMIN_MANAGEMENT_ACTIVE) {
    throw new AdminCreationError('inactive', ADMIN_MANAGEMENT_MESSAGE);
  }

  if (!input.full_name || !input.email || !input.password) {
    throw new AdminCreationError('invalid', 'Check the form values and try again.');
  }

  let intentId: string;
  try {
    // Step 1: open the intent with the Super Admin's own JWT. The intent, not
    // this screen, is the authoritative record of the requested account.
    const { data, error } = await supabase.rpc('super_admin_begin_admin_creation', {
      p_full_name: input.full_name.trim(),
      p_email: input.email.trim().toLowerCase(),
      p_phone: input.phone.trim(),
      p_district: input.district.trim(),
      p_thana: input.thana.trim(),
      p_local_area: input.local_area.trim(),
      p_reason: input.reason.trim(),
    });

    if (error) throw serverError(error.code ?? 'unknown-outcome');

    const rows: unknown = data;
    if (!Array.isArray(rows) || rows.length !== 1 || !isRecord(rows[0]) ||
        typeof rows[0].intent_id !== 'string' || !UUID.test(rows[0].intent_id)) {
      throw new AdminCreationError('unknown-outcome', UNCONFIRMED);
    }
    intentId = rows[0].intent_id;
  } catch (error) {
    if (error instanceof AdminCreationError) throw error;
    throw new AdminCreationError('unknown-outcome', UNCONFIRMED);
  }

  let response: Response;
  try {
    // Step 2: the Edge Function performs createUser -> link -> commit, or aborts.
    // Only the intent id and password are sent; every profile value is read from
    // the database by the function.
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) {
      throw new AdminCreationError('unauthorized',
        'You are signed out. Please log in again.');
    }

    response = await fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/admin-create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // The publishable/anon key plus the caller's JWT. No service key here.
        apikey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ intent_id: intentId, password: input.password }),
    });
  } catch (error) {
    if (error instanceof AdminCreationError) throw error;
    // The request may have reached the server. Never retry automatically.
    throw new AdminCreationError('unknown-outcome', UNCONFIRMED);
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    throw serverError(await readFailureCode(response));
  }

  if (!isRecord(body) ||
      (body.result !== 'created' && body.result !== 'already_created') ||
      typeof body.target_user_id !== 'string' || !UUID.test(body.target_user_id)) {
    throw new AdminCreationError('unknown-outcome', UNCONFIRMED);
  }

  return {
    result: body.result,
    target_user_id: body.target_user_id,
    history_id: typeof body.history_id === 'string' ? body.history_id : undefined,
  };
}
