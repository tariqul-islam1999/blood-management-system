-- REVIEW DRAFT ONLY. Requires separately approved deployment of 20261023000400.
-- Run this ENTIRE file in ONE runner-owned transaction with stop-on-error.
-- No existing account, donor status, signup trigger, or existing RPC is changed.
SET LOCAL search_path = '';
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL check_function_bodies = on;

DO $preflight$
DECLARE
    relation_name text;
    signature text;
BEGIN
    IF current_user <> 'postgres'
       OR pg_catalog.current_setting('server_version_num')::integer / 10000 <> 17 THEN
        RAISE EXCEPTION 'Requires PostgreSQL 17 and current_user postgres';
    END IF;
    IF pg_catalog.to_regprocedure('auth.uid()') IS NULL
       OR pg_catalog.to_regclass('auth.users') IS NULL
       OR EXISTS (
           SELECT 1 FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS r(name)
           WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles AS p WHERE p.rolname = r.name)
       ) THEN
        RAISE EXCEPTION 'Supabase Auth and API roles are required';
    END IF;
    IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_attribute
        WHERE attrelid = 'auth.users'::pg_catalog.regclass AND NOT attisdropped
          AND attname IN ('id', 'email', 'email_confirmed_at', 'is_anonymous')) <> 4 THEN
        RAISE EXCEPTION 'Expected Supabase Auth identity columns are missing';
    END IF;
    FOREACH relation_name IN ARRAY ARRAY[
        'profiles', 'donor_profiles', 'beneficiary_profiles',
        'donor_availability_details', 'donor_availability_history',
        'donor_availability_reminders', 'donor_verification_history'
    ] LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_class AS c
            WHERE c.oid = pg_catalog.to_regclass('public.' || relation_name)
              AND c.relkind = 'r' AND c.relrowsecurity
              AND c.relowner = 'postgres'::pg_catalog.regrole
        ) THEN
            RAISE EXCEPTION 'Missing, unexpected owner, or RLS-disabled prerequisite: %', relation_name;
        END IF;
    END LOOP;
    FOREACH signature IN ARRAY ARRAY[
        'public.admin_list_pending_donors(integer,integer)',
        'public.admin_review_donor(uuid,text,text)'
    ] LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_proc AS p
            WHERE p.oid = pg_catalog.to_regprocedure(signature)
              AND p.proowner = 'postgres'::pg_catalog.regrole AND p.prosecdef
        ) THEN
            RAISE EXCEPTION 'Deploy and verify donor verification migration first: %', signature;
        END IF;
    END LOOP;
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_attribute AS a
        JOIN pg_catalog.pg_attrdef AS d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attrelid = 'public.donor_profiles'::pg_catalog.regclass
          AND a.attname = 'verification_status' AND a.attnotnull
          AND pg_catalog.pg_get_expr(d.adbin, d.adrelid) = '''pending''::text'
    ) THEN
        RAISE EXCEPTION 'Donor verification default and NOT NULL prerequisite missing';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_trigger AS t
        WHERE t.tgrelid IN ('public.profiles'::pg_catalog.regclass,
                           'public.donor_profiles'::pg_catalog.regclass,
                           'public.donor_verification_history'::pg_catalog.regclass)
          AND NOT t.tgisinternal
    ) THEN
        RAISE EXCEPTION 'Unexpected profile or verification trigger; review before deployment';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_class AS c
        JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname IN (
            'admin_access_history', 'admin_access_history_event_number_seq',
            'admin_access_history_pkey', 'admin_access_history_event_number_key',
            'admin_access_history_target_event_idx', 'admin_access_history_one_bootstrap_idx')
    ) OR EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc AS p
        JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname IN (
            'super_admin_list_admins', 'super_admin_get_admin_candidate',
            'super_admin_appoint_admin', 'super_admin_revoke_admin')
    ) THEN
        RAISE EXCEPTION 'Super admin objects already exist; review drift instead of replacing';
    END IF;
END;
$preflight$;

CREATE TABLE public.admin_access_history (
    id uuid DEFAULT pg_catalog.gen_random_uuid() PRIMARY KEY,
    event_number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
    target_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    actor_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
    actor_role text,
    action text NOT NULL CHECK (action IN ('appointed', 'revoked', 'bootstrap_super_admin')),
    previous_role text NOT NULL,
    previous_account_status text NOT NULL,
    new_role text NOT NULL,
    new_account_status text NOT NULL,
    reason text NOT NULL CHECK (
        reason = pg_catalog.regexp_replace(reason, '^[[:space:]]+|[[:space:]]+$', '', 'g')
        AND pg_catalog.char_length(reason) BETWEEN 10 AND 500),
    occurred_at timestamp with time zone NOT NULL DEFAULT pg_catalog.clock_timestamp(),
    operator_reference text,
    CONSTRAINT admin_access_history_transition_check CHECK (
        (action = 'appointed' AND actor_id IS NOT NULL AND actor_id <> target_user_id
         AND actor_role IS NOT NULL AND actor_role = 'super_admin' AND operator_reference IS NULL
         AND new_role = 'admin' AND new_account_status = 'active'
         AND ((previous_role = 'beneficiary' AND previous_account_status = 'active')
              OR (previous_role = 'admin' AND previous_account_status = 'deactivated')))
        OR (action = 'revoked' AND actor_id IS NOT NULL AND actor_id <> target_user_id
         AND actor_role IS NOT NULL AND actor_role = 'super_admin' AND operator_reference IS NULL
         AND previous_role = 'admin' AND previous_account_status = 'active'
         AND new_role = 'admin' AND new_account_status = 'deactivated')
        OR (action = 'bootstrap_super_admin' AND actor_id IS NULL AND actor_role IS NULL
         AND previous_role = 'beneficiary' AND previous_account_status = 'active'
         AND new_role = 'super_admin' AND new_account_status = 'active'
         AND operator_reference IS NOT NULL
         AND operator_reference = pg_catalog.regexp_replace(
             operator_reference, '^[[:space:]]+|[[:space:]]+$', '', 'g')
         AND pg_catalog.char_length(operator_reference) BETWEEN 10 AND 200)
    )
);
ALTER TABLE public.admin_access_history OWNER TO postgres;
ALTER TABLE public.admin_access_history ENABLE ROW LEVEL SECURITY;
-- No client policies, direct reads, writes, or sequence access.
REVOKE ALL ON TABLE public.admin_access_history FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.admin_access_history_event_number_seq
    FROM PUBLIC, anon, authenticated, service_role;
CREATE INDEX admin_access_history_target_event_idx
    ON public.admin_access_history (target_user_id, event_number DESC);
CREATE UNIQUE INDEX admin_access_history_one_bootstrap_idx
    ON public.admin_access_history (action) WHERE action = 'bootstrap_super_admin';

CREATE FUNCTION public.super_admin_list_admins(
    page_size integer DEFAULT 20, page_offset integer DEFAULT 0
) RETURNS TABLE (
    user_id uuid, full_name text, account_status text, last_action text,
    last_changed_at timestamp with time zone
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET lock_timeout = '5s'
AS $list$
BEGIN
    PERFORM 1 FROM public.profiles AS p
    WHERE p.id = auth.uid() AND p.role = 'super_admin' AND p.account_status = 'active'
    FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Active super administrator required';
    END IF;
    IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 50
       OR page_offset IS NULL OR page_offset NOT BETWEEN 0 AND 100000 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid pagination';
    END IF;
    RETURN QUERY
    SELECT p.id, p.full_name, p.account_status, latest.action, latest.occurred_at
    FROM public.profiles AS p
    LEFT JOIN LATERAL (
        SELECT h.action, h.occurred_at FROM public.admin_access_history AS h
        WHERE h.target_user_id = p.id ORDER BY h.event_number DESC LIMIT 1
    ) AS latest ON true
    WHERE p.role = 'admin'
    ORDER BY p.created_at, p.id LIMIT page_size OFFSET page_offset;
END;
$list$;

CREATE FUNCTION public.super_admin_get_admin_candidate(target_user_id uuid)
RETURNS TABLE (user_id uuid, full_name text, current_role text, account_status text, eligible boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET lock_timeout = '5s'
AS $candidate$
DECLARE
    target_id uuid := target_user_id;
    target_profile public.profiles%ROWTYPE;
    verified_identity boolean;
    can_appoint boolean := false;
BEGIN
    PERFORM 1 FROM public.profiles AS p
    WHERE p.id = auth.uid() AND p.role = 'super_admin' AND p.account_status = 'active'
    FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Active super administrator required';
    END IF;
    IF target_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Target account is required';
    END IF;
    SELECT p.* INTO target_profile FROM public.profiles AS p WHERE p.id = target_id FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Account not found';
    END IF;
    SELECT u.email_confirmed_at IS NOT NULL AND u.is_anonymous IS FALSE
           AND NULLIF(pg_catalog.btrim(u.email), '') IS NOT NULL
    INTO verified_identity FROM auth.users AS u WHERE u.id = target_id FOR SHARE;
    IF target_id <> auth.uid() AND verified_identity IS TRUE
       AND NOT EXISTS (SELECT 1 FROM public.donor_profiles AS d WHERE d.user_id = target_id)
       AND EXISTS (SELECT 1 FROM public.beneficiary_profiles AS b WHERE b.user_id = target_id) THEN
        can_appoint := (target_profile.role = 'beneficiary' AND target_profile.account_status = 'active')
            OR (target_profile.role = 'admin' AND target_profile.account_status = 'deactivated'
                AND EXISTS (
                    SELECT 1 FROM (
                        SELECT h.action, h.occurred_at FROM public.admin_access_history AS h
                        WHERE h.target_user_id = target_id ORDER BY h.event_number DESC LIMIT 1
                    ) AS latest
                    WHERE latest.action = 'revoked' AND latest.occurred_at = target_profile.updated_at));
    END IF;
    RETURN QUERY SELECT target_id, target_profile.full_name, target_profile.role,
                        target_profile.account_status, can_appoint;
END;
$candidate$;

CREATE FUNCTION public.super_admin_appoint_admin(target_user_id uuid, reason text)
RETURNS TABLE (
    user_id uuid, assigned_role text, account_status text, history_id uuid,
    changed_at timestamp with time zone
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET lock_timeout = '5s'
AS $appoint$
DECLARE
    actor_id uuid := auth.uid();
    target_id uuid := target_user_id;
    target_profile public.profiles%ROWTYPE;
    verified_identity boolean;
    clean_reason text;
    decision_time timestamp with time zone;
    event_id uuid;
BEGIN
    PERFORM 1 FROM public.profiles AS p
    WHERE p.id = actor_id AND p.role = 'super_admin' AND p.account_status = 'active'
    FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Active super administrator required';
    END IF;
    IF target_id IS NULL OR target_id = actor_id THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid target account';
    END IF;
    IF reason IS NULL OR pg_catalog.octet_length(reason) > 4096 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid management reason';
    END IF;
    clean_reason := pg_catalog.regexp_replace(reason, '^[[:space:]]+|[[:space:]]+$', '', 'g');
    IF pg_catalog.char_length(clean_reason) NOT BETWEEN 10 AND 500 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid management reason';
    END IF;
    SELECT p.* INTO target_profile FROM public.profiles AS p WHERE p.id = target_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Account not found';
    END IF;
    SELECT u.email_confirmed_at IS NOT NULL AND u.is_anonymous IS FALSE
           AND NULLIF(pg_catalog.btrim(u.email), '') IS NOT NULL
    INTO verified_identity FROM auth.users AS u WHERE u.id = target_id FOR SHARE;
    PERFORM 1 FROM public.beneficiary_profiles AS b WHERE b.user_id = target_id FOR SHARE;
    IF NOT FOUND OR verified_identity IS NOT TRUE
       OR EXISTS (SELECT 1 FROM public.donor_profiles AS d WHERE d.user_id = target_id)
       OR NOT ((target_profile.role = 'beneficiary' AND target_profile.account_status = 'active')
            OR (target_profile.role = 'admin' AND target_profile.account_status = 'deactivated'
                AND EXISTS (
                    SELECT 1 FROM (
                        SELECT h.action, h.occurred_at FROM public.admin_access_history AS h
                        WHERE h.target_user_id = target_id ORDER BY h.event_number DESC LIMIT 1
                    ) AS latest
                    WHERE latest.action = 'revoked' AND latest.occurred_at = target_profile.updated_at))) THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Account is not eligible for appointment';
    END IF;
    decision_time := pg_catalog.clock_timestamp();
    UPDATE public.profiles AS p SET role = 'admin', account_status = 'active', updated_at = decision_time
    WHERE p.id = target_id;
    INSERT INTO public.admin_access_history AS h (
        target_user_id, actor_id, actor_role, action, previous_role, previous_account_status,
        new_role, new_account_status, reason, occurred_at
    ) VALUES (
        target_id, actor_id, 'super_admin', 'appointed', target_profile.role,
        target_profile.account_status, 'admin', 'active', clean_reason, decision_time
    ) RETURNING h.id INTO event_id;
    RETURN QUERY SELECT target_id, 'admin'::text, 'active'::text, event_id, decision_time;
END;
$appoint$;

CREATE FUNCTION public.super_admin_revoke_admin(target_user_id uuid, reason text)
RETURNS TABLE (
    user_id uuid, assigned_role text, account_status text, history_id uuid,
    changed_at timestamp with time zone
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET lock_timeout = '5s'
AS $revoke$
DECLARE
    actor_id uuid := auth.uid();
    target_id uuid := target_user_id;
    target_profile public.profiles%ROWTYPE;
    clean_reason text;
    decision_time timestamp with time zone;
    event_id uuid;
BEGIN
    PERFORM 1 FROM public.profiles AS p
    WHERE p.id = actor_id AND p.role = 'super_admin' AND p.account_status = 'active'
    FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Active super administrator required';
    END IF;
    IF target_id IS NULL OR target_id = actor_id THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid target account';
    END IF;
    IF reason IS NULL OR pg_catalog.octet_length(reason) > 4096 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid management reason';
    END IF;
    clean_reason := pg_catalog.regexp_replace(reason, '^[[:space:]]+|[[:space:]]+$', '', 'g');
    IF pg_catalog.char_length(clean_reason) NOT BETWEEN 10 AND 500 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid management reason';
    END IF;
    SELECT p.* INTO target_profile FROM public.profiles AS p WHERE p.id = target_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Account not found';
    END IF;
    -- Revocation must remain possible if an admin's email becomes unverified.
    IF target_profile.role <> 'admin' OR target_profile.account_status <> 'active'
       OR EXISTS (SELECT 1 FROM public.donor_profiles AS d WHERE d.user_id = target_id) THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Account is not an active dedicated admin';
    END IF;
    decision_time := pg_catalog.clock_timestamp();
    UPDATE public.profiles AS p SET account_status = 'deactivated', updated_at = decision_time
    WHERE p.id = target_id;
    INSERT INTO public.admin_access_history AS h (
        target_user_id, actor_id, actor_role, action, previous_role, previous_account_status,
        new_role, new_account_status, reason, occurred_at
    ) VALUES (
        target_id, actor_id, 'super_admin', 'revoked', 'admin', 'active',
        'admin', 'deactivated', clean_reason, decision_time
    ) RETURNING h.id INTO event_id;
    RETURN QUERY SELECT target_id, 'admin'::text, 'deactivated'::text, event_id, decision_time;
END;
$revoke$;

ALTER FUNCTION public.super_admin_list_admins(integer, integer) OWNER TO postgres;
ALTER FUNCTION public.super_admin_get_admin_candidate(uuid) OWNER TO postgres;
ALTER FUNCTION public.super_admin_appoint_admin(uuid, text) OWNER TO postgres;
ALTER FUNCTION public.super_admin_revoke_admin(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.super_admin_list_admins(integer, integer),
    public.super_admin_get_admin_candidate(uuid), public.super_admin_appoint_admin(uuid, text),
    public.super_admin_revoke_admin(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.super_admin_list_admins(integer, integer),
    public.super_admin_get_admin_candidate(uuid), public.super_admin_appoint_admin(uuid, text),
    public.super_admin_revoke_admin(uuid, text) TO authenticated;

-- Fail closed on unexpected effective access, including inheritance/SET ROLE.
-- Only new objects' grants are changed; existing insecure grants abort deployment.
DO $effective_permissions$
DECLARE
    client_role text;
    reachable record;
    relation_name text;
    signature text;
BEGIN
    FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        FOR reachable IN
            SELECT r.oid, r.rolsuper, r.rolbypassrls, r.rolcreaterole
            FROM pg_catalog.pg_roles AS r
            WHERE pg_catalog.pg_has_role(client_role, r.oid, 'USAGE')
               OR pg_catalog.pg_has_role(client_role, r.oid, 'SET')
        LOOP
            IF reachable.rolsuper OR reachable.rolbypassrls OR reachable.rolcreaterole THEN
                RAISE EXCEPTION 'Client can reach a privileged database role';
            END IF;
            FOREACH relation_name IN ARRAY ARRAY[
                'profiles', 'donor_profiles', 'beneficiary_profiles', 'donor_availability_details',
                'donor_availability_history', 'donor_availability_reminders'
            ] LOOP
                IF pg_catalog.has_table_privilege(reachable.oid,
                    'public.' || relation_name, 'TRUNCATE,TRIGGER') THEN
                    RAISE EXCEPTION 'Client retains unsafe TRUNCATE or TRIGGER access';
                END IF;
            END LOOP;
            FOREACH relation_name IN ARRAY ARRAY['profiles', 'donor_profiles'] LOOP
                IF pg_catalog.has_table_privilege(reachable.oid, 'public.' || relation_name,
                    'INSERT,UPDATE,DELETE')
                   OR pg_catalog.has_any_column_privilege(reachable.oid,
                       'public.' || relation_name, 'INSERT,UPDATE') THEN
                    RAISE EXCEPTION 'Client can bypass protected profile operations';
                END IF;
            END LOOP;
            FOREACH relation_name IN ARRAY ARRAY['admin_access_history', 'donor_verification_history'] LOOP
                IF pg_catalog.has_table_privilege(reachable.oid, 'public.' || relation_name,
                    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
                   OR pg_catalog.has_any_column_privilege(reachable.oid,
                       'public.' || relation_name, 'SELECT,INSERT,UPDATE,REFERENCES') THEN
                    RAISE EXCEPTION 'Client retains direct audit access';
                END IF;
            END LOOP;
            IF pg_catalog.has_sequence_privilege(reachable.oid,
                'public.admin_access_history_event_number_seq', 'USAGE,SELECT,UPDATE') THEN
                RAISE EXCEPTION 'Client retains audit sequence access';
            END IF;
            FOREACH signature IN ARRAY ARRAY[
                'public.super_admin_list_admins(integer,integer)',
                'public.super_admin_get_admin_candidate(uuid)',
                'public.super_admin_appoint_admin(uuid,text)',
                'public.super_admin_revoke_admin(uuid,text)'
            ] LOOP
                IF client_role = 'anon' AND pg_catalog.has_function_privilege(
                    reachable.oid, signature, 'EXECUTE') THEN
                    RAISE EXCEPTION 'Anonymous caller can execute a super admin RPC';
                END IF;
            END LOOP;
        END LOOP;
    END LOOP;
    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_class AS c
        CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl,
            pg_catalog.acldefault(CASE WHEN c.relkind = 'S' THEN 'S'::"char" ELSE 'r'::"char" END,
                                 c.relowner))) AS a
        WHERE c.oid IN ('public.admin_access_history'::pg_catalog.regclass,
                       'public.admin_access_history_event_number_seq'::pg_catalog.regclass)
          AND a.grantee <> c.relowner
    ) THEN
        RAISE EXCEPTION 'Unexpected default audit grantee; separate review required';
    END IF;
    FOREACH signature IN ARRAY ARRAY[
        'public.super_admin_list_admins(integer,integer)',
        'public.super_admin_get_admin_candidate(uuid)',
        'public.super_admin_appoint_admin(uuid,text)',
        'public.super_admin_revoke_admin(uuid,text)'
    ] LOOP
        IF NOT pg_catalog.has_function_privilege('authenticated', signature, 'EXECUTE')
           OR EXISTS (
               SELECT 1 FROM pg_catalog.pg_proc AS p
               CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,
                   pg_catalog.acldefault('f', p.proowner))) AS a
               WHERE p.oid = pg_catalog.to_regprocedure(signature)
                 AND (a.grantee NOT IN (p.proowner, 'authenticated'::pg_catalog.regrole)
                      OR (a.grantee = 'authenticated'::pg_catalog.regrole AND a.is_grantable))
           ) THEN
            RAISE EXCEPTION 'Unexpected RPC execution grants';
        END IF;
    END LOOP;
END;
$effective_permissions$;
