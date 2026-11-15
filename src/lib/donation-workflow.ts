import { supabase } from './supabase';

// Enable only after the P4.1/P4.2 migrations (20261029000100 / 20261030000100) are
// separately deployed and verified in the intended Supabase environment, and after
// device testing. Every wrapper here fails closed: activation, inputs and responses
// are validated before and after each call.
export const DONATION_WORKFLOW_SERVICE_ACTIVE: boolean = true;
export const DONATION_WORKFLOW_SERVICE_MESSAGE =
  'The donation workflow is not available yet because its backend is not enabled.';

// The five approved lifecycle statuses. No other status exists.
export const DONATION_STATUSES = [
  'selected',
  'reached_location',
  'donation_started',
  'donation_ended',
  'reached_home_safely',
] as const;
export type DonationStatus = (typeof DONATION_STATUSES)[number];

export type Feeling = 'ok' | 'so_so' | 'not_well';
export const FEELING_OPTIONS: ReadonlyArray<{ value: Feeling; label: string }> = [
  { value: 'ok', label: 'OK' },
  { value: 'so_so', label: 'So-so' },
  { value: 'not_well', label: 'Not well' },
];

export type PhysicalCondition = 'good' | 'moderate' | 'not_well';
export type HealthChanges = 'no_problems' | 'yes' | 'not_sure';
export type ComparedToAfter = 'yes' | 'same' | 'worse';
export type CurrentDiscomfort = 'no' | 'yes' | 'prefer_not_to_say';
export type ConsultedProfessional = 'yes' | 'not_yet' | 'not_needed';

export type FollowupAnswers = {
  physical_condition: PhysicalCondition;
  health_changes: HealthChanges;
  compared_to_after: ComparedToAfter;
  current_discomfort: CurrentDiscomfort;
  consulted_professional: ConsultedProfessional;
};

export const FOLLOWUP_QUESTIONS: ReadonlyArray<{
  key: keyof FollowupAnswers;
  question: string;
  options: ReadonlyArray<{ value: string; label: string }>;
}> = [
  {
    key: 'physical_condition',
    question: 'How is your physical condition now?',
    options: [
      { value: 'good', label: 'Good' },
      { value: 'moderate', label: 'Moderate' },
      { value: 'not_well', label: 'Not well' },
    ],
  },
  {
    key: 'health_changes',
    question: 'Have you noticed any changes since donating?',
    options: [
      { value: 'no_problems', label: 'No problems' },
      { value: 'yes', label: 'Yes' },
      { value: 'not_sure', label: 'Not sure' },
    ],
  },
  {
    key: 'compared_to_after',
    question: 'Are you feeling better than immediately after donation?',
    options: [
      { value: 'yes', label: 'Yes' },
      { value: 'same', label: 'Same' },
      { value: 'worse', label: 'Worse' },
    ],
  },
  {
    key: 'current_discomfort',
    question: 'Are you currently experiencing any discomfort?',
    options: [
      { value: 'no', label: 'No' },
      { value: 'yes', label: 'Yes' },
      { value: 'prefer_not_to_say', label: 'Prefer not to say' },
    ],
  },
  {
    key: 'consulted_professional',
    question: 'If you experienced problems, have you consulted a healthcare professional?',
    options: [
      { value: 'yes', label: 'Yes' },
      { value: 'not_yet', label: 'Not yet' },
      { value: 'not_needed', label: 'Not needed' },
    ],
  },
];

// Result contracts expose only the fields the donor UI needs. `beneficiary_id` is
// deliberately omitted: donor UI must never surface beneficiary identity.
export type AcceptDonationResult = {
  engagement_id: string;
  request_id: string;
  status: 'selected';
  selected_at: string;
};

export type ReachedLocationResult = {
  engagement_id: string;
  status: 'reached_location';
  reached_location_at: string;
  updated_at: string;
};

export type StartDonationResult = {
  engagement_id: string;
  status: 'donation_started';
  donation_started_at: string;
  updated_at: string;
};

export type EndDonationResult = {
  engagement_id: string;
  status: 'donation_ended';
  donation_ended_at: string;
  updated_at: string;
};

export type ReachedHomeSafelyResult = {
  engagement_id: string;
  status: 'reached_home_safely';
  reached_home_safely_at: string;
  feeling: Feeling;
  follow_up_due_at: string;
  updated_at: string;
};

export type SubmitFollowupResult = {
  engagement_id: string;
  response_id: string;
  submitted_at: string;
  follow_up_submitted_at: string;
};

export type DonationWorkflowErrorCode =
  | 'inactive'
  | 'expired'
  | 'unauthorized'
  | 'invalid'
  | 'stale'
  | 'duplicate'
  | 'busy'
  | 'request'
  | 'unknown-outcome';

export class DonationWorkflowError extends Error {
  constructor(public readonly code: DonationWorkflowErrorCode, message: string) {
    super(message);
    this.name = 'DonationWorkflowError';
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && uuidPattern.test(value);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isTimestamp = (value: unknown): value is string =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));
const isFeeling = (value: unknown): value is Feeling =>
  value === 'ok' || value === 'so_so' || value === 'not_well';

function requireActivation(): void {
  if (!DONATION_WORKFLOW_SERVICE_ACTIVE) {
    throw new DonationWorkflowError('inactive', DONATION_WORKFLOW_SERVICE_MESSAGE);
  }
}

function rpcError(error: { code?: string; message?: string; status?: number }, mutation = false): DonationWorkflowError {
  if (error.status === 401 || error.status === 403 ||
      ['PGRST301', 'PGRST302', 'PGRST303', '28000'].includes(error.code ?? '')) {
    return new DonationWorkflowError('expired', 'Your session has expired. Please log in again.');
  }
  switch (error.code) {
    case '42501':
      return new DonationWorkflowError('unauthorized', 'Your active donor account is not allowed to perform this action.');
    case 'PGRST202':
    case '42883':
      return new DonationWorkflowError('inactive', DONATION_WORKFLOW_SERVICE_MESSAGE);
    case '22023':
    case '22P02':
      return new DonationWorkflowError('invalid', 'Check the details and try again.');
    case 'P0002':
      return new DonationWorkflowError('stale', 'This donation is no longer available. Refresh and try again.');
    case '55000':
      return new DonationWorkflowError('stale', 'The donation is not in the expected state. Refresh and try again.');
    case '23505':
      return new DonationWorkflowError('duplicate', 'This request already has a donation. Refresh the list.');
    case '55P03':
    case '40P01':
      return new DonationWorkflowError('busy', 'The donation is being updated. Refresh and try again.');
    default:
      return new DonationWorkflowError(
        mutation ? 'unknown-outcome' : 'request',
        mutation
          ? 'The result could not be confirmed. Refresh before trying again.'
          : 'Unable to load donation data. Check your connection and retry.',
      );
  }
}

function rows(data: unknown, errorMessage: string): unknown[] {
  if (!Array.isArray(data)) throw new DonationWorkflowError('request', errorMessage);
  return data;
}

const isStatus = (value: unknown): value is DonationStatus =>
  typeof value === 'string' && (DONATION_STATUSES as readonly string[]).includes(value);

export async function verifyDonationWorkflowAccess(): Promise<string> {
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw new DonationWorkflowError('expired', 'You are signed out or your session has expired. Please log in again.');
    }
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role, account_status')
      .eq('id', data.user.id)
      .maybeSingle();
    if (profileError) throw rpcError(profileError);
    if (!isRecord(profile) || profile.role !== 'donor' || profile.account_status !== 'active') {
      throw new DonationWorkflowError('unauthorized', 'An active donor account is required.');
    }
    return data.user.id;
  } catch (error) {
    if (error instanceof DonationWorkflowError) throw error;
    throw new DonationWorkflowError('request', 'Unable to verify your account. Check your connection and retry.');
  }
}

export function validateFollowupAnswers(
  answers: Partial<FollowupAnswers>,
  additionalComments: string,
): string | null {
  for (const question of FOLLOWUP_QUESTIONS) {
    const value = answers[question.key];
    const allowed = question.options.map((option) => option.value);
    if (typeof value !== 'string' || !allowed.includes(value)) {
      return 'Please answer every question before submitting.';
    }
  }
  if (additionalComments.length > 500) {
    return 'Additional comments must be 500 characters or fewer.';
  }
  return null;
}

export async function donorAcceptBloodRequest(requestId: string): Promise<AcceptDonationResult> {
  if (!isUuid(requestId)) throw new DonationWorkflowError('invalid', 'Invalid blood request.');
  requireActivation();
  try {
    const { data, error } = await supabase.rpc('donor_accept_blood_request', {
      p_target_request_id: requestId,
    });
    if (error) throw rpcError(error, true);
    const result = rows(data, 'Your acceptance could not be confirmed.')[0];
    if (!isRecord(result) || !isUuid(result.engagement_id) || result.request_id !== requestId ||
        !isStatus(result.status) || result.status !== 'selected' || !isTimestamp(result.selected_at)) {
      throw new DonationWorkflowError('unknown-outcome', 'Your acceptance could not be confirmed. Refresh before trying again.');
    }
    return {
      engagement_id: result.engagement_id,
      request_id: result.request_id,
      status: 'selected',
      selected_at: result.selected_at,
    };
  } catch (error) {
    if (error instanceof DonationWorkflowError) throw error;
    throw rpcError({}, true);
  }
}

export async function donorMarkReachedLocation(engagementId: string): Promise<ReachedLocationResult> {
  if (!isUuid(engagementId)) throw new DonationWorkflowError('invalid', 'Invalid donation engagement.');
  requireActivation();
  try {
    const { data, error } = await supabase.rpc('donor_mark_reached_location', {
      p_engagement_id: engagementId,
    });
    if (error) throw rpcError(error, true);
    const result = rows(data, 'The status update could not be confirmed.')[0];
    if (!isRecord(result) || result.engagement_id !== engagementId || !isStatus(result.status) ||
        result.status !== 'reached_location' || !isTimestamp(result.reached_location_at) ||
        !isTimestamp(result.updated_at)) {
      throw new DonationWorkflowError('unknown-outcome', 'The status update could not be confirmed. Refresh before trying again.');
    }
    return {
      engagement_id: engagementId,
      status: 'reached_location',
      reached_location_at: result.reached_location_at,
      updated_at: result.updated_at,
    };
  } catch (error) {
    if (error instanceof DonationWorkflowError) throw error;
    throw rpcError({}, true);
  }
}

export async function donorStartDonation(engagementId: string): Promise<StartDonationResult> {
  if (!isUuid(engagementId)) throw new DonationWorkflowError('invalid', 'Invalid donation engagement.');
  requireActivation();
  try {
    const { data, error } = await supabase.rpc('donor_start_donation', {
      p_engagement_id: engagementId,
    });
    if (error) throw rpcError(error, true);
    const result = rows(data, 'The status update could not be confirmed.')[0];
    if (!isRecord(result) || result.engagement_id !== engagementId || !isStatus(result.status) ||
        result.status !== 'donation_started' || !isTimestamp(result.donation_started_at) ||
        !isTimestamp(result.updated_at)) {
      throw new DonationWorkflowError('unknown-outcome', 'The status update could not be confirmed. Refresh before trying again.');
    }
    return {
      engagement_id: engagementId,
      status: 'donation_started',
      donation_started_at: result.donation_started_at,
      updated_at: result.updated_at,
    };
  } catch (error) {
    if (error instanceof DonationWorkflowError) throw error;
    throw rpcError({}, true);
  }
}

export async function donorEndDonation(engagementId: string): Promise<EndDonationResult> {
  if (!isUuid(engagementId)) throw new DonationWorkflowError('invalid', 'Invalid donation engagement.');
  requireActivation();
  try {
    const { data, error } = await supabase.rpc('donor_end_donation', {
      p_engagement_id: engagementId,
    });
    if (error) throw rpcError(error, true);
    const result = rows(data, 'The status update could not be confirmed.')[0];
    if (!isRecord(result) || result.engagement_id !== engagementId || !isStatus(result.status) ||
        result.status !== 'donation_ended' || !isTimestamp(result.donation_ended_at) ||
        !isTimestamp(result.updated_at)) {
      throw new DonationWorkflowError('unknown-outcome', 'The status update could not be confirmed. Refresh before trying again.');
    }
    return {
      engagement_id: engagementId,
      status: 'donation_ended',
      donation_ended_at: result.donation_ended_at,
      updated_at: result.updated_at,
    };
  } catch (error) {
    if (error instanceof DonationWorkflowError) throw error;
    throw rpcError({}, true);
  }
}

export async function donorRecordReachedHomeSafely(
  engagementId: string,
  feeling: Feeling,
): Promise<ReachedHomeSafelyResult> {
  if (!isUuid(engagementId)) throw new DonationWorkflowError('invalid', 'Invalid donation engagement.');
  if (!isFeeling(feeling)) throw new DonationWorkflowError('invalid', 'Choose how you are feeling.');
  requireActivation();
  try {
    const { data, error } = await supabase.rpc('donor_record_reached_home_safely', {
      p_engagement_id: engagementId,
      p_feeling: feeling,
    });
    if (error) throw rpcError(error, true);
    const result = rows(data, 'The status update could not be confirmed.')[0];
    if (!isRecord(result) || result.engagement_id !== engagementId || !isStatus(result.status) ||
        result.status !== 'reached_home_safely' || !isTimestamp(result.reached_home_safely_at) ||
        !isFeeling(result.feeling) || !isTimestamp(result.follow_up_due_at) ||
        !isTimestamp(result.updated_at)) {
      throw new DonationWorkflowError('unknown-outcome', 'The status update could not be confirmed. Refresh before trying again.');
    }
    return {
      engagement_id: engagementId,
      status: 'reached_home_safely',
      reached_home_safely_at: result.reached_home_safely_at,
      feeling: result.feeling,
      follow_up_due_at: result.follow_up_due_at,
      updated_at: result.updated_at,
    };
  } catch (error) {
    if (error instanceof DonationWorkflowError) throw error;
    throw rpcError({}, true);
  }
}

export async function donorSubmitDonationFollowup(
  engagementId: string,
  answers: FollowupAnswers,
  additionalComments?: string | null,
): Promise<SubmitFollowupResult> {
  if (!isUuid(engagementId)) throw new DonationWorkflowError('invalid', 'Invalid donation engagement.');
  const comments = (additionalComments ?? '').trim();
  const validation = validateFollowupAnswers(answers, comments);
  if (validation) throw new DonationWorkflowError('invalid', validation);
  requireActivation();
  try {
    const { data, error } = await supabase.rpc('donor_submit_donation_followup', {
      p_engagement_id: engagementId,
      p_physical_condition: answers.physical_condition,
      p_health_changes: answers.health_changes,
      p_compared_to_after: answers.compared_to_after,
      p_current_discomfort: answers.current_discomfort,
      p_consulted_professional: answers.consulted_professional,
      p_additional_comments: comments.length > 0 ? comments : null,
    });
    if (error) throw rpcError(error, true);
    const result = rows(data, 'Your follow-up could not be confirmed.')[0];
    if (!isRecord(result) || result.engagement_id !== engagementId || !isUuid(result.response_id) ||
        !isTimestamp(result.submitted_at) || !isTimestamp(result.follow_up_submitted_at)) {
      throw new DonationWorkflowError('unknown-outcome', 'Your follow-up could not be confirmed. Refresh before trying again.');
    }
    return {
      engagement_id: engagementId,
      response_id: result.response_id,
      submitted_at: result.submitted_at,
      follow_up_submitted_at: result.follow_up_submitted_at,
    };
  } catch (error) {
    if (error instanceof DonationWorkflowError) throw error;
    throw rpcError({}, true);
  }
}
