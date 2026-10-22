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
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
    REVOKE TRUNCATE ON TABLES FROM anon, authenticated;

-- Do not silently widen this fix to global defaults or role memberships.
-- A per-schema revoke cannot cancel global or inherited grants.
-- Fail closed within the CLI-owned transaction if those settings retain access.
-- A failure rolls back THIS file only; earlier baselines remain committed and
-- may retain unsafe grants. Keep the environment inaccessible until verified.
DO $bms_truncate_check$
DECLARE
    table_name text;
    client_role text;
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
              )
          END
    ) THEN
        RAISE EXCEPTION 'Global or inherited default TRUNCATE requires separate reviewed remediation';
    END IF;
END;
$bms_truncate_check$;
