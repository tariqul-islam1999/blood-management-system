import { supabase } from './supabase';

// Enable only after separate deployment, verification and activation approval.
// All four wrappers fail closed, even when called outside the dashboard.
export const ADMIN_MANAGEMENT_ACTIVE: boolean = false;
export const ADMIN_MANAGEMENT_MESSAGE = 'Admin Management service not yet activated';

export type AccountStatus = 'active' | 'suspended' | 'deactivated';
export type AccountRole = 'donor' | 'beneficiary' | 'admin' | 'super_admin';
export type AdminListEntry = {
  user_id: string;
  full_name: string;
  account_status: AccountStatus;
  last_action: 'appointed' | 'revoked' | null;
  last_changed_at: string | null;
};
export type AdminCandidate = {
  user_id: string;
  full_name: string;
  current_role: AccountRole;
  account_status: AccountStatus;
  eligible: boolean;
};
export type AdminAccessChange = {
  user_id: string;
  assigned_role: 'admin';
  account_status: 'active' | 'deactivated';
  history_id: string;
  changed_at: string;
};
export type AdminManagementErrorCode =
  | 'inactive' | 'expired' | 'unauthorized' | 'invalid' | 'not-found'
  | 'stale' | 'busy' | 'request' | 'unknown-outcome';

export class AdminManagementError extends Error {
  constructor(public readonly code: AdminManagementErrorCode, message: string) {
    super(message);
    this.name = 'AdminManagementError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function isActiveSuperAdmin(profile: unknown): boolean {
  return isRecord(profile) && profile.role === 'super_admin' && profile.account_status === 'active';
}
export function isAdminAccountId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
const isUuid = (value: unknown): value is string => typeof value === 'string' && isAdminAccountId(value);
const isStatus = (value: unknown): value is AccountStatus =>
  value === 'active' || value === 'suspended' || value === 'deactivated';
const isRole = (value: unknown): value is AccountRole =>
  value === 'donor' || value === 'beneficiary' || value === 'admin' || value === 'super_admin';
const isDate = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));

export function validateAdminManagementReason(value: string): string | null {
  // Match the draft's raw UTF-8 input bound without relying on native TextEncoder.
  let bytes = 0;
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code >= 0xD800 && code <= 0xDFFF) return 'Enter a reason with valid text characters.';
    bytes += code <= 0x7F ? 1 : code <= 0x7FF ? 2 : code <= 0xFFFF ? 3 : 4;
    if (bytes > 4096) return 'The reason exceeds the input limit. Remove extra text or whitespace.';
  }
  const length = Array.from(value.trim()).length;
  return length < 10 || length > 500
    ? 'Enter a reason of 10–500 characters, excluding surrounding whitespace.' : null;
}

function requireActivation(): void {
  if (!ADMIN_MANAGEMENT_ACTIVE) throw new AdminManagementError('inactive', ADMIN_MANAGEMENT_MESSAGE);
}
function rpcError(code: string, mutation = false): AdminManagementError {
  if (['PGRST301', 'PGRST302', 'PGRST303', '28000'].includes(code)) {
    return new AdminManagementError('expired', 'Your session has expired. Please log in again.');
  }
  if (code === '42501') return new AdminManagementError('unauthorized', 'An active super admin account is required.');
  if (['PGRST202', '42883'].includes(code)) return new AdminManagementError('inactive', ADMIN_MANAGEMENT_MESSAGE);
  if (code === 'P0002') return new AdminManagementError('not-found', 'Account not found. Check the account ID.');
  if (code === '55000') return new AdminManagementError('stale', 'This account is not eligible for that action. Refresh and check its current status.');
  if (['22023', '22P02'].includes(code)) return new AdminManagementError('invalid', 'Check the account ID and required reason.');
  if (['55P03', '40P01'].includes(code)) return new AdminManagementError('busy', 'The account is busy. Refresh before trying again.');
  return new AdminManagementError(mutation ? 'unknown-outcome' : 'request', mutation
    ? 'The result could not be confirmed. Refresh the admin list before considering another action.'
    : 'Unable to load Admin Management data. Check your connection and retry.');
}

// Runtime screen authorization uses Auth-verified identity and database profiles.
// It does not use session/user metadata. The deployed RPCs must enforce this too.
export async function verifySuperAdminAccess(): Promise<string> {
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) {
      if (error.status === 401 || error.status === 403 || error.name === 'AuthSessionMissingError' ||
          ['refresh_token_not_found', 'refresh_token_already_used', 'session_not_found', 'user_not_found'].includes(error.code ?? '')) {
        throw new AdminManagementError('expired', 'You are signed out or your session has expired. Please log in again.');
      }
      throw new AdminManagementError('request', 'Unable to verify your session. Check your connection and retry.');
    }
    if (!data.user) throw new AdminManagementError('expired', 'You are signed out. Please log in again.');
    const { data: profile, error: profileError } = await supabase.from('profiles')
      .select('role, account_status').eq('id', data.user.id).maybeSingle();
    if (profileError) throw rpcError(profileError.code);
    if (!isActiveSuperAdmin(profile)) {
      throw new AdminManagementError('unauthorized', 'An active super admin account is required.');
    }
    return data.user.id;
  } catch (error) {
    if (error instanceof AdminManagementError) throw error;
    throw new AdminManagementError('request', 'Unable to verify your account. Check your connection and retry.');
  }
}

function isAdminEntry(value: unknown): value is AdminListEntry {
  return isRecord(value) && isUuid(value.user_id) && typeof value.full_name === 'string' &&
    isStatus(value.account_status) &&
    ((value.last_action === null && value.last_changed_at === null) ||
      ((value.last_action === 'appointed' || value.last_action === 'revoked') && isDate(value.last_changed_at)));
}
function isCandidate(value: unknown): value is AdminCandidate {
  return isRecord(value) && isUuid(value.user_id) && typeof value.full_name === 'string' &&
    isRole(value.current_role) && isStatus(value.account_status) && typeof value.eligible === 'boolean' &&
    (!value.eligible || (value.current_role === 'beneficiary' && value.account_status === 'active') ||
      (value.current_role === 'admin' && value.account_status === 'deactivated'));
}
function accountId(value: string): string {
  const id = value.trim().toLowerCase();
  if (!isAdminAccountId(id)) throw new AdminManagementError('invalid', 'Enter a valid account UUID.');
  return id;
}

export async function superAdminListAdmins(pageSize = 20, pageOffset = 0): Promise<AdminListEntry[]> {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50 ||
      !Number.isInteger(pageOffset) || pageOffset < 0 || pageOffset > 100000) {
    throw new AdminManagementError('invalid', 'Invalid admin list pagination.');
  }
  requireActivation();
  try {
    const { data, error } = await supabase.rpc('super_admin_list_admins', {
      page_size: pageSize, page_offset: pageOffset,
    });
    if (error) throw rpcError(error.code);
    const rows: unknown = data;
    if (!Array.isArray(rows) || !rows.every(isAdminEntry) || rows.length > pageSize ||
        new Set(rows.map(row => row.user_id.toLowerCase())).size !== rows.length) {
      throw new AdminManagementError('request', 'The service returned unexpected admin list data.');
    }
    return rows;
  } catch (error) {
    if (error instanceof AdminManagementError) throw error;
    throw rpcError('');
  }
}

export async function superAdminGetAdminCandidate(targetUserId: string): Promise<AdminCandidate> {
  const id = accountId(targetUserId);
  requireActivation();
  try {
    const { data, error } = await supabase.rpc('super_admin_get_admin_candidate', { target_user_id: id });
    if (error) throw rpcError(error.code);
    const rows: unknown = data;
    if (!Array.isArray(rows) || rows.length !== 1 || !isCandidate(rows[0]) || rows[0].user_id.toLowerCase() !== id) {
      throw new AdminManagementError('request', 'The service returned unexpected candidate data.');
    }
    return rows[0];
  } catch (error) {
    if (error instanceof AdminManagementError) throw error;
    throw rpcError('');
  }
}

async function changeAdminAccess(
  action: 'appoint' | 'revoke', targetUserId: string, reason: string,
): Promise<AdminAccessChange> {
  const id = accountId(targetUserId);
  const reasonError = validateAdminManagementReason(reason);
  if (reasonError) throw new AdminManagementError('invalid', reasonError);
  requireActivation();
  try {
    const { data, error } = await supabase.rpc(
      action === 'appoint' ? 'super_admin_appoint_admin' : 'super_admin_revoke_admin',
      { target_user_id: id, reason: reason.trim() },
    );
    if (error) throw rpcError(error.code, true);
    const rows: unknown = data;
    if (!Array.isArray(rows) || rows.length !== 1) throw rpcError('', true);
    const row: unknown = rows[0];
    const status = action === 'appoint' ? 'active' : 'deactivated';
    if (!isRecord(row) || !isUuid(row.user_id) || row.user_id.toLowerCase() !== id ||
        row.assigned_role !== 'admin' || row.account_status !== status ||
        !isUuid(row.history_id) || !isDate(row.changed_at)) throw rpcError('', true);
    return { user_id: row.user_id, assigned_role: 'admin', account_status: status,
      history_id: row.history_id, changed_at: row.changed_at };
  } catch (error) {
    if (error instanceof AdminManagementError) throw error;
    // A transport failure may occur AFTER commit. Never invent success or auto-retry.
    throw rpcError('', true);
  }
}
export function superAdminAppointAdmin(targetUserId: string, reason: string): Promise<AdminAccessChange> {
  return changeAdminAccess('appoint', targetUserId, reason);
}
export function superAdminRevokeAdmin(targetUserId: string, reason: string): Promise<AdminAccessChange> {
  return changeAdminAccess('revoke', targetUserId, reason);
}
