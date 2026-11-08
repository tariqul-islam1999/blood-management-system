-- REVIEW DRAFT ONLY. Not executed or approved for deployment.
-- Target: the separately approved, isolated Supabase PostgreSQL 17 environment.
-- Prerequisites: migrations 20261023000100 through 20261023000300, plus a
-- verified Supabase Auth installation. Read docs/database-baseline-review.md.
-- Supabase CLI must own the per-file transaction and migration-history record.
-- Never run this file with autocommit or directly against the main project.
-- This draft removes client TRIGGER, REFERENCES and MAINTAIN from the six BMS
-- tables without granting any new rights. It does not alter trigger objects,
-- handlers, RLS policies, or the preserved auth.users signup trigger.
SET LOCAL search_path = '';
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $bms_trigger_preflight$
DECLARE
    relation_name text;
    client_role text;
    privilege_name text;
    reachable_role record;
BEGIN
    IF current_user <> 'postgres'
       OR pg_catalog.current_setting('server_version_num')::integer / 10000 <> 17 THEN
        RAISE EXCEPTION 'BMS TRIGGER hardening requires PostgreSQL 17 and current_user postgres';
    END IF;

    IF pg_catalog.to_regclass('auth.users') IS NULL
       OR pg_catalog.to_regprocedure('auth.uid()') IS NULL
       OR pg_catalog.to_regprocedure('public.handle_new_user()') IS NULL
       OR EXISTS (
           SELECT 1
           FROM (VALUES ('anon'), ('authenticated'), ('service_role'), ('supabase_admin')) AS required(role_name)
           WHERE NOT EXISTS (
               SELECT 1 FROM pg_catalog.pg_roles AS role_entry
               WHERE role_entry.rolname = required.role_name
           )
       ) THEN
        RAISE EXCEPTION 'Supabase Auth helpers and expected API/owner roles are required';
    END IF;

    -- Do not replace, disable, or remove the legitimate signup trigger.
    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_trigger AS trigger_entry
        WHERE trigger_entry.tgrelid = pg_catalog.to_regclass('auth.users')
          AND trigger_entry.tgname = 'on_auth_user_created'
          AND trigger_entry.tgfoid = pg_catalog.to_regprocedure('public.handle_new_user()')
          AND trigger_entry.tgenabled = 'O'
          AND trigger_entry.tgisinternal IS FALSE
    ) THEN
        RAISE EXCEPTION 'Expected enabled auth.users signup trigger is missing or differs';
    END IF;

    FOREACH relation_name IN ARRAY ARRAY[
        'profiles', 'donor_profiles', 'beneficiary_profiles',
        'donor_availability_details', 'donor_availability_history',
        'donor_availability_reminders'
    ] LOOP
        IF NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_class AS relation_entry
            WHERE relation_entry.oid = pg_catalog.to_regclass('public.' || relation_name)
              AND relation_entry.relkind = 'r'
              AND relation_entry.relrowsecurity
              AND relation_entry.relowner = 'postgres'::pg_catalog.regrole
        ) THEN
            RAISE EXCEPTION 'Missing, unexpected owner, or RLS-disabled BMS table: %', relation_name;
        END IF;
    END LOOP;

    -- Only the two creators explicitly used by the baseline are changed below.
    -- An ACL for another creator that grants clients TRIGGER, REFERENCES or
    -- MAINTAIN is unresolved and must be reviewed rather than silently modified
    -- by this focused migration.
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

    -- Fail before changing ACLs if a client can reach a privileged role.
    -- This is intentionally limited to memberships relevant to the API roles.
    FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        FOR reachable_role IN
            SELECT role_entry.oid, role_entry.rolname,
                   role_entry.rolsuper, role_entry.rolbypassrls, role_entry.rolcreaterole
            FROM pg_catalog.pg_roles AS role_entry
            WHERE pg_catalog.pg_has_role(client_role, role_entry.oid, 'USAGE')
               OR pg_catalog.pg_has_role(client_role, role_entry.oid, 'SET')
        LOOP
            IF reachable_role.rolsuper OR reachable_role.rolbypassrls OR reachable_role.rolcreaterole THEN
                RAISE EXCEPTION 'Client can reach a privileged database role; separate review required';
            END IF;
        END LOOP;
    END LOOP;
END;
$bms_trigger_preflight$;

-- Remove only the table TRIGGER, REFERENCES and MAINTAIN privileges from API
-- clients and PUBLIC. No trigger object, handler, RLS policy, ownership, or
-- other table privilege is changed.
REVOKE TRIGGER, REFERENCES, MAINTAIN ON TABLE
    public.profiles,
    public.donor_profiles,
    public.beneficiary_profiles,
    public.donor_availability_details,
    public.donor_availability_history,
    public.donor_availability_reminders
FROM PUBLIC, anon, authenticated;

-- The baseline grants ALL TABLES to API roles in these per-schema defaults.
-- Remove only TRIGGER, REFERENCES and MAINTAIN, including any matching global
-- default grants.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
    REVOKE TRIGGER, REFERENCES, MAINTAIN ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    REVOKE TRIGGER, REFERENCES, MAINTAIN ON TABLES FROM PUBLIC, anon, authenticated;
-- PostgreSQL 17 permits ALTER DEFAULT PRIVILEGES FOR ROLE <role> for a role that
-- is a member of <role>; ADMIN OPTION is NOT required. Hosted Supabase's postgres
-- is not a member of supabase_admin, so these two revokes are capability-gated
-- instead of aborting with 42501. The guard below then proves the residual
-- supabase_admin defaults cannot reach any existing object in public, and aborts if
-- supabase_admin owns one. Residual risk is documented in
-- docs/database-baseline-review.md.
DO $bms_supabase_admin_trigger_default$
DECLARE
    can_alter_supabase_admin boolean;
BEGIN
    SELECT role_entry.rolsuper
           OR pg_catalog.pg_has_role(role_entry.rolname::text, 'supabase_admin', 'MEMBER')
      INTO can_alter_supabase_admin
      FROM pg_catalog.pg_roles AS role_entry
     WHERE role_entry.rolname = current_user;

    IF can_alter_supabase_admin IS TRUE THEN
        BEGIN
            EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin REVOKE TRIGGER, REFERENCES, MAINTAIN ON TABLES FROM PUBLIC, anon, authenticated';
            EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE TRIGGER, REFERENCES, MAINTAIN ON TABLES FROM PUBLIC, anon, authenticated';
        EXCEPTION WHEN insufficient_privilege THEN
            RAISE NOTICE 'supabase_admin TRIGGER/REFERENCES/MAINTAIN defaults not revoked: insufficient privilege. The guard below re-checks effective exposure and fails closed.';
        END;
    ELSE
        RAISE NOTICE 'supabase_admin TRIGGER/REFERENCES/MAINTAIN defaults not revoked: current user is not a member of supabase_admin. The guard below re-checks effective exposure and fails closed.';
    END IF;
END;
$bms_supabase_admin_trigger_default$;

DO $bms_trigger_effective_check$
DECLARE
    relation_name text;
    client_role text;
    privilege_name text;
    reachable_role record;
    can_alter_supabase_admin boolean;
BEGIN
    -- Membership in the creator role is what PostgreSQL 17 requires to alter that
    -- role's default privileges; ADMIN OPTION is not required. When this session is
    -- not a member of supabase_admin its exported defaults cannot be revoked here,
    -- so the exposure path must be proven empty rather than ignored.
    SELECT role_entry.rolsuper
           OR pg_catalog.pg_has_role(role_entry.rolname::text, 'supabase_admin', 'MEMBER')
      INTO can_alter_supabase_admin
      FROM pg_catalog.pg_roles AS role_entry
     WHERE role_entry.rolname = current_user;
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

                -- Check roles reachable through either inherited privileges or
                -- SET ROLE. A SET-only membership is not covered by the direct check.
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

        -- Catch PUBLIC, inherited-role and SET ROLE defaults, including global
        -- defaults. Per-schema revokes cannot cancel a global default grant.
        -- postgres is the creator of every BMS object: always strictly checked.
        -- supabase_admin defaults are in scope only when this session could revoke
        -- them; otherwise the assertion below proves the exposure path is empty.
        FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
            IF EXISTS (
                SELECT 1
                FROM pg_catalog.pg_default_acl AS defaults
                JOIN pg_catalog.pg_roles AS creator ON creator.oid = defaults.defaclrole
                CROSS JOIN LATERAL pg_catalog.aclexplode(defaults.defaclacl) AS grant_entry
                WHERE (
                        creator.rolname = 'postgres'
                        OR (can_alter_supabase_admin IS TRUE AND creator.rolname = 'supabase_admin')
                      )
                  AND defaults.defaclobjtype = 'r'
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

    -- A default ACL can only reach objects created by its owner role. When this
    -- session could not revoke supabase_admin's defaults, fail closed as soon as any
    -- supabase_admin-owned table exists in public.
    IF can_alter_supabase_admin IS NOT TRUE AND EXISTS (
        SELECT 1
        FROM pg_catalog.pg_class AS owned_relation
        JOIN pg_catalog.pg_namespace AS owned_namespace
          ON owned_namespace.oid = owned_relation.relnamespace
        WHERE owned_namespace.nspname = 'public'
          AND owned_relation.relkind IN ('r','p','v','f','m')
          AND owned_relation.relowner = pg_catalog.to_regrole('supabase_admin')
    ) THEN
        RAISE EXCEPTION 'public contains supabase_admin-owned tables; supabase_admin default ACLs are in scope and must be revoked by a member of supabase_admin';
    END IF;

    -- Recheck the trigger we deliberately preserved; do not alter auth.users.
    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_trigger AS trigger_entry
        WHERE trigger_entry.tgrelid = pg_catalog.to_regclass('auth.users')
          AND trigger_entry.tgname = 'on_auth_user_created'
          AND trigger_entry.tgfoid = pg_catalog.to_regprocedure('public.handle_new_user()')
          AND trigger_entry.tgenabled = 'O'
          AND trigger_entry.tgisinternal IS FALSE
    ) THEN
        RAISE EXCEPTION 'auth.users signup trigger changed unexpectedly';
    END IF;
END;
$bms_trigger_effective_check$;