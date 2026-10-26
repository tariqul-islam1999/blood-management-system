-- REVIEW DRAFT ONLY. DO NOT EXECUTE against the live BMS database.
-- Requires a separately approved disposable, EMPTY PostgreSQL 17 Supabase target,
-- reviewed baseline/hardening, donor verification + super admin migrations,
-- and pgTAP ALREADY installed in extensions. Do not install it automatically.
-- This file changes synthetic records, grants and triggers INSIDE a rollback.
-- A future runner must stop on SQL errors AND treat TAP failures as failures.
BEGIN;
SET LOCAL search_path = pg_temp, public, extensions;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $prerequisites$
BEGIN
    IF current_user <> 'postgres'
       OR pg_catalog.to_regprocedure('extensions.no_plan()') IS NULL
       OR pg_catalog.to_regprocedure('public.super_admin_appoint_admin(uuid,text)') IS NULL THEN
        RAISE EXCEPTION 'Requires postgres, installed pgTAP and both approved feature migrations';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles
               WHERE rolname IN ('bms_sa_test_inherit','bms_sa_test_set')) THEN
        RAISE EXCEPTION 'Test role names already exist; choose a fresh isolated target';
    END IF;
    IF EXISTS (SELECT 1 FROM auth.users) OR EXISTS (SELECT 1 FROM public.profiles)
       OR EXISTS (SELECT 1 FROM public.admin_access_history)
       OR EXISTS (SELECT 1 FROM public.donor_verification_history) THEN
        RAISE EXCEPTION 'Requires an EMPTY disposable target; never run against existing users';
    END IF;
END;
$prerequisites$;
SELECT extensions.no_plan();

-- Exact copy of the final migration guard body; offline validation checks parity.
CREATE FUNCTION pg_temp.assert_super_admin_permissions() RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $guard_test$
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
$guard_test$;
SELECT extensions.lives_ok($$SELECT pg_temp.assert_super_admin_permissions()$$,
    'initial effective grants satisfy migration guard');
GRANT SELECT ON public.admin_access_history TO authenticated;
SELECT extensions.throws_ok($$SELECT pg_temp.assert_super_admin_permissions()$$,
    'P0001', 'Client retains direct audit access', 'guard detects direct audit read');
REVOKE SELECT ON public.admin_access_history FROM authenticated;
GRANT USAGE ON SEQUENCE public.admin_access_history_event_number_seq TO authenticated;
SELECT extensions.throws_ok($$SELECT pg_temp.assert_super_admin_permissions()$$,
    'P0001', 'Client retains audit sequence access', 'guard detects sequence access');
REVOKE USAGE ON SEQUENCE public.admin_access_history_event_number_seq FROM authenticated;
GRANT UPDATE (role) ON public.profiles TO authenticated;
SELECT extensions.throws_ok($$SELECT pg_temp.assert_super_admin_permissions()$$,
    'P0001', 'Client can bypass protected profile operations', 'guard detects column grant bypass');
REVOKE UPDATE (role) ON public.profiles FROM authenticated;
GRANT TRIGGER ON public.beneficiary_profiles TO anon;
SELECT extensions.throws_ok($$SELECT pg_temp.assert_super_admin_permissions()$$,
    'P0001', 'Client retains unsafe TRUNCATE or TRIGGER access', 'guard detects unsafe trigger grant');
REVOKE TRIGGER ON public.beneficiary_profiles FROM anon;
GRANT EXECUTE ON FUNCTION public.super_admin_list_admins(integer,integer) TO PUBLIC;
SELECT extensions.throws_ok($$SELECT pg_temp.assert_super_admin_permissions()$$,
    'P0001', 'Anonymous caller can execute a super admin RPC', 'guard detects PUBLIC execution');
REVOKE EXECUTE ON FUNCTION public.super_admin_list_admins(integer,integer) FROM PUBLIC;
SELECT extensions.lives_ok($$SELECT pg_temp.assert_super_admin_permissions()$$,
    'all adversarial fixture grants removed');

SELECT extensions.throws_ok(
    $$INSERT INTO auth.users (id,raw_user_meta_data)
      VALUES ('10000000-0000-4000-8000-000000000090','{"role":"admin"}'::jsonb)$$,
    'P0001', 'Invalid registration role', 'public signup rejects admin metadata');
SELECT extensions.throws_ok(
    $$INSERT INTO auth.users (id,raw_user_meta_data)
      VALUES ('10000000-0000-4000-8000-000000000091','{"role":"super_admin"}'::jsonb)$$,
    'P0001', 'Invalid registration role', 'public signup rejects super admin metadata');

-- Synthetic addresses and users only; no passwords, tokens or real contact data.
-- Exercise the existing signup trigger before trusted fixture-only promotions.
INSERT INTO auth.users (id,email,email_confirmed_at,is_anonymous,raw_user_meta_data)
SELECT ('10000000-0000-4000-8000-' || pg_catalog.lpad(n::text,12,'0'))::uuid,
       'bms-management-fixture-' || n || '@example.invalid',
       CASE WHEN n = 11 THEN NULL ELSE pg_catalog.clock_timestamp() END,
       n = 12,
       pg_catalog.jsonb_build_object(
           'role', CASE WHEN n IN (4,5,18) THEN 'donor' ELSE 'beneficiary' END,
           'full_name', 'BMS management fixture ' || n,
           'phone', '01990000' || pg_catalog.lpad(n::text,3,'0'),
           'district','Test district','thana','Test thana','local_area','Test area',
           'blood_group','O+','date_of_birth','1990-01-01')
FROM pg_catalog.generate_series(1,18) AS fixture(n);
UPDATE public.profiles SET role = 'super_admin'
WHERE id IN ('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',
             '10000000-0000-4000-8000-000000000007','10000000-0000-4000-8000-000000000008');
UPDATE public.profiles SET role = 'admin'
WHERE id IN ('10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000009',
             '10000000-0000-4000-8000-000000000016');
UPDATE public.profiles SET account_status = 'suspended'
WHERE id IN ('10000000-0000-4000-8000-000000000007','10000000-0000-4000-8000-000000000010',
             '10000000-0000-4000-8000-000000000016');
UPDATE public.profiles SET account_status = 'deactivated'
WHERE id IN ('10000000-0000-4000-8000-000000000008','10000000-0000-4000-8000-000000000009',
             '10000000-0000-4000-8000-000000000014');
DELETE FROM public.beneficiary_profiles WHERE user_id = '10000000-0000-4000-8000-000000000017';
UPDATE public.donor_profiles SET verification_status = 'approved'
WHERE user_id = '10000000-0000-4000-8000-000000000004';
CREATE TEMP TABLE original_donors AS
SELECT d.user_id, pg_catalog.to_jsonb(d) AS snapshot FROM public.donor_profiles AS d
WHERE d.user_id IN ('10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000005');
CREATE TEMP TABLE original_beneficiary AS
SELECT pg_catalog.to_jsonb(b) AS snapshot FROM public.beneficiary_profiles AS b
WHERE b.user_id = '10000000-0000-4000-8000-000000000006';
INSERT INTO public.admin_access_history (
    target_user_id,actor_id,actor_role,action,previous_role,previous_account_status,
    new_role,new_account_status,reason,operator_reference
) VALUES ('10000000-0000-4000-8000-000000000001',NULL,NULL,'bootstrap_super_admin',
    'beneficiary','active','super_admin','active','Synthetic bootstrap fixture','Isolated test operator');
SELECT extensions.throws_ok(
    $$INSERT INTO public.admin_access_history (
        target_user_id,actor_id,actor_role,action,previous_role,previous_account_status,
        new_role,new_account_status,reason,operator_reference)
      VALUES ('10000000-0000-4000-8000-000000000002',NULL,NULL,'bootstrap_super_admin',
        'beneficiary','active','super_admin','active','Synthetic duplicate bootstrap','Isolated test operator')$$,
    '23505', NULL::text, 'bootstrap audit can occur only once');

SET LOCAL ROLE anon;
SELECT extensions.throws_ok(command,'42501',NULL::text,'anonymous cannot execute ' || label)
FROM (VALUES
    ('SELECT * FROM public.super_admin_list_admins()','list'),
    ('SELECT * FROM public.super_admin_get_admin_candidate(NULL)','lookup'),
    ('SELECT * FROM public.super_admin_appoint_admin(NULL,NULL)','appoint'),
    ('SELECT * FROM public.super_admin_revoke_admin(NULL,NULL)','revoke')
) AS cases(command,label);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000000',true);
SELECT pg_catalog.set_config('request.jwt.claims',
    '{"sub":"10000000-0000-4000-8000-000000000000","role":"authenticated","user_metadata":{"role":"super_admin"}}',true);
SELECT extensions.throws_ok(command,'42501','Active super administrator required',
    'database role overrides JWT metadata for fixture 0: ' || label)
FROM (VALUES
    ('SELECT * FROM public.super_admin_list_admins()','list'),
    ('SELECT * FROM public.super_admin_get_admin_candidate(NULL)','lookup'),
    ('SELECT * FROM public.super_admin_appoint_admin(NULL,NULL)','appoint'),
    ('SELECT * FROM public.super_admin_revoke_admin(NULL,NULL)','revoke')
) AS cases(command,label);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
SELECT pg_catalog.set_config('request.jwt.claims',
    '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated","user_metadata":{"role":"super_admin"}}',true);
SELECT extensions.throws_ok(command,'42501','Active super administrator required',
    'database role overrides JWT metadata for fixture 3: ' || label)
FROM (VALUES
    ('SELECT * FROM public.super_admin_list_admins()','list'),
    ('SELECT * FROM public.super_admin_get_admin_candidate(NULL)','lookup'),
    ('SELECT * FROM public.super_admin_appoint_admin(NULL,NULL)','appoint'),
    ('SELECT * FROM public.super_admin_revoke_admin(NULL,NULL)','revoke')
) AS cases(command,label);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000004',true);
SELECT pg_catalog.set_config('request.jwt.claims',
    '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated","user_metadata":{"role":"super_admin"}}',true);
SELECT extensions.throws_ok(command,'42501','Active super administrator required',
    'database role overrides JWT metadata for fixture 4: ' || label)
FROM (VALUES
    ('SELECT * FROM public.super_admin_list_admins()','list'),
    ('SELECT * FROM public.super_admin_get_admin_candidate(NULL)','lookup'),
    ('SELECT * FROM public.super_admin_appoint_admin(NULL,NULL)','appoint'),
    ('SELECT * FROM public.super_admin_revoke_admin(NULL,NULL)','revoke')
) AS cases(command,label);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000006',true);
SELECT pg_catalog.set_config('request.jwt.claims',
    '{"sub":"10000000-0000-4000-8000-000000000006","role":"authenticated","user_metadata":{"role":"super_admin"}}',true);
SELECT extensions.throws_ok(command,'42501','Active super administrator required',
    'database role overrides JWT metadata for fixture 6: ' || label)
FROM (VALUES
    ('SELECT * FROM public.super_admin_list_admins()','list'),
    ('SELECT * FROM public.super_admin_get_admin_candidate(NULL)','lookup'),
    ('SELECT * FROM public.super_admin_appoint_admin(NULL,NULL)','appoint'),
    ('SELECT * FROM public.super_admin_revoke_admin(NULL,NULL)','revoke')
) AS cases(command,label);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000007',true);
SELECT pg_catalog.set_config('request.jwt.claims',
    '{"sub":"10000000-0000-4000-8000-000000000007","role":"authenticated","user_metadata":{"role":"super_admin"}}',true);
SELECT extensions.throws_ok(command,'42501','Active super administrator required',
    'database role overrides JWT metadata for fixture 7: ' || label)
FROM (VALUES
    ('SELECT * FROM public.super_admin_list_admins()','list'),
    ('SELECT * FROM public.super_admin_get_admin_candidate(NULL)','lookup'),
    ('SELECT * FROM public.super_admin_appoint_admin(NULL,NULL)','appoint'),
    ('SELECT * FROM public.super_admin_revoke_admin(NULL,NULL)','revoke')
) AS cases(command,label);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000008',true);
SELECT pg_catalog.set_config('request.jwt.claims',
    '{"sub":"10000000-0000-4000-8000-000000000008","role":"authenticated","user_metadata":{"role":"super_admin"}}',true);
SELECT extensions.throws_ok(command,'42501','Active super administrator required',
    'database role overrides JWT metadata for fixture 8: ' || label)
FROM (VALUES
    ('SELECT * FROM public.super_admin_list_admins()','list'),
    ('SELECT * FROM public.super_admin_get_admin_candidate(NULL)','lookup'),
    ('SELECT * FROM public.super_admin_appoint_admin(NULL,NULL)','appoint'),
    ('SELECT * FROM public.super_admin_revoke_admin(NULL,NULL)','revoke')
) AS cases(command,label);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000009',true);
SELECT pg_catalog.set_config('request.jwt.claims',
    '{"sub":"10000000-0000-4000-8000-000000000009","role":"authenticated","user_metadata":{"role":"super_admin"}}',true);
SELECT extensions.throws_ok(command,'42501','Active super administrator required',
    'database role overrides JWT metadata for fixture 9: ' || label)
FROM (VALUES
    ('SELECT * FROM public.super_admin_list_admins()','list'),
    ('SELECT * FROM public.super_admin_get_admin_candidate(NULL)','lookup'),
    ('SELECT * FROM public.super_admin_appoint_admin(NULL,NULL)','appoint'),
    ('SELECT * FROM public.super_admin_revoke_admin(NULL,NULL)','revoke')
) AS cases(command,label);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000016',true);
SELECT pg_catalog.set_config('request.jwt.claims',
    '{"sub":"10000000-0000-4000-8000-000000000016","role":"authenticated","user_metadata":{"role":"super_admin"}}',true);
SELECT extensions.throws_ok(command,'42501','Active super administrator required',
    'database role overrides JWT metadata for fixture 16: ' || label)
FROM (VALUES
    ('SELECT * FROM public.super_admin_list_admins()','list'),
    ('SELECT * FROM public.super_admin_get_admin_candidate(NULL)','lookup'),
    ('SELECT * FROM public.super_admin_appoint_admin(NULL,NULL)','appoint'),
    ('SELECT * FROM public.super_admin_revoke_admin(NULL,NULL)','revoke')
) AS cases(command,label);
RESET ROLE;

-- A signed-out authenticated context must also fail before argument validation.
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub','',true);
SELECT pg_catalog.set_config('request.jwt.claims','{}',true);
SELECT extensions.throws_ok($$SELECT * FROM public.super_admin_list_admins()$$,
    '42501','Active super administrator required','missing auth.uid denied');
RESET ROLE;

-- Active super admin: bounded list/lookup and authoritative eligibility.
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
SELECT pg_catalog.set_config('request.jwt.claims',
    '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT extensions.is((SELECT pg_catalog.count(*) FROM public.super_admin_list_admins()),
    3::bigint,'list includes active, suspended and deactivated admins');
SELECT extensions.is((SELECT pg_catalog.count(*) FROM public.super_admin_list_admins(1,0)),
    1::bigint,'list pagination bounded');
SELECT extensions.is((SELECT pg_catalog.count(*) FROM public.super_admin_list_admins(20,100000)),
    0::bigint,'empty list page handled');
SELECT extensions.throws_ok(command,'22023','Invalid pagination','invalid pagination rejected')
FROM (VALUES ('SELECT * FROM public.super_admin_list_admins(0,0)'),
    ('SELECT * FROM public.super_admin_list_admins(51,0)'),
    ('SELECT * FROM public.super_admin_list_admins(NULL,0)'),
    ('SELECT * FROM public.super_admin_list_admins(20,-1)'),
    ('SELECT * FROM public.super_admin_list_admins(20,100001)'),
    ('SELECT * FROM public.super_admin_list_admins(20,NULL)')) AS cases(command);
SELECT extensions.ok((SELECT eligible FROM public.super_admin_get_admin_candidate(
    '10000000-0000-4000-8000-000000000006')),'verified beneficiary without donor subtype is eligible');
SELECT extensions.ok(NOT (SELECT eligible FROM public.super_admin_get_admin_candidate(
    ('10000000-0000-4000-8000-' || pg_catalog.lpad(n::text,12,'0'))::uuid)),
    'ineligible candidate fixture ' || n)
FROM (VALUES (1),(2),(3),(4),(5),(9),(10),(11),(12),(14),(16),(17)) AS cases(n);
SELECT extensions.throws_ok($$SELECT * FROM public.super_admin_get_admin_candidate(NULL)$$,
    '22023','Target account is required','null lookup rejected');
SELECT extensions.throws_ok(
    $$SELECT * FROM public.super_admin_get_admin_candidate('10000000-0000-4000-8000-000000000099')$$,
    'P0002','Account not found','missing target handled');
SELECT extensions.throws_ok(command,'22023','Invalid target account','null/self mutation rejected')
FROM (VALUES
    ('SELECT * FROM public.super_admin_appoint_admin(NULL,''Valid test reason'')'),
    ('SELECT * FROM public.super_admin_revoke_admin(NULL,''Valid test reason'')'),
    ('SELECT * FROM public.super_admin_appoint_admin(''10000000-0000-4000-8000-000000000001'',''Valid test reason'')'),
    ('SELECT * FROM public.super_admin_revoke_admin(''10000000-0000-4000-8000-000000000001'',''Valid test reason'')')
) AS cases(command);
SELECT extensions.throws_ok(pg_catalog.format(
    'SELECT * FROM public.super_admin_appoint_admin(%L::uuid,%L)',
    '10000000-0000-4000-8000-000000000006',bad_reason),
    '22023','Invalid management reason','invalid appointment reason rejected')
FROM (VALUES (NULL::text),('         '),('123456789'),(pg_catalog.repeat('x',501)),
    (pg_catalog.repeat(' ',4087) || '1234567890')) AS cases(bad_reason);
SELECT extensions.throws_ok(pg_catalog.format(
    'SELECT * FROM public.super_admin_revoke_admin(%L::uuid,%L)',
    '10000000-0000-4000-8000-000000000003',bad_reason),
    '22023','Invalid management reason','invalid revocation reason rejected')
FROM (VALUES (NULL::text),('         '),('123456789'),(pg_catalog.repeat('x',501)),
    (pg_catalog.repeat(' ',4087) || '1234567890')) AS cases(bad_reason);
SELECT extensions.throws_ok(pg_catalog.format(
    'SELECT * FROM public.super_admin_appoint_admin(%L::uuid,%L)',
    '10000000-0000-4000-8000-' || pg_catalog.lpad(n::text,12,'0'),'Valid test reason'),
    '55000','Account is not eligible for appointment','ineligible appointment fixture ' || n)
FROM (VALUES (2),(3),(4),(5),(9),(10),(11),(12),(14),(16),(17)) AS cases(n);
SELECT extensions.throws_ok(pg_catalog.format(
    'SELECT * FROM public.super_admin_revoke_admin(%L::uuid,%L)',
    '10000000-0000-4000-8000-' || pg_catalog.lpad(n::text,12,'0'),'Valid test reason'),
    '55000','Account is not an active dedicated admin','ineligible revocation fixture ' || n)
FROM (VALUES (2),(4),(5),(6),(9),(10),(16)) AS cases(n);
SELECT extensions.throws_ok(
    $$SELECT * FROM public.super_admin_appoint_admin('10000000-0000-4000-8000-000000000099','Valid test reason')$$,
    'P0002','Account not found','missing appointment target handled');
SELECT extensions.throws_ok(
    $$SELECT * FROM public.super_admin_revoke_admin('10000000-0000-4000-8000-000000000099','Valid test reason')$$,
    'P0002','Account not found','missing revocation target handled');
SELECT extensions.lives_ok(
    $$SELECT * FROM public.super_admin_appoint_admin('10000000-0000-4000-8000-000000000006',E' \n1234567890\t ')$$,
    'appointment accepts trimmed ten-character reason');
SELECT extensions.throws_ok(
    $$SELECT * FROM public.super_admin_appoint_admin('10000000-0000-4000-8000-000000000006','Valid test reason')$$,
    '55000','Account is not eligible for appointment','duplicate appointment fails');
SELECT extensions.lives_ok(
    $$SELECT * FROM public.super_admin_appoint_admin('10000000-0000-4000-8000-000000000015',pg_catalog.repeat('শ',500))$$,
    '500 Unicode characters accepted');
SELECT extensions.lives_ok(
    $$SELECT * FROM public.super_admin_revoke_admin('10000000-0000-4000-8000-000000000015','Valid test reason')$$,
    'revocation preserves admin role and deactivates');
SELECT extensions.lives_ok(
    $$SELECT * FROM public.super_admin_appoint_admin('10000000-0000-4000-8000-000000000015',
        pg_catalog.repeat(' ',4086) || '1234567890')$$,
    '4096 raw bytes allowed when trimmed reason is valid');
SELECT extensions.lives_ok(
    $$SELECT * FROM public.super_admin_revoke_admin('10000000-0000-4000-8000-000000000006','Valid revoke reason')$$,
    'explicit revocation succeeds');
SELECT extensions.throws_ok(
    $$SELECT * FROM public.super_admin_revoke_admin('10000000-0000-4000-8000-000000000006','Valid revoke reason')$$,
    '55000','Account is not an active dedicated admin','duplicate revocation fails');
SELECT extensions.ok((SELECT eligible FROM public.super_admin_get_admin_candidate(
    '10000000-0000-4000-8000-000000000006')),'explicitly revoked account can be reappointed');
SELECT extensions.lives_ok(
    $$SELECT * FROM public.super_admin_appoint_admin('10000000-0000-4000-8000-000000000006','Valid reappoint reason')$$,
    'reappointment appends a fresh audit event');
RESET ROLE;

SELECT extensions.is((SELECT p.role || '/' || p.account_status FROM public.profiles AS p
    WHERE p.id = '10000000-0000-4000-8000-000000000006'),
    'admin/active','reappointed target has exact intended role/status');
SELECT extensions.is((SELECT pg_catalog.count(*) FROM public.admin_access_history AS h
    WHERE h.target_user_id = '10000000-0000-4000-8000-000000000006'),
    3::bigint,'appoint/revoke/reappoint creates exactly three events');
SELECT extensions.ok(NOT EXISTS (
    SELECT 1 FROM public.admin_access_history AS h
    WHERE h.action <> 'bootstrap_super_admin'
      AND (h.actor_id <> '10000000-0000-4000-8000-000000000001' OR h.actor_role <> 'super_admin')),
    'audit attribution is server-derived');
SELECT extensions.is((SELECT h.reason FROM public.admin_access_history AS h
    WHERE h.target_user_id = '10000000-0000-4000-8000-000000000006'
    ORDER BY h.event_number LIMIT 1),'1234567890','reason stored trimmed');
SELECT extensions.ok(EXISTS (
    SELECT 1 FROM public.profiles AS p JOIN public.admin_access_history AS h
      ON h.target_user_id = p.id AND h.occurred_at = p.updated_at
    WHERE p.id = '10000000-0000-4000-8000-000000000006' AND h.action = 'appointed'),
    'profile and audit share exact server decision timestamp');
SELECT extensions.is((SELECT pg_catalog.to_jsonb(b) FROM public.beneficiary_profiles AS b
    WHERE b.user_id = '10000000-0000-4000-8000-000000000006'),
    (SELECT snapshot FROM original_beneficiary),'beneficiary subtype remains unchanged');

-- Failed audit inserts must roll back both appointment AND revocation.
CREATE FUNCTION pg_temp.fail_management_audit() RETURNS trigger LANGUAGE plpgsql
AS $fail_audit$
BEGIN
    RAISE EXCEPTION 'Synthetic management audit failure';
END;
$fail_audit$;
CREATE TRIGGER bms_test_fail_management_audit BEFORE INSERT ON public.admin_access_history
    FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_management_audit();
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
SELECT pg_catalog.set_config('request.jwt.claims',
    '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT extensions.throws_ok(
    $$SELECT * FROM public.super_admin_appoint_admin('10000000-0000-4000-8000-000000000013','Valid audit test reason')$$,
    'P0001','Synthetic management audit failure','appointment fails closed if audit fails');
SELECT extensions.throws_ok(
    $$SELECT * FROM public.super_admin_revoke_admin('10000000-0000-4000-8000-000000000006','Valid audit test reason')$$,
    'P0001','Synthetic management audit failure','revocation fails closed if audit fails');
RESET ROLE;
DROP TRIGGER bms_test_fail_management_audit ON public.admin_access_history;
DROP FUNCTION pg_temp.fail_management_audit();
SELECT extensions.is((SELECT role || '/' || account_status FROM public.profiles
    WHERE id = '10000000-0000-4000-8000-000000000013'),
    'beneficiary/active','failed appointment did not change profile');
SELECT extensions.is((SELECT role || '/' || account_status FROM public.profiles
    WHERE id = '10000000-0000-4000-8000-000000000006'),
    'admin/active','failed revocation did not change profile');
SELECT extensions.is((SELECT pg_catalog.count(*) FROM public.admin_access_history
    WHERE target_user_id = '10000000-0000-4000-8000-000000000013'),
    0::bigint,'failed appointment left no history event');
SELECT extensions.is((SELECT pg_catalog.count(*) FROM public.admin_access_history
    WHERE target_user_id = '10000000-0000-4000-8000-000000000006'),
    3::bigint,'failed revocation left no extra history event');

-- Independent trusted-operator changes must not be silently undone by reappointment.
SET LOCAL ROLE authenticated;
SELECT extensions.lives_ok(
    $$SELECT * FROM public.super_admin_revoke_admin('10000000-0000-4000-8000-000000000015','Valid revoke reason')$$,
    'prepare explicit revocation before independent account change');
RESET ROLE;
UPDATE public.profiles SET updated_at = updated_at + interval '1 second'
WHERE id = '10000000-0000-4000-8000-000000000015';
SET LOCAL ROLE authenticated;
SELECT extensions.ok(NOT (SELECT eligible FROM public.super_admin_get_admin_candidate(
    '10000000-0000-4000-8000-000000000015')),'independent profile change invalidates reappointment');
SELECT extensions.throws_ok(
    $$SELECT * FROM public.super_admin_appoint_admin('10000000-0000-4000-8000-000000000015','Valid reappoint reason')$$,
    '55000','Account is not eligible for appointment','timestamp mismatch blocks reactivation');
RESET ROLE;

-- An existing admin can review donors, but all four management RPCs denied above.
-- Use a THIRD synthetic donor; the original approved/pending pair stays untouched.
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
SELECT pg_catalog.set_config('request.jwt.claims',
    '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
SELECT extensions.lives_ok(
    $$SELECT * FROM public.admin_review_donor('10000000-0000-4000-8000-000000000018','approved',NULL)$$,
    'ordinary admin retains donor verification ability');
RESET ROLE;
CREATE TEMP TABLE prior_verification_history AS
SELECT pg_catalog.to_jsonb(h) AS snapshot FROM public.donor_verification_history AS h
WHERE h.reviewer_id = '10000000-0000-4000-8000-000000000003';
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
SELECT pg_catalog.set_config('request.jwt.claims',
    '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT extensions.lives_ok(
    $$SELECT * FROM public.super_admin_revoke_admin('10000000-0000-4000-8000-000000000003','Valid legacy admin revocation')$$,
    'legacy non-donor admin may be revoked without fabricated appointment history');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
SELECT pg_catalog.set_config('request.jwt.claims',
    '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated","user_metadata":{"role":"admin"}}',true);
SELECT extensions.throws_ok($$SELECT * FROM public.admin_list_pending_donors()$$,
    '42501','Active administrator required','existing JWT cannot list donors after revocation');
SELECT extensions.throws_ok(
    $$SELECT * FROM public.admin_review_donor('10000000-0000-4000-8000-000000000005','approved',NULL)$$,
    '42501','Active administrator required','existing JWT cannot review donors after revocation');
SELECT extensions.throws_ok($$SELECT * FROM public.super_admin_list_admins()$$,
    '42501','Active super administrator required','revoked admin cannot manage admins');
RESET ROLE;
SELECT extensions.is((SELECT role || '/' || account_status FROM public.profiles
    WHERE id = '10000000-0000-4000-8000-000000000003'),
    'admin/deactivated','revocation preserves role and account record');
SELECT extensions.is((SELECT pg_catalog.to_jsonb(h) FROM public.donor_verification_history AS h
    WHERE h.reviewer_id = '10000000-0000-4000-8000-000000000003'),
    (SELECT snapshot FROM prior_verification_history),'revocation preserves donor verification history');
SELECT extensions.ok(NOT EXISTS (
    SELECT 1 FROM original_donors AS original
    FULL JOIN public.donor_profiles AS d ON d.user_id = original.user_id
    WHERE original.user_id IS NOT NULL AND original.snapshot IS DISTINCT FROM pg_catalog.to_jsonb(d)),
    'all original approved and pending donor column values are preserved');
SELECT extensions.is((SELECT pg_catalog.count(*) FROM public.donor_verification_history
    WHERE donor_id IN ('10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000005')),
    0::bigint,'no fake verification events backfilled for original donors');

-- Even an active super admin has no direct client audit/table privileges.
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
SELECT pg_catalog.set_config('request.jwt.claims',
    '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT extensions.throws_ok(command,'42501',NULL::text,'direct client access denied: ' || label)
FROM (VALUES
    ('SELECT * FROM public.admin_access_history','audit read'),
    ('INSERT INTO public.admin_access_history DEFAULT VALUES','audit insert'),
    ('UPDATE public.admin_access_history SET reason = ''forged reason''','audit update'),
    ('DELETE FROM public.admin_access_history','audit delete'),
    ('TRUNCATE public.admin_access_history','audit truncate'),
    ('SELECT pg_catalog.nextval(''public.admin_access_history_event_number_seq'')','sequence'),
    ('UPDATE public.profiles SET role = ''super_admin'' WHERE id = auth.uid()','self promotion'),
    ('UPDATE public.profiles SET account_status = ''active'' WHERE id = auth.uid()','status bypass'),
    ('UPDATE public.donor_profiles SET verification_status = ''approved''','donor verification bypass')
) AS cases(command,label);
RESET ROLE;
SELECT extensions.throws_ok(
    $$DELETE FROM public.profiles WHERE id = '10000000-0000-4000-8000-000000000006'$$,
    '23503',NULL::text,'target deletion cannot erase management audit');
SELECT extensions.throws_ok(
    $$DELETE FROM auth.users WHERE id = '10000000-0000-4000-8000-000000000001'$$,
    '23503',NULL::text,'cascading auth deletion cannot erase actor attribution');

-- Effective access through inherited/SET-only roles must also fail the guard.
-- Only disposable test roles; all role changes roll back with this file.
CREATE ROLE bms_sa_test_inherit NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE bms_sa_test_set NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
GRANT UPDATE (role) ON public.profiles TO bms_sa_test_inherit;
GRANT bms_sa_test_inherit TO authenticated WITH INHERIT TRUE;
SELECT extensions.throws_ok($$SELECT pg_temp.assert_super_admin_permissions()$$,
    'P0001','Client can bypass protected profile operations','guard detects inherited column privileges');
REVOKE bms_sa_test_inherit FROM authenticated;
GRANT SELECT ON public.admin_access_history TO bms_sa_test_set;
GRANT bms_sa_test_set TO authenticated WITH INHERIT FALSE;
GRANT bms_sa_test_set TO authenticated WITH SET TRUE;
SELECT extensions.throws_ok($$SELECT pg_temp.assert_super_admin_permissions()$$,
    'P0001','Client retains direct audit access','guard detects SET-only role privileges');
REVOKE bms_sa_test_set FROM authenticated;
SELECT extensions.throws_ok($$SELECT pg_temp.assert_super_admin_permissions()$$,
    'P0001','Unexpected default audit grantee; separate review required',
    'guard also rejects custom audit grantee after membership removal');
REVOKE SELECT ON public.admin_access_history FROM bms_sa_test_set;
REVOKE UPDATE (role) ON public.profiles FROM bms_sa_test_inherit;
SELECT extensions.lives_ok($$SELECT pg_temp.assert_super_admin_permissions()$$,
    'final effective permission guard passes after fixture cleanup');

-- A newly appointed admin gains donor-list access through the database role,
-- while a second active super admin can independently manage dedicated accounts.
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000006',true);
SELECT pg_catalog.set_config('request.jwt.claims',
    '{"sub":"10000000-0000-4000-8000-000000000006","role":"authenticated","user_metadata":{"role":"beneficiary"}}',true);
SELECT extensions.is((SELECT pg_catalog.count(*) FROM public.admin_list_pending_donors()),
    1::bigint,'new admin can list pending donors despite original beneficiary metadata');
SELECT extensions.throws_ok($$SELECT * FROM public.super_admin_list_admins()$$,
    '42501','Active super administrator required','new admin cannot manage admins');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
SELECT pg_catalog.set_config('request.jwt.claims',
    '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
SELECT extensions.lives_ok($$SELECT * FROM public.super_admin_list_admins()$$,
    'second active super admin can list admins');
SELECT extensions.ok((SELECT eligible FROM public.super_admin_get_admin_candidate(
    '10000000-0000-4000-8000-000000000013')),'second super admin can look up a candidate');
SELECT extensions.lives_ok(
    $$SELECT * FROM public.super_admin_appoint_admin('10000000-0000-4000-8000-000000000013','Second super admin appointment')$$,
    'second active super admin can appoint');
SELECT extensions.lives_ok(
    $$SELECT * FROM public.super_admin_revoke_admin('10000000-0000-4000-8000-000000000013','Second super admin revocation')$$,
    'second active super admin can revoke');
RESET ROLE;
SELECT extensions.is((SELECT pg_catalog.count(*) FROM public.admin_access_history
    WHERE target_user_id = '10000000-0000-4000-8000-000000000013'
      AND actor_id = '10000000-0000-4000-8000-000000000002' AND actor_role = 'super_admin'),
    2::bigint,'second super admin attribution is derived from caller');

-- Separate future two-session tests are documented; this single connection does
-- NOT prove concurrency, API/JWT verification, bootstrap or migration atomicity.
SELECT * FROM extensions.finish();
ROLLBACK;
