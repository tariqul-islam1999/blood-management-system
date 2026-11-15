-- REVIEW DRAFT ONLY. Do not execute against a live or populated project.
-- P4.7 STRUCTURAL test for the P4.1 donation schema (migration 20261029000100).
-- SCOPE: structural assertions only. Behavioral and concurrency tests are added later,
--   after P4.2, to this same file.
-- Target: an approved, disposable, EMPTY Supabase PostgreSQL 17 target where the BMS
--   baseline schema, the eligibility migration (20261027000100), M7 (20261028000100)
--   and the P4.1 schema migration (20261029000100) have already been applied, and
--   pgTAP is already installed in the `extensions` schema.
-- TEST-TARGET OPT-IN: an approved disposable-test runner MUST set the session GUC
--   bms.test_target = 'p4.7-disposable' before running this file. The guard fails closed
--   when it is missing or different. This marker must ONLY be set by an approved
--   disposable-test runner; it is a required opt-in and is NOT proof of disposability by
--   itself. The empty-table checks below are additional safeguards, not proof either.
-- Run as postgres. Do not install extensions, do not create fixtures, do not COMMIT.
-- This file makes NO data changes and ends with ROLLBACK.
-- The P4.1 migration's own pre-apply fail-closed guard is deliberately NOT rerun here:
--   a post-migration pgTAP session cannot prove the migration would reject a bad target.
-- The runner must stop on SQL errors and treat any TAP failure as a failure.
BEGIN;
SET LOCAL search_path = pg_temp, public, extensions;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $bms_p4_1_schema_test_prerequisites$
BEGIN
    IF pg_catalog.current_setting('bms.test_target', true) IS DISTINCT FROM 'p4.7-disposable' THEN
        RAISE EXCEPTION 'Refusing to run: set bms.test_target = ''p4.7-disposable'' from an approved disposable-test runner; this opt-in is required and is not proof of disposability by itself';
    END IF;
    IF current_user <> 'postgres'
       OR pg_catalog.current_setting('server_version_num')::integer / 10000 <> 17
       OR pg_catalog.to_regprocedure('extensions.no_plan()') IS NULL THEN
        RAISE EXCEPTION 'Requires PostgreSQL 17, postgres, and existing pgTAP in extensions';
    END IF;
    IF pg_catalog.to_regclass('public.donation_engagements') IS NULL
       OR pg_catalog.to_regclass('public.donation_status_events') IS NULL
       OR pg_catalog.to_regclass('public.donation_followup_responses') IS NULL THEN
        RAISE EXCEPTION 'Apply the approved P4.1 migration 20261029000100 before this test';
    END IF;
    IF pg_catalog.to_regclass('auth.users') IS NULL
       OR pg_catalog.to_regclass('public.profiles') IS NULL
       OR pg_catalog.to_regclass('public.donor_profiles') IS NULL
       OR pg_catalog.to_regclass('public.beneficiary_profiles') IS NULL
       OR pg_catalog.to_regclass('public.blood_requests') IS NULL
       OR pg_catalog.to_regclass('public.blood_request_interests') IS NULL
       OR pg_catalog.to_regclass('public.donor_donations') IS NULL THEN
        RAISE EXCEPTION 'Apply the prerequisite BMS migrations before this test';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon')
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated')
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
        RAISE EXCEPTION 'Supabase anon, authenticated and service_role roles are required';
    END IF;
    IF EXISTS (SELECT 1 FROM auth.users)
       OR EXISTS (SELECT 1 FROM public.profiles)
       OR EXISTS (SELECT 1 FROM public.donation_engagements)
       OR EXISTS (SELECT 1 FROM public.donation_status_events)
       OR EXISTS (SELECT 1 FROM public.donation_followup_responses) THEN
        RAISE EXCEPTION 'Use an empty disposable target; never use real users or real donation data';
    END IF;
END;
$bms_p4_1_schema_test_prerequisites$;

SELECT extensions.no_plan();

-- ---------------------------------------------------------------------------
-- Ownership, RLS and policies
-- ---------------------------------------------------------------------------
SELECT extensions.is((SELECT c.relowner::pg_catalog.regrole::text FROM pg_catalog.pg_class c WHERE c.oid = 'public.donation_engagements'::pg_catalog.regclass), 'postgres', 'donation_engagements owned by postgres');
SELECT extensions.is((SELECT c.relowner::pg_catalog.regrole::text FROM pg_catalog.pg_class c WHERE c.oid = 'public.donation_status_events'::pg_catalog.regclass), 'postgres', 'donation_status_events owned by postgres');
SELECT extensions.is((SELECT c.relowner::pg_catalog.regrole::text FROM pg_catalog.pg_class c WHERE c.oid = 'public.donation_followup_responses'::pg_catalog.regclass), 'postgres', 'donation_followup_responses owned by postgres');

SELECT extensions.ok((SELECT c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid = 'public.donation_engagements'::pg_catalog.regclass), 'donation_engagements RLS enabled');
SELECT extensions.ok((SELECT c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid = 'public.donation_status_events'::pg_catalog.regclass), 'donation_status_events RLS enabled');
SELECT extensions.ok((SELECT c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid = 'public.donation_followup_responses'::pg_catalog.regclass), 'donation_followup_responses RLS enabled');

SELECT extensions.ok(NOT (SELECT c.relforcerowsecurity FROM pg_catalog.pg_class c WHERE c.oid = 'public.donation_engagements'::pg_catalog.regclass), 'donation_engagements RLS not forced');
SELECT extensions.ok(NOT (SELECT c.relforcerowsecurity FROM pg_catalog.pg_class c WHERE c.oid = 'public.donation_status_events'::pg_catalog.regclass), 'donation_status_events RLS not forced');
SELECT extensions.ok(NOT (SELECT c.relforcerowsecurity FROM pg_catalog.pg_class c WHERE c.oid = 'public.donation_followup_responses'::pg_catalog.regclass), 'donation_followup_responses RLS not forced');

SELECT extensions.is((SELECT pg_catalog.count(*) FROM pg_catalog.pg_policies WHERE schemaname = 'public' AND tablename = 'donation_engagements'), 0::bigint, 'donation_engagements has no RLS policies');
SELECT extensions.is((SELECT pg_catalog.count(*) FROM pg_catalog.pg_policies WHERE schemaname = 'public' AND tablename = 'donation_status_events'), 0::bigint, 'donation_status_events has no RLS policies');
SELECT extensions.is((SELECT pg_catalog.count(*) FROM pg_catalog.pg_policies WHERE schemaname = 'public' AND tablename = 'donation_followup_responses'), 0::bigint, 'donation_followup_responses has no RLS policies');

-- ---------------------------------------------------------------------------
-- Columns, types and nullability (exact; a removed/added/retyped column fails)
-- ---------------------------------------------------------------------------
SELECT extensions.ok(
    (SELECT pg_catalog.count(*) FROM (
        SELECT a.attname::text AS col_name, pg_catalog.format_type(a.atttypid, a.atttypmod) AS col_type, a.attnotnull AS is_not_null
          FROM pg_catalog.pg_attribute a
         WHERE a.attrelid = 'public.donation_engagements'::pg_catalog.regclass AND a.attnum > 0 AND NOT a.attisdropped
        EXCEPT
        SELECT e.col_name, e.col_type, e.is_not_null FROM (VALUES
            ('id'::text, 'uuid'::text, true),
            ('request_id', 'uuid', true),
            ('donor_id', 'uuid', true),
            ('beneficiary_id', 'uuid', true),
            ('status', 'text', true),
            ('selected_at', 'timestamp with time zone', true),
            ('reached_location_at', 'timestamp with time zone', false),
            ('donation_started_at', 'timestamp with time zone', false),
            ('donation_ended_at', 'timestamp with time zone', false),
            ('reached_home_safely_at', 'timestamp with time zone', false),
            ('feeling', 'text', false),
            ('follow_up_due_at', 'timestamp with time zone', false),
            ('follow_up_submitted_at', 'timestamp with time zone', false),
            ('created_at', 'timestamp with time zone', true),
            ('updated_at', 'timestamp with time zone', true)
        ) AS e(col_name, col_type, is_not_null)
    ) AS unexpected) = 0
    AND (SELECT pg_catalog.count(*) FROM pg_catalog.pg_attribute a
          WHERE a.attrelid = 'public.donation_engagements'::pg_catalog.regclass AND a.attnum > 0 AND NOT a.attisdropped) = 15
, 'donation_engagements columns/types/nullability exact');

SELECT extensions.ok(
    (SELECT pg_catalog.count(*) FROM (
        SELECT a.attname::text AS col_name, pg_catalog.format_type(a.atttypid, a.atttypmod) AS col_type, a.attnotnull AS is_not_null
          FROM pg_catalog.pg_attribute a
         WHERE a.attrelid = 'public.donation_status_events'::pg_catalog.regclass AND a.attnum > 0 AND NOT a.attisdropped
        EXCEPT
        SELECT e.col_name, e.col_type, e.is_not_null FROM (VALUES
            ('id'::text, 'uuid'::text, true),
            ('engagement_id', 'uuid', true),
            ('from_status', 'text', false),
            ('to_status', 'text', true),
            ('actor_id', 'uuid', true),
            ('actor_role', 'text', true),
            ('occurred_at', 'timestamp with time zone', true),
            ('note', 'text', false)
        ) AS e(col_name, col_type, is_not_null)
    ) AS unexpected) = 0
    AND (SELECT pg_catalog.count(*) FROM pg_catalog.pg_attribute a
          WHERE a.attrelid = 'public.donation_status_events'::pg_catalog.regclass AND a.attnum > 0 AND NOT a.attisdropped) = 8
, 'donation_status_events columns/types/nullability exact');

SELECT extensions.ok(
    (SELECT pg_catalog.count(*) FROM (
        SELECT a.attname::text AS col_name, pg_catalog.format_type(a.atttypid, a.atttypmod) AS col_type, a.attnotnull AS is_not_null
          FROM pg_catalog.pg_attribute a
         WHERE a.attrelid = 'public.donation_followup_responses'::pg_catalog.regclass AND a.attnum > 0 AND NOT a.attisdropped
        EXCEPT
        SELECT e.col_name, e.col_type, e.is_not_null FROM (VALUES
            ('id'::text, 'uuid'::text, true),
            ('engagement_id', 'uuid', true),
            ('physical_condition', 'text', true),
            ('health_changes', 'text', true),
            ('compared_to_after', 'text', true),
            ('current_discomfort', 'text', true),
            ('consulted_professional', 'text', true),
            ('additional_comments', 'text', false),
            ('submitted_at', 'timestamp with time zone', true)
        ) AS e(col_name, col_type, is_not_null)
    ) AS unexpected) = 0
    AND (SELECT pg_catalog.count(*) FROM pg_catalog.pg_attribute a
          WHERE a.attrelid = 'public.donation_followup_responses'::pg_catalog.regclass AND a.attnum > 0 AND NOT a.attisdropped) = 9
, 'donation_followup_responses columns/types/nullability exact');

-- ---------------------------------------------------------------------------
-- Named constraints (exact name + type set per table; any drift fails)
-- ---------------------------------------------------------------------------
SELECT extensions.ok(
    (SELECT pg_catalog.count(*) FROM (
        SELECT c.conname::text AS con_name, c.contype::text AS con_type FROM pg_catalog.pg_constraint c
         WHERE c.conrelid = 'public.donation_engagements'::pg_catalog.regclass
        EXCEPT
        SELECT e.con_name, e.con_type FROM (VALUES
            ('donation_engagements_pkey'::text, 'p'::text),
            ('donation_engagements_status_check', 'c'),
            ('donation_engagements_feeling_check', 'c'),
            ('donation_engagements_reached_location_presence_check', 'c'),
            ('donation_engagements_donation_started_presence_check', 'c'),
            ('donation_engagements_donation_ended_presence_check', 'c'),
            ('donation_engagements_reached_home_safely_presence_check', 'c'),
            ('donation_engagements_feeling_presence_check', 'c'),
            ('donation_engagements_follow_up_due_check', 'c'),
            ('donation_engagements_follow_up_submitted_check', 'c'),
            ('donation_engagements_timestamp_order_check', 'c'),
            ('donation_engagements_request_id_key', 'u'),
            ('donation_engagements_request_id_fkey', 'f'),
            ('donation_engagements_donor_id_fkey', 'f'),
            ('donation_engagements_beneficiary_id_fkey', 'f')
        ) AS e(con_name, con_type)
    ) AS unexpected) = 0
    AND (SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint c WHERE c.conrelid = 'public.donation_engagements'::pg_catalog.regclass) = 15
, 'donation_engagements constraint name/type set exact');

SELECT extensions.ok(
    (SELECT pg_catalog.count(*) FROM (
        SELECT c.conname::text AS con_name, c.contype::text AS con_type FROM pg_catalog.pg_constraint c
         WHERE c.conrelid = 'public.donation_status_events'::pg_catalog.regclass
        EXCEPT
        SELECT e.con_name, e.con_type FROM (VALUES
            ('donation_status_events_pkey'::text, 'p'::text),
            ('donation_status_events_from_status_check', 'c'),
            ('donation_status_events_to_status_check', 'c'),
            ('donation_status_events_actor_role_check', 'c'),
            ('donation_status_events_transition_check', 'c'),
            ('donation_status_events_engagement_id_fkey', 'f'),
            ('donation_status_events_actor_id_fkey', 'f')
        ) AS e(con_name, con_type)
    ) AS unexpected) = 0
    AND (SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint c WHERE c.conrelid = 'public.donation_status_events'::pg_catalog.regclass) = 7
, 'donation_status_events constraint name/type set exact');

SELECT extensions.ok(
    (SELECT pg_catalog.count(*) FROM (
        SELECT c.conname::text AS con_name, c.contype::text AS con_type FROM pg_catalog.pg_constraint c
         WHERE c.conrelid = 'public.donation_followup_responses'::pg_catalog.regclass
        EXCEPT
        SELECT e.con_name, e.con_type FROM (VALUES
            ('donation_followup_responses_pkey'::text, 'p'::text),
            ('donation_followup_responses_engagement_key', 'u'),
            ('donation_followup_responses_physical_condition_check', 'c'),
            ('donation_followup_responses_health_changes_check', 'c'),
            ('donation_followup_responses_compared_to_after_check', 'c'),
            ('donation_followup_responses_current_discomfort_check', 'c'),
            ('donation_followup_responses_consulted_professional_check', 'c'),
            ('donation_followup_responses_additional_comments_check', 'c'),
            ('donation_followup_responses_engagement_id_fkey', 'f')
        ) AS e(con_name, con_type)
    ) AS unexpected) = 0
    AND (SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint c WHERE c.conrelid = 'public.donation_followup_responses'::pg_catalog.regclass) = 9
, 'donation_followup_responses constraint name/type set exact');

-- ---------------------------------------------------------------------------
-- Constraint definitions (required fragments) and FK delete behaviour
-- ---------------------------------------------------------------------------
SELECT extensions.ok(NOT EXISTS (
    SELECT 1 FROM (VALUES
        ('donation_engagements_status_check'::text, 'reached_home_safely'::text),
        ('donation_engagements_feeling_check', 'so_so'),
        ('donation_engagements_reached_location_presence_check', 'reached_location_at'),
        ('donation_engagements_donation_started_presence_check', 'donation_started_at'),
        ('donation_engagements_donation_ended_presence_check', 'donation_ended_at'),
        ('donation_engagements_reached_home_safely_presence_check', 'reached_home_safely_at'),
        ('donation_engagements_feeling_presence_check', 'feeling'),
        ('donation_engagements_follow_up_due_check', 'follow_up_due_at'),
        ('donation_engagements_follow_up_due_check', 'reached_home_safely_at'),
        ('donation_engagements_follow_up_submitted_check', 'follow_up_submitted_at'),
        ('donation_engagements_timestamp_order_check', 'selected_at'),
        ('donation_engagements_timestamp_order_check', 'donation_ended_at'),
        ('donation_engagements_request_id_key', 'request_id')
    ) AS e(constraint_name, fragment)
    WHERE NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint c
         WHERE c.conrelid = 'public.donation_engagements'::pg_catalog.regclass
           AND c.conname = e.constraint_name
           AND pg_catalog.pg_get_constraintdef(c.oid) LIKE '%' || e.fragment || '%'
    )
), 'donation_engagements constraint definitions contain the required fragments');

SELECT extensions.ok(NOT EXISTS (
    SELECT 1 FROM (VALUES
        ('donation_status_events_from_status_check'::text, 'reached_home_safely'::text),
        ('donation_status_events_to_status_check', 'reached_home_safely'),
        ('donation_status_events_actor_role_check', 'donor'),
        ('donation_status_events_transition_check', 'selected')
    ) AS e(constraint_name, fragment)
    WHERE NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint c
         WHERE c.conrelid = 'public.donation_status_events'::pg_catalog.regclass
           AND c.conname = e.constraint_name
           AND pg_catalog.pg_get_constraintdef(c.oid) LIKE '%' || e.fragment || '%'
    )
), 'donation_status_events constraint definitions contain the required fragments');

SELECT extensions.ok(NOT EXISTS (
    SELECT 1 FROM (VALUES
        ('donation_followup_responses_engagement_key'::text, 'engagement_id'::text),
        ('donation_followup_responses_physical_condition_check', 'not_well'),
        ('donation_followup_responses_health_changes_check', 'not_sure'),
        ('donation_followup_responses_compared_to_after_check', 'worse'),
        ('donation_followup_responses_current_discomfort_check', 'prefer_not_to_say'),
        ('donation_followup_responses_consulted_professional_check', 'not_needed'),
        ('donation_followup_responses_additional_comments_check', 'additional_comments'),
        ('donation_followup_responses_additional_comments_check', '500')
    ) AS e(constraint_name, fragment)
    WHERE NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint c
         WHERE c.conrelid = 'public.donation_followup_responses'::pg_catalog.regclass
           AND c.conname = e.constraint_name
           AND pg_catalog.pg_get_constraintdef(c.oid) LIKE '%' || e.fragment || '%'
    )
), 'donation_followup_responses constraint definitions contain the required fragments');

SELECT extensions.ok(NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid = 'public.donation_engagements'::pg_catalog.regclass AND c.contype = 'f' AND c.confdeltype <> 'r'), 'all donation_engagements FKs are ON DELETE RESTRICT');
SELECT extensions.ok(NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid = 'public.donation_status_events'::pg_catalog.regclass AND c.contype = 'f' AND c.confdeltype <> 'r'), 'all donation_status_events FKs are ON DELETE RESTRICT');
SELECT extensions.ok(NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid = 'public.donation_followup_responses'::pg_catalog.regclass AND c.contype = 'f' AND c.confdeltype <> 'r'), 'all donation_followup_responses FKs are ON DELETE RESTRICT');
SELECT extensions.is((SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint c WHERE c.conrelid = 'public.donation_engagements'::pg_catalog.regclass AND c.contype = 'f'), 3::bigint, 'donation_engagements has 3 FK constraints');
SELECT extensions.is((SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint c WHERE c.conrelid = 'public.donation_status_events'::pg_catalog.regclass AND c.contype = 'f'), 2::bigint, 'donation_status_events has 2 FK constraints');
SELECT extensions.is((SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint c WHERE c.conrelid = 'public.donation_followup_responses'::pg_catalog.regclass AND c.contype = 'f'), 1::bigint, 'donation_followup_responses has 1 FK constraint');

-- 48-hour interval: verify the actual interval literal, not just column-name fragments.
SELECT extensions.ok(EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint c
     WHERE c.conrelid = 'public.donation_engagements'::pg_catalog.regclass
       AND c.conname = 'donation_engagements_follow_up_due_check'
       AND pg_catalog.replace(pg_catalog.pg_get_constraintdef(c.oid), ' ', '') LIKE '%48:00:00%'
       AND pg_catalog.replace(pg_catalog.pg_get_constraintdef(c.oid), ' ', '') LIKE '%interval%'
), 'donation_engagements_follow_up_due_check uses the 48-hour interval');

-- FK targets: verify the referenced table AND column, not only ON DELETE.
SELECT extensions.ok(NOT EXISTS (
    SELECT 1 FROM (VALUES
        ('donation_engagements'::text, 'donation_engagements_request_id_fkey'::text, 'request_id'::text, 'blood_requests'::text, 'id'::text),
        ('donation_engagements', 'donation_engagements_donor_id_fkey', 'donor_id', 'donor_profiles', 'user_id'),
        ('donation_engagements', 'donation_engagements_beneficiary_id_fkey', 'beneficiary_id', 'beneficiary_profiles', 'user_id'),
        ('donation_status_events', 'donation_status_events_engagement_id_fkey', 'engagement_id', 'donation_engagements', 'id'),
        ('donation_status_events', 'donation_status_events_actor_id_fkey', 'actor_id', 'profiles', 'id'),
        ('donation_followup_responses', 'donation_followup_responses_engagement_id_fkey', 'engagement_id', 'donation_engagements', 'id')
    ) AS e(local_table, con_name, local_col, ref_table, ref_col)
    WHERE NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint c
         WHERE c.conrelid = ('public.' || e.local_table)::pg_catalog.regclass
           AND c.conname = e.con_name
           AND c.contype = 'f'
           AND c.confrelid = ('public.' || e.ref_table)::pg_catalog.regclass
           AND (SELECT a.attname FROM pg_catalog.pg_attribute a WHERE a.attrelid = c.conrelid AND a.attnum = c.conkey[1]) = e.local_col
           AND (SELECT a.attname FROM pg_catalog.pg_attribute a WHERE a.attrelid = c.confrelid AND a.attnum = c.confkey[1]) = e.ref_col
    )
), 'every P4.1 FK references the approved table and column');

-- Column defaults defined by the migration.
SELECT extensions.ok(NOT EXISTS (
    SELECT 1 FROM (VALUES
        ('donation_engagements'::text, 'id'::text, 'gen_random_uuid'::text),
        ('donation_engagements', 'status', 'selected'),
        ('donation_engagements', 'selected_at', 'clock_timestamp'),
        ('donation_engagements', 'created_at', 'clock_timestamp'),
        ('donation_engagements', 'updated_at', 'clock_timestamp'),
        ('donation_status_events', 'id', 'gen_random_uuid'),
        ('donation_status_events', 'occurred_at', 'clock_timestamp'),
        ('donation_followup_responses', 'id', 'gen_random_uuid'),
        ('donation_followup_responses', 'submitted_at', 'clock_timestamp')
    ) AS e(local_table, col_name, frag)
    WHERE NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_attrdef ad
          JOIN pg_catalog.pg_attribute a ON a.attrelid = ad.adrelid AND a.attnum = ad.adnum
         WHERE ad.adrelid = ('public.' || e.local_table)::pg_catalog.regclass
           AND a.attname = e.col_name
           AND pg_catalog.replace(pg_catalog.pg_get_expr(ad.adbin, ad.adrelid), ' ', '') LIKE '%' || e.frag || '%'
    )
), 'every P4.1 column default matches the approved migration');

-- ---------------------------------------------------------------------------
-- The nine expected indexes (existence, uniqueness, key columns, partial predicate)
-- ---------------------------------------------------------------------------
SELECT extensions.ok(EXISTS (SELECT 1 FROM pg_catalog.pg_index i WHERE i.indexrelid = 'public.donation_engagements_pkey'::pg_catalog.regclass AND i.indrelid = 'public.donation_engagements'::pg_catalog.regclass AND i.indisunique AND i.indisprimary), 'donation_engagements_pkey present (unique primary key)');
SELECT extensions.is((SELECT pg_catalog.string_agg(pg_catalog.pg_get_indexdef(i.indexrelid, k.n, true), ', ' ORDER BY k.n) FROM pg_catalog.pg_index i CROSS JOIN pg_catalog.generate_series(1, i.indnkeyatts) AS k(n) WHERE i.indexrelid = 'public.donation_engagements_pkey'::pg_catalog.regclass), 'id', 'donation_engagements_pkey key columns');

SELECT extensions.ok(EXISTS (SELECT 1 FROM pg_catalog.pg_index i WHERE i.indexrelid = 'public.donation_engagements_request_id_key'::pg_catalog.regclass AND i.indrelid = 'public.donation_engagements'::pg_catalog.regclass AND i.indisunique AND NOT i.indisprimary), 'donation_engagements_request_id_key present (UNIQUE, one engagement per request)');
SELECT extensions.is((SELECT pg_catalog.string_agg(pg_catalog.pg_get_indexdef(i.indexrelid, k.n, true), ', ' ORDER BY k.n) FROM pg_catalog.pg_index i CROSS JOIN pg_catalog.generate_series(1, i.indnkeyatts) AS k(n) WHERE i.indexrelid = 'public.donation_engagements_request_id_key'::pg_catalog.regclass), 'request_id', 'donation_engagements_request_id_key key columns');

SELECT extensions.ok(EXISTS (SELECT 1 FROM pg_catalog.pg_index i WHERE i.indexrelid = 'public.donation_engagements_donor_active_idx'::pg_catalog.regclass AND i.indrelid = 'public.donation_engagements'::pg_catalog.regclass AND i.indisunique AND NOT i.indisprimary AND i.indpred IS NOT NULL AND pg_catalog.replace(pg_catalog.lower(pg_catalog.pg_get_expr(i.indpred, i.indrelid)), ' ', '') ~ '^\(?status<>''reached_home_safely''(::text)?\)?$'), 'donation_engagements_donor_active_idx predicate is exactly (status <> reached_home_safely)');
SELECT extensions.is((SELECT pg_catalog.string_agg(pg_catalog.pg_get_indexdef(i.indexrelid, k.n, true), ', ' ORDER BY k.n) FROM pg_catalog.pg_index i CROSS JOIN pg_catalog.generate_series(1, i.indnkeyatts) AS k(n) WHERE i.indexrelid = 'public.donation_engagements_donor_active_idx'::pg_catalog.regclass), 'donor_id', 'donation_engagements_donor_active_idx key columns');

SELECT extensions.ok(EXISTS (SELECT 1 FROM pg_catalog.pg_index i WHERE i.indexrelid = 'public.donation_engagements_beneficiary_idx'::pg_catalog.regclass AND i.indrelid = 'public.donation_engagements'::pg_catalog.regclass AND NOT i.indisunique), 'donation_engagements_beneficiary_idx present (non-unique)');
SELECT extensions.is((SELECT pg_catalog.string_agg(pg_catalog.pg_get_indexdef(i.indexrelid, k.n, true), ', ' ORDER BY k.n) FROM pg_catalog.pg_index i CROSS JOIN pg_catalog.generate_series(1, i.indnkeyatts) AS k(n) WHERE i.indexrelid = 'public.donation_engagements_beneficiary_idx'::pg_catalog.regclass), 'beneficiary_id, updated_at DESC, id', 'donation_engagements_beneficiary_idx key columns');

SELECT extensions.ok(EXISTS (SELECT 1 FROM pg_catalog.pg_index i WHERE i.indexrelid = 'public.donation_engagements_donor_idx'::pg_catalog.regclass AND i.indrelid = 'public.donation_engagements'::pg_catalog.regclass AND NOT i.indisunique), 'donation_engagements_donor_idx present (non-unique)');
SELECT extensions.is((SELECT pg_catalog.string_agg(pg_catalog.pg_get_indexdef(i.indexrelid, k.n, true), ', ' ORDER BY k.n) FROM pg_catalog.pg_index i CROSS JOIN pg_catalog.generate_series(1, i.indnkeyatts) AS k(n) WHERE i.indexrelid = 'public.donation_engagements_donor_idx'::pg_catalog.regclass), 'donor_id, updated_at DESC, id', 'donation_engagements_donor_idx key columns');

SELECT extensions.ok(EXISTS (SELECT 1 FROM pg_catalog.pg_index i WHERE i.indexrelid = 'public.donation_status_events_pkey'::pg_catalog.regclass AND i.indrelid = 'public.donation_status_events'::pg_catalog.regclass AND i.indisunique AND i.indisprimary), 'donation_status_events_pkey present (unique primary key)');
SELECT extensions.is((SELECT pg_catalog.string_agg(pg_catalog.pg_get_indexdef(i.indexrelid, k.n, true), ', ' ORDER BY k.n) FROM pg_catalog.pg_index i CROSS JOIN pg_catalog.generate_series(1, i.indnkeyatts) AS k(n) WHERE i.indexrelid = 'public.donation_status_events_pkey'::pg_catalog.regclass), 'id', 'donation_status_events_pkey key columns');

SELECT extensions.ok(EXISTS (SELECT 1 FROM pg_catalog.pg_index i WHERE i.indexrelid = 'public.donation_status_events_engagement_idx'::pg_catalog.regclass AND i.indrelid = 'public.donation_status_events'::pg_catalog.regclass AND NOT i.indisunique), 'donation_status_events_engagement_idx present (non-unique)');
SELECT extensions.is((SELECT pg_catalog.string_agg(pg_catalog.pg_get_indexdef(i.indexrelid, k.n, true), ', ' ORDER BY k.n) FROM pg_catalog.pg_index i CROSS JOIN pg_catalog.generate_series(1, i.indnkeyatts) AS k(n) WHERE i.indexrelid = 'public.donation_status_events_engagement_idx'::pg_catalog.regclass), 'engagement_id, occurred_at, id', 'donation_status_events_engagement_idx key columns');

SELECT extensions.ok(EXISTS (SELECT 1 FROM pg_catalog.pg_index i WHERE i.indexrelid = 'public.donation_followup_responses_pkey'::pg_catalog.regclass AND i.indrelid = 'public.donation_followup_responses'::pg_catalog.regclass AND i.indisunique AND i.indisprimary), 'donation_followup_responses_pkey present (unique primary key)');
SELECT extensions.is((SELECT pg_catalog.string_agg(pg_catalog.pg_get_indexdef(i.indexrelid, k.n, true), ', ' ORDER BY k.n) FROM pg_catalog.pg_index i CROSS JOIN pg_catalog.generate_series(1, i.indnkeyatts) AS k(n) WHERE i.indexrelid = 'public.donation_followup_responses_pkey'::pg_catalog.regclass), 'id', 'donation_followup_responses_pkey key columns');

SELECT extensions.ok(EXISTS (SELECT 1 FROM pg_catalog.pg_index i WHERE i.indexrelid = 'public.donation_followup_responses_engagement_key'::pg_catalog.regclass AND i.indrelid = 'public.donation_followup_responses'::pg_catalog.regclass AND i.indisunique AND NOT i.indisprimary), 'donation_followup_responses_engagement_key present (UNIQUE, one response per engagement)');
SELECT extensions.is((SELECT pg_catalog.string_agg(pg_catalog.pg_get_indexdef(i.indexrelid, k.n, true), ', ' ORDER BY k.n) FROM pg_catalog.pg_index i CROSS JOIN pg_catalog.generate_series(1, i.indnkeyatts) AS k(n) WHERE i.indexrelid = 'public.donation_followup_responses_engagement_key'::pg_catalog.regclass), 'engagement_id', 'donation_followup_responses_engagement_key key columns');

SELECT extensions.is((SELECT pg_catalog.count(*) FROM pg_catalog.pg_index i WHERE i.indrelid = 'public.donation_engagements'::pg_catalog.regclass), 5::bigint, 'donation_engagements has exactly 5 indexes');
SELECT extensions.is((SELECT pg_catalog.count(*) FROM pg_catalog.pg_index i WHERE i.indrelid = 'public.donation_status_events'::pg_catalog.regclass), 2::bigint, 'donation_status_events has exactly 2 indexes');
SELECT extensions.is((SELECT pg_catalog.count(*) FROM pg_catalog.pg_index i WHERE i.indrelid = 'public.donation_followup_responses'::pg_catalog.regclass), 2::bigint, 'donation_followup_responses has exactly 2 indexes');

-- ---------------------------------------------------------------------------
-- Privilege protections: no direct table/column privileges for anon,
-- authenticated, service_role; and no PUBLIC grant.
-- ---------------------------------------------------------------------------
SELECT extensions.ok(NOT EXISTS (
    SELECT 1 FROM (VALUES ('anon'),('authenticated'),('service_role')) AS r(role_name)
    CROSS JOIN (VALUES ('donation_engagements'),('donation_status_events'),('donation_followup_responses')) AS t(table_name)
    WHERE pg_catalog.has_table_privilege(r.role_name, 'public.' || t.table_name,
              'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
), 'no table privilege for anon/authenticated/service_role on any P4.1 table');

SELECT extensions.ok(NOT EXISTS (
    SELECT 1 FROM (VALUES ('anon'),('authenticated'),('service_role')) AS r(role_name)
    CROSS JOIN (VALUES ('donation_engagements'),('donation_status_events'),('donation_followup_responses')) AS t(table_name)
    WHERE pg_catalog.has_any_column_privilege(r.role_name, 'public.' || t.table_name,
              'SELECT,INSERT,UPDATE,REFERENCES')
), 'no column privilege for anon/authenticated/service_role on any P4.1 table');

-- PUBLIC is a pseudo-role (oid 0); inspect the expanded relation ACL directly.
SELECT extensions.ok(NOT EXISTS (
    SELECT 1 FROM (VALUES ('donation_engagements'),('donation_status_events'),('donation_followup_responses')) AS t(table_name)
    CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(
            (SELECT c.relacl FROM pg_catalog.pg_class c WHERE c.oid = ('public.' || t.table_name)::pg_catalog.regclass),
            pg_catalog.acldefault('r', (SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = ('public.' || t.table_name)::pg_catalog.regclass))
        )
    ) AS acl
    WHERE acl.grantee = 0
), 'PUBLIC holds no privilege on any P4.1 table');

-- Effective access evaluated through each role's own oid (defence in depth; mirrors the migration guard).
SELECT extensions.ok(NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles r
    WHERE r.rolname IN ('anon','authenticated','service_role')
      AND (pg_catalog.has_table_privilege(r.oid, 'public.donation_engagements', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
        OR pg_catalog.has_table_privilege(r.oid, 'public.donation_status_events', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
        OR pg_catalog.has_table_privilege(r.oid, 'public.donation_followup_responses', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'))
), 'no effective table privilege via role oid for anon/authenticated/service_role');

-- No client role may reach a privileged role (mirrors the migration's effective-permission guard).
SELECT extensions.ok(NOT EXISTS (
    SELECT 1 FROM (VALUES ('anon'),('authenticated')) AS c(client_role)
    CROSS JOIN pg_catalog.pg_roles r
    WHERE (pg_catalog.pg_has_role(c.client_role, r.oid, 'USAGE') OR pg_catalog.pg_has_role(c.client_role, r.oid, 'SET'))
      AND (r.rolsuper OR r.rolbypassrls OR r.rolcreaterole)
), 'no client role can reach a privileged (SUPERUSER/BYPASSRLS/CREATEROLE) role');

SELECT * FROM extensions.finish();
ROLLBACK;
