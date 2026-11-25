// Supabase Edge Function: create an Admin account on behalf of an active
// Super Admin.
//
// Authentication model
//   * The caller's Super Admin JWT is forwarded to every RPC, so auth.uid()
//     resolves inside the database and each RPC re-authorizes on its own.
//   * The service-role key is used ONLY for auth.admin.createUser and
//     auth.admin.deleteUser. It is never returned, logged, or sent to a client.
//   * No user id is ever read from the request body. The only deletion target
//     is the cleanup_target_user_id returned by a successful abort RPC.
//
// Sequence: status -> createUser -> link -> commit, otherwise abort.
//
// Deno runtime (Supabase Edge Functions). No npm dependency is added.

// The `jsr:` specifier is resolved by the Deno runtime and by `deno check`.
// TypeScript's own resolver (the VS Code language service in this Expo project)
// cannot resolve it, so the module-not-found diagnostic is suppressed here
// rather than changing the import to a Node-only specifier, which would break
// the Edge Function at deploy time.
// @ts-ignore -- Deno-only specifier; resolved by Deno, not by TypeScript.
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

type CreationStatusRow = {
  intent_id: string;
  status: 'pending' | 'committed' | 'aborted' | 'inconsistent';
  target_user_id: string | null;
  cleanup_state: 'none' | 'delete_pending' | 'deleted';
  cleanup_target_user_id: string | null;
  deletion_authorized: boolean;
  creation_allowed: boolean;
  target_email: string;
  target_full_name: string;
  target_phone: string;
  target_district: string;
  target_thana: string;
  target_local_area: string;
};

type AbortRow = {
  intent_id: string;
  status: string;
  cleanup_target_user_id: string | null;
  delete_required: boolean;
};

type CommitRow = {
  target_user_id: string;
  assigned_role: string;
  account_status: string;
  history_id: string;
  changed_at: string;
  replayed: boolean;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CLEANUP_REASON =
  'Automated cleanup after a failed Admin account creation attempt.';

// Type-only declaration of the parts of the Deno global this function uses.
//
// TypeScript in this Expo workspace has no Deno lib/types installed, so without
// this the identifiers below are "Cannot find name 'Deno'". `declare` emits no
// JavaScript, so the real Deno runtime global is unaffected and behaviour is
// identical. Only the two members actually used are declared, and nothing that
// Deno already provides is redefined at runtime.
declare const Deno: {
  serve(handler: (request: Request) => Response | Promise<Response>): unknown;
  env: { get(name: string): string | undefined };
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Reads a single row from an RPC that returns exactly one row. */
function singleRow<T>(data: unknown): T | null {
  if (!Array.isArray(data) || data.length !== 1) return null;
  const row = data[0];
  return typeof row === 'object' && row !== null ? (row as T) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCreationStatusRow(value: unknown): value is CreationStatusRow {
  if (!isRecord(value)) return false;
  return (
    typeof value.intent_id === 'string' &&
    typeof value.status === 'string' &&
    typeof value.creation_allowed === 'boolean' &&
    typeof value.deletion_authorized === 'boolean' &&
    typeof value.target_email === 'string' &&
    typeof value.target_full_name === 'string' &&
    typeof value.target_phone === 'string' &&
    typeof value.target_district === 'string' &&
    typeof value.target_thana === 'string' &&
    typeof value.target_local_area === 'string'
  );
}

function isAbortRow(value: unknown): value is AbortRow {
  if (!isRecord(value)) return false;
  return (
    typeof value.status === 'string' &&
    typeof value.delete_required === 'boolean' &&
    (value.cleanup_target_user_id === null ||
      typeof value.cleanup_target_user_id === 'string')
  );
}

function isCommitRow(value: unknown): value is CommitRow {
  if (!isRecord(value)) return false;
  return (
    typeof value.target_user_id === 'string' &&
    typeof value.history_id === 'string' &&
    typeof value.changed_at === 'string' &&
    typeof value.replayed === 'boolean'
  );
}

/**
 * Maps a PostgREST/Postgres error to a safe client code.
 *
 * Classification uses machine fields only (the SQLSTATE code). Human-readable
 * message text is never pattern-matched, so an unrelated error can never be
 * mistaken for a duplicate email.
 */
function safeCode(error: { code?: string } | null): string {
  switch (error?.code) {
    case '42501': return 'unauthorized';
    case '22023': return 'invalid';
    case 'P0002': return 'not-found';
    case '55000': return 'conflict';
    case '55P03':
    case '40P01': return 'busy';
    default: return 'unknown';
  }
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') {
    return json({ result: 'rejected', code: 'method' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return json({ result: 'rejected', code: 'misconfigured' }, 500);
  }

  // The caller's JWT is forwarded verbatim; the function never mints one.
  const authorization = request.headers.get('Authorization') ?? '';
  if (!authorization.toLowerCase().startsWith('bearer ')) {
    return json({ result: 'rejected', code: 'unauthorized' }, 401);
  }

  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    payload = isRecord(parsed) ? parsed : {};
  } catch {
    return json({ result: 'rejected', code: 'invalid' }, 400);
  }

  const intentId = typeof payload.intent_id === 'string' ? payload.intent_id : '';
  const password = typeof payload.password === 'string' ? payload.password : '';
  if (!UUID_PATTERN.test(intentId) || password.length < 8) {
    return json({ result: 'rejected', code: 'invalid' }, 400);
  }

  // User-scoped client: auth.uid() is the Super Admin for every RPC.
  const asSuperAdmin: SupabaseClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await asSuperAdmin.auth.getUser();
  if (userError || !userData.user) {
    return json({ result: 'rejected', code: 'unauthorized' }, 401);
  }

  const readStatus = async (): Promise<CreationStatusRow | null> => {
    const { data, error } = await asSuperAdmin.rpc('super_admin_get_creation_status', {
      p_intent_id: intentId,
    });
    if (error) return null;
    const row = singleRow<CreationStatusRow>(data);
    return row && isCreationStatusRow(row) ? row : null;
  };

  let status = await readStatus();
  if (!status) {
    return json({ result: 'rejected', code: 'not-found' }, 404);
  }

  if (status.status === 'committed') {
    return json({ result: 'already_created', target_user_id: status.target_user_id }, 200);
  }
  if (status.status === 'aborted') {
    return json({ result: 'rejected', code: 'conflict' }, 409);
  }
  if (status.status === 'inconsistent') {
    // Never delete on an ambiguous state: escalate to an operator instead.
    return json({ result: 'orphan', code: 'inconsistent' }, 409);
  }

  // The service client exists only to call the Auth admin API.
  const asService: SupabaseClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  /** Aborts the intent and deletes only the id the database hands back. */
  const cleanup = async (): Promise<Response> => {
    const abortResult = await asSuperAdmin.rpc('super_admin_abort_admin_creation', {
      p_intent_id: intentId,
      p_reason: CLEANUP_REASON,
    });

    if (abortResult.error) {
      // Abort itself was refused (revoked caller, or a committed intent).
      // Deleting here would be an unproven deletion, so refuse.
      return json({ result: 'orphan', code: 'cleanup_refused' }, 409);
    }

    const abortRow = singleRow<AbortRow>(abortResult.data);
    if (!abortRow || !isAbortRow(abortRow)) {
      return json({ result: 'orphan', code: 'cleanup_unconfirmed' }, 409);
    }
    if (!abortRow.delete_required || !abortRow.cleanup_target_user_id) {
      return json({ result: 'rejected', code: 'conflict' }, 409);
    }
    if (!UUID_PATTERN.test(abortRow.cleanup_target_user_id)) {
      return json({ result: 'orphan', code: 'cleanup_unconfirmed' }, 409);
    }

    const { error: deleteError } = await asService.auth.admin.deleteUser(
      abortRow.cleanup_target_user_id,
    );
    if (deleteError) {
      // Leave the orphan recorded for operator follow-up. No blind retry.
      return json({ result: 'orphan', code: 'cleanup_failed' }, 409);
    }
    return json({ result: 'rejected', code: 'conflict' }, 409);
  };

  let targetUserId = status.target_user_id;

  if (!targetUserId) {
    if (!status.creation_allowed) {
      // Expired intents must not create a new identity. If one already exists
      // it is unlinked, which is an operator case: never an email-based delete.
      return json({ result: 'rejected', code: 'expired' }, 409);
    }

    const { data: created, error: createError } = await asService.auth.admin.createUser({
      email: status.target_email,
      password,
      // No invitation workflow, and no fabricated confirmation: the Super Admin
      // verified the address out of band. Reporting a confirmed email would be
      // untrue and would weaken checks that later rely on that flag.
      email_confirm: false,
      user_metadata: {
        role: 'beneficiary',
        full_name: status.target_full_name,
        phone: status.target_phone,
        district: status.target_district,
        thana: status.target_thana,
        local_area: status.target_local_area,
      },
    });

    if (createError || !created.user) {
      // Never infer a duplicate from message text. The intent is left pending
      // for an explicit retry or operator decision.
      return json({ result: 'rejected', code: 'create-failed' }, 409);
    }
    targetUserId = created.user.id;
  }

  // Persist the created identity immediately, in its own RPC and transaction.
  // Without this durable link a failed commit would strand the Auth user.
  const { data: linkData, error: linkError } = await asSuperAdmin.rpc(
    'super_admin_link_admin_creation_user',
    { p_intent_id: intentId, p_user_id: targetUserId },
  );
  if (linkError || !singleRow(linkData)) {
    if (linkError && safeCode(linkError) === 'unauthorized') {
      // Cannot abort either, so refuse to delete anything.
      return json({ result: 'orphan', code: 'cleanup_refused' }, 409);
    }
    return await cleanup();
  }

  const { data: commitData, error: commitError } = await asSuperAdmin.rpc(
    'super_admin_commit_admin_creation',
    { p_intent_id: intentId, p_user_id: targetUserId },
  );

  if (!commitError) {
    const commitRow = singleRow<CommitRow>(commitData);
    if (commitRow && isCommitRow(commitRow)) {
      return json({
        result: commitRow.replayed ? 'already_created' : 'created',
        target_user_id: commitRow.target_user_id,
        history_id: commitRow.history_id,
      }, 200);
    }
    return json({ result: 'orphan', code: 'commit_unconfirmed' }, 409);
  }

  if (safeCode(commitError) === 'unauthorized') {
    // Abort would be refused too. Refuse to delete rather than guess.
    return json({ result: 'orphan', code: 'cleanup_refused' }, 409);
  }

  // A transport failure may hide a successful commit. Re-read before cleanup.
  status = await readStatus();
  if (status?.status === 'committed') {
    return json({ result: 'already_created', target_user_id: status.target_user_id }, 200);
  }
  if (!status || status.status === 'inconsistent') {
    return json({ result: 'orphan', code: 'unknown-outcome' }, 409);
  }

  return await cleanup();
});