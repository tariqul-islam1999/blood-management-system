-- REVIEW DRAFT ONLY. Do not deploy without separate target-specific approval.
-- Run as one migration-runner transaction with stop-on-error; never with autocommit.
-- This adds request/interest objects only. It never rewrites existing BMS records.
SET LOCAL search_path = '';
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL check_function_bodies = on;

DO $preflight$
DECLARE relation_name text; client_role text; reachable record;
BEGIN
  IF current_user <> 'postgres' OR pg_catalog.current_setting('server_version_num')::integer / 10000 <> 17 THEN
    RAISE EXCEPTION 'Requires PostgreSQL 17 and current_user postgres';
  END IF;
  IF pg_catalog.to_regprocedure('auth.uid()') IS NULL OR pg_catalog.to_regclass('auth.users') IS NULL
     OR EXISTS (SELECT 1 FROM (VALUES ('anon'),('authenticated'),('service_role')) x(role_name)
                WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname=x.role_name)) THEN
    RAISE EXCEPTION 'Supabase Auth and API roles are required';
  END IF;
  FOREACH relation_name IN ARRAY ARRAY['profiles','donor_profiles','beneficiary_profiles','donor_availability_details','donor_availability_history','donor_availability_reminders'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid=pg_catalog.to_regclass('public.'||relation_name)
                   AND c.relkind='r' AND c.relrowsecurity AND NOT c.relforcerowsecurity AND c.relowner='postgres'::pg_catalog.regrole) THEN
      RAISE EXCEPTION 'Missing, unexpected owner, or RLS-disabled BMS prerequisite: %', relation_name;
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('profiles','id','uuid',true),('profiles','role','text',true),('profiles','account_status','text',true),
      ('profiles','district','text',true),('profiles','thana','text',true),('profiles','local_area','text',true),
      ('donor_profiles','user_id','uuid',true),('donor_profiles','blood_group','text',true),
      ('donor_profiles','verification_status','text',true),('donor_profiles','availability_status','text',true),
      ('beneficiary_profiles','user_id','uuid',true)
    ) AS required(table_name,column_name,type_name,not_null)
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute a
      WHERE a.attrelid=pg_catalog.to_regclass('public.'||required.table_name)
        AND a.attname=required.column_name AND NOT a.attisdropped
        AND a.atttypid=pg_catalog.to_regtype(required.type_name)
        AND a.attnotnull=required.not_null
    )
  ) THEN RAISE EXCEPTION 'BMS prerequisite columns, types, or nullability are unexpected'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attrdef d JOIN pg_catalog.pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum
                 WHERE d.adrelid='public.donor_profiles'::pg_catalog.regclass AND a.attname='verification_status'
                   AND pg_catalog.pg_get_expr(d.adbin,d.adrelid) IN ('''pending''::text','''pending''')) THEN
    RAISE EXCEPTION 'A reviewed donor-verification workflow with a pending default is required before blood requests';
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.role NOT IN ('donor','beneficiary','admin','super_admin') OR p.account_status NOT IN ('active','suspended','deactivated')
             OR pg_catalog.char_length(pg_catalog.btrim(p.district)) NOT BETWEEN 2 AND 100 OR pg_catalog.char_length(pg_catalog.btrim(p.thana)) NOT BETWEEN 2 AND 100 OR pg_catalog.char_length(pg_catalog.btrim(p.local_area)) NOT BETWEEN 2 AND 100)
     OR EXISTS (SELECT 1 FROM public.donor_profiles d WHERE d.blood_group NOT IN ('A+','A-','B+','B-','AB+','AB-','O+','O-') OR d.verification_status NOT IN ('pending','approved','rejected') OR d.availability_status NOT IN ('available','unavailable')) THEN
    RAISE EXCEPTION 'BMS prerequisite data contains unexpected status, blood-group, or location values';
  END IF;
  FOREACH client_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    FOR reachable IN SELECT r.oid FROM pg_catalog.pg_roles r WHERE pg_catalog.pg_has_role(client_role,r.oid,'USAGE') OR pg_catalog.pg_has_role(client_role,r.oid,'SET') LOOP
      FOREACH relation_name IN ARRAY ARRAY['profiles','donor_profiles','beneficiary_profiles','donor_availability_details','donor_availability_history','donor_availability_reminders'] LOOP
        IF pg_catalog.has_table_privilege(reachable.oid,'public.'||relation_name,'TRIGGER') THEN RAISE EXCEPTION 'A separately reviewed removal of client TRIGGER privileges is required before blood requests'; END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
             WHERE n.nspname='public' AND c.relname IN ('blood_requests','blood_request_interests','blood_requests_pkey','blood_request_interests_pkey','blood_request_interests_request_id_donor_id_key','blood_requests_beneficiary_created_idx','blood_requests_open_browse_idx','blood_request_interests_request_idx'))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
                WHERE n.nspname='public' AND p.proname IN ('beneficiary_create_blood_request','beneficiary_list_my_blood_requests','beneficiary_cancel_blood_request','donor_list_open_blood_requests','donor_express_interest')) THEN
    RAISE EXCEPTION 'Blood request objects already exist; review schema drift instead of replacing objects';
  END IF;
END;
$preflight$;

CREATE TABLE public.blood_requests (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  beneficiary_id uuid NOT NULL REFERENCES public.beneficiary_profiles(user_id) ON DELETE RESTRICT,
  blood_group text NOT NULL CHECK (blood_group IN ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
  district text NOT NULL CHECK (district=pg_catalog.btrim(district) AND pg_catalog.char_length(district) BETWEEN 2 AND 100),
  thana text NOT NULL CHECK (thana=pg_catalog.btrim(thana) AND pg_catalog.char_length(thana) BETWEEN 2 AND 100),
  local_area text NOT NULL CHECK (local_area=pg_catalog.btrim(local_area) AND pg_catalog.char_length(local_area) BETWEEN 2 AND 100),
  units_requested smallint NOT NULL CHECK (units_requested BETWEEN 1 AND 10),
  urgency text NOT NULL CHECK (urgency IN ('routine','urgent')),
  needed_by date NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','cancelled')),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  cancelled_at timestamptz,
  CONSTRAINT blood_requests_cancellation_check CHECK ((status='open' AND cancelled_at IS NULL) OR (status='cancelled' AND cancelled_at IS NOT NULL AND cancelled_at=updated_at))
);
ALTER TABLE public.blood_requests OWNER TO postgres;
ALTER TABLE public.blood_requests ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.blood_request_interests (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.blood_requests(id) ON DELETE RESTRICT,
  donor_id uuid NOT NULL REFERENCES public.donor_profiles(user_id) ON DELETE RESTRICT,
  expressed_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT blood_request_interests_request_id_donor_id_key UNIQUE (request_id,donor_id)
);
ALTER TABLE public.blood_request_interests OWNER TO postgres;
ALTER TABLE public.blood_request_interests ENABLE ROW LEVEL SECURITY;
-- No policies or direct client grants. The owner sees only counts through RPCs.
REVOKE ALL ON TABLE public.blood_requests,public.blood_request_interests FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX blood_requests_beneficiary_created_idx ON public.blood_requests (beneficiary_id,created_at DESC,id DESC);
CREATE INDEX blood_requests_open_browse_idx ON public.blood_requests (blood_group,created_at DESC,id DESC) WHERE status='open';
CREATE INDEX blood_request_interests_request_idx ON public.blood_request_interests (request_id);

CREATE FUNCTION public.beneficiary_create_blood_request(requested_blood_group text,requested_units integer,requested_urgency text,requested_needed_by date)
RETURNS TABLE (request_id uuid,blood_group text,district text,thana text,local_area text,units_requested smallint,urgency text,needed_by date,status text,created_at timestamptz,interest_count bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s'
AS $create$
DECLARE actor_id uuid:=auth.uid(); actor_profile public.profiles%ROWTYPE; created_request public.blood_requests%ROWTYPE;
BEGIN
  SELECT p.* INTO actor_profile FROM public.profiles p WHERE p.id=actor_id AND p.role='beneficiary' AND p.account_status='active' FOR SHARE;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.beneficiary_profiles b WHERE b.user_id=actor_id FOR SHARE) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Active beneficiary account required';
  END IF;
  IF requested_blood_group IS NULL OR requested_blood_group NOT IN ('A+','A-','B+','B-','AB+','AB-','O+','O-')
     OR requested_units IS NULL OR requested_units NOT BETWEEN 1 AND 10
     OR requested_urgency IS NULL OR requested_urgency NOT IN ('routine','urgent')
     OR requested_needed_by IS NULL OR requested_needed_by<CURRENT_DATE OR requested_needed_by>CURRENT_DATE+90 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid blood request details';
  END IF;
  -- Exact location is copied from the current beneficiary profile, never supplied by the client.
  INSERT INTO public.blood_requests(beneficiary_id,blood_group,district,thana,local_area,units_requested,urgency,needed_by)
  VALUES(actor_id,requested_blood_group,actor_profile.district,actor_profile.thana,actor_profile.local_area,requested_units::smallint,requested_urgency,requested_needed_by)
  RETURNING * INTO created_request;
  RETURN QUERY SELECT created_request.id,created_request.blood_group,created_request.district,created_request.thana,created_request.local_area,created_request.units_requested,created_request.urgency,created_request.needed_by,created_request.status,created_request.created_at,0::bigint;
END;
$create$;

CREATE FUNCTION public.beneficiary_list_my_blood_requests(page_size integer DEFAULT 20,page_offset integer DEFAULT 0)
RETURNS TABLE (request_id uuid,blood_group text,district text,thana text,local_area text,units_requested smallint,urgency text,needed_by date,status text,created_at timestamptz,updated_at timestamptz,cancelled_at timestamptz,interest_count bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s'
AS $list_owner$
DECLARE actor_id uuid:=auth.uid();
BEGIN
  PERFORM 1 FROM public.profiles p WHERE p.id=actor_id AND p.role='beneficiary' AND p.account_status='active' FOR SHARE;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.beneficiary_profiles b WHERE b.user_id=actor_id FOR SHARE) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Active beneficiary account required'; END IF;
  IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 50 OR page_offset IS NULL OR page_offset NOT BETWEEN 0 AND 100000 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid pagination'; END IF;
  RETURN QUERY SELECT r.id,r.blood_group,r.district,r.thana,r.local_area,r.units_requested,r.urgency,r.needed_by,r.status,r.created_at,r.updated_at,r.cancelled_at,pg_catalog.count(i.id)
  FROM public.blood_requests r LEFT JOIN public.blood_request_interests i ON i.request_id=r.id
  WHERE r.beneficiary_id=actor_id GROUP BY r.id ORDER BY r.created_at DESC,r.id DESC LIMIT page_size OFFSET page_offset;
END;
$list_owner$;

CREATE FUNCTION public.beneficiary_cancel_blood_request(target_request_id uuid)
RETURNS TABLE(request_id uuid,status text,cancelled_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s'
AS $cancel$
DECLARE actor_id uuid:=auth.uid(); target_request public.blood_requests%ROWTYPE; decision_time timestamptz;
BEGIN
  PERFORM 1 FROM public.profiles p WHERE p.id=actor_id AND p.role='beneficiary' AND p.account_status='active' FOR SHARE;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.beneficiary_profiles b WHERE b.user_id=actor_id FOR SHARE) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Active beneficiary account required'; END IF;
  IF target_request_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid blood request'; END IF;
  SELECT r.* INTO target_request FROM public.blood_requests r WHERE r.id=target_request_id AND r.beneficiary_id=actor_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='Blood request not found'; END IF;
  IF target_request.status<>'open' THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Blood request is no longer open'; END IF;
  decision_time:=pg_catalog.clock_timestamp();
  UPDATE public.blood_requests r SET status='cancelled',cancelled_at=decision_time,updated_at=decision_time WHERE r.id=target_request_id;
  RETURN QUERY SELECT target_request_id,'cancelled'::text,decision_time;
END;
$cancel$;

CREATE FUNCTION public.donor_list_open_blood_requests(page_size integer DEFAULT 20,page_offset integer DEFAULT 0)
RETURNS TABLE(request_id uuid,blood_group text,district text,thana text,local_area text,units_requested smallint,urgency text,needed_by date,created_at timestamptz,has_expressed_interest boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s'
AS $list_donor$
DECLARE actor_id uuid:=auth.uid(); actor_blood_group text;
BEGIN
  SELECT d.blood_group INTO actor_blood_group FROM public.donor_profiles d JOIN public.profiles p ON p.id=d.user_id
  WHERE d.user_id=actor_id AND p.role='donor' AND p.account_status='active' AND d.verification_status='approved' AND d.availability_status='available' FOR SHARE OF d,p;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Active approved available donor account required'; END IF;
  IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 50 OR page_offset IS NULL OR page_offset NOT BETWEEN 0 AND 100000 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid pagination'; END IF;
  RETURN QUERY SELECT r.id,r.blood_group,r.district,r.thana,r.local_area,r.units_requested,r.urgency,r.needed_by,r.created_at,
    EXISTS(SELECT 1 FROM public.blood_request_interests i WHERE i.request_id=r.id AND i.donor_id=actor_id)
  FROM public.blood_requests r WHERE r.status='open' AND r.needed_by>=CURRENT_DATE AND r.blood_group=actor_blood_group ORDER BY r.created_at DESC,r.id DESC LIMIT page_size OFFSET page_offset;
END;
$list_donor$;

CREATE FUNCTION public.donor_express_interest(target_request_id uuid)
RETURNS TABLE(request_id uuid,interest_id uuid,interest_status text,expressed_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s'
AS $interest$
DECLARE actor_id uuid:=auth.uid(); actor_blood_group text; target_request public.blood_requests%ROWTYPE; new_interest_id uuid; decision_time timestamptz;
BEGIN
  SELECT d.blood_group INTO actor_blood_group FROM public.donor_profiles d JOIN public.profiles p ON p.id=d.user_id
  WHERE d.user_id=actor_id AND p.role='donor' AND p.account_status='active' AND d.verification_status='approved' AND d.availability_status='available' FOR SHARE OF d,p;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Active approved available donor account required'; END IF;
  IF target_request_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid blood request'; END IF;
  SELECT r.* INTO target_request FROM public.blood_requests r WHERE r.id=target_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='Blood request not found'; END IF;
  IF target_request.status<>'open' OR target_request.needed_by<CURRENT_DATE OR target_request.blood_group<>actor_blood_group THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Blood request is not eligible for interest'; END IF;
  decision_time:=pg_catalog.clock_timestamp();
  INSERT INTO public.blood_request_interests(request_id,donor_id,expressed_at) VALUES(target_request_id,actor_id,decision_time)
  ON CONFLICT(request_id,donor_id) DO NOTHING RETURNING id INTO new_interest_id;
  IF new_interest_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Interest already recorded'; END IF;
  -- This records willingness to help only. It is not a completed donation.
  RETURN QUERY SELECT target_request_id,new_interest_id,'interested'::text,decision_time;
END;
$interest$;

ALTER FUNCTION public.beneficiary_create_blood_request(text,integer,text,date) OWNER TO postgres;
ALTER FUNCTION public.beneficiary_list_my_blood_requests(integer,integer) OWNER TO postgres;
ALTER FUNCTION public.beneficiary_cancel_blood_request(uuid) OWNER TO postgres;
ALTER FUNCTION public.donor_list_open_blood_requests(integer,integer) OWNER TO postgres;
ALTER FUNCTION public.donor_express_interest(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.beneficiary_create_blood_request(text,integer,text,date),public.beneficiary_list_my_blood_requests(integer,integer),public.beneficiary_cancel_blood_request(uuid),public.donor_list_open_blood_requests(integer,integer),public.donor_express_interest(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.beneficiary_create_blood_request(text,integer,text,date),public.beneficiary_list_my_blood_requests(integer,integer),public.beneficiary_cancel_blood_request(uuid),public.donor_list_open_blood_requests(integer,integer),public.donor_express_interest(uuid) TO authenticated;

-- Fail closed on historical ACL drift. No existing broad grant is weakened here.
DO $effective_permissions$
DECLARE client_role text; reachable record; relation_name text; signature text;
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    FOR reachable IN SELECT r.oid,r.rolsuper,r.rolbypassrls,r.rolcreaterole FROM pg_catalog.pg_roles r WHERE pg_catalog.pg_has_role(client_role,r.oid,'USAGE') OR pg_catalog.pg_has_role(client_role,r.oid,'SET') LOOP
      IF reachable.rolsuper OR reachable.rolbypassrls OR reachable.rolcreaterole THEN RAISE EXCEPTION 'Client can reach a privileged database role'; END IF;
      FOREACH relation_name IN ARRAY ARRAY['profiles','donor_profiles','beneficiary_profiles','donor_availability_details','donor_availability_history','donor_availability_reminders'] LOOP
        IF pg_catalog.has_table_privilege(reachable.oid,'public.'||relation_name,'TRUNCATE,TRIGGER') THEN RAISE EXCEPTION 'Client retains unsafe TRUNCATE or TRIGGER access'; END IF;
      END LOOP;
      FOREACH relation_name IN ARRAY ARRAY['profiles','donor_profiles'] LOOP
        IF pg_catalog.has_table_privilege(reachable.oid,'public.'||relation_name,'INSERT,UPDATE,DELETE') OR pg_catalog.has_any_column_privilege(reachable.oid,'public.'||relation_name,'INSERT,UPDATE') THEN RAISE EXCEPTION 'Client can bypass protected profile operations'; END IF;
      END LOOP;
      FOREACH relation_name IN ARRAY ARRAY['blood_requests','blood_request_interests'] LOOP
        IF pg_catalog.has_table_privilege(reachable.oid,'public.'||relation_name,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') OR pg_catalog.has_any_column_privilege(reachable.oid,'public.'||relation_name,'SELECT,INSERT,UPDATE,REFERENCES') THEN RAISE EXCEPTION 'Client retains direct blood request access'; END IF;
      END LOOP;
      FOREACH signature IN ARRAY ARRAY['public.beneficiary_create_blood_request(text,integer,text,date)','public.beneficiary_list_my_blood_requests(integer,integer)','public.beneficiary_cancel_blood_request(uuid)','public.donor_list_open_blood_requests(integer,integer)','public.donor_express_interest(uuid)'] LOOP
        IF client_role='anon' AND pg_catalog.has_function_privilege(reachable.oid,signature,'EXECUTE') THEN RAISE EXCEPTION 'Anonymous caller can execute a blood request RPC'; END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  FOREACH signature IN ARRAY ARRAY['public.beneficiary_create_blood_request(text,integer,text,date)','public.beneficiary_list_my_blood_requests(integer,integer)','public.beneficiary_cancel_blood_request(uuid)','public.donor_list_open_blood_requests(integer,integer)','public.donor_express_interest(uuid)'] LOOP
    IF NOT pg_catalog.has_function_privilege('authenticated',signature,'EXECUTE') OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a WHERE p.oid=pg_catalog.to_regprocedure(signature) AND (a.grantee NOT IN(p.proowner,'authenticated'::pg_catalog.regrole) OR(a.grantee='authenticated'::pg_catalog.regrole AND a.is_grantable))) THEN RAISE EXCEPTION 'Unexpected blood request RPC execution grants'; END IF;
  END LOOP;
END;
$effective_permissions$;
