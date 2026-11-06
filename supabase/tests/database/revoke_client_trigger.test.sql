-- REVIEW DRAFT ONLY. Do not execute against a live or populated project.
-- Target: an approved, disposable, isolated Supabase PostgreSQL 17 database.
-- Requires the reviewed baseline migrations 20261023000100 through 00300,
-- including the auth.users signup trigger from 20261023000200, the dedicated
-- TRIGGER, REFERENCES and MAINTAIN hardening migration, and pgTAP already
-- installed in extensions.
-- Run as postgres with approved role/membership administration. Do not install
-- extensions or create these fixture roles outside this rollback-only test.
-- The runner must stop on SQL errors and treat any TAP failure as a failure.
BEGIN;
SET LOCAL search_path = pg_temp, public, extensions;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $bms_trigger_test_prerequisites$
BEGIN
    IF current_user <> 'postgres'
       OR pg_catalog.current_setting('server_version_num')::integer / 10000 <> 17
       OR pg_catalog.to_regprocedure('extensions.no_plan()') IS NULL THEN
        RAISE EXCEPTION 'Requires PostgreSQL 17, postgres, and existing pgTAP in extensions';
    END IF;
    IF pg_catalog.to_regprocedure('public.handle_new_user()') IS NULL
       OR pg_catalog.to_regclass('auth.users') IS NULL
       OR pg_catalog.to_regclass('public.profiles') IS NULL THEN
        RAISE EXCEPTION 'Apply the isolated BMS baseline before this test';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_roles
        WHERE rolname IN ('bms_trigger_test_inherit', 'bms_trigger_test_set')
    ) THEN
        RAISE EXCEPTION 'TRIGGER test fixture role names already exist; choose a fresh isolated target';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_class AS relation_entry
        WHERE relation_entry.oid IN (
            'public.profiles'::pg_catalog.regclass,
            'public.donor_profiles'::pg_catalog.regclass,
            'public.beneficiary_profiles'::pg_catalog.regclass,
            'public.donor_availability_details'::pg_catalog.regclass,
            'public.donor_availability_history'::pg_catalog.regclass,
            'public.donor_availability_reminders'::pg_catalog.regclass
        ) AND NOT relation_entry.relrowsecurity
    ) THEN
        RAISE EXCEPTION 'Expected RLS-enabled baseline tables are missing or changed';
    END IF;
    IF EXISTS (
        SELECT 1 FROM auth.users
    ) OR EXISTS (
        SELECT 1 FROM public.profiles
    ) THEN
        RAISE EXCEPTION 'Use an empty disposable target; never use real users';
    END IF;
END;
$bms_trigger_test_prerequisites$;

SELECT extensions.no_plan();

-- Match the production migration's effective-permission checks for client
-- direct rights, PUBLIC, inherited memberships, SET ROLE paths, and defaults,
-- covering TRIGGER, REFERENCES and MAINTAIN on the six BMS tables.
CREATE FUNCTION pg_temp.bms_assert_no_client_trigger()
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $bms_trigger_guard$
DECLARE
    relation_name text;
    client_role text;
    privilege_name text;
    reachable_role record;
BEGIN
    FOREACH privilege_name IN ARRAY ARRAY['TRIGGER', 'REFERENCES', 'MAINTAIN'] LOOP
        FOREACH relation_name IN ARRAY ARRAY[
            'profiles', 'donor_profiles', 'beneficiary_profiles',
            'donor_availability_details', 'donor_availability_history',
            'donor_availability_reminders'
        ] LOOP
            FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
                IF pg_catalog.has_table_privilege(
                    client_role, 'public.' || relation_name, privilege_name
                ) THEN
                    RAISE EXCEPTION 'Effective client % privilege remains on public.%',
                        privilege_name, relation_name;
                END IF;
                FOR reachable_role IN
                    SELECT role_entry.oid, role_entry.rolname
                    FROM pg_catalog.pg_roles AS role_entry
                    WHERE pg_catalog.pg_has_role(client_role, role_entry.oid, 'USAGE')
                       OR pg_catalog.pg_has_role(client_role, role_entry.oid, 'SET')
                LOOP
                    IF pg_catalog.has_table_privilege(
                        reachable_role.oid, 'public.' || relation_name, privilege_name
                    ) THEN
                        RAISE EXCEPTION 'Client can reach role % with % on public.%',
                            reachable_role.rolname, privilege_name, relation_name;
                    END IF;
                END LOOP;
            END LOOP;
        END LOOP;

        FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
            IF EXISTS (
                SELECT 1
                FROM pg_catalog.pg_default_acl AS defaults
                CROSS JOIN LATERAL pg_catalog.aclexplode(defaults.defaclacl) AS grant_entry
                WHERE defaults.defaclobjtype = 'r'
                  AND (defaults.defaclnamespace = 0::oid OR defaults.defaclnamespace = (
                      SELECT namespace_entry.oid
                      FROM pg_catalog.pg_namespace AS namespace_entry
                      WHERE namespace_entry.nspname = 'public'
                  ))
                  AND grant_entry.privilege_type = privilege_name
                  AND CASE
                      WHEN grant_entry.grantee = 0 THEN true
                      ELSE pg_catalog.pg_has_role(client_role, grant_entry.grantee, 'USAGE')
                        OR pg_catalog.pg_has_role(client_role, grant_entry.grantee, 'SET')
                  END
            ) THEN
                RAISE EXCEPTION 'Client-reachable global or public-schema % default remains', privilege_name;
            END IF;
        END LOOP;
    END LOOP;
END;
$bms_trigger_guard$;

-- Test-only equivalent of the migration preflight that rejects client-reachable
-- default TRIGGER, REFERENCES or MAINTAIN ACLs from creators other than
-- postgres/supabase_admin.
CREATE FUNCTION pg_temp.bms_assert_no_unreviewed_trigger_default()
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $bms_unknown_creator_guard$
DECLARE
    client_role text;
    privilege_name text;
BEGIN
    FOREACH privilege_name IN ARRAY ARRAY['TRIGGER', 'REFERENCES', 'MAINTAIN'] LOOP
        FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
            IF EXISTS (
                SELECT 1
                FROM pg_catalog.pg_default_acl AS defaults
                CROSS JOIN LATERAL pg_catalog.aclexplode(defaults.defaclacl) AS grant_entry
                WHERE defaults.defaclobjtype = 'r'
                  AND (defaults.defaclnamespace = 0::oid OR defaults.defaclnamespace = (
                      SELECT namespace_entry.oid
                      FROM pg_catalog.pg_namespace AS namespace_entry
                      WHERE namespace_entry.nspname = 'public'
                  ))
                  AND grant_entry.privilege_type = privilege_name
                  AND CASE
                      WHEN grant_entry.grantee = 0 THEN true
                      ELSE pg_catalog.pg_has_role(client_role, grant_entry.grantee, 'USAGE')
                        OR pg_catalog.pg_has_role(client_role, grant_entry.grantee, 'SET')
                  END
                  AND NOT EXISTS (
                      SELECT 1
                      FROM pg_catalog.pg_roles AS creator
                      WHERE creator.oid = defaults.defaclrole
                        AND creator.rolname IN ('postgres', 'supabase_admin')
                  )
            ) THEN
                RAISE EXCEPTION 'Client-reachable % default ACL exists for an unreviewed creator role', privilege_name;
            END IF;
        END LOOP;
    END LOOP;
END;
$bms_unknown_creator_guard$;

SELECT extensions.lives_ok(
    $$SELECT pg_temp.bms_assert_no_client_trigger()$$,
    'baseline has no effective client TRIGGER, REFERENCES or MAINTAIN grants after hardening'
);
SELECT extensions.ok(
    EXISTS (
        SELECT 1 FROM pg_catalog.pg_trigger AS trigger_entry
        WHERE trigger_entry.tgrelid = 'auth.users'::pg_catalog.regclass
          AND trigger_entry.tgname = 'on_auth_user_created'
          AND trigger_entry.tgfoid = 'public.handle_new_user()'::pg_catalog.regprocedure
          AND trigger_entry.tgenabled = 'O'
          AND NOT trigger_entry.tgisinternal
    ),
    'auth.users signup trigger remains attached and enabled'
);

CREATE ROLE bms_trigger_test_inherit NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE bms_trigger_test_set NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

-- Direct grant to a named API role.
GRANT TRIGGER ON TABLE public.profiles TO authenticated;
SELECT extensions.throws_ok(
    $$SELECT pg_temp.bms_assert_no_client_trigger()$$,
    'P0001', 'Effective client TRIGGER privilege remains on public.profiles',
    'guard rejects direct authenticated TRIGGER grant'
);
REVOKE TRIGGER ON TABLE public.profiles FROM authenticated;

-- PUBLIC is inherited by every role, including anon and authenticated.
GRANT TRIGGER ON TABLE public.beneficiary_profiles TO PUBLIC;
SELECT extensions.throws_ok(
    $$SELECT pg_temp.bms_assert_no_client_trigger()$$,
    'P0001', 'Effective client TRIGGER privilege remains on public.beneficiary_profiles',
    'guard rejects PUBLIC TRIGGER grant'
);
REVOKE TRIGGER ON TABLE public.beneficiary_profiles FROM PUBLIC;

-- Ordinary inherited membership exposes the fixture role's table privilege.
GRANT TRIGGER ON TABLE public.donor_profiles TO bms_trigger_test_inherit;
GRANT bms_trigger_test_inherit TO authenticated WITH INHERIT TRUE, SET FALSE;
SELECT extensions.throws_ok(
    $$SELECT pg_temp.bms_assert_no_client_trigger()$$,
    'P0001', 'Effective client TRIGGER privilege remains on public.donor_profiles',
    'direct effective-privilege check rejects inherited TRIGGER grant first'
);
REVOKE bms_trigger_test_inherit FROM authenticated;
REVOKE TRIGGER ON TABLE public.donor_profiles FROM bms_trigger_test_inherit;

-- A SET-only membership does not grant the privilege immediately, but a client
-- can SET ROLE to it, so the migration guard must still reject the path.
GRANT TRIGGER ON TABLE public.profiles TO bms_trigger_test_set;
GRANT bms_trigger_test_set TO authenticated WITH INHERIT FALSE, SET TRUE;
SELECT extensions.ok(
    NOT pg_catalog.has_table_privilege('authenticated', 'public.profiles', 'TRIGGER')
      AND pg_catalog.pg_has_role('authenticated', 'bms_trigger_test_set', 'SET'),
    'SET-only fixture is not inherited directly but can be selected with SET ROLE'
);
SELECT extensions.throws_ok(
    $$SELECT pg_temp.bms_assert_no_client_trigger()$$,
    'P0001', 'Client can reach role bms_trigger_test_set with TRIGGER on public.profiles',
    'guard rejects SET ROLE-only TRIGGER grant'
);
REVOKE bms_trigger_test_set FROM authenticated;
REVOKE TRIGGER ON TABLE public.profiles FROM bms_trigger_test_set;

-- Future objects: check a global PUBLIC default and a schema-scoped API-role
-- default. Each is removed before the next assertion.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
    GRANT TRIGGER ON TABLES TO PUBLIC;
SELECT extensions.throws_ok(
    $$SELECT pg_temp.bms_assert_no_client_trigger()$$,
    'P0001', 'Client-reachable global or public-schema TRIGGER default remains',
    'guard detects global PUBLIC TRIGGER default for postgres-created tables'
);
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
    REVOKE TRIGGER ON TABLES FROM PUBLIC;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    GRANT TRIGGER ON TABLES TO authenticated;
SELECT extensions.throws_ok(
    $$SELECT pg_temp.bms_assert_no_client_trigger()$$,
    'P0001', 'Client-reachable global or public-schema TRIGGER default remains',
    'guard detects public-schema authenticated TRIGGER default'
);
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    REVOKE TRIGGER ON TABLES FROM authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin
    GRANT TRIGGER ON TABLES TO anon;
SELECT extensions.throws_ok(
    $$SELECT pg_temp.bms_assert_no_client_trigger()$$,
    'P0001', 'Client-reachable global or public-schema TRIGGER default remains',
    'guard detects global anon TRIGGER default for supabase_admin-created tables'
);
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin
    REVOKE TRIGGER ON TABLES FROM anon;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
    GRANT TRIGGER ON TABLES TO authenticated;
SELECT extensions.throws_ok(
    $$SELECT pg_temp.bms_assert_no_client_trigger()$$,
    'P0001', 'Client-reachable global or public-schema TRIGGER default remains',
    'guard detects public-schema authenticated TRIGGER default for supabase_admin'
);
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
    REVOKE TRIGGER ON TABLES FROM authenticated;

-- An otherwise client-reachable default from an unreviewed table creator must
-- be rejected by the same fail-closed preflight used in the migration.
ALTER DEFAULT PRIVILEGES FOR ROLE bms_trigger_test_inherit
    GRANT TRIGGER ON TABLES TO authenticated;
SELECT extensions.throws_ok(
    $$SELECT pg_temp.bms_assert_no_unreviewed_trigger_default()$$,
    'P0001', 'Client-reachable TRIGGER default ACL exists for an unreviewed creator role',
    'preflight rejects authenticated TRIGGER default from an unknown creator role'
);
ALTER DEFAULT PRIVILEGES FOR ROLE bms_trigger_test_inherit
    REVOKE TRIGGER ON TABLES FROM authenticated;

-- The same effective-privilege guard now covers REFERENCES and MAINTAIN on the
-- six BMS tables. Each case injects exactly one grant, asserts rejection, then
-- reverts it, mirroring the TRIGGER cases above.

-- REFERENCES: direct grant to a named API role.
GRANT REFERENCES ON TABLE public.profiles TO authenticated;
SELECT extensions.throws_ok(
    $$SELECT pg_temp.bms_assert_no_client_trigger()$$,
    'P0001', 'Effective client REFERENCES privilege remains on public.profiles',
    'guard rejects direct authenticated REFERENCES grant'
);
REVOKE REFERENCES ON TABLE public.profiles FROM authenticated;

-- REFERENCES: PUBLIC is inherited by every role.
GRANT REFERENCES ON TABLE public.beneficiary_profiles TO PUBLIC;
SELECT extensions.throws_ok(
    $$SELECT pg_temp.bms_assert_no_client_trigger()$$,
    'P0001', 'Effective client REFERENCES privilege remains on public.beneficiary_profiles',
    'guard rejects PUBLIC REFERENCES grant'
);
REVOKE REFERENCES ON TABLE public.beneficiary_profiles FROM PUBLIC;

-- REFERENCES: inherited membership exposes the fixture role's privilege.
GRANT REFERENCES ON TABLE public.donor_profiles TO bms_trigger_test_inherit;
GRANT bms_trigger_test_inherit TO authenticated WITH INHERIT TRUE, SET FALSE;
SELECT extensions.throws_ok(
    $$SELECT pg_temp.bms_assert_no_client_trigger()$$,
    'P0001', 'Effective client REFERENCES privilege remains on public.donor_profiles',
    'guard rejects inherited REFERENCES grant'
);
REVOKE bms_trigger_test_inherit FROM authenticated;
REVOKE REFERENCES ON TABLE public.donor_profiles FROM bms_trigger_test_inherit;

-- REFERENCES: SET-only membership path is still reachable with SET ROLE.
GRANT REFERENCES ON TABLE public.profiles TO bms_trigger_test_set;
GRANT bms_trigger_test_set TO authenticated WITH INHERIT FALSE, SET TRUE;
SELECT extensions.throws_ok(
    $$SELECT pg_temp.bms_assert_no_client_trigger()$$,
    'P0001', 'Client can reach role bms_trigger_test_set with REFERENCES on public.profiles',
    'guard rejects SET ROLE-only REFERENCES grant'
);
REVOKE bms_trigger_test_set FROM authenticated;
REVOKE REFERENCES ON TABLE public.profiles FROM bms_trigger_test_set;

-- REFERENCES: postgres global PUBLIC default.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
    GRANT REFERENCES ON TABLES TO PUBLIC;
SELECT extensions.throws_ok(
    $$SELECT pg_temp.bms_assert_no_client_trigger()$$,
    'P0001', 'Client-reachable global or public-schema REFERENCES default remains',
    'guard detects global PUBLIC REFERENCES default for postgres-created tables'
);
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
    REVOKE REFERENCES ON TABLES FROM PUBLIC;

-- REFERENCES: postgres public-schema authenticated default.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    GRANT REFERENCES ON TABLES TO authenticated;
SELECT extensions.throws_ok(
    $$SELECT pg_temp.bms_assert_no_client_trigger()$$,
    'P0001', 'Client-reachable global or public-schema REFERENCES default remains',
    'guard detects public-schema authenticated REFERENCES default'
);
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    REVOKE REFERENCES ON TABLES FROM authenticated;

-- REFERENCES: supabase_admin global anon default.
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin
    GRANT REFERENCES ON TABLES TO anon;
SELECT extensions.throws_ok(
    $$SELECT pg_temp.bms_assert_no_client_trigger()$$,
    'P0001', 'Client-reachable global or public-schema REFERENCES default remains',
    'guard detects global anon REFERENCES default for supabase_admin-created tables'
);
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin
    REVOKE REFERENCES ON TABLES FROM anon;

-- REFERENCES: supabase_admin public-schema authenticated default.
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
    GRANT REFERENCES ON TABLES TO authenticated;
SELECT extensions.throws_ok(
    $$SELECT pg_temp.bms_assert_no_client_trigger()$$,
    'P0001', 'Client-reachable global or public-schema REFERENCES default remains',
    'guard detects public-schema authenticated REFERENCES default for supabase_admin'
);
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
    REVOKE REFERENCES ON TABLES FROM authenticated;

-- REFERENCES: unreviewed creator default is rejected by the preflight copy.
ALTER DEFAULT PRIVILEGES FOR ROLE bms_trigger_test_inherit
    GRANT REFERENCES ON TABLES TO authenticated;
SELECT extensions.throws_ok(
    $$SELECT pg_temp.bms_assert_no_unreviewed_trigger_default()$$,
    'P0001', 'Client-reachable REFERENCES default ACL exists for an unreviewed creator role',
    'preflight rejects authenticated REFERENCES default from an unknown creator role'
);
ALTER DEFAULT PRIVILEGES FOR ROLE bms_trigger_test_inherit
    REVOKE REFERENCES ON TABLES FROM authenticated;

-- MAINTAIN: direct grant to a named API role.
GRANT MAINTAIN ON TABLE public.profiles TO authenticated;
SELECT extensions.throws_ok(
    $$SELECT pg_temp.bms_assert_no_client_trigger()$$,
    'P0001', 'Effective client MAINTAIN privilege remains on public.profiles',
    'guard rejects direct authenticated MAINTAIN grant'
);
REVOKE MAINTAIN ON TABLE public.profiles FROM authenticated;

-- MAINTAIN: PUBLIC is inherited by every role.
GRANT MAINTAIN ON TABLE public.beneficiary_profiles TO PUBLIC;
SELECT extensions.throws_ok(
    $$SELECT pg_temp.bms_assert_no_client_trigger()$$,
    'P0001', 'Effective client MAINTAIN privilege remains on public.beneficiary_profiles',
    'guard rejects PUBLIC MAINTAIN grant'
);
REVOKE MAINTAIN ON TABLE public.beneficiary_profiles FROM PUBLIC;

-- MAINTAIN: inherited membership exposes the fixture role's privilege.
GRANT MAINTAIN ON TABLE public.donor_profiles TO bms_trigger_test_inherit;
GRANT bms_trigger_test_inherit TO authenticated WITH INHERIT TRUE, SET FALSE;
SELECT extensions.throws_ok(
    $$SELECT pg_temp.bms_assert_no_client_trigger()$$,
    'P0001', 'Effective client MAINTAIN privilege remains on public.donor_profiles',
    'guard rejects inherited MAINTAIN grant'
);
REVOKE bms_trigger_test_inherit FROM authenticated;
REVOKE MAINTAIN ON TABLE public.donor_profiles FROM bms_trigger_test_inherit;

-- MAINTAIN: SET-only membership path is still reachable with SET ROLE.
GRANT MAINTAIN ON TABLE public.profiles TO bms_trigger_test_set;
GRANT bms_trigger_test_set TO authenticated WITH INHERIT FALSE, SET TRUE;
SELECT extensions.throws_ok(
    $$SELECT pg_temp.bms_assert_no_client_trigger()$$,
    'P0001', 'Client can reach role bms_trigger_test_set with MAINTAIN on public.profiles',
    'guard rejects SET ROLE-only MAINTAIN grant'
);
REVOKE bms_trigger_test_set FROM authenticated;
REVOKE MAINTAIN ON TABLE public.profiles FROM bms_trigger_test_set;

-- MAINTAIN: postgres global PUBLIC default.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
    GRANT MAINTAIN ON TABLES TO PUBLIC;
SELECT extensions.throws_ok(
    $$SELECT pg_temp.bms_assert_no_client_trigger()$$,
    'P0001', 'Client-reachable global or public-schema MAINTAIN default remains',
    'guard detects global PUBLIC MAINTAIN default for postgres-created tables'
);
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
    REVOKE MAINTAIN ON TABLES FROM PUBLIC;

-- MAINTAIN: postgres public-schema authenticated default.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    GRANT MAINTAIN ON TABLES TO authenticated;
SELECT extensions.throws_ok(
    $$SELECT pg_temp.bms_assert_no_client_trigger()$$,
    'P0001', 'Client-reachable global or public-schema MAINTAIN default remains',
    'guard detects public-schema authenticated MAINTAIN default'
);
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    REVOKE MAINTAIN ON TABLES FROM authenticated;

-- MAINTAIN: supabase_admin global anon default.
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin
    GRANT MAINTAIN ON TABLES TO anon;
SELECT extensions.throws_ok(
    $$SELECT pg_temp.bms_assert_no_client_trigger()$$,
    'P0001', 'Client-reachable global or public-schema MAINTAIN default remains',
    'guard detects global anon MAINTAIN default for supabase_admin-created tables'
);
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin
    REVOKE MAINTAIN ON TABLES FROM anon;

-- MAINTAIN: supabase_admin public-schema authenticated default.
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
    GRANT MAINTAIN ON TABLES TO authenticated;
SELECT extensions.throws_ok(
    $$SELECT pg_temp.bms_assert_no_client_trigger()$$,
    'P0001', 'Client-reachable global or public-schema MAINTAIN default remains',
    'guard detects public-schema authenticated MAINTAIN default for supabase_admin'
);
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
    REVOKE MAINTAIN ON TABLES FROM authenticated;

-- MAINTAIN: unreviewed creator default is rejected by the preflight copy.
ALTER DEFAULT PRIVILEGES FOR ROLE bms_trigger_test_inherit
    GRANT MAINTAIN ON TABLES TO authenticated;
SELECT extensions.throws_ok(
    $$SELECT pg_temp.bms_assert_no_unreviewed_trigger_default()$$,
    'P0001', 'Client-reachable MAINTAIN default ACL exists for an unreviewed creator role',
    'preflight rejects authenticated MAINTAIN default from an unknown creator role'
);
ALTER DEFAULT PRIVILEGES FOR ROLE bms_trigger_test_inherit
    REVOKE MAINTAIN ON TABLES FROM authenticated;

-- Rollback-on-failure rehearsal: direct client and SET-only grants are present.
-- The simulated migration revokes direct/default grants, then its final guard
-- fails on the unresolved SET ROLE path. The exception subtransaction must
-- restore both earlier ACL changes. This tests PostgreSQL savepoint rollback,
-- not Supabase CLI migration-runner transaction behavior.
GRANT TRIGGER ON TABLE public.profiles TO anon;
GRANT TRIGGER ON TABLE public.profiles TO bms_trigger_test_set;
GRANT bms_trigger_test_set TO authenticated WITH INHERIT FALSE, SET TRUE;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
    GRANT TRIGGER ON TABLES TO authenticated;
CREATE FUNCTION pg_temp.bms_revoke_then_assert_rolls_back()
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $bms_trigger_rollback$
BEGIN
    BEGIN
        REVOKE TRIGGER ON TABLE
            public.profiles, public.donor_profiles, public.beneficiary_profiles,
            public.donor_availability_details, public.donor_availability_history,
            public.donor_availability_reminders
        FROM PUBLIC, anon, authenticated;
        ALTER DEFAULT PRIVILEGES FOR ROLE postgres
            REVOKE TRIGGER ON TABLES FROM PUBLIC, anon, authenticated;
        ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
            REVOKE TRIGGER ON TABLES FROM PUBLIC, anon, authenticated;
        ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin
            REVOKE TRIGGER ON TABLES FROM PUBLIC, anon, authenticated;
        ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
            REVOKE TRIGGER ON TABLES FROM PUBLIC, anon, authenticated;

        PERFORM pg_temp.bms_assert_no_client_trigger();
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        -- The exception block rolls back the simulated revokes before this
        -- assertion runs. Check that both injected ACLs were restored.
        RETURN pg_catalog.has_table_privilege('anon', 'public.profiles', 'TRIGGER')
          AND EXISTS (
              SELECT 1
              FROM pg_catalog.pg_default_acl AS defaults
              CROSS JOIN LATERAL pg_catalog.aclexplode(defaults.defaclacl) AS grant_entry
              WHERE defaults.defaclrole = 'postgres'::pg_catalog.regrole
                AND defaults.defaclnamespace = 0::oid
                AND defaults.defaclobjtype = 'r'
                AND grant_entry.grantee = 'authenticated'::pg_catalog.regrole
                AND grant_entry.privilege_type = 'TRIGGER'
          );
    END;
    RAISE EXCEPTION 'Synthetic guard failure was not raised';
END;
$bms_trigger_rollback$;
SELECT extensions.ok(
    pg_temp.bms_revoke_then_assert_rolls_back(),
    'a failed effective-privilege guard rolls back earlier ACL revokes'
);
SELECT extensions.throws_ok(
    $$SELECT pg_temp.bms_assert_no_client_trigger()$$,
    'P0001', 'Effective client TRIGGER privilege remains on public.profiles',
    'rollback restored the original unsafe ACL and guard still detects it'
);

-- Remove injected grants and fixture memberships before final clean-state check.
REVOKE bms_trigger_test_set FROM authenticated;
REVOKE TRIGGER, REFERENCES, MAINTAIN ON TABLE public.profiles FROM anon, bms_trigger_test_set;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
    REVOKE TRIGGER, REFERENCES, MAINTAIN ON TABLES FROM PUBLIC, anon, authenticated;
DROP ROLE bms_trigger_test_set;
DROP ROLE bms_trigger_test_inherit;
SELECT extensions.lives_ok(
    $$SELECT pg_temp.bms_assert_no_client_trigger()$$,
    'all test-injected TRIGGER, REFERENCES and MAINTAIN grants and defaults are removed'
);

SELECT * FROM extensions.finish();
ROLLBACK;