-- REVIEW DRAFT ONLY. Do not deploy without separate target-specific approval.
-- BMS corrective migration — fix SQLSTATE 42702 in public.donor_express_interest.
-- M7 (20261028000100_blood_request_management.sql) declared
--   RETURNS TABLE(request_id uuid, ...), so the bare column name `request_id` in the
--   ON CONFLICT conflict target was ambiguous between the table column
--   public.blood_request_interests.request_id and the function's output parameter
--   `request_id`. check_function_bodies only syntax-checks the body, so the ambiguity
--   surfaced (42702) on the first execution. This migration replaces ONLY that function,
--   changing the conflict target to the named unique constraint.
-- Preserved verbatim: signature/parameter name, return columns/types, body logic,
--   validation, locking, duplicate behavior, error codes/messages, SECURITY DEFINER,
--   search_path='', lock_timeout, postgres ownership, and REVOKE/GRANT permissions.
-- Run as one migration-runner transaction with stop-on-error; never with autocommit.
SET LOCAL search_path = '';
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL check_function_bodies = on;

DO $preflight$
DECLARE relation_name text;
BEGIN
  IF current_user <> 'postgres' OR pg_catalog.current_setting('server_version_num')::integer / 10000 <> 17 THEN
    RAISE EXCEPTION 'Requires PostgreSQL 17 and current_user postgres';
  END IF;
  IF pg_catalog.to_regprocedure('auth.uid()') IS NULL OR pg_catalog.to_regclass('auth.users') IS NULL
     OR EXISTS (SELECT 1 FROM (VALUES ('anon'),('authenticated'),('service_role')) x(role_name)
                WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname=x.role_name)) THEN
    RAISE EXCEPTION 'Supabase Auth and API roles are required';
  END IF;
  FOREACH relation_name IN ARRAY ARRAY['profiles','donor_profiles','blood_requests','blood_request_interests'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid=pg_catalog.to_regclass('public.'||relation_name)
                   AND c.relkind='r' AND c.relrowsecurity AND NOT c.relforcerowsecurity AND c.relowner='postgres'::pg_catalog.regrole) THEN
      RAISE EXCEPTION 'Missing, unexpected owner, or RLS-disabled prerequisite table: %', relation_name;
    END IF;
  END LOOP;
  IF pg_catalog.to_regprocedure('public.refresh_eligible_donor_availability()') IS NULL
     OR pg_catalog.to_regprocedure('public.donor_is_eligible(date)') IS NULL THEN
    RAISE EXCEPTION 'Apply the donor eligibility migration 20261027000100 before this corrective migration';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
                 WHERE c.conrelid=pg_catalog.to_regclass('public.blood_request_interests')
                   AND c.conname='blood_request_interests_request_id_donor_id_key'
                   AND c.contype='u') THEN
    RAISE EXCEPTION 'Expected unique constraint blood_request_interests_request_id_donor_id_key is missing';
  END IF;
  IF pg_catalog.to_regprocedure('public.donor_express_interest(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Apply the blood request migration 20261028000100 before this corrective migration';
  END IF;
END;
$preflight$;

-- Only the ON CONFLICT conflict target changed: request_id/donor_id column list replaced by
-- the named unique constraint (identical unique index; removes the 42702 ambiguity).
CREATE OR REPLACE FUNCTION public.donor_express_interest(target_request_id uuid)
RETURNS TABLE(request_id uuid,interest_id uuid,interest_status text,expressed_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s'
AS $interest$
DECLARE actor_id uuid:=auth.uid(); actor_blood_group text; actor_last_donation date; target_request public.blood_requests%ROWTYPE; new_interest_id uuid; decision_time timestamptz;
BEGIN
  PERFORM public.refresh_eligible_donor_availability();
  SELECT d.blood_group,d.last_donation_date INTO actor_blood_group,actor_last_donation FROM public.donor_profiles d JOIN public.profiles p ON p.id=d.user_id
  WHERE d.user_id=actor_id AND p.role='donor' AND p.account_status='active' AND d.verification_status='approved' AND d.availability_status='available' FOR SHARE OF d,p;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Active approved available donor account required'; END IF;
  IF NOT public.donor_is_eligible(actor_last_donation) THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Donor eligibility returns after the 4-month recovery period'; END IF;
  IF target_request_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid blood request'; END IF;
  SELECT r.* INTO target_request FROM public.blood_requests r WHERE r.id=target_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='Blood request not found'; END IF;
  IF target_request.status<>'open' OR target_request.needed_by<CURRENT_DATE OR target_request.blood_group<>actor_blood_group THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Blood request is not eligible for interest'; END IF;
  decision_time:=pg_catalog.clock_timestamp();
  INSERT INTO public.blood_request_interests(request_id,donor_id,expressed_at) VALUES(target_request_id,actor_id,decision_time)
  ON CONFLICT ON CONSTRAINT blood_request_interests_request_id_donor_id_key DO NOTHING RETURNING id INTO new_interest_id;
  IF new_interest_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Interest already recorded'; END IF;
  -- This records willingness to help only. It is not a completed donation.
  RETURN QUERY SELECT target_request_id,new_interest_id,'interested'::text,decision_time;
END;
$interest$;

ALTER FUNCTION public.donor_express_interest(uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.donor_express_interest(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.donor_express_interest(uuid) TO authenticated;

-- Fail closed: the corrected function keeps postgres ownership, SECURITY DEFINER, a
-- restricted search_path, and authenticated-only EXECUTE; and the ambiguous conflict
-- target must be gone from the stored body.
DO $effective_permissions$
DECLARE func record; signature text := 'public.donor_express_interest(uuid)';
BEGIN
  SELECT p.oid, p.proowner, p.prosecdef, p.proconfig INTO func
  FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure(signature);
  IF func.proowner <> 'postgres'::pg_catalog.regrole THEN
    RAISE EXCEPTION 'donor_express_interest must be owned by postgres';
  END IF;
  IF NOT func.prosecdef THEN
    RAISE EXCEPTION 'donor_express_interest must be SECURITY DEFINER';
  END IF;
  IF func.proconfig IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.unnest(func.proconfig) c WHERE c = 'search_path=""') THEN
    RAISE EXCEPTION 'donor_express_interest must set an empty search_path';
  END IF;
  IF pg_catalog.has_function_privilege('anon', signature, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', signature, 'EXECUTE') THEN
    RAISE EXCEPTION 'anon or service_role can execute donor_express_interest';
  END IF;
  IF NOT pg_catalog.has_function_privilege('authenticated', signature, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
                WHERE p.oid = pg_catalog.to_regprocedure(signature)
                  AND (a.grantee NOT IN (p.proowner, 'authenticated'::pg_catalog.regrole)
                       OR (a.grantee = 'authenticated'::pg_catalog.regrole AND a.is_grantable))) THEN
    RAISE EXCEPTION 'Unexpected execution grants for donor_express_interest';
  END IF;
  IF pg_catalog.pg_get_functiondef(func.oid) LIKE '%ON CONFLICT(request_id,donor_id)%' THEN
    RAISE EXCEPTION 'Ambiguous ON CONFLICT(request_id,donor_id) still present';
  END IF;
END;
$effective_permissions$;

