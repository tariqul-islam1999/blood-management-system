-- Admin account creation (Super Admin direct provisioning).
--
-- REVIEW DRAFT ONLY. Requires 20261026000100_super_admin_management.sql (M6).
-- Run this ENTIRE file in ONE runner-owned transaction with stop-on-error.
-- Contains no BEGIN/COMMIT: the Supabase CLI batches one file per migration.
--
-- Design summary
--   * Intent-first provisioning: the Super Admin opens an intent, the Edge
--     Function creates the Auth user, then links, then commits.
--   * expires_at limits ONLY creation of a NEW Auth identity. It never rejects
--     a late link or commit; the binding rule is that the Auth identity's own
--     created_at fell inside the intent window.
--   * The durable Auth identity link (user_id) is written by its own RPC in its
--     own transaction, so a failed commit cannot roll the link back and strand
--     an unreferenced Auth user.
--   * requested_by (who opened) and committed_by (who promoted) are separate,
--     so a successor Super Admin can safely read or resume an intent.
--   * No function here uses min(uuid): uuid has no core min/max aggregate in
--     PostgreSQL 17.

SET LOCAL search_path = '';
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL check_function_bodies = on;

DO $preflight$
BEGIN
    IF current_user <> 'postgres'
       OR pg_catalog.current_setting('server_version_num')::integer / 10000 <> 17 THEN
        RAISE EXCEPTION 'Requires PostgreSQL 17 and current_user postgres';
    END IF;

    IF pg_catalog.to_regclass('public.admin_access_history') IS NULL
       OR pg_catalog.to_regclass('public.profiles') IS NULL
       OR pg_catalog.to_regclass('public.beneficiary_profiles') IS NULL
       OR pg_catalog.to_regclass('public.donor_profiles') IS NULL THEN
        RAISE EXCEPTION 'Deploy 20261026000100_super_admin_management.sql first';
    END IF;

    IF (SELECT pg_catalog.count(*)
          FROM pg_catalog.pg_attribute
         WHERE attrelid = 'auth.users'::pg_catalog.regclass
           AND NOT attisdropped
           AND attname IN ('id', 'email', 'created_at', 'deleted_at',
                           'is_anonymous', 'email_confirmed_at')) <> 6 THEN
        RAISE EXCEPTION 'Expected Supabase Auth identity columns are missing';
    END IF;

    IF pg_catalog.to_regclass('public.admin_creation_pending') IS NOT NULL THEN
        RAISE EXCEPTION 'admin_creation_pending already exists; review drift instead of replacing';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM pg_catalog.pg_proc AS p
          JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname IN (
               '_admin_creation_verify_identity',
               'super_admin_begin_admin_creation',
               'super_admin_link_admin_creation_user',
               'super_admin_commit_admin_creation',
               'super_admin_abort_admin_creation',
               'super_admin_get_creation_status')
    ) THEN
        RAISE EXCEPTION 'Admin creation functions already exist; review drift instead of replacing';
    END IF;

    IF pg_catalog.has_function_privilege('anon',
           'public.super_admin_list_admins(integer,integer)', 'EXECUTE') THEN
        RAISE EXCEPTION 'Anonymous callers can already execute super admin RPCs';
    END IF;
END;
$preflight$;

-- ---------------------------------------------------------------------------
-- Intent table
-- ---------------------------------------------------------------------------
-- Both link FKs use ON DELETE RESTRICT. That yields the invariant the whole
-- design depends on:
--
--     user_id IS NOT NULL  =>  the Auth user row still exists
--
-- Deleting an Auth user cascades into public.profiles, and this RESTRICT then
-- aborts the delete. So a linked Auth identity cannot vanish silently, and an
-- unlinked one is never deleted on the strength of an email match alone: the
-- abort RPC must abandon the link explicitly first.

CREATE TABLE public.admin_creation_pending (
    intent_id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),

    -- Who opened the intent. Kept separate from committed_by so a successor
    -- Super Admin can finish or inspect an intent the opener abandoned.
    requested_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,

    -- Required profile facts. handle_new_user() rejects any role other than
    -- donor/beneficiary and requires a BD phone plus district/thana/area, so
    -- truthful values are collected up front. No placeholder data is written.
    target_full_name text NOT NULL,
    target_email text NOT NULL,
    target_phone text NOT NULL,
    target_district text NOT NULL,
    target_thana text NOT NULL,
    target_local_area text NOT NULL,

    -- Management reason, mirrored onto the audit event on commit.
    reason text NOT NULL,

    -- Records how the Super Admin established mailbox ownership. email_confirm
    -- stays false, so this documents human verification rather than claiming a
    -- machine-verified address.
    verification_method text NOT NULL,

    -- Durable link to the created Auth identity, written by its own RPC.
    user_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,

    -- Consumption triple: written together or not at all.
    consumed_at timestamp with time zone,
    audit_history_id uuid REFERENCES public.admin_access_history(id) ON DELETE RESTRICT,
    committed_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,

    -- Abandonment record. cleanup_target_user_id deliberately has no FK: it
    -- must survive the deletion it describes.
    cancelled_at timestamp with time zone,
    cancelled_reason text,
    cancelled_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
    cleanup_target_user_id uuid,

    created_at timestamp with time zone NOT NULL DEFAULT pg_catalog.clock_timestamp(),
    expires_at timestamp with time zone NOT NULL,

    CONSTRAINT admin_creation_pending_email_norm_check CHECK (
        target_email = pg_catalog.lower(pg_catalog.btrim(target_email))
        AND pg_catalog.char_length(target_email) BETWEEN 3 AND 320),
    CONSTRAINT admin_creation_pending_phone_check CHECK (
        target_phone ~ '^01[3-9][0-9]{8}$'),
    CONSTRAINT admin_creation_pending_trim_check CHECK (
        target_full_name = pg_catalog.btrim(target_full_name)
        AND target_district = pg_catalog.btrim(target_district)
        AND target_thana = pg_catalog.btrim(target_thana)
        AND target_local_area = pg_catalog.btrim(target_local_area)),
    CONSTRAINT admin_creation_pending_reason_check CHECK (
        reason = pg_catalog.regexp_replace(reason, '^[[:space:]]+|[[:space:]]+$', '', 'g')
        AND pg_catalog.char_length(reason) BETWEEN 10 AND 500),
    CONSTRAINT admin_creation_pending_verification_check CHECK (
        verification_method IN ('out_of_band_in_person')),
    CONSTRAINT admin_creation_pending_expiry_check CHECK (expires_at > created_at),

    -- Consumption is atomic: unset or complete, never partial. A partial write
    -- would make "pending" unprovable, so it is made unrepresentable.
    CONSTRAINT admin_creation_pending_consumption_check CHECK (
        (consumed_at IS NULL) = (audit_history_id IS NULL)
        AND (consumed_at IS NULL) = (committed_by IS NULL)),

    CONSTRAINT admin_creation_pending_cancel_check CHECK (
        (cancelled_at IS NULL AND cancelled_reason IS NULL
         AND cancelled_by IS NULL AND cleanup_target_user_id IS NULL)
        OR (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL
            AND cancelled_reason IS NOT NULL
            AND cancelled_reason = pg_catalog.regexp_replace(
                    cancelled_reason, '^[[:space:]]+|[[:space:]]+$', '', 'g')
            AND pg_catalog.char_length(cancelled_reason) BETWEEN 10 AND 500)),

    -- An intent is consumed or abandoned, never both.
    CONSTRAINT admin_creation_pending_not_both_check CHECK (
        cancelled_at IS NULL
        OR (consumed_at IS NULL AND audit_history_id IS NULL AND committed_by IS NULL)),

    -- Aborting releases the link in the same statement that records the
    -- cancellation, so a cancelled intent never pins a profiles row.
    CONSTRAINT admin_creation_pending_cancel_unlinks_check CHECK (
        cancelled_at IS NULL OR user_id IS NULL)
);

ALTER TABLE public.admin_creation_pending OWNER TO postgres;
ALTER TABLE public.admin_creation_pending ENABLE ROW LEVEL SECURITY;
-- No policies. Every read and write goes through a SECURITY DEFINER RPC; grants
-- are the real control because service_role holds BYPASSRLS.
REVOKE ALL ON TABLE public.admin_creation_pending
    FROM PUBLIC, anon, authenticated, service_role;

-- One live intent per email, so two Super Admins cannot race the same address.
CREATE UNIQUE INDEX admin_creation_pending_open_email_key
    ON public.admin_creation_pending (target_email)
    WHERE consumed_at IS NULL AND cancelled_at IS NULL;

-- One live intent per linked Auth identity.
CREATE UNIQUE INDEX admin_creation_pending_active_user_key
    ON public.admin_creation_pending (user_id)
    WHERE user_id IS NOT NULL AND cancelled_at IS NULL;

-- One cleanup claim per Auth identity.
CREATE UNIQUE INDEX admin_creation_pending_cleanup_target_key
    ON public.admin_creation_pending (cleanup_target_user_id)
    WHERE cleanup_target_user_id IS NOT NULL;

COMMENT ON TABLE public.admin_creation_pending IS
    'Intent-first Admin provisioning. RPC-only; no client or service_role access.';

-- ---------------------------------------------------------------------------
-- Audit history: exact intent link and the 'created' action
-- ---------------------------------------------------------------------------

ALTER TABLE public.admin_access_history ADD COLUMN creation_intent_id uuid;

-- At most one created audit event per intent.
CREATE UNIQUE INDEX admin_access_history_creation_intent_key
    ON public.admin_access_history (creation_intent_id)
    WHERE creation_intent_id IS NOT NULL;

ALTER TABLE public.admin_access_history
    ADD CONSTRAINT admin_access_history_creation_intent_fkey
    FOREIGN KEY (creation_intent_id)
    REFERENCES public.admin_creation_pending(intent_id) ON DELETE RESTRICT;

-- 'created' requires an intent; every pre-existing action forbids one, so all
-- historical rows satisfy this CHECK without being rewritten.
ALTER TABLE public.admin_access_history
    ADD CONSTRAINT admin_access_history_creation_intent_required_check CHECK (
        (action = 'created' AND creation_intent_id IS NOT NULL)
        OR (action <> 'created' AND creation_intent_id IS NULL));

-- The existing action CHECK is an inline column constraint, so PostgreSQL
-- auto-named it. Discover the real name instead of assuming it: a wrong DROP
-- would remove an unrelated constraint.
DO $rename_action_check$
DECLARE
    check_name text;
    check_count integer := 0;
    candidate record;
BEGIN
    -- Iterate rather than aggregate so no type-specific aggregate is assumed.
    FOR candidate IN
        SELECT c.conname
          FROM pg_catalog.pg_constraint AS c
         WHERE c.conrelid = 'public.admin_access_history'::pg_catalog.regclass
           AND c.contype = 'c'
           AND pg_catalog.pg_get_constraintdef(c.oid) LIKE '%action = ANY%'
    LOOP
        check_count := check_count + 1;
        check_name := candidate.conname;
    END LOOP;

    IF check_count <> 1 THEN
        RAISE EXCEPTION 'Expected exactly one action CHECK on admin_access_history, found %',
            check_count;
    END IF;

    EXECUTE pg_catalog.format(
        'ALTER TABLE public.admin_access_history DROP CONSTRAINT %I', check_name);
END;
$rename_action_check$;

ALTER TABLE public.admin_access_history
    ADD CONSTRAINT admin_access_history_action_check CHECK (
        action IN ('appointed', 'revoked', 'bootstrap_super_admin', 'created'));

ALTER TABLE public.admin_access_history
    DROP CONSTRAINT admin_access_history_transition_check;

ALTER TABLE public.admin_access_history
    ADD CONSTRAINT admin_access_history_transition_check CHECK (
        (action = 'appointed' AND actor_id IS NOT NULL AND actor_id <> target_user_id
         AND actor_role IS NOT NULL AND actor_role = 'super_admin'
         AND operator_reference IS NULL
         AND new_role = 'admin' AND new_account_status = 'active'
         AND ((previous_role = 'beneficiary' AND previous_account_status = 'active')
              OR (previous_role = 'admin' AND previous_account_status = 'deactivated')))
        OR (action = 'revoked' AND actor_id IS NOT NULL AND actor_id <> target_user_id
         AND actor_role IS NOT NULL AND actor_role = 'super_admin'
         AND operator_reference IS NULL
         AND previous_role = 'admin' AND previous_account_status = 'active'
         AND new_role = 'admin' AND new_account_status = 'deactivated')
        OR (action = 'created' AND actor_id IS NOT NULL AND actor_id <> target_user_id
         AND actor_role IS NOT NULL AND actor_role = 'super_admin'
         AND operator_reference IS NULL
         AND creation_intent_id IS NOT NULL
         AND previous_role = 'beneficiary' AND previous_account_status = 'active'
         AND new_role = 'admin' AND new_account_status = 'active')
        OR (action = 'bootstrap_super_admin' AND actor_id IS NULL AND actor_role IS NULL
         AND operator_reference IS NOT NULL
         AND operator_reference = pg_catalog.regexp_replace(
                operator_reference, '^[[:space:]]+|[[:space:]]+$', '', 'g')
         AND pg_catalog.char_length(operator_reference) BETWEEN 10 AND 200
         AND previous_role = 'beneficiary' AND previous_account_status = 'active'
         AND new_role = 'super_admin' AND new_account_status = 'active'));

-- ---------------------------------------------------------------------------
-- Identity verification helper
-- ---------------------------------------------------------------------------
-- Single source of truth for "is this the exact Auth identity this intent
-- created?". Called by link (durable write) and commit (promotion).
--
-- SECURITY INVOKER on purpose: it is only ever called from the postgres-owned
-- SECURITY DEFINER RPCs below, and no client role holds EXECUTE on it.
--
-- PostgreSQL 17 has no min(uuid)/max(uuid) aggregate. A single-statement
-- aggregate with an array subscript is used instead. The subscript is only
-- consulted when exactly one row matched, so no ordering assumption is made.

CREATE FUNCTION public._admin_creation_verify_identity(
    p_target_email text,
    p_window_start timestamp with time zone,
    p_window_end timestamp with time zone,
    p_user_id uuid
) RETURNS void
LANGUAGE plpgsql
SET search_path = ''
SET lock_timeout = '5s'
AS $verify$
DECLARE
    match_count bigint;
    matched_id uuid;
    matched_anon boolean;
    matched_created_at timestamp with time zone;
    matched_email text;
BEGIN
    IF p_user_id IS NULL OR p_target_email IS NULL
       OR p_window_start IS NULL OR p_window_end IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
            MESSAGE = 'Identity verification inputs are required';
    END IF;

    SELECT pg_catalog.count(*),
           (pg_catalog.array_agg(u.id))[1],
           (pg_catalog.array_agg(u.is_anonymous))[1],
           (pg_catalog.array_agg(u.created_at))[1],
           (pg_catalog.array_agg(pg_catalog.lower(pg_catalog.btrim(u.email))))[1]
      INTO match_count, matched_id, matched_anon, matched_created_at, matched_email
      FROM auth.users AS u
     WHERE pg_catalog.lower(pg_catalog.btrim(u.email)) = p_target_email
       AND u.deleted_at IS NULL;

    -- Zero or several live matches is ambiguous. Never guess with LIMIT 1.
    IF match_count <> 1 THEN
        RAISE EXCEPTION USING ERRCODE = '55000',
            MESSAGE = 'Auth identity is missing or ambiguous for this email';
    END IF;

    IF matched_id <> p_user_id THEN
        RAISE EXCEPTION USING ERRCODE = '55000',
            MESSAGE = 'Auth identity does not match the intent';
    END IF;

    IF matched_email <> p_target_email THEN
        RAISE EXCEPTION USING ERRCODE = '55000',
            MESSAGE = 'Auth identity does not match the intent';
    END IF;

    IF matched_anon IS TRUE THEN
        RAISE EXCEPTION USING ERRCODE = '55000',
            MESSAGE = 'Anonymous accounts cannot become admins';
    END IF;

    -- Re-confirm under a row lock so a concurrent delete cannot slip between
    -- the aggregate above and the caller's write.
    PERFORM 1
       FROM auth.users AS u
      WHERE u.id = p_user_id
        AND u.deleted_at IS NULL
      FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '55000',
            MESSAGE = 'Auth identity does not match the intent';
    END IF;

    IF matched_created_at < p_window_start OR matched_created_at > p_window_end THEN
        RAISE EXCEPTION USING ERRCODE = '55000',
            MESSAGE = 'Auth identity was not created inside this intent window';
    END IF;
END;
$verify$;

ALTER FUNCTION public._admin_creation_verify_identity(
    text, timestamp with time zone, timestamp with time zone, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public._admin_creation_verify_identity(
    text, timestamp with time zone, timestamp with time zone, uuid)
    FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- begin: open an intent and return the authoritative provisioning payload
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.super_admin_begin_admin_creation(
    p_full_name text,
    p_email text,
    p_phone text,
    p_district text,
    p_thana text,
    p_local_area text,
    p_reason text
) RETURNS TABLE (
    intent_id uuid,
    email text,
    expires_at timestamp with time zone
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
AS $begin$
DECLARE
    caller uuid := auth.uid();
    normalized_email text := pg_catalog.lower(pg_catalog.btrim(COALESCE(p_email, '')));
    clean_reason text;
    new_intent uuid;
    window_end timestamp with time zone;
BEGIN
    PERFORM 1
       FROM public.profiles AS p
      WHERE p.id = caller
        AND p.role = 'super_admin'
        AND p.account_status = 'active'
      FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
            MESSAGE = 'Active super administrator required';
    END IF;

    IF p_full_name IS NULL OR pg_catalog.btrim(p_full_name) = ''
       OR p_phone IS NULL OR p_district IS NULL OR pg_catalog.btrim(p_district) = ''
       OR p_thana IS NULL OR pg_catalog.btrim(p_thana) = ''
       OR p_local_area IS NULL OR pg_catalog.btrim(p_local_area) = '' THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
            MESSAGE = 'Full name, phone, district, thana and local area are required';
    END IF;

    IF p_phone !~ '^01[3-9][0-9]{8}$' THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
            MESSAGE = 'Enter an 11-digit Bangladesh mobile number';
    END IF;

    IF normalized_email !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
            MESSAGE = 'Enter a valid email address';
    END IF;

    IF p_reason IS NULL OR pg_catalog.octet_length(p_reason) > 4096 THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
            MESSAGE = 'Invalid management reason';
    END IF;
    clean_reason := pg_catalog.regexp_replace(
        p_reason, '^[[:space:]]+|[[:space:]]+$', '', 'g');
    IF pg_catalog.char_length(clean_reason) NOT BETWEEN 10 AND 500 THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
            MESSAGE = 'Invalid management reason';
    END IF;

    -- Advisory only. The commit path re-checks the real Auth state, because a
    -- different identity could appear between this call and the commit.
    IF EXISTS (
        SELECT 1 FROM auth.users AS u
         WHERE pg_catalog.lower(pg_catalog.btrim(u.email)) = normalized_email
           AND u.deleted_at IS NULL) THEN
        RAISE EXCEPTION USING ERRCODE = '55000',
            MESSAGE = 'An account already uses that email';
    END IF;

    window_end := pg_catalog.clock_timestamp() + interval '15 minutes';

    INSERT INTO public.admin_creation_pending (
        requested_by, target_full_name, target_email, target_phone,
        target_district, target_thana, target_local_area,
        reason, verification_method, expires_at)
    VALUES (
        caller, pg_catalog.btrim(p_full_name), normalized_email, p_phone,
        pg_catalog.btrim(p_district), pg_catalog.btrim(p_thana),
        pg_catalog.btrim(p_local_area), clean_reason,
        'out_of_band_in_person', window_end)
    RETURNING admin_creation_pending.intent_id INTO new_intent;

    RETURN QUERY SELECT new_intent, normalized_email, window_end;
END;
$begin$;

-- ---------------------------------------------------------------------------
-- link: persist the created Auth identity in its own transaction
-- ---------------------------------------------------------------------------
-- This is the durability guarantee. The link is written by a standalone RPC, so
-- if the later commit fails the intent still records which Auth user was
-- created and abort can therefore clean it up.
--
-- expires_at is deliberately NOT compared with now() here. Expiry only governs
-- creating a NEW identity (exposed as status.creation_allowed). Binding a late
-- link is safe because the identity must have been created inside the intent
-- window, which _admin_creation_verify_identity proves.

CREATE FUNCTION public.super_admin_link_admin_creation_user(
    p_intent_id uuid,
    p_user_id uuid
) RETURNS TABLE (
    intent_id uuid,
    status text,
    target_user_id uuid,
    linked boolean
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
AS $link$
DECLARE
    caller uuid := auth.uid();
    intent public.admin_creation_pending%ROWTYPE;
    linked_events bigint;
BEGIN
    PERFORM 1
       FROM public.profiles AS p
      WHERE p.id = caller
        AND p.role = 'super_admin'
        AND p.account_status = 'active'
      FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
            MESSAGE = 'Active super administrator required';
    END IF;

    IF p_intent_id IS NULL OR p_user_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
            MESSAGE = 'Intent and account are required';
    END IF;

    SELECT i.* INTO intent
      FROM public.admin_creation_pending AS i
     WHERE i.intent_id = p_intent_id
       AND (i.requested_by = caller
            OR NOT EXISTS (SELECT 1 FROM public.profiles AS r
                            WHERE r.id = i.requested_by
                              AND r.role = 'super_admin'
                              AND r.account_status = 'active'))
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002',
            MESSAGE = 'Creation intent not found';
    END IF;

    IF intent.cancelled_at IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = '55000',
            MESSAGE = 'Creation intent was aborted';
    END IF;

    IF intent.consumed_at IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = '55000',
            MESSAGE = 'Creation intent is already committed';
    END IF;

    IF intent.user_id IS NOT NULL AND intent.user_id <> p_user_id THEN
        RAISE EXCEPTION USING ERRCODE = '55000',
            MESSAGE = 'Creation intent is already linked to another account';
    END IF;

    SELECT pg_catalog.count(*) INTO linked_events
      FROM public.admin_access_history AS h
     WHERE h.creation_intent_id = intent.intent_id;
    IF linked_events <> 0
       OR EXISTS (SELECT 1 FROM public.admin_access_history AS h
                   WHERE h.action = 'created' AND h.target_user_id = p_user_id) THEN
        RAISE EXCEPTION USING ERRCODE = '55000',
            MESSAGE = 'Creation intent is inconsistent; operator review required';
    END IF;

    PERFORM public._admin_creation_verify_identity(
        intent.target_email,
        intent.created_at - interval '60 seconds',
        intent.expires_at + interval '60 seconds',
        p_user_id);

    -- Idempotent: a retried link for the same identity writes nothing.
    IF intent.user_id = p_user_id THEN
        RETURN QUERY SELECT intent.intent_id, 'pending'::text, p_user_id, true;
        RETURN;
    END IF;

    UPDATE public.admin_creation_pending AS i
       SET user_id = p_user_id
     WHERE i.intent_id = intent.intent_id;

    RETURN QUERY SELECT intent.intent_id, 'pending'::text, p_user_id, true;
END;
$link$;

-- ---------------------------------------------------------------------------
-- commit: promote the linked account and write the audit event atomically
-- ---------------------------------------------------------------------------
-- The link is a precondition here, never a side effect. If the intent is not
-- linked, commit refuses and the Edge Function links first. That ordering keeps
-- the durable link independent of this transaction.
--
-- committed_by records who actually promoted, which may differ from
-- requested_by when a successor Super Admin resumes the work. The audit actor
-- must equal committed_by, so replay validation is correct for either caller.

CREATE FUNCTION public.super_admin_commit_admin_creation(
    p_intent_id uuid,
    p_user_id uuid
) RETURNS TABLE (
    target_user_id uuid,
    assigned_role text,
    account_status text,
    history_id uuid,
    changed_at timestamp with time zone,
    replayed boolean
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
AS $commit$
DECLARE
    caller uuid := auth.uid();
    intent public.admin_creation_pending%ROWTYPE;
    audit public.admin_access_history%ROWTYPE;
    target public.profiles%ROWTYPE;
    linked_events bigint;
    audit_id uuid;
    committed_at timestamp with time zone;
BEGIN
    PERFORM 1
       FROM public.profiles AS p
      WHERE p.id = caller
        AND p.role = 'super_admin'
        AND p.account_status = 'active'
      FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
            MESSAGE = 'Active super administrator required';
    END IF;

    IF p_intent_id IS NULL OR p_user_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
            MESSAGE = 'Intent and account are required';
    END IF;

    SELECT i.* INTO intent
      FROM public.admin_creation_pending AS i
     WHERE i.intent_id = p_intent_id
       AND (i.requested_by = caller
            OR NOT EXISTS (SELECT 1 FROM public.profiles AS r
                            WHERE r.id = i.requested_by
                              AND r.role = 'super_admin'
                              AND r.account_status = 'active'))
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002',
            MESSAGE = 'Creation intent not found';
    END IF;

    IF intent.cancelled_at IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = '55000',
            MESSAGE = 'Creation intent was aborted and cannot be committed';
    END IF;

    IF intent.consumed_at IS NOT NULL THEN
        -- Replay: validate the recorded event exactly, then return it unchanged.
        SELECT h.* INTO audit
          FROM public.admin_access_history AS h
         WHERE h.id = intent.audit_history_id
           AND h.creation_intent_id = intent.intent_id
         FOR SHARE;
        IF NOT FOUND THEN
            RAISE EXCEPTION USING ERRCODE = '55000',
                MESSAGE = 'Consumed intent has no linked audit event; operator review required';
        END IF;

        IF intent.user_id IS NULL
           OR intent.committed_by IS NULL
           OR intent.user_id IS DISTINCT FROM p_user_id
           OR audit.target_user_id <> intent.user_id
           -- Compare the audit actor with who actually committed, not with the
           -- caller: a successor Super Admin must be able to read the result.
           OR audit.actor_id IS DISTINCT FROM intent.committed_by
           OR audit.action <> 'created'
           OR audit.previous_role <> 'beneficiary'
           OR audit.previous_account_status <> 'active'
           OR audit.new_role <> 'admin'
           OR audit.new_account_status <> 'active'
           OR audit.occurred_at <> intent.consumed_at THEN
            RAISE EXCEPTION USING ERRCODE = '55000',
                MESSAGE = 'Creation replay does not match its audit event';
        END IF;

        RETURN QUERY
        SELECT audit.target_user_id, audit.new_role, audit.new_account_status,
               audit.id, audit.occurred_at, true;
        RETURN;
    END IF;

    -- Unconsumed from here on.
    IF intent.user_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '55000',
            MESSAGE = 'Creation intent is not linked to an account; link it first';
    END IF;
    IF intent.user_id <> p_user_id THEN
        RAISE EXCEPTION USING ERRCODE = '55000',
            MESSAGE = 'Creation intent is linked to a different account';
    END IF;

    SELECT pg_catalog.count(*) INTO linked_events
      FROM public.admin_access_history AS h
     WHERE h.creation_intent_id = intent.intent_id;
    IF linked_events <> 0
       OR EXISTS (SELECT 1 FROM public.admin_access_history AS h
                   WHERE h.action = 'created' AND h.target_user_id = p_user_id) THEN
        RAISE EXCEPTION USING ERRCODE = '55000',
            MESSAGE = 'Creation intent is inconsistent; operator review required';
    END IF;

    -- Re-verify: the link may be minutes old and the identity may have changed.
    PERFORM public._admin_creation_verify_identity(
        intent.target_email,
        intent.created_at - interval '60 seconds',
        intent.expires_at + interval '60 seconds',
        p_user_id);

    SELECT p.* INTO target
      FROM public.profiles AS p
     WHERE p.id = p_user_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Account not found';
    END IF;

    PERFORM 1 FROM public.beneficiary_profiles AS b
     WHERE b.user_id = p_user_id FOR SHARE;

    IF NOT FOUND
       OR target.role <> 'beneficiary'
       OR target.account_status <> 'active'
       OR EXISTS (SELECT 1 FROM public.donor_profiles AS d WHERE d.user_id = p_user_id) THEN
        RAISE EXCEPTION USING ERRCODE = '55000',
            MESSAGE = 'Account is not eligible for admin creation';
    END IF;

    committed_at := pg_catalog.clock_timestamp();

    UPDATE public.profiles AS p
       SET role = 'admin', account_status = 'active', updated_at = committed_at
     WHERE p.id = p_user_id;

    INSERT INTO public.admin_access_history AS h (
        target_user_id, actor_id, actor_role, action,
        previous_role, previous_account_status, new_role, new_account_status,
        reason, occurred_at, creation_intent_id)
    VALUES (
        p_user_id, caller, 'super_admin', 'created',
        'beneficiary', 'active', 'admin', 'active',
        intent.reason, committed_at, intent.intent_id)
    RETURNING h.id INTO audit_id;

    UPDATE public.admin_creation_pending AS i
       SET consumed_at = committed_at,
           audit_history_id = audit_id,
           committed_by = caller
     WHERE i.intent_id = intent.intent_id;

    RETURN QUERY
    SELECT p_user_id, 'admin'::text, 'active'::text, audit_id, committed_at, false;
END;
$commit$;

-- ---------------------------------------------------------------------------
-- abort: abandon an uncommitted intent and release its Auth identity
-- ---------------------------------------------------------------------------
-- This is the only path that yields a deletion target. The target comes from
-- the intent row itself, never from a caller-supplied value and never from an
-- email match. If the Auth user is already gone, delete_required is false.

CREATE FUNCTION public.super_admin_abort_admin_creation(
    p_intent_id uuid,
    p_reason text
) RETURNS TABLE (
    intent_id uuid,
    status text,
    cleanup_target_user_id uuid,
    delete_required boolean
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
AS $abort$
DECLARE
    caller uuid := auth.uid();
    intent public.admin_creation_pending%ROWTYPE;
    clean_reason text;
    linked_events bigint;
    cleanup_target uuid;
    still_exists boolean;
BEGIN
    PERFORM 1
       FROM public.profiles AS p
      WHERE p.id = caller
        AND p.role = 'super_admin'
        AND p.account_status = 'active'
      FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
            MESSAGE = 'Active super administrator required';
    END IF;

    IF p_intent_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
            MESSAGE = 'Creation intent is required';
    END IF;

    IF p_reason IS NULL OR pg_catalog.octet_length(p_reason) > 4096 THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
            MESSAGE = 'Invalid cleanup reason';
    END IF;
    clean_reason := pg_catalog.regexp_replace(
        p_reason, '^[[:space:]]+|[[:space:]]+$', '', 'g');
    IF pg_catalog.char_length(clean_reason) NOT BETWEEN 10 AND 500 THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
            MESSAGE = 'Invalid cleanup reason';
    END IF;

    SELECT i.* INTO intent
      FROM public.admin_creation_pending AS i
     WHERE i.intent_id = p_intent_id
       AND (i.requested_by = caller
            OR NOT EXISTS (SELECT 1 FROM public.profiles AS r
                            WHERE r.id = i.requested_by
                              AND r.role = 'super_admin'
                              AND r.account_status = 'active'))
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002',
            MESSAGE = 'Creation intent not found';
    END IF;

    -- Already aborted: idempotent. Also the retry path when the Edge Function's
    -- deleteUser call failed the first time.
    IF intent.cancelled_at IS NOT NULL THEN
        cleanup_target := intent.cleanup_target_user_id;
        still_exists := false;
        IF cleanup_target IS NOT NULL THEN
            SELECT EXISTS (SELECT 1 FROM auth.users AS u WHERE u.id = cleanup_target)
              INTO still_exists;
        END IF;
        RETURN QUERY SELECT intent.intent_id, 'aborted'::text,
                            cleanup_target, still_exists;
        RETURN;
    END IF;

    IF intent.consumed_at IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = '55000',
            MESSAGE = 'Committed creation cannot be aborted';
    END IF;

    SELECT pg_catalog.count(*) INTO linked_events
      FROM public.admin_access_history AS h
     WHERE h.creation_intent_id = intent.intent_id;
    IF linked_events <> 0
       OR (intent.user_id IS NOT NULL AND EXISTS (
             SELECT 1 FROM public.admin_access_history AS h
              WHERE h.action = 'created' AND h.target_user_id = intent.user_id)) THEN
        RAISE EXCEPTION USING ERRCODE = '55000',
            MESSAGE = 'Creation intent is inconsistent; operator review required';
    END IF;

    cleanup_target := intent.user_id;

    -- Release the link and record cancellation in one statement, so the
    -- cancel_unlinks CHECK never sees an intermediate state.
    UPDATE public.admin_creation_pending AS i
       SET cleanup_target_user_id = cleanup_target,
           user_id = NULL,
           cancelled_at = pg_catalog.clock_timestamp(),
           cancelled_reason = clean_reason,
           cancelled_by = caller
     WHERE i.intent_id = intent.intent_id;

    still_exists := false;
    IF cleanup_target IS NOT NULL THEN
        SELECT EXISTS (SELECT 1 FROM auth.users AS u WHERE u.id = cleanup_target)
          INTO still_exists;
    END IF;

    RETURN QUERY SELECT intent.intent_id, 'aborted'::text,
                        cleanup_target, still_exists;
END;
$abort$;

-- ---------------------------------------------------------------------------
-- status: authoritative state plus the provisioning payload
-- ---------------------------------------------------------------------------
-- Returns the projection the Edge Function must use for createUser, so no
-- email or profile value is ever taken from the untrusted request body.
--
--   pending      proven: no 'created' audit event can exist for this intent
--   committed    promoted and audited; replay-validated
--   aborted      deliberately abandoned
--   inconsistent unknown or ambiguous; never authorizes deletion
--
-- creation_allowed governs only creating a NEW Auth identity.
-- deletion_authorized is advisory: the Edge Function must still call abort to
-- obtain the exact cleanup id. is_expired never changes the status.

CREATE FUNCTION public.super_admin_get_creation_status(p_intent_id uuid)
RETURNS TABLE (
    intent_id uuid,
    status text,
    target_user_id uuid,
    consumed_at timestamp with time zone,
    audit_history_id uuid,
    expires_at timestamp with time zone,
    is_expired boolean,
    cleanup_state text,
    cleanup_target_user_id uuid,
    deletion_authorized boolean,
    creation_allowed boolean,
    target_email text,
    target_full_name text,
    target_phone text,
    target_district text,
    target_thana text,
    target_local_area text
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
AS $status$
DECLARE
    caller uuid := auth.uid();
    intent public.admin_creation_pending%ROWTYPE;
    audit public.admin_access_history%ROWTYPE;
    linked_events bigint;
    created_for_target bigint;
    intent_status text;
    cleanup uuid;
    cleanup_state_value text;
BEGIN
    PERFORM 1
       FROM public.profiles AS p
      WHERE p.id = caller
        AND p.role = 'super_admin'
        AND p.account_status = 'active'
      FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
            MESSAGE = 'Active super administrator required';
    END IF;

    IF p_intent_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
            MESSAGE = 'Creation intent is required';
    END IF;

    -- Lock so the answer cannot straddle a concurrent commit or abort.
    SELECT i.* INTO intent
      FROM public.admin_creation_pending AS i
     WHERE i.intent_id = p_intent_id
       AND (i.requested_by = caller
            OR NOT EXISTS (SELECT 1 FROM public.profiles AS r
                            WHERE r.id = i.requested_by
                              AND r.role = 'super_admin'
                              AND r.account_status = 'active'))
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002',
            MESSAGE = 'Creation intent not found';
    END IF;

    cleanup := intent.cleanup_target_user_id;
    IF intent.cancelled_at IS NULL THEN
        cleanup_state_value := 'none';
    ELSIF cleanup IS NULL THEN
        cleanup_state_value := 'deleted';
    ELSIF EXISTS (SELECT 1 FROM auth.users AS u WHERE u.id = cleanup) THEN
        cleanup_state_value := 'delete_pending';
    ELSE
        cleanup_state_value := 'deleted';
    END IF;

    SELECT pg_catalog.count(*) INTO linked_events
      FROM public.admin_access_history AS h
     WHERE h.creation_intent_id = intent.intent_id;

    IF intent.cancelled_at IS NOT NULL AND intent.consumed_at IS NOT NULL THEN
        intent_status := 'inconsistent';
    ELSIF intent.consumed_at IS NOT NULL THEN
        SELECT h.* INTO audit
          FROM public.admin_access_history AS h
         WHERE h.id = intent.audit_history_id
           AND h.creation_intent_id = intent.intent_id
         FOR SHARE;

        IF NOT FOUND
           OR linked_events <> 1
           OR intent.user_id IS NULL
           OR intent.committed_by IS NULL
           OR audit.target_user_id <> intent.user_id
           -- Successor-safe: compare against who committed, not the caller.
           OR audit.actor_id IS DISTINCT FROM intent.committed_by
           OR audit.action <> 'created'
           OR audit.previous_role <> 'beneficiary'
           OR audit.previous_account_status <> 'active'
           OR audit.new_role <> 'admin'
           OR audit.new_account_status <> 'active'
           OR audit.occurred_at <> intent.consumed_at THEN
            intent_status := 'inconsistent';
        ELSE
            intent_status := 'committed';
        END IF;
    ELSIF intent.cancelled_at IS NOT NULL THEN
        IF linked_events <> 0
           OR (cleanup IS NOT NULL AND EXISTS (
                 SELECT 1 FROM public.admin_access_history AS h
                  WHERE h.action = 'created' AND h.target_user_id = cleanup)) THEN
            intent_status := 'inconsistent';
        ELSE
            intent_status := 'aborted';
        END IF;
    ELSIF linked_events <> 0 THEN
        intent_status := 'inconsistent';
    ELSIF intent.user_id IS NOT NULL THEN
        SELECT pg_catalog.count(*) INTO created_for_target
          FROM public.admin_access_history AS h
         WHERE h.action = 'created' AND h.target_user_id = intent.user_id;

        IF created_for_target <> 0 THEN
            intent_status := 'inconsistent';
        ELSIF EXISTS (SELECT 1 FROM auth.users AS u WHERE u.id = intent.user_id) THEN
            intent_status := 'pending';
        ELSE
            -- A live link whose Auth user vanished contradicts the RESTRICT
            -- invariant: treat as unrecoverable rather than claim pending.
            intent_status := 'inconsistent';
        END IF;
    ELSE
        intent_status := 'pending';
    END IF;

    RETURN QUERY SELECT
        intent.intent_id,
        intent_status,
        intent.user_id,
        intent.consumed_at,
        intent.audit_history_id,
        intent.expires_at,
        (pg_catalog.clock_timestamp() > intent.expires_at),
        cleanup_state_value,
        cleanup,
        (intent_status = 'pending' AND intent.user_id IS NOT NULL
         AND intent.cancelled_at IS NULL),
        (intent_status = 'pending' AND intent.user_id IS NULL
         AND pg_catalog.clock_timestamp() <= intent.expires_at),
        intent.target_email,
        intent.target_full_name,
        intent.target_phone,
        intent.target_district,
        intent.target_thana,
        intent.target_local_area;
END;
$status$;

-- ---------------------------------------------------------------------------
-- Ownership, revocation and grants
-- ---------------------------------------------------------------------------
-- Order matters: ALTER/REVOKE/GRANT must follow every CREATE FUNCTION above.
--
-- service_role is explicitly denied. The Edge Function calls these RPCs with
-- the Super Admin's own user JWT so auth.uid() resolves; the service key is
-- used only for auth.admin.createUser and auth.admin.deleteUser. Denying
-- service_role here makes that separation enforceable rather than a convention.

ALTER FUNCTION public.super_admin_begin_admin_creation(
    text, text, text, text, text, text, text) OWNER TO postgres;
ALTER FUNCTION public.super_admin_link_admin_creation_user(uuid, uuid) OWNER TO postgres;
ALTER FUNCTION public.super_admin_commit_admin_creation(uuid, uuid) OWNER TO postgres;
ALTER FUNCTION public.super_admin_abort_admin_creation(uuid, text) OWNER TO postgres;
ALTER FUNCTION public.super_admin_get_creation_status(uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.super_admin_begin_admin_creation(
    text, text, text, text, text, text, text)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.super_admin_link_admin_creation_user(uuid, uuid)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.super_admin_commit_admin_creation(uuid, uuid)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.super_admin_abort_admin_creation(uuid, text)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.super_admin_get_creation_status(uuid)
    FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.super_admin_begin_admin_creation(
    text, text, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.super_admin_link_admin_creation_user(uuid, uuid)
    TO authenticated;
GRANT EXECUTE ON FUNCTION public.super_admin_commit_admin_creation(uuid, uuid)
    TO authenticated;
GRANT EXECUTE ON FUNCTION public.super_admin_abort_admin_creation(uuid, text)
    TO authenticated;
GRANT EXECUTE ON FUNCTION public.super_admin_get_creation_status(uuid)
    TO authenticated;

-- ---------------------------------------------------------------------------
-- Fail closed on unexpected effective access
-- ---------------------------------------------------------------------------
-- Checks the new objects only; existing grants are never modified here. Unlike
-- M6 this also asserts service_role, because the service key is part of the
-- Admin creation flow and BYPASSRLS makes RLS irrelevant to it.

DO $effective_permissions$
DECLARE
    client_role text;
    signature text;
BEGIN
    FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
        IF pg_catalog.has_table_privilege(client_role,
               'public.admin_creation_pending',
               'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
           OR pg_catalog.has_any_column_privilege(client_role,
               'public.admin_creation_pending',
               'SELECT,INSERT,UPDATE,REFERENCES') THEN
            RAISE EXCEPTION '% retains direct access to admin_creation_pending',
                client_role;
        END IF;
    END LOOP;

    -- The identity helper must never be directly callable by a client role.
    IF pg_catalog.has_function_privilege('anon',
           'public._admin_creation_verify_identity(text,timestamp with time zone,timestamp with time zone,uuid)',
           'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated',
           'public._admin_creation_verify_identity(text,timestamp with time zone,timestamp with time zone,uuid)',
           'EXECUTE')
       OR pg_catalog.has_function_privilege('service_role',
           'public._admin_creation_verify_identity(text,timestamp with time zone,timestamp with time zone,uuid)',
           'EXECUTE') THEN
        RAISE EXCEPTION 'Identity helper must not be directly executable by client roles';
    END IF;

    FOREACH signature IN ARRAY ARRAY[
        'public.super_admin_begin_admin_creation(text,text,text,text,text,text,text)',
        'public.super_admin_link_admin_creation_user(uuid,uuid)',
        'public.super_admin_commit_admin_creation(uuid,uuid)',
        'public.super_admin_abort_admin_creation(uuid,text)',
        'public.super_admin_get_creation_status(uuid)'
    ] LOOP
        IF pg_catalog.has_function_privilege('anon', signature, 'EXECUTE')
           OR pg_catalog.has_function_privilege('service_role', signature, 'EXECUTE')
           OR NOT pg_catalog.has_function_privilege('authenticated', signature, 'EXECUTE') THEN
            RAISE EXCEPTION 'Unexpected EXECUTE grants on %', signature;
        END IF;
    END LOOP;

    -- Every creation RPC must be postgres-owned, SECURITY DEFINER, and carry an
    -- empty search_path.
    IF EXISTS (
        SELECT 1
          FROM pg_catalog.pg_proc AS p
         WHERE p.pronamespace = 'public'::pg_catalog.regnamespace
           AND p.proname IN (
               'super_admin_begin_admin_creation',
               'super_admin_link_admin_creation_user',
               'super_admin_commit_admin_creation',
               'super_admin_abort_admin_creation',
               'super_admin_get_creation_status')
           AND (p.proowner <> 'postgres'::pg_catalog.regrole
                OR NOT p.prosecdef
                OR NOT EXISTS (
                    SELECT 1 FROM pg_catalog.unnest(p.proconfig) AS cfg
                     WHERE cfg LIKE 'search_path=%'))) THEN
        RAISE EXCEPTION 'Admin creation RPC ownership or security settings are wrong';
    END IF;
END;
$effective_permissions$;
