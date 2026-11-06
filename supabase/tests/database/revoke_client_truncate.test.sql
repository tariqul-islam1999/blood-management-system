-- REVIEW DRAFT ONLY. Do not execute against a live or populated project.
-- Target: an approved, disposable, isolated Supabase PostgreSQL 17 database.
-- Requires the reviewed baseline migrations 20261023000100 through 00300 and
-- pgTAP already installed in extensions.
-- Run as postgres with approved role/membership administration. Do not install
-- extensions or create these fixture roles outside this rollback-only test.
-- The runner must stop on SQL errors and treat any TAP failure as a failure.
-- The pg_temp guard below must stay identical to the TRUNCATE guard body in
-- 20261023000300_revoke_client_truncate.sql. Offline review must confirm parity.
BEGIN;
SET LOCAL search_path = pg_temp, public, extensions;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $bms_truncate_test_prerequisites$
BEGIN
    IF current_user <> 'postgres'
       OR pg_catalog.current_setting('server_version_num')::integer / 10000 <> 17
       OR pg_catalog.to_regprocedure('extensions.no_plan()') IS NULL THEN
        RAISE EXCEPTION 'Requires PostgreSQL 17, postgres, and existing pgTAP in extensions';
    END IF;
    IF pg_catalog.to_regclass('auth.users') IS NULL
       OR pg_catalog.to_regclass('public.profiles') IS NULL
       OR pg_catalog.to_regclass('public.donor_profiles') IS NULL
       OR pg_catalog.to_regclass('public.beneficiary_profiles') IS NULL
       OR pg_catalog.to_regclass('public.donor_availability_details') IS NULL
       OR pg_catalog.to_regclass('public.donor_availability_history') IS NULL
       OR pg_catalog.to_regclass('public.donor_availability_reminders') IS NULL THEN
        RAISE EXCEPTION 'Apply the isolated BMS baseline before this test';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon')
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
        RAISE EXCEPTION 'Supabase anon and authenticated roles are required';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_roles
        WHERE rolname IN (
            'bms_truncate_test_inherit', 'bms_truncate_test_set',
            'bms_truncate_test_default_set'
        )
    ) THEN
        RAISE EXCEPTION 'TRUNCATE test fixture role names already exist; choose a fresh isolated target';
    END IF;
    IF EXISTS (SELECT 1 FROM auth.users) OR EXISTS (SELECT 1 FROM public.profiles) THEN
        RAISE EXCEPTION 'Use an empty disposable target; never use real users';
    END IF;
END;
$bms_truncate_test_prerequisites$;

SELECT extensions.no_plan();

-- Test-only copy of the M3 guard body: direct/PUBLIC/inherited checks, SET ROLE
-- reachable-role checks, and the default-ACL check including SET-only grantees.
CREATE FUNCTION pg_temp.bms_assert_no_client_truncate()
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $bms_truncate_guard$
DECLARE
    table_name text;
    client_role text;
    reachable_role record;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'profiles', 'donor_profiles', 'beneficiary_profiles',
        'donor_availability_details', 'donor_availability_history',
        'donor_availability_reminders'
    ] LOOP
        FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
            IF pg_catalog.has_table_privilege(
                client_role, 'public.' || table_name, 'TRUNCATE'
            ) THEN
                RAISE EXCEPTION 'TRUNCATE remains through ownership, PUBLIC, or inherited grants';
            END IF;

            -- has_table_privilege does not cover SET-only role paths, so check
            -- every role the client can reach by inheritance or SET ROLE.
            FOR reachable_role IN
                SELECT role_entry.oid, role_entry.rolname
                FROM pg_catalog.pg_roles AS role_entry
                WHERE pg_catalog.pg_has_role(client_role, role_entry.oid, 'USAGE')
                   OR pg_catalog.pg_has_role(client_role, role_entry.oid, 'SET')
            LOOP
                IF pg_catalog.has_table_privilege(
                    reachable_role.oid, 'public.' || table_name, 'TRUNCATE'
                ) THEN
                    RAISE EXCEPTION 'Client can reach role % with TRUNCATE on public.%',
                        reachable_role.rolname, table_name;
                END IF;
            END LOOP;
        END LOOP;
    END LOOP;

    IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_default_acl AS defaults
        JOIN pg_catalog.pg_roles AS creator ON creator.oid = defaults.defaclrole
        CROSS JOIN LATERAL pg_catalog.aclexplode(defaults.defaclacl) AS grant_entry
        WHERE creator.rolname IN ('postgres', 'supabase_admin')
          AND defaults.defaclobjtype = 'r'
          AND defaults.defaclnamespace IN (
              0::oid,
              (SELECT ns.oid FROM pg_catalog.pg_namespace AS ns WHERE ns.nspname = 'public')
          )
          AND grant_entry.privilege_type = 'TRUNCATE'
          AND CASE
              WHEN grant_entry.grantee = 0 THEN true
              ELSE (
                  pg_catalog.pg_has_role('anon', grant_entry.grantee, 'USAGE')
                  OR pg_catalog.pg_has_role('authenticated', grant_entry.grantee, 'USAGE')
                   OR pg_catalog.pg_has_role('anon', grant_entry.grantee, 'SET')
                   OR pg_catalog.pg_has_role('authenticated', grant_entry.grantee, 'SET')
              )
          END
    ) THEN
        RAISE EXCEPTION 'Global or inherited default TRUNCATE requires separate reviewed remediation';
    END IF;
END;
$bms_truncate_guard$;


-- Baseline after M3: no client TRUNCATE on the six BMS tables.
SELECT extensions.lives_ok(
    $$SELECT pg_temp.bms_assert_no_client_truncate()$$,
    'baseline has no effective client TRUNCATE after M3'
);

CREATE ROLE bms_truncate_test_inherit NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE bms_truncate_test_set NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE bms_truncate_test_default_set NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

-- 1. Direct TRUNCATE denial.
GRANT TRUNCATE ON TABLE public.profiles TO authenticated;
SELECT extensions.throws_ok(
    $$SELECT pg_temp.bms_assert_no_client_truncate()$$,
    'P0001', 'TRUNCATE remains through ownership, PUBLIC, or inherited grants',
    'guard rejects direct authenticated TRUNCATE'
);
REVOKE TRUNCATE ON TABLE public.profiles FROM authenticated;

-- 2. PUBLIC-granted TRUNCATE denial.
GRANT TRUNCATE ON TABLE public.donor_profiles TO PUBLIC;
SELECT extensions.throws_ok(
    $$SELECT pg_temp.bms_assert_no_client_truncate()$$,
    'P0001', 'TRUNCATE remains through ownership, PUBLIC, or inherited grants',
    'guard rejects PUBLIC TRUNCATE on donor table'
);
REVOKE TRUNCATE ON TABLE public.donor_profiles FROM PUBLIC;

-- 3. Inherited-role TRUNCATE denial (membership with INHERIT).
GRANT TRUNCATE ON TABLE public.beneficiary_profiles TO bms_truncate_test_inherit;
GRANT bms_truncate_test_inherit TO authenticated WITH INHERIT TRUE, SET FALSE;
SELECT extensions.throws_ok(
    $$SELECT pg_temp.bms_assert_no_client_truncate()$$,
    'P0001', 'TRUNCATE remains through ownership, PUBLIC, or inherited grants',
    'guard rejects inherited TRUNCATE on beneficiary table'
);
REVOKE bms_truncate_test_inherit FROM authenticated;
REVOKE TRUNCATE ON TABLE public.beneficiary_profiles FROM bms_truncate_test_inherit;

-- 4. SET ROLE-only path: no immediate or inherited privilege, but SET is allowed.
GRANT TRUNCATE ON TABLE public.donor_availability_details TO bms_truncate_test_set;
GRANT bms_truncate_test_set TO authenticated WITH INHERIT FALSE, SET TRUE;
SELECT extensions.ok(
    NOT pg_catalog.has_table_privilege(
        'authenticated', 'public.donor_availability_details', 'TRUNCATE'
    ),
    'fixture separates immediate privileges from SET ROLE access'
);
SELECT extensions.throws_ok(
    $$SELECT pg_temp.bms_assert_no_client_truncate()$$,
    'P0001', 'Client can reach role bms_truncate_test_set with TRUNCATE on public.donor_availability_details',
    'guard detects SET ROLE-only TRUNCATE'
);
REVOKE bms_truncate_test_set FROM authenticated;
REVOKE TRUNCATE ON TABLE public.donor_availability_details FROM bms_truncate_test_set;

-- 5. Default ACL: direct client grantee in the postgres creator default.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
    GRANT TRUNCATE ON TABLES TO authenticated;
SELECT extensions.throws_ok(
    $$SELECT pg_temp.bms_assert_no_client_truncate()$$,
    'P0001', 'Global or inherited default TRUNCATE requires separate reviewed remediation',
    'guard rejects direct authenticated TRUNCATE default'
);
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
    REVOKE TRUNCATE ON TABLES FROM authenticated;

-- 6. Default ACL: SET-only reachable grantee (the case the M3 default check missed).
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
    GRANT TRUNCATE ON TABLES TO bms_truncate_test_default_set;
GRANT bms_truncate_test_default_set TO authenticated WITH INHERIT FALSE, SET TRUE;
SELECT extensions.throws_ok(
    $$SELECT pg_temp.bms_assert_no_client_truncate()$$,
    'P0001', 'Global or inherited default TRUNCATE requires separate reviewed remediation',
    'guard rejects default TRUNCATE for a SET-only reachable role'
);
REVOKE bms_truncate_test_default_set FROM authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
    REVOKE TRUNCATE ON TABLES FROM bms_truncate_test_default_set;

-- Remove all injected grants and fixture roles before the final clean-state check.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
    REVOKE TRUNCATE ON TABLES FROM authenticated;
DROP ROLE bms_truncate_test_default_set;
DROP ROLE bms_truncate_test_set;
DROP ROLE bms_truncate_test_inherit;
SELECT extensions.lives_ok(
    $$SELECT pg_temp.bms_assert_no_client_truncate()$$,
    'all test-injected TRUNCATE grants, memberships and defaults are removed'
);

SELECT * FROM extensions.finish();
ROLLBACK;
