-- REVIEW DRAFT ONLY. No deployment approval; see docs/admin-donor-verification.md.
-- PostgreSQL 17 / initialized Supabase, AFTER the three reviewed drafts AND
-- separately approved TRIGGER hardening. Historical grants intentionally cause
-- this file to fail until that prerequisite is satisfied; no automatic revokes.
-- The CLI must own this file's transaction. Never run with autocommit.
SET LOCAL search_path = '';
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL check_function_bodies = on;

DO $preflight$
DECLARE
    relation_name text;
BEGIN
    IF current_user <> 'postgres'
       OR pg_catalog.current_setting('server_version_num')::integer / 10000 <> 17 THEN
        RAISE EXCEPTION 'Requires PostgreSQL 17 and current_user postgres';
    END IF;
    IF pg_catalog.to_regprocedure('auth.uid()') IS NULL THEN
        RAISE EXCEPTION 'Supabase auth.uid() is required';
    END IF;
    IF EXISTS (
        SELECT 1 FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS r(name)
        WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles AS p WHERE p.rolname = r.name)
    ) THEN
        RAISE EXCEPTION 'Required Supabase API roles are missing';
    END IF;
    FOREACH relation_name IN ARRAY ARRAY[
        'profiles', 'donor_profiles', 'beneficiary_profiles',
        'donor_availability_details', 'donor_availability_history',
        'donor_availability_reminders'
    ] LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_class AS c
            WHERE c.oid = pg_catalog.to_regclass('public.' || relation_name)
              AND c.relkind = 'r' AND c.relrowsecurity
              AND c.relowner = 'postgres'::pg_catalog.regrole
        ) THEN
            RAISE EXCEPTION 'Missing, unexpected owner, or RLS-disabled BMS prerequisite: %', relation_name;
        END IF;
        IF pg_catalog.has_table_privilege('anon', 'public.' || relation_name, 'TRUNCATE')
           OR pg_catalog.has_table_privilege('authenticated', 'public.' || relation_name, 'TRUNCATE') THEN
            RAISE EXCEPTION 'Apply and verify the separate TRUNCATE fix before this migration';
        END IF;
        IF pg_catalog.has_table_privilege('anon', 'public.' || relation_name, 'TRIGGER')
           OR pg_catalog.has_table_privilege('authenticated', 'public.' || relation_name, 'TRIGGER') THEN
            RAISE EXCEPTION 'Client TRIGGER access requires separate reviewed hardening before this migration';
        END IF;
    END LOOP;
    IF pg_catalog.to_regclass('public.donor_verification_history') IS NOT NULL
       OR EXISTS (
           SELECT 1 FROM pg_catalog.pg_proc AS p
           JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public'
             AND p.proname IN ('admin_list_pending_donors', 'admin_review_donor')
       ) THEN
        RAISE EXCEPTION 'Admin objects already exist; review drift instead of replacing them';
    END IF;
END;
$preflight$;

-- Serialize the data check with inserts/updates; never rewrite historical statuses.
LOCK TABLE public.donor_profiles IN ACCESS EXCLUSIVE MODE;
DO $status_preflight$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.donor_profiles AS d
        WHERE d.verification_status IS NULL
           OR d.verification_status NOT IN ('pending', 'approved', 'rejected')
    ) THEN
        RAISE EXCEPTION 'Existing verification statuses need separate reviewed remediation';
    END IF;
END;
$status_preflight$;
ALTER TABLE public.donor_profiles ALTER COLUMN verification_status SET DEFAULT 'pending';
ALTER TABLE public.donor_profiles ALTER COLUMN verification_status SET NOT NULL;

CREATE TABLE public.donor_verification_history (
    id uuid DEFAULT pg_catalog.gen_random_uuid() PRIMARY KEY,
    donor_id uuid NOT NULL REFERENCES public.donor_profiles(user_id) ON DELETE RESTRICT,
    reviewer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    reviewer_role text NOT NULL CHECK (reviewer_role IN ('admin', 'super_admin')),
    previous_status text NOT NULL CHECK (previous_status = 'pending'),
    new_status text NOT NULL CHECK (new_status IN ('approved', 'rejected')),
    rejection_reason text,
    reviewed_at timestamp with time zone NOT NULL,
    CONSTRAINT donor_verification_reason_check CHECK (
        (new_status = 'approved' AND rejection_reason IS NULL)
        OR (new_status = 'rejected' AND rejection_reason IS NOT NULL
            AND rejection_reason = pg_catalog.regexp_replace(rejection_reason,
                '^[[:space:]]+|[[:space:]]+$', '', 'g')
            AND pg_catalog.char_length(rejection_reason) BETWEEN 10 AND 500)
    )
);
ALTER TABLE public.donor_verification_history OWNER TO postgres;
ALTER TABLE public.donor_verification_history ENABLE ROW LEVEL SECURITY;
-- No client policies. Remove grants introduced by broad historical defaults.
REVOKE ALL ON TABLE public.donor_verification_history FROM PUBLIC, anon, authenticated, service_role;
CREATE INDEX donor_verification_history_donor_idx
    ON public.donor_verification_history (donor_id, reviewed_at DESC, id);
CREATE INDEX donor_profiles_pending_review_idx
    ON public.donor_profiles (created_at, user_id) WHERE verification_status = 'pending';

CREATE FUNCTION public.admin_list_pending_donors(
    page_size integer DEFAULT 20, page_offset integer DEFAULT 0
) RETURNS TABLE (
    donor_id uuid, full_name text, blood_group text, age_years integer,
    last_donation_date date, district text, thana text, local_area text,
    registered_at timestamp with time zone
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
AS $list$
DECLARE
    actor_id uuid := auth.uid();
    actor_role text;
BEGIN
    -- Serialize authorization with concurrent account demotion/suspension.
    SELECT p.role INTO actor_role
    FROM public.profiles AS p
    WHERE p.id = actor_id AND p.account_status = 'active'
      AND p.role IN ('admin', 'super_admin')
    FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Active administrator required';
    END IF;
    IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 50
       OR page_offset IS NULL OR page_offset NOT BETWEEN 0 AND 100000 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid pagination';
    END IF;
    RETURN QUERY
    SELECT d.user_id, p.full_name, d.blood_group,
           EXTRACT(YEAR FROM pg_catalog.age(CURRENT_DATE, d.date_of_birth))::integer,
           d.last_donation_date, p.district, p.thana, p.local_area, d.created_at
    FROM public.donor_profiles AS d
    JOIN public.profiles AS p ON p.id = d.user_id
    WHERE d.verification_status = 'pending' AND p.role = 'donor'
      AND p.account_status = 'active'
    ORDER BY d.created_at, d.user_id
    LIMIT page_size OFFSET page_offset;
END;
$list$;
ALTER FUNCTION public.admin_list_pending_donors(integer, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_list_pending_donors(integer, integer)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_pending_donors(integer, integer) TO authenticated;

CREATE FUNCTION public.admin_review_donor(
    target_donor_id uuid, decision text, rejection_reason text DEFAULT NULL
) RETURNS TABLE (
    donor_id uuid, verification_status text,
    reviewed_at timestamp with time zone, history_id uuid
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
AS $review$
DECLARE
    actor_id uuid := auth.uid();
    actor_role text;
    current_status text;
    clean_reason text;
    decision_time timestamp with time zone;
    event_id uuid;
BEGIN
    SELECT p.role INTO actor_role
    FROM public.profiles AS p
    WHERE p.id = actor_id AND p.account_status = 'active'
      AND p.role IN ('admin', 'super_admin')
    FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Active administrator required';
    END IF;
    -- Authorize first. Bound unnormalized UTF-8 input before regex/character scans.
    -- 4096 bytes permits 500 four-byte characters plus bounded edge whitespace.
    IF rejection_reason IS NOT NULL AND pg_catalog.octet_length(rejection_reason) > 4096 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Rejection reason exceeds raw input limit';
    END IF;
    clean_reason := NULLIF(pg_catalog.regexp_replace(rejection_reason,
        '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
    IF target_donor_id IS NULL OR decision IS NULL
       OR decision NOT IN ('approved', 'rejected') THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid donor review request';
    END IF;
    IF (decision = 'rejected' AND (clean_reason IS NULL
            OR pg_catalog.char_length(clean_reason) NOT BETWEEN 10 AND 500))
       OR (decision = 'approved' AND clean_reason IS NOT NULL) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid rejection reason';
    END IF;

    -- Lock target account status and donor row. The client cannot supply actor identity.
    PERFORM 1 FROM public.profiles AS p
    WHERE p.id = target_donor_id AND p.role = 'donor' AND p.account_status = 'active'
    FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Active donor not found';
    END IF;
    SELECT d.verification_status INTO current_status
    FROM public.donor_profiles AS d WHERE d.user_id = target_donor_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Active donor not found';
    END IF;
    IF current_status IS DISTINCT FROM 'pending' THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Donor is no longer pending';
    END IF;
    decision_time := pg_catalog.clock_timestamp();
    UPDATE public.donor_profiles AS d
    SET verification_status = decision, verified_by = actor_id,
        verified_at = decision_time, updated_at = decision_time,
        availability_status = 'unavailable'
    WHERE d.user_id = target_donor_id;
    INSERT INTO public.donor_verification_history AS h (
        donor_id, reviewer_id, reviewer_role, previous_status, new_status,
        rejection_reason, reviewed_at
    ) VALUES (
        target_donor_id, actor_id, actor_role, 'pending', decision,
        clean_reason, decision_time
    ) RETURNING h.id INTO event_id;
    -- No exception handler: a failed audit insert must roll back the decision.
    RETURN QUERY SELECT target_donor_id, decision, decision_time, event_id;
END;
$review$;
ALTER FUNCTION public.admin_review_donor(uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_review_donor(uuid, text, text)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_review_donor(uuid, text, text) TO authenticated;

-- Inspect effective privileges including PUBLIC, inheritance and SET ROLE paths.
-- Unknown default grantees are not silently revoked: abort for separate review.
DO $effective_permissions$
DECLARE
    client_role text;
    reachable record;
    relation_name text;
BEGIN
    FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        FOR reachable IN
            SELECT r.oid, r.rolname, r.rolsuper, r.rolbypassrls, r.rolcreaterole
            FROM pg_catalog.pg_roles AS r
            WHERE pg_catalog.pg_has_role(client_role, r.oid, 'USAGE')
               OR pg_catalog.pg_has_role(client_role, r.oid, 'SET')
        LOOP
            IF reachable.rolsuper OR reachable.rolbypassrls OR reachable.rolcreaterole THEN
                RAISE EXCEPTION 'Client can reach a privileged database role; separate review required';
            END IF;
            IF pg_catalog.has_table_privilege(reachable.oid,
                'public.donor_verification_history',
                'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
               OR pg_catalog.has_any_column_privilege(reachable.oid,
                   'public.donor_verification_history', 'SELECT,INSERT,UPDATE,REFERENCES') THEN
                RAISE EXCEPTION 'Audit table retains effective client access, including possible TRUNCATE';
            END IF;
            -- Historical TRIGGER grants can attach behavior fired by definer RPCs.
            -- Check all six BMS tables, including inherited and SET ROLE paths.
            FOREACH relation_name IN ARRAY ARRAY[
                'profiles', 'donor_profiles', 'beneficiary_profiles',
                'donor_availability_details', 'donor_availability_history',
                'donor_availability_reminders'
            ] LOOP
                IF pg_catalog.has_table_privilege(reachable.oid,
                    'public.' || relation_name, 'TRIGGER') THEN
                    RAISE EXCEPTION 'Effective client TRIGGER access requires separate reviewed hardening';
                END IF;
            END LOOP;
            FOREACH relation_name IN ARRAY ARRAY['profiles', 'donor_profiles'] LOOP
                IF pg_catalog.has_table_privilege(reachable.oid, 'public.' || relation_name,
                    'INSERT,UPDATE,DELETE,TRUNCATE')
                   OR pg_catalog.has_any_column_privilege(reachable.oid,
                       'public.' || relation_name, 'INSERT,UPDATE') THEN
                    RAISE EXCEPTION 'Client can bypass protected profile operations; separate review required';
                END IF;
            END LOOP;
            IF client_role = 'anon' AND (
                pg_catalog.has_function_privilege(reachable.oid,
                    'public.admin_list_pending_donors(integer,integer)', 'EXECUTE')
                OR pg_catalog.has_function_privilege(reachable.oid,
                    'public.admin_review_donor(uuid,text,text)', 'EXECUTE')
            ) THEN
                RAISE EXCEPTION 'Anonymous caller can execute an admin RPC';
            END IF;
        END LOOP;
    END LOOP;
    IF NOT pg_catalog.has_function_privilege('authenticated',
            'public.admin_list_pending_donors(integer,integer)', 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('authenticated',
            'public.admin_review_donor(uuid,text,text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'Authenticated RPC execution grant is missing';
    END IF;
END;
$effective_permissions$;
