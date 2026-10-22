-- REVIEW DRAFT ONLY. Do not execute without separate isolated-target approval.
-- Requires four migrations plus separately reviewed TRIGGER hardening, postgres,
-- CREATEROLE/fixture membership administration, and pgTAP ALREADY in extensions.
-- Adversarial grants/memberships below are TEST ONLY and rolled back; never run live.
-- Intended for a disposable EMPTY BMS test database, never the existing project.
-- The future runner must stop on SQL errors and report TAP failures as failures.
-- These explicit transaction boundaries belong to a TEST file, not a migration.
BEGIN;
SET LOCAL search_path = pg_temp, public, extensions;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $test_prerequisites$
BEGIN
    IF current_user <> 'postgres'
       OR pg_catalog.to_regprocedure('extensions.no_plan()') IS NULL THEN
        RAISE EXCEPTION 'Test requires postgres and existing pgTAP in extensions; do not install automatically';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = current_user AND rolcreaterole)
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles
                  WHERE rolname IN ('bms_test_inherit_parent', 'bms_test_set_parent')) THEN
        RAISE EXCEPTION 'Test requires approved role administration and unused fixture role names';
    END IF;
    IF EXISTS (SELECT 1 FROM public.profiles) THEN
        RAISE EXCEPTION 'Tests require empty BMS profiles; never use real or existing users';
    END IF;
    IF pg_catalog.to_regprocedure('public.admin_review_donor(uuid,text,text)') IS NULL THEN
        RAISE EXCEPTION 'Apply and verify all four drafts in the approved isolated target first';
    END IF;
END;
$test_prerequisites$;

SELECT extensions.no_plan();

-- Exact copy of the migration guard body: offline checks must keep it identical.
-- This invoker helper is test-only; it does not replace the migration guard.
CREATE FUNCTION pg_temp.bms_assert_client_permissions() RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $guard_test$
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
$guard_test$;
SELECT extensions.lives_ok($$SELECT pg_temp.bms_assert_client_permissions()$$,
    'initial effective permission guard succeeds after approved hardening');

CREATE FUNCTION pg_temp.bms_noop_trigger() RETURNS trigger
LANGUAGE plpgsql AS $noop$
BEGIN
    RETURN NEW;
END;
$noop$;
GRANT EXECUTE ON FUNCTION pg_temp.bms_noop_trigger() TO authenticated;

-- Public signup cannot select either privileged application role.
SELECT extensions.throws_ok(
    $$INSERT INTO auth.users (id, raw_user_meta_data)
      VALUES ('00000000-0000-4000-8000-000000000090', '{"role":"admin"}'::jsonb)$$,
    'P0001', 'Invalid registration role', 'signup cannot choose admin');
SELECT extensions.throws_ok(
    $$INSERT INTO auth.users (id, raw_user_meta_data)
      VALUES ('00000000-0000-4000-8000-000000000091', '{"role":"super_admin"}'::jsonb)$$,
    'P0001', 'Invalid registration role', 'signup cannot choose super admin');

-- Synthetic records only. No passwords, sessions, email addresses or real users.
-- Exercise the real signup trigger, then promote fixture admins as trusted postgres.
INSERT INTO auth.users (id, raw_user_meta_data)
SELECT ('00000000-0000-4000-8000-' || pg_catalog.lpad(n::text, 12, '0'))::uuid,
       pg_catalog.jsonb_build_object(
           'role', CASE WHEN n = 3 OR n BETWEEN 7 AND 10 THEN 'donor' ELSE 'beneficiary' END,
           'full_name', 'BMS synthetic fixture ' || n,
           'phone', '01990000' || pg_catalog.lpad(n::text, 3, '0'),
           'district', 'Test district', 'thana', 'Test thana', 'local_area', 'Test area',
           'blood_group', 'O+', 'date_of_birth', '1990-01-01'
       )
FROM pg_catalog.generate_series(1, 11) AS fixture(n);

UPDATE public.profiles SET role = 'admin'
WHERE id IN ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000005');
UPDATE public.profiles SET role = 'super_admin'
WHERE id IN ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000006');
UPDATE public.profiles SET account_status = 'suspended'
WHERE id IN ('00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000009');
UPDATE public.profiles SET account_status = 'deactivated'
WHERE id = '00000000-0000-4000-8000-000000000006';

-- Omit verification_status on an additional insert to test the corrected DEFAULT.
UPDATE public.profiles SET role = 'donor'
WHERE id = '00000000-0000-4000-8000-000000000011';
INSERT INTO public.donor_profiles (user_id, blood_group, date_of_birth)
VALUES ('00000000-0000-4000-8000-000000000011', 'O+', '1990-01-01');
SELECT extensions.is(
    (SELECT verification_status FROM public.donor_profiles
     WHERE user_id = '00000000-0000-4000-8000-000000000011'),
    'pending', 'omitted status defaults to pending');
SELECT extensions.throws_ok(
    $$UPDATE public.donor_profiles SET verification_status = NULL
      WHERE user_id = '00000000-0000-4000-8000-000000000011'$$,
    '23502', NULL, 'NULL verification status is forbidden');

SELECT extensions.ok(
    NOT pg_catalog.has_table_privilege('anon', 'public.donor_verification_history', 'TRUNCATE')
    AND NOT pg_catalog.has_table_privilege('authenticated', 'public.donor_verification_history', 'TRUNCATE'),
    'neither client role has effective TRUNCATE');
SELECT extensions.ok(
    (SELECT relrowsecurity FROM pg_catalog.pg_class
     WHERE oid = 'public.donor_verification_history'::pg_catalog.regclass),
    'history has RLS enabled');

SET LOCAL ROLE anon;
SELECT extensions.throws_ok(
    $$SELECT * FROM public.admin_list_pending_donors()$$,
    '42501', NULL, 'anon cannot execute listing RPC');
SELECT extensions.throws_ok(
    $$SELECT * FROM public.admin_review_donor('00000000-0000-4000-8000-000000000007', 'approved')$$,
    '42501', NULL, 'anon cannot execute decision RPC');
RESET ROLE;

SET LOCAL ROLE authenticated;
-- Missing identity even with the authenticated database role must fail.
SELECT pg_catalog.set_config('request.jwt.claim.sub', '', true);
SELECT pg_catalog.set_config('request.jwt.claims', '{}', true);
SELECT extensions.throws_ok(
    $$SELECT * FROM public.admin_list_pending_donors()$$,
    '42501', 'Active administrator required', 'missing identity cannot list');
SELECT extensions.throws_ok(
    $$SELECT * FROM public.admin_review_donor('00000000-0000-4000-8000-000000000007', 'approved')$$,
    '42501', 'Active administrator required', 'missing identity cannot review');

SELECT pg_catalog.set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000003', true);
SELECT pg_catalog.set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000003","role":"authenticated","user_metadata":{"role":"admin"}}', true);
SELECT extensions.throws_ok(
    $$SELECT * FROM public.admin_list_pending_donors()$$,
    '42501', 'Active administrator required', 'donor with forged admin metadata cannot list');
SELECT extensions.throws_ok(
    $$SELECT * FROM public.admin_review_donor('00000000-0000-4000-8000-000000000007', 'approved')$$,
    '42501', 'Active administrator required', 'donor with forged admin metadata cannot review');

SELECT pg_catalog.set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000004', true);
SELECT pg_catalog.set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated","user_metadata":{"role":"admin"}}', true);
SELECT extensions.throws_ok(
    $$SELECT * FROM public.admin_list_pending_donors()$$,
    '42501', 'Active administrator required', 'beneficiary cannot list');
SELECT extensions.throws_ok(
    $$SELECT * FROM public.admin_review_donor('00000000-0000-4000-8000-000000000007', 'approved')$$,
    '42501', 'Active administrator required', 'beneficiary cannot review');

SELECT pg_catalog.set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000005', true);
SELECT pg_catalog.set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000005","role":"authenticated","user_metadata":{"role":"admin"}}', true);
SELECT extensions.throws_ok(
    $$SELECT * FROM public.admin_list_pending_donors()$$,
    '42501', 'Active administrator required', 'suspended admin cannot list');
SELECT extensions.throws_ok(
    $$SELECT * FROM public.admin_review_donor('00000000-0000-4000-8000-000000000007', 'approved')$$,
    '42501', 'Active administrator required', 'suspended admin cannot review');

SELECT pg_catalog.set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000006', true);
SELECT pg_catalog.set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000006","role":"authenticated","user_metadata":{"role":"admin"}}', true);
SELECT extensions.throws_ok(
    $$SELECT * FROM public.admin_list_pending_donors()$$,
    '42501', 'Active administrator required', 'deactivated super admin cannot list');
SELECT extensions.throws_ok(
    $$SELECT * FROM public.admin_review_donor('00000000-0000-4000-8000-000000000007', 'approved')$$,
    '42501', 'Active administrator required', 'deactivated super admin cannot review');

SELECT pg_catalog.set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000099', true);
SELECT pg_catalog.set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000099","role":"authenticated","user_metadata":{"role":"admin"}}', true);
SELECT extensions.throws_ok(
    $$SELECT * FROM public.admin_list_pending_donors()$$,
    '42501', 'Active administrator required', 'missing profile cannot list');
SELECT extensions.throws_ok(
    $$SELECT * FROM public.admin_review_donor('00000000-0000-4000-8000-000000000007', 'approved')$$,
    '42501', 'Active administrator required', 'missing profile cannot review');

-- Complete the inactive-admin role/status matrix as trusted fixture setup.
RESET ROLE;
UPDATE public.profiles SET account_status = 'deactivated'
WHERE id = '00000000-0000-4000-8000-000000000005';
UPDATE public.profiles SET account_status = 'suspended'
WHERE id = '00000000-0000-4000-8000-000000000006';
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000005', true);
SELECT pg_catalog.set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000005","role":"authenticated"}', true);
SELECT extensions.throws_ok(
    $$SELECT * FROM public.admin_list_pending_donors()$$,
    '42501', 'Active administrator required', 'deactivated admin cannot list');
SELECT extensions.throws_ok(
    $$SELECT * FROM public.admin_review_donor('00000000-0000-4000-8000-000000000007', 'approved')$$,
    '42501', 'Active administrator required', 'deactivated admin cannot review');
SELECT pg_catalog.set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000006', true);
SELECT pg_catalog.set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000006","role":"authenticated"}', true);
SELECT extensions.throws_ok(
    $$SELECT * FROM public.admin_list_pending_donors()$$,
    '42501', 'Active administrator required', 'suspended super admin cannot list');
SELECT extensions.throws_ok(
    $$SELECT * FROM public.admin_review_donor('00000000-0000-4000-8000-000000000007', 'approved')$$,
    '42501', 'Active administrator required', 'suspended super admin cannot review');

-- Ordinary clients must not promote their OWN profiles either.
SELECT pg_catalog.set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000003', true);
SELECT pg_catalog.set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
SELECT extensions.throws_ok(
    $$UPDATE public.profiles SET role = 'admin'
      WHERE id = '00000000-0000-4000-8000-000000000003'$$,
    '42501', NULL, 'donor cannot self-promote');
SELECT extensions.throws_ok(
    $$SELECT * FROM public.admin_review_donor('00000000-0000-4000-8000-000000000007',
      'rejected', repeat('x', 4097))$$,
    '42501', 'Active administrator required', 'authorization precedes oversized reason validation');
SELECT pg_catalog.set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000004', true);
SELECT pg_catalog.set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
SELECT extensions.throws_ok(
    $$UPDATE public.profiles SET role = 'super_admin'
      WHERE id = '00000000-0000-4000-8000-000000000004'$$,
    '42501', NULL, 'beneficiary cannot self-promote');

-- Active database admin; deliberately conflicting metadata must not override it.
SELECT pg_catalog.set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
SELECT pg_catalog.set_config('request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated","user_metadata":{"role":"donor"}}', true);
SELECT extensions.is(
    (SELECT count(*) FROM public.admin_list_pending_donors()), 5::bigint,
    'active admin sees all five active pending synthetic donors');
SELECT extensions.is(
    (SELECT count(*) FROM public.admin_list_pending_donors(1, 0)), 1::bigint,
    'page size is enforced');
SELECT extensions.is(
    (SELECT count(*) FROM public.admin_list_pending_donors()
     WHERE donor_id = '00000000-0000-4000-8000-000000000009'), 0::bigint,
    'inactive target is excluded');
SELECT extensions.throws_ok($$SELECT * FROM public.admin_list_pending_donors(51, 0)$$,
    '22023', 'Invalid pagination', 'oversized page rejected');
SELECT extensions.throws_ok($$SELECT * FROM public.admin_list_pending_donors(NULL, 0)$$,
    '22023', 'Invalid pagination', 'NULL page rejected');
SELECT extensions.throws_ok($$SELECT * FROM public.admin_list_pending_donors(20, -1)$$,
    '22023', 'Invalid pagination', 'negative offset rejected');
SELECT extensions.throws_ok(
    $$UPDATE public.profiles SET role = 'super_admin'
      WHERE id = '00000000-0000-4000-8000-000000000003'$$,
    '42501', NULL, 'admin client cannot directly change roles');
SELECT extensions.throws_ok(
    $$UPDATE public.donor_profiles SET verification_status = 'approved'
      WHERE user_id = '00000000-0000-4000-8000-000000000007'$$,
    '42501', NULL, 'admin client cannot directly approve');
SELECT extensions.throws_ok($$SELECT * FROM public.donor_verification_history$$,
    '42501', NULL, 'audit records cannot be read directly');
SELECT extensions.throws_ok(
    $$INSERT INTO public.donor_verification_history DEFAULT VALUES$$,
    '42501', NULL, 'client cannot fabricate audit events');
SELECT extensions.throws_ok($$DELETE FROM public.donor_verification_history$$,
    '42501', NULL, 'client cannot delete audit history');
SELECT extensions.throws_ok(
    $$UPDATE public.donor_verification_history SET new_status = 'approved'$$,
    '42501', NULL, 'client cannot rewrite audit history');
SELECT extensions.throws_ok(
    $$CREATE TRIGGER bms_test_forbidden_trigger BEFORE UPDATE ON public.donor_profiles
      FOR EACH ROW EXECUTE FUNCTION pg_temp.bms_noop_trigger()$$,
    '42501', NULL, 'client cannot attach trigger to protected donor table');
SELECT extensions.throws_ok(
    $$CREATE TRIGGER bms_test_forbidden_profile_trigger BEFORE UPDATE ON public.profiles
      FOR EACH ROW EXECUTE FUNCTION pg_temp.bms_noop_trigger()$$,
    '42501', NULL, 'client cannot attach trigger to protected profile table');


SELECT extensions.throws_ok(
    $$SELECT * FROM public.admin_review_donor('00000000-0000-4000-8000-000000000007',
      'rejected', repeat(' ', 4097))$$,
    '22023', 'Rejection reason exceeds raw input limit', 'raw bound applies before trimming');
SELECT extensions.throws_ok(
    $$SELECT * FROM public.admin_review_donor('00000000-0000-4000-8000-000000000007',
      'rejected', repeat(chr(128512), 1025))$$,
    '22023', 'Rejection reason exceeds raw input limit', 'raw limit counts UTF-8 bytes');

SELECT extensions.throws_ok(
    $$SELECT * FROM public.admin_review_donor('00000000-0000-4000-8000-000000000007', 'rejected')$$,
    '22023', 'Invalid rejection reason', 'rejection requires reason');
SELECT extensions.throws_ok(
    $$SELECT * FROM public.admin_review_donor('00000000-0000-4000-8000-000000000007', 'rejected', '         ')$$,
    '22023', 'Invalid rejection reason', 'blank rejection reason rejected');
SELECT extensions.throws_ok(
    $$SELECT * FROM public.admin_review_donor('00000000-0000-4000-8000-000000000007', 'rejected', repeat(chr(9), 12))$$,
    '22023', 'Invalid rejection reason', 'tab-only rejection reason rejected');
SELECT extensions.throws_ok(
    $$SELECT * FROM public.admin_review_donor('00000000-0000-4000-8000-000000000007', 'rejected', 'too short')$$,
    '22023', 'Invalid rejection reason', 'nine-character reason rejected');
SELECT extensions.throws_ok(
    $$SELECT * FROM public.admin_review_donor('00000000-0000-4000-8000-000000000007', 'rejected', repeat('x', 501))$$,
    '22023', 'Invalid rejection reason', '501-character reason rejected');
SELECT extensions.throws_ok(
    $$SELECT * FROM public.admin_review_donor('00000000-0000-4000-8000-000000000007', 'approved', 'unneeded note')$$,
    '22023', 'Invalid rejection reason', 'approval cannot store rejection reason');
SELECT extensions.throws_ok(
    $$SELECT * FROM public.admin_review_donor('00000000-0000-4000-8000-000000000007', 'pending')$$,
    '22023', 'Invalid donor review request', 'unsupported decision rejected');
SELECT extensions.throws_ok(
    $$SELECT * FROM public.admin_review_donor(NULL, 'approved')$$,
    '22023', 'Invalid donor review request', 'NULL target rejected');
SELECT extensions.throws_ok(
    $$SELECT * FROM public.admin_review_donor('00000000-0000-4000-8000-000000000009', 'approved')$$,
    'P0002', 'Active donor not found', 'inactive donor cannot be reviewed');
SELECT extensions.throws_ok(
    $$SELECT * FROM public.admin_review_donor('00000000-0000-4000-8000-000000000004', 'approved')$$,
    'P0002', 'Active donor not found', 'beneficiary cannot be reviewed');
SELECT extensions.throws_ok(
    $$SELECT * FROM public.admin_review_donor('00000000-0000-4000-8000-000000000099', 'approved')$$,
    'P0002', 'Active donor not found', 'nonexistent donor cannot be reviewed');

SELECT extensions.lives_ok(
    $$SELECT * FROM public.admin_review_donor('00000000-0000-4000-8000-000000000007', 'approved')$$,
    'active admin can approve');
SELECT extensions.throws_ok(
    $$SELECT * FROM public.admin_review_donor('00000000-0000-4000-8000-000000000007', 'rejected', 'Valid reason here')$$,
    '55000', 'Donor is no longer pending', 'repeat/conflicting decision fails');
RESET ROLE;

SELECT extensions.ok(
    (SELECT verification_status = 'approved' AND availability_status = 'unavailable'
        AND verified_by = '00000000-0000-4000-8000-000000000001' AND verified_at IS NOT NULL
     FROM public.donor_profiles WHERE user_id = '00000000-0000-4000-8000-000000000007'),
    'approval records caller and time but leaves donor unavailable');
SELECT extensions.ok(
    (SELECT h.previous_status = 'pending' AND h.new_status = 'approved'
        AND h.reviewer_role = 'admin' AND h.rejection_reason IS NULL
        AND h.reviewer_id = d.verified_by AND h.reviewed_at = d.verified_at
        AND d.updated_at = h.reviewed_at
     FROM public.donor_verification_history AS h
     JOIN public.donor_profiles AS d ON d.user_id = h.donor_id
     WHERE h.donor_id = '00000000-0000-4000-8000-000000000007'),
    'approval and audit agree on reviewer, status and exact timestamp');
SELECT extensions.is(
    (SELECT count(*) FROM public.donor_verification_history
     WHERE donor_id = '00000000-0000-4000-8000-000000000007'), 1::bigint,
    'repeated decision does not create another audit row');

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', true);
SELECT pg_catalog.set_config('request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
SELECT extensions.is(
    (SELECT count(*) FROM public.admin_list_pending_donors()), 4::bigint,
    'active super admin can list; approved donor left queue');
SELECT extensions.lives_ok(
    $$SELECT * FROM public.admin_review_donor('00000000-0000-4000-8000-000000000008', 'rejected', '  Needs more information  ')$$,
    'active super admin can reject');
SELECT extensions.throws_ok(
    $$SELECT * FROM public.admin_review_donor('00000000-0000-4000-8000-000000000008', 'approved')$$,
    '55000', 'Donor is no longer pending', 'rejected donor cannot be approved again');
RESET ROLE;
SELECT extensions.ok(
    (SELECT h.new_status = 'rejected' AND h.rejection_reason = 'Needs more information'
        AND h.reviewer_role = 'super_admin' AND h.reviewer_id = d.verified_by
        AND d.verification_status = 'rejected' AND d.availability_status = 'unavailable'
     FROM public.donor_verification_history AS h
     JOIN public.donor_profiles AS d ON d.user_id = h.donor_id
     WHERE h.donor_id = '00000000-0000-4000-8000-000000000008'),
    'rejection is recorded with normalized reason and verified database role');

SET LOCAL ROLE authenticated;
SELECT extensions.lives_ok(
    $$SELECT * FROM public.admin_review_donor('00000000-0000-4000-8000-000000000011', 'rejected', repeat(' ', 4086) || repeat('x', 10))$$,
    '4096-byte raw limit and ten-character normalized reason accepted');
SELECT extensions.lives_ok(
    $$SELECT * FROM public.admin_review_donor('00000000-0000-4000-8000-000000000003', 'rejected', repeat('x', 500))$$,
    '500-character rejection reason accepted');
RESET ROLE;

-- Account closure is deactivation, not physical deletion; preserve attribution.
SELECT extensions.throws_ok(
    $$DELETE FROM public.donor_profiles
      WHERE user_id = '00000000-0000-4000-8000-000000000007'$$,
    '23503', NULL, 'reviewed donor cannot be physically deleted');
SELECT extensions.throws_ok(
    $$DELETE FROM public.profiles WHERE id = '00000000-0000-4000-8000-000000000001'$$,
    '23503', NULL, 'reviewer cannot be physically deleted');
SELECT extensions.throws_ok(
    $$DELETE FROM auth.users WHERE id = '00000000-0000-4000-8000-000000000007'$$,
    '23503', NULL, 'auth-user cascade cannot erase reviewed donor');
UPDATE public.profiles SET account_status = 'deactivated'
WHERE id IN ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000007');
SELECT extensions.is(
    (SELECT count(*) FROM public.donor_verification_history
     WHERE donor_id = '00000000-0000-4000-8000-000000000007'
       AND reviewer_id = '00000000-0000-4000-8000-000000000001'), 1::bigint,
    'deactivation preserves donor/reviewer history');
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
SELECT pg_catalog.set_config('request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
SELECT extensions.throws_ok($$SELECT * FROM public.admin_list_pending_donors()$$,
    '42501', 'Active administrator required', 'deactivated reviewer cannot list');
SELECT extensions.throws_ok(
    $$SELECT * FROM public.admin_review_donor('00000000-0000-4000-8000-000000000010', 'approved')$$,
    '42501', 'Active administrator required', 'deactivated reviewer cannot review');
SELECT pg_catalog.set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', true);
SELECT pg_catalog.set_config('request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
RESET ROLE;

-- Fault-inject permissions only in this EMPTY isolated test transaction.
-- These nonprivileged NOLOGIN parent roles must disappear on outer ROLLBACK.
CREATE ROLE bms_test_inherit_parent NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE bms_test_set_parent NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

GRANT TRIGGER ON TABLE public.profiles TO authenticated;
SELECT extensions.throws_ok($$SELECT pg_temp.bms_assert_client_permissions()$$,
    'P0001', 'Effective client TRIGGER access requires separate reviewed hardening',
    'guard detects direct TRIGGER');
REVOKE TRIGGER ON TABLE public.profiles FROM authenticated;

GRANT TRIGGER ON TABLE public.beneficiary_profiles TO PUBLIC;
SELECT extensions.throws_ok($$SELECT pg_temp.bms_assert_client_permissions()$$,
    'P0001', 'Effective client TRIGGER access requires separate reviewed hardening',
    'guard detects PUBLIC TRIGGER on beneficiary table');
REVOKE TRIGGER ON TABLE public.beneficiary_profiles FROM PUBLIC;

GRANT TRIGGER ON TABLE public.donor_profiles TO bms_test_inherit_parent;
GRANT bms_test_inherit_parent TO authenticated WITH INHERIT TRUE;
SELECT extensions.throws_ok($$SELECT pg_temp.bms_assert_client_permissions()$$,
    'P0001', 'Effective client TRIGGER access requires separate reviewed hardening',
    'guard detects inherited TRIGGER');
REVOKE bms_test_inherit_parent FROM authenticated;
REVOKE TRIGGER ON TABLE public.donor_profiles FROM bms_test_inherit_parent;

GRANT TRIGGER ON TABLE public.profiles TO bms_test_set_parent;
GRANT bms_test_set_parent TO authenticated WITH INHERIT FALSE;
GRANT bms_test_set_parent TO authenticated WITH SET TRUE;
SELECT extensions.ok(
    NOT pg_catalog.has_table_privilege('authenticated', 'public.profiles', 'TRIGGER')
    AND pg_catalog.pg_has_role('authenticated', 'bms_test_set_parent', 'SET'),
    'fixture separates immediate privileges from SET ROLE access');
SELECT extensions.throws_ok($$SELECT pg_temp.bms_assert_client_permissions()$$,
    'P0001', 'Effective client TRIGGER access requires separate reviewed hardening',
    'guard detects SET ROLE-only TRIGGER');
REVOKE bms_test_set_parent FROM authenticated;
REVOKE TRIGGER ON TABLE public.profiles FROM bms_test_set_parent;

GRANT TRUNCATE ON TABLE public.donor_verification_history TO PUBLIC;
SELECT extensions.throws_ok($$SELECT pg_temp.bms_assert_client_permissions()$$,
    'P0001', 'Audit table retains effective client access, including possible TRUNCATE',
    'guard detects PUBLIC audit TRUNCATE without executing TRUNCATE');
REVOKE TRUNCATE ON TABLE public.donor_verification_history FROM PUBLIC;

GRANT TRUNCATE ON TABLE public.donor_verification_history TO bms_test_set_parent;
GRANT bms_test_set_parent TO authenticated WITH INHERIT FALSE;
GRANT bms_test_set_parent TO authenticated WITH SET TRUE;
SELECT extensions.throws_ok($$SELECT pg_temp.bms_assert_client_permissions()$$,
    'P0001', 'Audit table retains effective client access, including possible TRUNCATE',
    'guard detects SET ROLE-only audit TRUNCATE');
REVOKE bms_test_set_parent FROM authenticated;
REVOKE TRUNCATE ON TABLE public.donor_verification_history FROM bms_test_set_parent;

GRANT UPDATE (role) ON TABLE public.profiles TO authenticated;
SELECT extensions.throws_ok($$SELECT pg_temp.bms_assert_client_permissions()$$,
    'P0001', 'Client can bypass protected profile operations; separate review required',
    'guard detects column-level self-promotion privilege');
REVOKE UPDATE (role) ON TABLE public.profiles FROM authenticated;

SELECT extensions.lives_ok($$SELECT pg_temp.bms_assert_client_permissions()$$,
    'permission fault injections restored before continuing');

-- Inject a test-only audit failure as postgres; all objects disappear on ROLLBACK.
CREATE FUNCTION pg_temp.bms_fail_audit() RETURNS trigger
LANGUAGE plpgsql AS $failure$
BEGIN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Synthetic audit failure';
END;
$failure$;
CREATE TRIGGER bms_test_fail_audit BEFORE INSERT ON public.donor_verification_history
FOR EACH ROW EXECUTE FUNCTION pg_temp.bms_fail_audit();

SET LOCAL ROLE authenticated;
SELECT extensions.throws_ok(
    $$SELECT * FROM public.admin_review_donor('00000000-0000-4000-8000-000000000010', 'approved')$$,
    '23514', 'Synthetic audit failure', 'audit failure aborts review');
RESET ROLE;
SELECT extensions.ok(
    (SELECT verification_status = 'pending' AND verified_by IS NULL AND verified_at IS NULL
     FROM public.donor_profiles WHERE user_id = '00000000-0000-4000-8000-000000000010'),
    'failed audit rolls back donor decision');
SELECT extensions.is(
    (SELECT count(*) FROM public.donor_verification_history
     WHERE donor_id = '00000000-0000-4000-8000-000000000010'), 0::bigint,
    'failed review leaves no audit row');

-- TWO-SESSION CONCURRENCY DRAFT (comments only; separate approval required).
-- Requires separately committed SYNTHETIC fixtures in a disposable database.
-- Do not COMMIT this pgTAP file to retain fixtures.
--
-- Session A:
-- BEGIN;
-- SET LOCAL statement_timeout = '15s';
-- SET LOCAL ROLE authenticated;
-- SELECT pg_catalog.set_config('request.jwt.claim.sub', '<ADMIN_A_UUID>', true);
-- SELECT pg_catalog.set_config('request.jwt.claims',
--   '{"sub":"<ADMIN_A_UUID>","role":"authenticated"}', true);
-- SELECT * FROM public.admin_review_donor('<PENDING_DONOR_UUID>', 'approved');
-- Leave A open.
--
-- Session B (independent connection, while A remains open):
-- BEGIN;
-- SET LOCAL statement_timeout = '15s';
-- SET LOCAL ROLE authenticated;
-- SELECT pg_catalog.set_config('request.jwt.claim.sub', '<ADMIN_B_UUID>', true);
-- SELECT pg_catalog.set_config('request.jwt.claims',
--   '{"sub":"<ADMIN_B_UUID>","role":"authenticated"}', true);
-- SELECT * FROM public.admin_review_donor('<PENDING_DONOR_UUID>',
--   'rejected', 'Synthetic review reason');
-- While B waits, COMMIT A within the 5s lock timeout.
-- Expect B: 55000 at READ COMMITTED (or serialization failure at stricter isolation).
-- ROLLBACK B. As trusted test operator assert ONE history row, A as reviewer,
-- approved/unavailable donor, and matching verification/audit timestamps.
-- Repeat with first rejection, A ROLLBACK, B timeout, and actor/target suspension.
-- See the documentation for the separate migration-runner rollback rehearsal.
--
-- No TRUNCATE statements are used to test permissions.
-- True simultaneous review / demotion races require the two-session procedure
-- in docs/admin-donor-verification.md; sequential stale-review tests are not concurrency proof.
SELECT * FROM extensions.finish();
ROLLBACK;
