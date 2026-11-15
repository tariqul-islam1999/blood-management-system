-- REVIEW DRAFT ONLY. Do not deploy without separate target-specific approval.
-- BMS P4.2 — Donation workflow RPCs (migration 20261030000100).
-- Adds the six donor lifecycle transition RPCs, the beneficiary read RPCs and the admin read
-- RPCs, and modifies two M7 RPCs to exclude/reject engaged requests (D-6 Option 2).
-- Scope: functions + ACL only. NO triggers, NO Realtime, NO notifications, NO application code.
-- Application tables stay grant-free; access is only through owner-checked SECURITY DEFINER RPCs.
-- Run as one migration-runner transaction with stop-on-error; never with autocommit.
-- Requires PostgreSQL 17, the eligibility migration (20261027000100), M7 (20261028000100) and
-- the P4.1 schema migration (20261029000100) to be applied first.
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
  FOREACH relation_name IN ARRAY ARRAY['profiles','donor_profiles','beneficiary_profiles','blood_requests','blood_request_interests','donor_donations','donation_engagements','donation_status_events','donation_followup_responses'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid=pg_catalog.to_regclass('public.'||relation_name)
                   AND c.relkind='r' AND c.relrowsecurity AND NOT c.relforcerowsecurity AND c.relowner='postgres'::pg_catalog.regrole) THEN
      RAISE EXCEPTION 'Missing, unexpected owner, or RLS-disabled prerequisite table: %', relation_name;
    END IF;
  END LOOP;
  IF pg_catalog.to_regprocedure('public.donor_is_eligible(date)') IS NULL
     OR pg_catalog.to_regprocedure('public.refresh_eligible_donor_availability()') IS NULL
     OR pg_catalog.to_regprocedure('public.bms_local_date()') IS NULL
     OR pg_catalog.to_regprocedure('public.apply_donation_ended(uuid,date,text,uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'Apply the donor eligibility migration 20261027000100 before P4.2';
  END IF;
  IF pg_catalog.to_regprocedure('public.donor_list_open_blood_requests(integer,integer)') IS NULL
     OR pg_catalog.to_regprocedure('public.beneficiary_cancel_blood_request(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Apply the blood request migration 20261028000100 before P4.2';
  END IF;
  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('profiles','id','uuid',true),('profiles','role','text',true),('profiles','account_status','text',true),
      ('profiles','full_name','text',true),('profiles','phone','text',true),('profiles','district','text',true),
      ('profiles','thana','text',true),('profiles','local_area','text',true),
      ('donor_profiles','user_id','uuid',true),('donor_profiles','blood_group','text',true),
      ('donor_profiles','verification_status','text',true),('donor_profiles','availability_status','text',true),
      ('donor_profiles','last_donation_date','date',false),
      ('beneficiary_profiles','user_id','uuid',true),
      ('blood_requests','id','uuid',true),('blood_requests','beneficiary_id','uuid',true),('blood_requests','status','text',true),
      ('blood_requests','blood_group','text',true),('blood_requests','needed_by','date',true),
      ('blood_request_interests','request_id','uuid',true),('blood_request_interests','donor_id','uuid',true)
    ) AS required(table_name,column_name,type_name,not_null)
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute a
      WHERE a.attrelid=pg_catalog.to_regclass('public.'||required.table_name)
        AND a.attname=required.column_name AND NOT a.attisdropped
        AND a.atttypid=pg_catalog.to_regtype(required.type_name) AND a.attnotnull=required.not_null
    )
  ) THEN RAISE EXCEPTION 'BMS prerequisite columns, types, or nullability are unexpected'; END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
             WHERE n.nspname='public' AND p.proname IN ('donor_accept_blood_request','donor_mark_reached_location','donor_start_donation','donor_end_donation','donor_record_reached_home_safely','donor_submit_donation_followup','beneficiary_get_donation_status','beneficiary_list_my_donations','beneficiary_get_followup_response','admin_list_donations','admin_get_donation','admin_get_donation_followup')) THEN
    RAISE EXCEPTION 'P4.2 objects already exist; review schema drift instead of replacing objects';
  END IF;
END;
$preflight$;

-- ---------------------------------------------------------------------------
-- Donor write RPCs (one per transition; donor-only, D-12)
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.donor_accept_blood_request(p_target_request_id uuid)
RETURNS TABLE(engagement_id uuid, request_id uuid, beneficiary_id uuid, status text, selected_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s'
AS $accept$
DECLARE
  actor_id uuid := auth.uid();
  actor_blood_group text;
  actor_last_donation date;
  target_request public.blood_requests%ROWTYPE;
  new_engagement_id uuid;
  decision_time timestamptz;
BEGIN
  IF p_target_request_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid blood request'; END IF;
  PERFORM public.refresh_eligible_donor_availability();
  -- D-6 concurrency: lock the donor row first, then the request row.
  SELECT d.blood_group, d.last_donation_date
    INTO actor_blood_group, actor_last_donation
  FROM public.donor_profiles d JOIN public.profiles p ON p.id = d.user_id
  WHERE d.user_id = actor_id AND p.role='donor' AND p.account_status='active'
    AND d.verification_status='approved' AND d.availability_status='available'
  FOR UPDATE OF d;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Active approved available donor account required'; END IF;
  IF NOT public.donor_is_eligible(actor_last_donation) THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Donor eligibility returns after the 4-month recovery period'; END IF;
  SELECT r.* INTO target_request FROM public.blood_requests r WHERE r.id = p_target_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='Blood request not found'; END IF;
  IF target_request.status <> 'open' OR target_request.needed_by < CURRENT_DATE OR target_request.blood_group <> actor_blood_group THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Blood request is not eligible for acceptance';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.blood_request_interests i WHERE i.request_id = p_target_request_id AND i.donor_id = actor_id) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Express interest in a request before accepting it';
  END IF;
  IF EXISTS (SELECT 1 FROM public.donation_engagements e WHERE e.donor_id = actor_id AND e.status <> 'reached_home_safely') THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='An active donation already exists for this donor';
  END IF;
  decision_time := pg_catalog.clock_timestamp();
  INSERT INTO public.donation_engagements(request_id, donor_id, beneficiary_id, status, selected_at, created_at, updated_at)
  VALUES (p_target_request_id, actor_id, target_request.beneficiary_id, 'selected', decision_time, decision_time, decision_time)
  RETURNING id INTO new_engagement_id;
  INSERT INTO public.donation_status_events(engagement_id, from_status, to_status, actor_id, actor_role, occurred_at)
  VALUES (new_engagement_id, NULL, 'selected', actor_id, 'donor', decision_time);
  RETURN QUERY SELECT new_engagement_id, p_target_request_id, target_request.beneficiary_id, 'selected'::text, decision_time;
END;
$accept$;

CREATE FUNCTION public.donor_mark_reached_location(p_engagement_id uuid)
RETURNS TABLE(engagement_id uuid, status text, reached_location_at timestamptz, updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s'
AS $reached_location$
DECLARE
  actor_id uuid := auth.uid();
  engagement_row public.donation_engagements%ROWTYPE;
  event_time timestamptz;
BEGIN
  IF p_engagement_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid donation engagement'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = actor_id AND p.role='donor' AND p.account_status='active') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Active donor account required';
  END IF;
  SELECT e.* INTO engagement_row FROM public.donation_engagements e WHERE e.id = p_engagement_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='Donation engagement not found'; END IF;
  IF engagement_row.donor_id <> actor_id THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Donor does not own this donation'; END IF;
  IF engagement_row.status <> 'selected' THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Donation is not in the expected state'; END IF;
  event_time := pg_catalog.clock_timestamp();
  UPDATE public.donation_engagements e SET status='reached_location', reached_location_at=event_time, updated_at=event_time
  WHERE e.id = p_engagement_id AND e.status = 'selected';
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Donation is not in the expected state'; END IF;
  INSERT INTO public.donation_status_events(engagement_id, from_status, to_status, actor_id, actor_role, occurred_at)
  VALUES (p_engagement_id, 'selected', 'reached_location', actor_id, 'donor', event_time);
  RETURN QUERY SELECT p_engagement_id, 'reached_location'::text, event_time, event_time;
END;
$reached_location$;

CREATE FUNCTION public.donor_start_donation(p_engagement_id uuid)
RETURNS TABLE(engagement_id uuid, status text, donation_started_at timestamptz, updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s'
AS $start_donation$
DECLARE
  actor_id uuid := auth.uid();
  engagement_row public.donation_engagements%ROWTYPE;
  event_time timestamptz;
BEGIN
  IF p_engagement_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid donation engagement'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = actor_id AND p.role='donor' AND p.account_status='active') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Active donor account required';
  END IF;
  SELECT e.* INTO engagement_row FROM public.donation_engagements e WHERE e.id = p_engagement_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='Donation engagement not found'; END IF;
  IF engagement_row.donor_id <> actor_id THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Donor does not own this donation'; END IF;
  IF engagement_row.status <> 'reached_location' THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Donation is not in the expected state'; END IF;
  event_time := pg_catalog.clock_timestamp();
  UPDATE public.donation_engagements e SET status='donation_started', donation_started_at=event_time, updated_at=event_time
  WHERE e.id = p_engagement_id AND e.status = 'reached_location';
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Donation is not in the expected state'; END IF;
  INSERT INTO public.donation_status_events(engagement_id, from_status, to_status, actor_id, actor_role, occurred_at)
  VALUES (p_engagement_id, 'reached_location', 'donation_started', actor_id, 'donor', event_time);
  RETURN QUERY SELECT p_engagement_id, 'donation_started'::text, event_time, event_time;
END;
$start_donation$;

CREATE FUNCTION public.donor_end_donation(p_engagement_id uuid)
RETURNS TABLE(engagement_id uuid, status text, donation_ended_at timestamptz, updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s'
AS $end_donation$
DECLARE
  actor_id uuid := auth.uid();
  engagement_row public.donation_engagements%ROWTYPE;
  event_time timestamptz;
BEGIN
  IF p_engagement_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid donation engagement'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = actor_id AND p.role='donor' AND p.account_status='active') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Active donor account required';
  END IF;
  SELECT e.* INTO engagement_row FROM public.donation_engagements e WHERE e.id = p_engagement_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='Donation engagement not found'; END IF;
  IF engagement_row.donor_id <> actor_id THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Donor does not own this donation'; END IF;
  IF engagement_row.status <> 'donation_started' THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Donation is not in the expected state'; END IF;
  event_time := pg_catalog.clock_timestamp();
  UPDATE public.donation_engagements e SET status='donation_ended', donation_ended_at=event_time, updated_at=event_time
  WHERE e.id = p_engagement_id AND e.status = 'donation_started';
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Donation is not in the expected state'; END IF;
  INSERT INTO public.donation_status_events(engagement_id, from_status, to_status, actor_id, actor_role, occurred_at)
  VALUES (p_engagement_id, 'donation_started', 'donation_ended', actor_id, 'donor', event_time);
  -- Donation Ended integration: record history + start the 4-month recovery atomically (owner-only helper).
  PERFORM public.apply_donation_ended(
    p_donor_id   => engagement_row.donor_id,
    p_donated_on => public.bms_local_date(),
    p_source     => 'donor',
    p_recorded_by=> actor_id,
    p_note       => NULL);
  RETURN QUERY SELECT p_engagement_id, 'donation_ended'::text, event_time, event_time;
END;
$end_donation$;

CREATE FUNCTION public.donor_record_reached_home_safely(p_engagement_id uuid, p_feeling text)
RETURNS TABLE(engagement_id uuid, status text, reached_home_safely_at timestamptz, feeling text, follow_up_due_at timestamptz, updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s'
AS $home_safely$
DECLARE
  actor_id uuid := auth.uid();
  engagement_row public.donation_engagements%ROWTYPE;
  event_time timestamptz;
  due_time timestamptz;
BEGIN
  IF p_engagement_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid donation engagement'; END IF;
  IF p_feeling IS NULL OR p_feeling NOT IN ('ok','so_so','not_well') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid feeling value'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = actor_id AND p.role='donor' AND p.account_status='active') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Active donor account required';
  END IF;
  SELECT e.* INTO engagement_row FROM public.donation_engagements e WHERE e.id = p_engagement_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='Donation engagement not found'; END IF;
  IF engagement_row.donor_id <> actor_id THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Donor does not own this donation'; END IF;
  IF engagement_row.status <> 'donation_ended' THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Donation is not in the expected state'; END IF;
  event_time := pg_catalog.clock_timestamp();
  -- Completing the cycle releases the active-donation restriction and starts the 48h follow-up timer.
  due_time := event_time + interval '48 hours';
  UPDATE public.donation_engagements e
  SET status='reached_home_safely', reached_home_safely_at=event_time, feeling=p_feeling, follow_up_due_at=due_time, updated_at=event_time
  WHERE e.id = p_engagement_id AND e.status = 'donation_ended';
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Donation is not in the expected state'; END IF;
  INSERT INTO public.donation_status_events(engagement_id, from_status, to_status, actor_id, actor_role, occurred_at)
  VALUES (p_engagement_id, 'donation_ended', 'reached_home_safely', actor_id, 'donor', event_time);
  RETURN QUERY SELECT p_engagement_id, 'reached_home_safely'::text, event_time, p_feeling, due_time, event_time;
END;
$home_safely$;

CREATE FUNCTION public.donor_submit_donation_followup(
  p_engagement_id uuid,
  p_physical_condition text,
  p_health_changes text,
  p_compared_to_after text,
  p_current_discomfort text,
  p_consulted_professional text,
  p_additional_comments text DEFAULT NULL)
RETURNS TABLE(engagement_id uuid, response_id uuid, submitted_at timestamptz, follow_up_submitted_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s'
AS $followup$
DECLARE
  actor_id uuid := auth.uid();
  engagement_row public.donation_engagements%ROWTYPE;
  event_time timestamptz;
  cleaned_comments text;
  new_response_id uuid;
BEGIN
  IF p_engagement_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid donation engagement'; END IF;
  IF p_physical_condition IS NULL OR p_physical_condition NOT IN ('good','moderate','not_well')
     OR p_health_changes IS NULL OR p_health_changes NOT IN ('no_problems','yes','not_sure')
     OR p_compared_to_after IS NULL OR p_compared_to_after NOT IN ('yes','same','worse')
     OR p_current_discomfort IS NULL OR p_current_discomfort NOT IN ('no','yes','prefer_not_to_say')
     OR p_consulted_professional IS NULL OR p_consulted_professional NOT IN ('yes','not_yet','not_needed') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid follow-up answers';
  END IF;
  cleaned_comments := NULLIF(pg_catalog.btrim(p_additional_comments), '');
  IF cleaned_comments IS NOT NULL AND pg_catalog.char_length(cleaned_comments) > 500 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Additional comments must be 500 characters or fewer'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = actor_id AND p.role='donor' AND p.account_status='active') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Active donor account required';
  END IF;
  SELECT e.* INTO engagement_row FROM public.donation_engagements e WHERE e.id = p_engagement_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='Donation engagement not found'; END IF;
  IF engagement_row.donor_id <> actor_id THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Donor does not own this donation'; END IF;
  IF engagement_row.status <> 'reached_home_safely' THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Donation is not in the expected state'; END IF;
  IF engagement_row.follow_up_submitted_at IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Follow-up has already been submitted'; END IF;
  IF pg_catalog.now() < engagement_row.follow_up_due_at THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Follow-up cannot be submitted before it is due'; END IF;
  event_time := pg_catalog.clock_timestamp();
  INSERT INTO public.donation_followup_responses(engagement_id, physical_condition, health_changes, compared_to_after, current_discomfort, consulted_professional, additional_comments, submitted_at)
  VALUES (p_engagement_id, p_physical_condition, p_health_changes, p_compared_to_after, p_current_discomfort, p_consulted_professional, cleaned_comments, event_time)
  RETURNING id INTO new_response_id;
  -- Atomic same-timestamp marker (D-13). No donation_status_events row (approved decision 1).
  UPDATE public.donation_engagements e SET follow_up_submitted_at=event_time, updated_at=event_time
  WHERE e.id = p_engagement_id AND e.status = 'reached_home_safely' AND e.follow_up_submitted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Follow-up has already been submitted'; END IF;
  RETURN QUERY SELECT p_engagement_id, new_response_id, event_time, event_time;
END;
$followup$;

-- ---------------------------------------------------------------------------
-- Beneficiary read RPCs (owner-only; donor identity revealed only because an
-- accepted engagement exists — never for unrelated beneficiaries)
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.beneficiary_get_donation_status(p_engagement_id uuid)
RETURNS TABLE(engagement_id uuid, request_id uuid, status text, donor_id uuid, donor_full_name text, donor_blood_group text, donor_district text, donor_thana text, donor_local_area text, selected_at timestamptz, reached_location_at timestamptz, donation_started_at timestamptz, donation_ended_at timestamptz, reached_home_safely_at timestamptz, feeling text, follow_up_due_at timestamptz, follow_up_submitted_at timestamptz, updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s'
AS $beneficiary_status$
DECLARE actor_id uuid := auth.uid();
BEGIN
  IF p_engagement_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid donation engagement'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = actor_id AND p.role='beneficiary' AND p.account_status='active') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Active beneficiary account required';
  END IF;
  RETURN QUERY
  SELECT e.id, e.request_id, e.status, e.donor_id, dp.full_name, d.blood_group, dp.district, dp.thana, dp.local_area,
         e.selected_at, e.reached_location_at, e.donation_started_at, e.donation_ended_at, e.reached_home_safely_at,
         e.feeling, e.follow_up_due_at, e.follow_up_submitted_at, e.updated_at
  FROM public.donation_engagements e
  JOIN public.profiles dp ON dp.id = e.donor_id
  JOIN public.donor_profiles d ON d.user_id = e.donor_id
  WHERE e.id = p_engagement_id AND e.beneficiary_id = actor_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='Donation engagement not found'; END IF;
END;
$beneficiary_status$;

CREATE FUNCTION public.beneficiary_list_my_donations(p_page_size integer DEFAULT 20, p_page_offset integer DEFAULT 0)
RETURNS TABLE(engagement_id uuid, request_id uuid, status text, donor_id uuid, donor_full_name text, donor_blood_group text, updated_at timestamptz, follow_up_submitted_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s'
AS $beneficiary_list$
DECLARE actor_id uuid := auth.uid();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = actor_id AND p.role='beneficiary' AND p.account_status='active') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Active beneficiary account required';
  END IF;
  IF p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 50 OR p_page_offset IS NULL OR p_page_offset NOT BETWEEN 0 AND 100000 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid pagination';
  END IF;
  RETURN QUERY
  SELECT e.id, e.request_id, e.status, e.donor_id, dp.full_name, d.blood_group, e.updated_at, e.follow_up_submitted_at
  FROM public.donation_engagements e
  JOIN public.profiles dp ON dp.id = e.donor_id
  JOIN public.donor_profiles d ON d.user_id = e.donor_id
  WHERE e.beneficiary_id = actor_id
  ORDER BY e.updated_at DESC, e.id DESC
  LIMIT p_page_size OFFSET p_page_offset;
END;
$beneficiary_list$;

CREATE FUNCTION public.beneficiary_get_followup_response(p_engagement_id uuid)
RETURNS TABLE(engagement_id uuid, physical_condition text, health_changes text, compared_to_after text, current_discomfort text, consulted_professional text, additional_comments text, submitted_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s'
AS $beneficiary_followup$
DECLARE actor_id uuid := auth.uid();
BEGIN
  IF p_engagement_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid donation engagement'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = actor_id AND p.role='beneficiary' AND p.account_status='active') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Active beneficiary account required';
  END IF;
  RETURN QUERY
  SELECT r.engagement_id, r.physical_condition, r.health_changes, r.compared_to_after, r.current_discomfort, r.consulted_professional, r.additional_comments, r.submitted_at
  FROM public.donation_followup_responses r
  JOIN public.donation_engagements e ON e.id = r.engagement_id
  WHERE r.engagement_id = p_engagement_id AND e.beneficiary_id = actor_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='Follow-up response not found'; END IF;
END;
$beneficiary_followup$;

-- ---------------------------------------------------------------------------
-- Admin read RPCs (admin/super_admin only; identities revealed per D-5/D-10).
-- Restricted fields; pagination follows R-4.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.admin_list_donations(p_page_size integer DEFAULT 20, p_page_offset integer DEFAULT 0)
RETURNS TABLE(engagement_id uuid, request_id uuid, status text, donor_id uuid, beneficiary_id uuid, selected_at timestamptz, donation_ended_at timestamptz, reached_home_safely_at timestamptz, follow_up_due_at timestamptz, follow_up_submitted_at timestamptz, updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s'
AS $admin_list$
DECLARE actor_id uuid := auth.uid();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = actor_id AND p.role IN ('admin','super_admin') AND p.account_status='active') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Active administrator account required';
  END IF;
  IF p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 50 OR p_page_offset IS NULL OR p_page_offset NOT BETWEEN 0 AND 100000 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid pagination';
  END IF;
  RETURN QUERY
  SELECT e.id, e.request_id, e.status, e.donor_id, e.beneficiary_id, e.selected_at, e.donation_ended_at, e.reached_home_safely_at, e.follow_up_due_at, e.follow_up_submitted_at, e.updated_at
  FROM public.donation_engagements e
  ORDER BY e.updated_at DESC, e.id DESC
  LIMIT p_page_size OFFSET p_page_offset;
END;
$admin_list$;

CREATE FUNCTION public.admin_get_donation(p_engagement_id uuid)
RETURNS TABLE(engagement_id uuid, request_id uuid, status text, donor_id uuid, donor_full_name text, donor_phone text, donor_blood_group text, donor_district text, donor_thana text, donor_local_area text, beneficiary_id uuid, beneficiary_full_name text, beneficiary_phone text, beneficiary_district text, beneficiary_thana text, beneficiary_local_area text, selected_at timestamptz, reached_location_at timestamptz, donation_started_at timestamptz, donation_ended_at timestamptz, reached_home_safely_at timestamptz, feeling text, follow_up_due_at timestamptz, follow_up_submitted_at timestamptz, created_at timestamptz, updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s'
AS $admin_get$
DECLARE actor_id uuid := auth.uid();
BEGIN
  IF p_engagement_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid donation engagement'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = actor_id AND p.role IN ('admin','super_admin') AND p.account_status='active') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Active administrator account required';
  END IF;
  RETURN QUERY
  SELECT e.id, e.request_id, e.status, e.donor_id, dp.full_name, dp.phone, d.blood_group, dp.district, dp.thana, dp.local_area,
         e.beneficiary_id, bp.full_name, bp.phone, bp.district, bp.thana, bp.local_area,
         e.selected_at, e.reached_location_at, e.donation_started_at, e.donation_ended_at, e.reached_home_safely_at,
         e.feeling, e.follow_up_due_at, e.follow_up_submitted_at, e.created_at, e.updated_at
  FROM public.donation_engagements e
  JOIN public.profiles dp ON dp.id = e.donor_id
  JOIN public.donor_profiles d ON d.user_id = e.donor_id
  JOIN public.profiles bp ON bp.id = e.beneficiary_id
  WHERE e.id = p_engagement_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='Donation engagement not found'; END IF;
END;
$admin_get$;

CREATE FUNCTION public.admin_get_donation_followup(p_engagement_id uuid)
RETURNS TABLE(engagement_id uuid, physical_condition text, health_changes text, compared_to_after text, current_discomfort text, consulted_professional text, additional_comments text, submitted_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s'
AS $admin_followup$
DECLARE actor_id uuid := auth.uid();
BEGIN
  IF p_engagement_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid donation engagement'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = actor_id AND p.role IN ('admin','super_admin') AND p.account_status='active') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Active administrator account required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.donation_engagements e WHERE e.id = p_engagement_id) THEN
    RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='Donation engagement not found';
  END IF;
  RETURN QUERY
  SELECT r.engagement_id, r.physical_condition, r.health_changes, r.compared_to_after, r.current_discomfort, r.consulted_professional, r.additional_comments, r.submitted_at
  FROM public.donation_followup_responses r
  WHERE r.engagement_id = p_engagement_id;
END;
$admin_followup$;

-- ---------------------------------------------------------------------------
-- Modified M7 RPCs (CREATE OR REPLACE; contracts and authorization preserved).
-- D-6 Option 2: the blood_requests.status CHECK is unchanged; engaged requests are
-- excluded from the donor open list and can no longer be cancelled.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.donor_list_open_blood_requests(page_size integer DEFAULT 20,page_offset integer DEFAULT 0)
RETURNS TABLE(request_id uuid,blood_group text,district text,thana text,local_area text,units_requested smallint,urgency text,needed_by date,created_at timestamptz,has_expressed_interest boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s'
AS $list_donor$
DECLARE actor_id uuid:=auth.uid(); actor_blood_group text; actor_last_donation date;
BEGIN
  PERFORM public.refresh_eligible_donor_availability();
  SELECT d.blood_group,d.last_donation_date INTO actor_blood_group,actor_last_donation FROM public.donor_profiles d JOIN public.profiles p ON p.id=d.user_id
  WHERE d.user_id=actor_id AND p.role='donor' AND p.account_status='active' AND d.verification_status='approved' AND d.availability_status='available' FOR SHARE OF d,p;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Active approved available donor account required'; END IF;
  IF NOT public.donor_is_eligible(actor_last_donation) THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Donor eligibility returns after the 4-month recovery period'; END IF;
  IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 50 OR page_offset IS NULL OR page_offset NOT BETWEEN 0 AND 100000 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid pagination'; END IF;
  RETURN QUERY SELECT r.id,r.blood_group,r.district,r.thana,r.local_area,r.units_requested,r.urgency,r.needed_by,r.created_at,
    EXISTS(SELECT 1 FROM public.blood_request_interests i WHERE i.request_id=r.id AND i.donor_id=actor_id)
  FROM public.blood_requests r
  WHERE r.status='open' AND r.needed_by>=CURRENT_DATE AND r.blood_group=actor_blood_group
    AND NOT EXISTS (SELECT 1 FROM public.donation_engagements e WHERE e.request_id=r.id)
  ORDER BY r.created_at DESC,r.id DESC LIMIT page_size OFFSET page_offset;
END;
$list_donor$;

CREATE OR REPLACE FUNCTION public.beneficiary_cancel_blood_request(target_request_id uuid)
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
  IF EXISTS (SELECT 1 FROM public.donation_engagements e WHERE e.request_id=target_request_id) THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='A donation has started for this request; it can no longer be cancelled'; END IF;
  decision_time:=pg_catalog.clock_timestamp();
  UPDATE public.blood_requests r SET status='cancelled',cancelled_at=decision_time,updated_at=decision_time WHERE r.id=target_request_id;
  RETURN QUERY SELECT target_request_id,'cancelled'::text,decision_time;
END;
$cancel$;

-- ---------------------------------------------------------------------------
-- Ownership and execution permissions (public pgTap/ACL conventions).
-- ---------------------------------------------------------------------------
ALTER FUNCTION public.donor_accept_blood_request(uuid) OWNER TO postgres;
ALTER FUNCTION public.donor_mark_reached_location(uuid) OWNER TO postgres;
ALTER FUNCTION public.donor_start_donation(uuid) OWNER TO postgres;
ALTER FUNCTION public.donor_end_donation(uuid) OWNER TO postgres;
ALTER FUNCTION public.donor_record_reached_home_safely(uuid,text) OWNER TO postgres;
ALTER FUNCTION public.donor_submit_donation_followup(uuid,text,text,text,text,text,text) OWNER TO postgres;
ALTER FUNCTION public.beneficiary_get_donation_status(uuid) OWNER TO postgres;
ALTER FUNCTION public.beneficiary_list_my_donations(integer,integer) OWNER TO postgres;
ALTER FUNCTION public.beneficiary_get_followup_response(uuid) OWNER TO postgres;
ALTER FUNCTION public.admin_list_donations(integer,integer) OWNER TO postgres;
ALTER FUNCTION public.admin_get_donation(uuid) OWNER TO postgres;
ALTER FUNCTION public.admin_get_donation_followup(uuid) OWNER TO postgres;
ALTER FUNCTION public.donor_list_open_blood_requests(integer,integer) OWNER TO postgres;
ALTER FUNCTION public.beneficiary_cancel_blood_request(uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.donor_accept_blood_request(uuid),public.donor_mark_reached_location(uuid),public.donor_start_donation(uuid),public.donor_end_donation(uuid),public.donor_record_reached_home_safely(uuid,text),public.donor_submit_donation_followup(uuid,text,text,text,text,text,text),public.beneficiary_get_donation_status(uuid),public.beneficiary_list_my_donations(integer,integer),public.beneficiary_get_followup_response(uuid),public.admin_list_donations(integer,integer),public.admin_get_donation(uuid),public.admin_get_donation_followup(uuid),public.donor_list_open_blood_requests(integer,integer),public.beneficiary_cancel_blood_request(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.donor_accept_blood_request(uuid),public.donor_mark_reached_location(uuid),public.donor_start_donation(uuid),public.donor_end_donation(uuid),public.donor_record_reached_home_safely(uuid,text),public.donor_submit_donation_followup(uuid,text,text,text,text,text,text),public.beneficiary_get_donation_status(uuid),public.beneficiary_list_my_donations(integer,integer),public.beneficiary_get_followup_response(uuid),public.admin_list_donations(integer,integer),public.admin_get_donation(uuid),public.admin_get_donation_followup(uuid),public.donor_list_open_blood_requests(integer,integer),public.beneficiary_cancel_blood_request(uuid) TO authenticated;

-- Fail closed on accidental drift: no client table/column access to the P4.1 tables,
-- anon/service_role cannot execute, authenticated executes only (no grant option).
DO $effective_permissions$
DECLARE client_role text; reachable record; relation_name text; signature text;
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    FOR reachable IN SELECT r.oid,r.rolsuper,r.rolbypassrls,r.rolcreaterole FROM pg_catalog.pg_roles r WHERE pg_catalog.pg_has_role(client_role,r.oid,'USAGE') OR pg_catalog.pg_has_role(client_role,r.oid,'SET') LOOP
      IF reachable.rolsuper OR reachable.rolbypassrls OR reachable.rolcreaterole THEN RAISE EXCEPTION 'Client can reach a privileged database role'; END IF;
      FOREACH relation_name IN ARRAY ARRAY['donation_engagements','donation_status_events','donation_followup_responses'] LOOP
        IF pg_catalog.has_table_privilege(reachable.oid,'public.'||relation_name,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') OR pg_catalog.has_any_column_privilege(reachable.oid,'public.'||relation_name,'SELECT,INSERT,UPDATE,REFERENCES') THEN RAISE EXCEPTION 'Client retains direct donation workflow access on %', relation_name; END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  FOREACH relation_name IN ARRAY ARRAY['donation_engagements','donation_status_events','donation_followup_responses'] LOOP
    IF pg_catalog.has_table_privilege('service_role','public.'||relation_name,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') THEN RAISE EXCEPTION 'service_role retains direct donation workflow access on %', relation_name; END IF;
  END LOOP;
  FOREACH signature IN ARRAY ARRAY['public.donor_accept_blood_request(uuid)','public.donor_mark_reached_location(uuid)','public.donor_start_donation(uuid)','public.donor_end_donation(uuid)','public.donor_record_reached_home_safely(uuid,text)','public.donor_submit_donation_followup(uuid,text,text,text,text,text,text)','public.beneficiary_get_donation_status(uuid)','public.beneficiary_list_my_donations(integer,integer)','public.beneficiary_get_followup_response(uuid)','public.admin_list_donations(integer,integer)','public.admin_get_donation(uuid)','public.admin_get_donation_followup(uuid)','public.donor_list_open_blood_requests(integer,integer)','public.beneficiary_cancel_blood_request(uuid)'] LOOP
    IF pg_catalog.has_function_privilege('anon',signature,'EXECUTE') OR pg_catalog.has_function_privilege('service_role',signature,'EXECUTE') THEN RAISE EXCEPTION 'anon or service_role can execute %', signature; END IF;
    IF NOT pg_catalog.has_function_privilege('authenticated',signature,'EXECUTE') OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a WHERE p.oid=pg_catalog.to_regprocedure(signature) AND (a.grantee NOT IN (p.proowner,'authenticated'::pg_catalog.regrole) OR (a.grantee='authenticated'::pg_catalog.regrole AND a.is_grantable))) THEN RAISE EXCEPTION 'Unexpected execution grants for %', signature; END IF;
  END LOOP;
END;
$effective_permissions$;
