-- REVIEW DRAFT ONLY. Not executed or approved for deployment.
-- Target: an initialized, isolated Supabase PostgreSQL 17 environment.
-- Read docs/database-baseline-review.md before any future application.
-- Supabase CLI owns the per-file transaction and migration-history recording.
-- Do not add outer BEGIN/COMMIT or run this file with autocommit.
SET LOCAL search_path = '';
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Separate behavior change: remove client TRUNCATE without granting any new rights.
-- Applies to the six BMS tables only. It does not truncate or delete any rows.
REVOKE TRUNCATE ON TABLE
    public.profiles,
    public.donor_profiles,
    public.beneficiary_profiles,
    public.donor_availability_details,
    public.donor_availability_history,
    public.donor_availability_reminders
FROM anon, authenticated;

-- Undo the exported per-schema defaults for both confirmed creator roles.
-- Existing objects and future objects need separate revokes.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    REVOKE TRUNCATE ON TABLES FROM anon, authenticated;

-- PostgreSQL 17 permits ALTER DEFAULT PRIVILEGES FOR ROLE <role> for a role that
-- is a member of <role>; ADMIN OPTION is NOT required. Hosted Supabase's postgres
-- is not a member of supabase_admin, so this revoke is capability-gated instead of
-- aborting with 42501. The guard below then proves that the residual
-- supabase_admin default cannot reach any existing object in public, and aborts if
-- supabase_admin owns one. Residual risk is documented in
-- docs/database-baseline-review.md.
DO $bms_supabase_admin_truncate_default$
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
            EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE TRUNCATE ON TABLES FROM anon, authenticated';
        EXCEPTION WHEN insufficient_privilege THEN
            RAISE NOTICE 'supabase_admin TRUNCATE default not revoked: insufficient privilege. The guard below re-checks effective exposure and fails closed.';
        END;
    ELSE
        RAISE NOTICE 'supabase_admin TRUNCATE default not revoked: current user is not a member of supabase_admin. The guard below re-checks effective exposure and fails closed.';
    END IF;
END;
$bms_supabase_admin_truncate_default$;

-- Do not silently widen this fix to global defaults or role memberships.
-- A per-schema revoke cannot cancel global or inherited grants.
-- Fail closed within the CLI-owned transaction if those settings retain access.
-- A failure rolls back THIS file only; earlier baselines remain committed and
-- may retain unsafe grants. Keep the environment inaccessible until verified.
DO $bms_truncate_check$
DECLARE
    table_name text;
    client_role text;
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
        -- postgres is the creator of every BMS object: always strictly checked.
        -- supabase_admin defaults are in scope only when this session could revoke
        -- them; otherwise the assertion below proves the exposure path is empty.
        WHERE (
                creator.rolname = 'postgres'
                OR (can_alter_supabase_admin IS TRUE AND creator.rolname = 'supabase_admin')
              )
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

    -- A default ACL can only reach objects created by its owner role. When this
    -- session could not revoke supabase_admin's defaults, fail closed as soon as
    -- any supabase_admin-owned table exists in public.
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
END;
$bms_truncate_check$;
