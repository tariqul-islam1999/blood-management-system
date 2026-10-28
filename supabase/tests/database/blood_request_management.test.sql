-- REVIEW DRAFT ONLY. Do not run against a live or populated BMS database.
-- Requires PostgreSQL 17, postgres, pgTAP already installed in extensions, an
-- EMPTY disposable Supabase target, migrations 001-003 plus approved privilege/
-- trigger hardening, then 20261028000100. This file is fully rolled back.
-- The migration's pre-apply ACL guard is deliberately not rerun here: a post-migration
-- pgTAP session cannot prove that the migration would reject a pre-existing bad ACL.
-- See docs/blood-request-management.md for isolated pre-deployment fault injection.
BEGIN;
SET LOCAL search_path = pg_temp, public, extensions;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $prerequisites$
BEGIN
  IF current_user <> 'postgres' OR pg_catalog.to_regprocedure('extensions.no_plan()') IS NULL THEN
    RAISE EXCEPTION 'Requires postgres and existing pgTAP; do not install automatically';
  END IF;
  IF EXISTS (SELECT 1 FROM auth.users) OR EXISTS (SELECT 1 FROM public.profiles)
     OR EXISTS (SELECT 1 FROM public.blood_requests) OR EXISTS (SELECT 1 FROM public.blood_request_interests) THEN
    RAISE EXCEPTION 'Requires an EMPTY disposable test target; never use real users';
  END IF;
END;
$prerequisites$;
SELECT extensions.no_plan();

-- Public registration may never select privileged application roles.
SELECT extensions.throws_ok($$INSERT INTO auth.users(id,raw_user_meta_data) VALUES('20000000-0000-4000-8000-000000000090','{"role":"admin"}'::jsonb)$$,'P0001','Invalid registration role','signup rejects admin metadata');
SELECT extensions.throws_ok($$INSERT INTO auth.users(id,raw_user_meta_data) VALUES('20000000-0000-4000-8000-000000000091','{"role":"super_admin"}'::jsonb)$$,'P0001','Invalid registration role','signup rejects super-admin metadata');

-- Synthetic identities only. Fixture promotion is trusted postgres setup, not API behavior.
INSERT INTO auth.users(id,raw_user_meta_data)
SELECT ('20000000-0000-4000-8000-'||pg_catalog.lpad(n::text,12,'0'))::uuid,
  pg_catalog.jsonb_build_object('role',CASE WHEN n IN(3,4,5,6,7,8) THEN 'donor' ELSE 'beneficiary' END,
    'full_name','Blood request fixture '||n,'phone','01980000'||pg_catalog.lpad(n::text,3,'0'),
    'district','Test district','thana','Test thana','local_area','Test area',
    'blood_group',CASE WHEN n=6 THEN 'A+' ELSE 'O+' END,'date_of_birth','1990-01-01')
FROM pg_catalog.generate_series(1,8) AS fixtures(n);
UPDATE public.donor_profiles SET verification_status='approved',availability_status='available'
WHERE user_id IN ('20000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000006','20000000-0000-4000-8000-000000000008');
UPDATE public.donor_profiles SET verification_status='approved',availability_status='unavailable'
WHERE user_id='20000000-0000-4000-8000-000000000004';
UPDATE public.donor_profiles SET verification_status='pending',availability_status='available'
WHERE user_id='20000000-0000-4000-8000-000000000005';
UPDATE public.profiles SET account_status='suspended' WHERE id='20000000-0000-4000-8000-000000000007';
CREATE FUNCTION pg_temp.bms_noop_request_trigger() RETURNS trigger LANGUAGE plpgsql AS $noop$
BEGIN RETURN NEW; END;
$noop$;

-- No identity or user metadata supplied by callers grants request permissions.
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub','',true);
SELECT pg_catalog.set_config('request.jwt.claims','{}',true);
SELECT extensions.throws_ok(command,'42501',NULL::text,'signed-out caller denied: '||label)
FROM (VALUES
 ('SELECT * FROM public.beneficiary_create_blood_request(''O+'',1,''routine'',CURRENT_DATE)','create'),
 ('SELECT * FROM public.beneficiary_list_my_blood_requests()','owner list'),
 ('SELECT * FROM public.beneficiary_cancel_blood_request(NULL)','cancel'),
 ('SELECT * FROM public.donor_list_open_blood_requests()','donor list'),
 ('SELECT * FROM public.donor_express_interest(NULL)','interest')) AS cases(command,label);
RESET ROLE;

-- Donors cannot act as beneficiaries; beneficiaries cannot browse/interest as donors.
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000003',true);
SELECT pg_catalog.set_config('request.jwt.claims','{"sub":"20000000-0000-4000-8000-000000000003","role":"authenticated","user_metadata":{"role":"beneficiary"}}',true);
SELECT extensions.throws_ok(command,'42501','Active beneficiary account required','donor cannot perform beneficiary RPC: '||label)
FROM (VALUES ('SELECT * FROM public.beneficiary_create_blood_request(''O+'',1,''routine'',CURRENT_DATE)'),('SELECT * FROM public.beneficiary_list_my_blood_requests()'),('SELECT * FROM public.beneficiary_cancel_blood_request(NULL)')) AS cases(command,label);
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',true);
SELECT pg_catalog.set_config('request.jwt.claims','{"sub":"20000000-0000-4000-8000-000000000001","role":"authenticated","user_metadata":{"role":"donor"}}',true);
SELECT extensions.throws_ok(command,'42501','Active approved available donor account required','beneficiary cannot perform donor RPC: '||label)
FROM (VALUES ('SELECT * FROM public.donor_list_open_blood_requests()'),('SELECT * FROM public.donor_express_interest(NULL)')) AS cases(command,label);

-- Server validation rejects all invalid create values, including dates outside the bounded window.
SELECT extensions.throws_ok(command,'22023','Invalid blood request details','invalid request rejected')
FROM (VALUES
 ('SELECT * FROM public.beneficiary_create_blood_request(NULL,1,''routine'',CURRENT_DATE)'),
 ('SELECT * FROM public.beneficiary_create_blood_request(''X'',1,''routine'',CURRENT_DATE)'),
 ('SELECT * FROM public.beneficiary_create_blood_request(''O+'',0,''routine'',CURRENT_DATE)'),
 ('SELECT * FROM public.beneficiary_create_blood_request(''O+'',11,''routine'',CURRENT_DATE)'),
 ('SELECT * FROM public.beneficiary_create_blood_request(''O+'',1,''critical'',CURRENT_DATE)'),
 ('SELECT * FROM public.beneficiary_create_blood_request(''O+'',1,''routine'',CURRENT_DATE-1)'),
 ('SELECT * FROM public.beneficiary_create_blood_request(''O+'',1,''routine'',CURRENT_DATE+91)')) AS cases(command);
CREATE TEMP TABLE request_one AS
SELECT * FROM public.beneficiary_create_blood_request('O+',2,'urgent',CURRENT_DATE+1);
SELECT extensions.is((SELECT district FROM request_one),'Test district','request location derives from profile');
SELECT extensions.is((SELECT interest_count FROM request_one),0::bigint,'new request has no interest');
SELECT extensions.is((SELECT pg_catalog.count(*) FROM public.beneficiary_list_my_blood_requests()),1::bigint,'beneficiary lists own request');
SELECT extensions.throws_ok(command,'22023','Invalid pagination','owner list validates pagination')
FROM (VALUES ('SELECT * FROM public.beneficiary_list_my_blood_requests(0,0)'),('SELECT * FROM public.beneficiary_list_my_blood_requests(51,0)'),('SELECT * FROM public.beneficiary_list_my_blood_requests(20,-1)')) AS cases(command);
RESET ROLE;
CREATE TEMP TABLE expired_request AS
WITH created AS (
  INSERT INTO public.blood_requests(beneficiary_id,blood_group,district,thana,local_area,units_requested,urgency,needed_by)
  VALUES ('20000000-0000-4000-8000-000000000001','O+','Test district','Test thana','Test area',1,'routine',CURRENT_DATE-1)
  RETURNING id
) SELECT id AS request_id FROM created;

-- A second beneficiary cannot discover/cancel the first beneficiary's request.
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000002',true);
SELECT pg_catalog.set_config('request.jwt.claims','{"sub":"20000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
SELECT extensions.is((SELECT pg_catalog.count(*) FROM public.beneficiary_list_my_blood_requests()),0::bigint,'beneficiary cannot list another owner request');
SELECT extensions.throws_ok($$SELECT * FROM public.beneficiary_cancel_blood_request((SELECT request_id FROM request_one))$$,'P0002','Blood request not found','beneficiary cannot cancel another owner request');
RESET ROLE;

-- Eligibility is fully checked in PostgreSQL, not in client metadata.
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000003',true);
SELECT pg_catalog.set_config('request.jwt.claims','{"sub":"20000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
SELECT extensions.is((SELECT pg_catalog.count(*) FROM public.donor_list_open_blood_requests()),1::bigint,'exact approved available donor sees open matching request');
SELECT extensions.ok(NOT (SELECT has_expressed_interest FROM public.donor_list_open_blood_requests() LIMIT 1),'interest initially false');
SELECT extensions.like(pg_catalog.pg_get_functiondef('public.donor_express_interest(uuid)'::regprocedure),'%FOR UPDATE%','interest function locks target request for transition serialization');
SELECT extensions.lives_ok($$SELECT * FROM public.donor_express_interest((SELECT request_id FROM request_one))$$,'eligible donor records interest');
SELECT extensions.throws_ok($$SELECT * FROM public.donor_express_interest((SELECT request_id FROM request_one))$$,'55000','Interest already recorded','duplicate interest rejected');
SELECT extensions.throws_ok($$SELECT * FROM public.donor_express_interest((SELECT request_id FROM expired_request))$$,'55000','Blood request is not eligible for interest','expired request rejects interest');
SELECT extensions.ok((SELECT has_expressed_interest FROM public.donor_list_open_blood_requests() LIMIT 1),'donor sees own interest flag only');
SELECT extensions.ok(pg_catalog.pg_get_function_result('public.donor_list_open_blood_requests(integer,integer)'::pg_catalog.regprocedure) NOT LIKE '%beneficiary%', 'donor RPC return contract omits beneficiary identity');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000004',true);
SELECT pg_catalog.set_config('request.jwt.claims','{"sub":"20000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
SELECT extensions.throws_ok($$SELECT * FROM public.donor_list_open_blood_requests()$$,'42501','Active approved available donor account required','unavailable donor denied');
SELECT extensions.throws_ok($$SELECT * FROM public.donor_express_interest((SELECT request_id FROM request_one))$$,'42501','Active approved available donor account required','unavailable donor cannot express interest');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000005',true);
SELECT pg_catalog.set_config('request.jwt.claims','{"sub":"20000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
SELECT extensions.throws_ok($$SELECT * FROM public.donor_list_open_blood_requests()$$,'42501','Active approved available donor account required','pending donor denied');
SELECT extensions.throws_ok($$SELECT * FROM public.donor_express_interest((SELECT request_id FROM request_one))$$,'42501','Active approved available donor account required','pending donor cannot express interest');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000007',true);
SELECT pg_catalog.set_config('request.jwt.claims','{"sub":"20000000-0000-4000-8000-000000000007","role":"authenticated"}',true);
SELECT extensions.throws_ok($$SELECT * FROM public.donor_list_open_blood_requests()$$,'42501','Active approved available donor account required','suspended donor denied');
SELECT extensions.throws_ok($$SELECT * FROM public.donor_express_interest((SELECT request_id FROM request_one))$$,'42501','Active approved available donor account required','suspended donor cannot express interest');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000006',true);
SELECT pg_catalog.set_config('request.jwt.claims','{"sub":"20000000-0000-4000-8000-000000000006","role":"authenticated"}',true);
SELECT extensions.is((SELECT pg_catalog.count(*) FROM public.donor_list_open_blood_requests()),0::bigint,'different blood group sees no request');
SELECT extensions.throws_ok($$SELECT * FROM public.donor_express_interest((SELECT request_id FROM request_one))$$,'55000','Blood request is not eligible for interest','different blood group cannot express interest');
RESET ROLE;

-- Owner sees a count, never interest identity. Direct client table reads/writes fail.
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',true);
SELECT pg_catalog.set_config('request.jwt.claims','{"sub":"20000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT extensions.is((SELECT interest_count FROM public.beneficiary_list_my_blood_requests() LIMIT 1),1::bigint,'owner sees interest count');
SELECT extensions.ok(pg_catalog.pg_get_function_result('public.beneficiary_list_my_blood_requests(integer,integer)'::pg_catalog.regprocedure) NOT LIKE '%donor%', 'beneficiary RPC return contract omits donor identity');
SELECT extensions.throws_ok(command,'42501',NULL::text,'direct request access denied: '||label)
FROM (VALUES
 ('SELECT * FROM public.blood_requests','request read'),('INSERT INTO public.blood_requests DEFAULT VALUES','request insert'),
 ('UPDATE public.blood_requests SET status=''cancelled''','request update'),('DELETE FROM public.blood_requests','request delete'),
 ('TRUNCATE public.blood_requests','request truncate'),('CREATE TRIGGER bms_test_forbidden_request_trigger BEFORE UPDATE ON public.blood_requests FOR EACH ROW EXECUTE FUNCTION pg_temp.bms_noop_request_trigger()','request trigger'),
 ('CREATE TEMP TABLE bms_test_request_reference (request_id uuid REFERENCES public.blood_requests(id))','request references'),
 ('SELECT * FROM public.blood_request_interests','interest identity read'),('INSERT INTO public.blood_request_interests DEFAULT VALUES','interest insert'),
 ('UPDATE public.blood_request_interests SET donor_id=auth.uid()','interest update'),('DELETE FROM public.blood_request_interests','interest delete'),
 ('TRUNCATE public.blood_request_interests','interest truncate'),('CREATE TRIGGER bms_test_forbidden_interest_trigger BEFORE UPDATE ON public.blood_request_interests FOR EACH ROW EXECUTE FUNCTION pg_temp.bms_noop_request_trigger()','interest trigger'),
 ('CREATE TEMP TABLE bms_test_interest_reference (interest_id uuid REFERENCES public.blood_request_interests(id))','interest references')) AS cases(command,label);
SELECT extensions.lives_ok($$SELECT * FROM public.beneficiary_cancel_blood_request((SELECT request_id FROM request_one))$$,'owner cancels open request');
SELECT extensions.throws_ok($$SELECT * FROM public.beneficiary_cancel_blood_request((SELECT request_id FROM request_one))$$,'55000','Blood request is no longer open','second cancellation rejected');
RESET ROLE;

-- The target-row lock makes cancel and interest serialize. After cancellation, a later
-- interest cannot commit. A real two-session lock/race test is documented separately.
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000008',true);
SELECT pg_catalog.set_config('request.jwt.claims','{"sub":"20000000-0000-4000-8000-000000000008","role":"authenticated"}',true);
SELECT extensions.throws_ok($$SELECT * FROM public.donor_express_interest((SELECT request_id FROM request_one))$$,'55000','Blood request is not eligible for interest','cancelled request rejects later interest');
RESET ROLE;

-- A failed interest insert must roll back completely. Test-only trigger disappears at ROLLBACK.
SET LOCAL ROLE postgres;
CREATE FUNCTION pg_temp.fail_request_interest() RETURNS trigger LANGUAGE plpgsql AS $fail$
BEGIN RAISE EXCEPTION 'Synthetic interest audit failure'; END;
$fail$;
CREATE TRIGGER bms_test_fail_request_interest BEFORE INSERT ON public.blood_request_interests
FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_request_interest();
RESET ROLE;
-- Make a second request for rollback testing.
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',true);
SELECT pg_catalog.set_config('request.jwt.claims','{"sub":"20000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
CREATE TEMP TABLE request_two AS SELECT * FROM public.beneficiary_create_blood_request('O+',1,'routine',CURRENT_DATE+2);
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000008',true);
SELECT pg_catalog.set_config('request.jwt.claims','{"sub":"20000000-0000-4000-8000-000000000008","role":"authenticated"}',true);
SELECT extensions.throws_ok($$SELECT * FROM public.donor_express_interest((SELECT request_id FROM request_two))$$,'P0001','Synthetic interest audit failure','failed interest insert rolls back');
RESET ROLE;
SELECT extensions.is((SELECT pg_catalog.count(*) FROM public.blood_request_interests WHERE request_id=(SELECT request_id FROM request_two)),0::bigint,'failed interest leaves no row');
DROP TRIGGER bms_test_fail_request_interest ON public.blood_request_interests;
DROP FUNCTION pg_temp.fail_request_interest();

SELECT * FROM extensions.finish();
ROLLBACK;
