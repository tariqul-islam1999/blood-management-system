-- REVIEW DRAFT ONLY. Do not deploy without separate target-specific approval.
-- Prerequisites: M1, M2, M3, M3.5, M5 and M6 applied. This file is ordered BEFORE
-- 20261028000100_blood_request_management.sql (M7), which depends on its helpers.
-- It adds donation history and donation-date-based calendar-month eligibility only; it
-- never rewrites existing donor history or reclassifies existing donations.
SET LOCAL search_path = '';
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL check_function_bodies = on;

DO $preflight$
DECLARE relation_name text; signature text;
BEGIN
  IF current_user <> 'postgres'
     OR pg_catalog.current_setting('server_version_num')::integer / 10000 <> 17 THEN
    RAISE EXCEPTION 'Requires PostgreSQL 17 and current_user postgres';
  END IF;
  IF pg_catalog.to_regprocedure('auth.uid()') IS NULL
     OR pg_catalog.to_regclass('auth.users') IS NULL
     OR EXISTS (
        SELECT 1 FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS r(name)
        WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles AS p WHERE p.rolname = r.name)
     ) THEN
    RAISE EXCEPTION 'Supabase Auth and API roles are required';
  END IF;
  FOREACH relation_name IN ARRAY ARRAY[
    'profiles', 'donor_profiles', 'beneficiary_profiles',
    'donor_availability_details', 'donor_availability_history',
    'donor_availability_reminders', 'donor_verification_history'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class AS c
      WHERE c.oid = pg_catalog.to_regclass('public.' || relation_name)
        AND c.relkind = 'r' AND c.relrowsecurity AND NOT c.relforcerowsecurity
        AND c.relowner = 'postgres'::pg_catalog.regrole
    ) THEN
      RAISE EXCEPTION 'Missing, unexpected owner, or RLS-disabled prerequisite: %', relation_name;
    END IF;
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute AS a
    WHERE a.attrelid = 'public.donor_profiles'::pg_catalog.regclass
      AND a.attname = 'last_donation_date' AND NOT a.attisdropped
      AND a.atttypid = 'date'::pg_catalog.regtype AND NOT a.attnotnull
  ) THEN
    RAISE EXCEPTION 'donor_profiles.last_donation_date date (nullable) is required';
  END IF;
  FOREACH signature IN ARRAY ARRAY[
    'public.admin_list_pending_donors(integer,integer)',
    'public.admin_review_donor(uuid,text,text)'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc AS p
      WHERE p.oid = pg_catalog.to_regprocedure(signature)
        AND p.proowner = 'postgres'::pg_catalog.regrole AND p.prosecdef
    ) THEN
      RAISE EXCEPTION 'Apply and verify the donor verification migration first: %', signature;
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger AS t
    WHERE t.tgrelid IN ('public.profiles'::pg_catalog.regclass,
                        'public.donor_profiles'::pg_catalog.regclass,
                        'public.donor_verification_history'::pg_catalog.regclass)
      AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'Unexpected profile or verification trigger; review before deployment';
  END IF;
  IF pg_catalog.to_regclass('public.donor_donations') IS NOT NULL
     OR EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc AS p
        JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN ('donor_next_eligible_date', 'donor_is_eligible',
                            'refresh_eligible_donor_availability',
                            'bms_local_date', 'apply_donation_ended', 'get_my_donor_eligibility',
                            'list_my_donations', 'admin_correct_donor_donation_date')
     ) THEN
    RAISE EXCEPTION 'Donor eligibility objects already exist; review drift instead of replacing them';
  END IF;
END;
$preflight$;

CREATE TABLE public.donor_donations (
    id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
    donor_id uuid NOT NULL REFERENCES public.donor_profiles (user_id) ON DELETE CASCADE,
    donated_on date NOT NULL CHECK (donated_on <= (pg_catalog.now() AT TIME ZONE 'Asia/Dhaka')::date),
    note text,
    source text NOT NULL DEFAULT 'donor' CHECK (source IN ('donor', 'admin')),
    recorded_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
    recorded_at timestamp with time zone NOT NULL DEFAULT pg_catalog.clock_timestamp(),
    CONSTRAINT donor_donations_note_check
        CHECK (note IS NULL OR pg_catalog.char_length(pg_catalog.btrim(note)) BETWEEN 1 AND 200),
    CONSTRAINT donor_donations_donor_on_key UNIQUE (donor_id, donated_on)
);
ALTER TABLE public.donor_donations OWNER TO postgres;
ALTER TABLE public.donor_donations ENABLE ROW LEVEL SECURITY;
-- No client policies and no direct client grants: history is RPC-only.
REVOKE ALL ON TABLE public.donor_donations FROM PUBLIC, anon, authenticated, service_role;
CREATE INDEX donor_donations_donor_recent_idx
    ON public.donor_donations (donor_id, donated_on DESC, id DESC);

-- Align the existing registration constraint with the Bangladesh calendar day.
-- Existing rows only need last_donation_date <= UTC today, so they all still pass.
ALTER TABLE public.donor_profiles DROP CONSTRAINT IF EXISTS donor_last_donation_date_check;
ALTER TABLE public.donor_profiles ADD CONSTRAINT donor_last_donation_date_check
    CHECK (last_donation_date IS NULL
           OR last_donation_date <= (pg_catalog.now() AT TIME ZONE 'Asia/Dhaka')::date);

-- Calendar-month eligibility: a donor becomes eligible again four months after the
-- donation date (e.g. 2026-01-31 + 4 months = 2026-05-31).
CREATE FUNCTION public.donor_next_eligible_date(last_donation date) RETURNS date
    LANGUAGE sql IMMUTABLE
    SET search_path = ''
    AS $$
    SELECT CASE
             WHEN last_donation IS NULL THEN NULL
             ELSE (last_donation + INTERVAL '4 months')::date
           END;
$$;
ALTER FUNCTION public.donor_next_eligible_date(date) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.donor_next_eligible_date(date)
    FROM PUBLIC, anon, authenticated, service_role;

-- Business dates follow the Bangladesh calendar (Asia/Dhaka, UTC+6, no DST), not
-- the UTC database date. Owner-only helper; used by every eligibility decision.
CREATE FUNCTION public.bms_local_date() RETURNS date
    LANGUAGE sql STABLE
    SET search_path = ''
    AS $$
    SELECT (pg_catalog.now() AT TIME ZONE 'Asia/Dhaka')::date;
$$;
ALTER FUNCTION public.bms_local_date() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.bms_local_date()
    FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.donor_is_eligible(last_donation date) RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path = ''
    AS $$
    SELECT last_donation IS NULL
           OR (last_donation + INTERVAL '4 months')::date <= public.bms_local_date();
$$;
ALTER FUNCTION public.donor_is_eligible(date) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.donor_is_eligible(date)
    FROM PUBLIC, anon, authenticated, service_role;

-- Automatic availability restoration. Only donors the system made unavailable for a
-- donation recovery period are restored; personal "unavailable" choices are kept.
CREATE FUNCTION public.refresh_eligible_donor_availability() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = ''
    SET lock_timeout = '5s'
    AS $refresh$
DECLARE
    changed integer := 0;
BEGIN
    WITH restored AS (
        UPDATE public.donor_profiles AS d
        SET availability_status = 'available',
            updated_at = pg_catalog.clock_timestamp()
        WHERE d.availability_status = 'unavailable'
          AND d.last_donation_date IS NOT NULL
          AND (d.last_donation_date + INTERVAL '4 months')::date <= public.bms_local_date()
          AND EXISTS (
              SELECT 1 FROM public.donor_availability_details AS det
              WHERE det.user_id = d.user_id
                AND det.unavailable_reason = 'Donation recovery period: automatically unavailable until the 4-month eligibility date.'
          )
        RETURNING d.user_id
    ), recorded AS (
        INSERT INTO public.donor_availability_history (user_id, previous_status, new_status, reason)
        SELECT user_id, 'unavailable', 'available',
               'Automatic restoration after the 4-month donation recovery period.'
        FROM restored
        RETURNING 1
    )
    SELECT pg_catalog.count(*) INTO changed FROM restored;
    DELETE FROM public.donor_availability_details AS det
    WHERE det.unavailable_reason = 'Donation recovery period: automatically unavailable until the 4-month eligibility date.'
      AND EXISTS (
          SELECT 1 FROM public.donor_profiles AS d
          WHERE d.user_id = det.user_id AND d.availability_status = 'available'
      );
    RETURN changed;
END;
$refresh$;
ALTER FUNCTION public.refresh_eligible_donor_availability() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.refresh_eligible_donor_availability()
    FROM PUBLIC, anon, authenticated, service_role;


-- INTERNAL helper for the future Complete Donation Workflow. Owner-only: no client
-- EXECUTE grant. The completion RPC must call this inside the same transaction that
-- records the "donation ended" status transition, so donation history,
-- donor_profiles.last_donation_date and the 4-month recovery period are applied
-- automatically with that status change instead of a separate donor action.
CREATE FUNCTION public.apply_donation_ended(
    p_donor_id uuid,
    p_donated_on date,
    p_source text DEFAULT 'donor',
    p_recorded_by uuid DEFAULT NULL,
    p_note text DEFAULT NULL)
RETURNS TABLE (donation_id uuid, donated_on date, next_eligible_date date, availability_status text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = ''
    SET lock_timeout = '5s'
    AS $apply$
DECLARE
    previous_status text;
    previous_last date;
    cleaned_note text;
    event_time timestamp with time zone;
    new_id uuid;
BEGIN
    IF p_donor_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid donor account';
    END IF;
    IF p_source IS NULL OR p_source NOT IN ('donor', 'admin') THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid donation source';
    END IF;
    SELECT d.availability_status, d.last_donation_date
      INTO previous_status, previous_last
    FROM public.donor_profiles AS d
    JOIN public.profiles AS p ON p.id = d.user_id
    WHERE d.user_id = p_donor_id
      AND p.role = 'donor' AND p.account_status = 'active'
      AND d.verification_status = 'approved'
    FOR UPDATE OF d;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '55000',
            MESSAGE = 'Active approved donor required';
    END IF;
    IF p_donated_on IS NULL OR p_donated_on > public.bms_local_date() THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
            MESSAGE = 'Donation date must be a past or present date';
    END IF;
    cleaned_note := NULLIF(pg_catalog.btrim(p_note), '');
    IF cleaned_note IS NOT NULL AND pg_catalog.char_length(cleaned_note) > 200 THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
            MESSAGE = 'Donation note must be 200 characters or fewer';
    END IF;
    IF previous_last IS NOT NULL AND p_donated_on <= previous_last THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
            MESSAGE = 'Donation date must be after the previous recorded donation';
    END IF;
    IF previous_last IS NOT NULL
       AND p_donated_on < (previous_last + INTERVAL '4 months')::date THEN
        RAISE EXCEPTION USING ERRCODE = '55000',
            MESSAGE = 'A donation cannot be recorded before the 4-month recovery period ends';
    END IF;
    IF EXISTS (SELECT 1 FROM public.donor_donations AS dn
               WHERE dn.donor_id = p_donor_id AND dn.donated_on = p_donated_on) THEN
        RAISE EXCEPTION USING ERRCODE = '55000',
            MESSAGE = 'Donation already recorded for this date';
    END IF;
    event_time := pg_catalog.clock_timestamp();
    INSERT INTO public.donor_donations (donor_id, donated_on, note, source, recorded_by, recorded_at)
    VALUES (p_donor_id, p_donated_on, cleaned_note, p_source, p_recorded_by, event_time)
    RETURNING id INTO new_id;
    UPDATE public.donor_profiles AS d
    SET last_donation_date = p_donated_on,
        availability_status = 'unavailable',
        updated_at = event_time
    WHERE d.user_id = p_donor_id;
    INSERT INTO public.donor_availability_details
        (user_id, unavailable_reason, unavailable_since, updated_at)
    VALUES (p_donor_id,
            'Donation recovery period: automatically unavailable until the 4-month eligibility date.',
            event_time, event_time)
    ON CONFLICT (user_id) DO UPDATE
    SET unavailable_reason = EXCLUDED.unavailable_reason,
        unavailable_since = EXCLUDED.unavailable_since,
        updated_at = EXCLUDED.updated_at;
    IF previous_status <> 'unavailable' THEN
        INSERT INTO public.donor_availability_history
            (user_id, previous_status, new_status, reason)
        VALUES (p_donor_id, previous_status, 'unavailable',
                'Donation recorded; automatic 4-month recovery period.');
    END IF;
    RETURN QUERY
    SELECT new_id, p_donated_on,
           public.donor_next_eligible_date(p_donated_on),
           'unavailable'::text;
END;
$apply$;
ALTER FUNCTION public.apply_donation_ended(uuid, date, text, uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.apply_donation_ended(uuid, date, text, uuid, text)
    FROM PUBLIC, anon, authenticated, service_role;
-- No GRANT: this helper is callable only by the owning postgres role (the future
-- completion RPC, admin corrections or migrations).


CREATE FUNCTION public.get_my_donor_eligibility()
RETURNS TABLE (last_donation_date date, next_eligible_date date,
               is_eligible boolean, days_remaining integer, availability_status text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = ''
    SET lock_timeout = '5s'
    AS $eligibility$
DECLARE
    actor_id uuid := auth.uid();
    donor_row public.donor_profiles%ROWTYPE;
BEGIN
    PERFORM public.refresh_eligible_donor_availability();
    SELECT d.* INTO donor_row
    FROM public.donor_profiles AS d
    JOIN public.profiles AS p ON p.id = d.user_id
    WHERE d.user_id = actor_id AND p.role = 'donor' AND p.account_status = 'active';
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Active donor account required';
    END IF;
    RETURN QUERY
    SELECT donor_row.last_donation_date,
           public.donor_next_eligible_date(donor_row.last_donation_date),
           public.donor_is_eligible(donor_row.last_donation_date),
           CASE WHEN public.donor_is_eligible(donor_row.last_donation_date) THEN 0
                ELSE GREATEST(0, public.donor_next_eligible_date(donor_row.last_donation_date) - public.bms_local_date())
           END,
           donor_row.availability_status;
END;
$eligibility$;
ALTER FUNCTION public.get_my_donor_eligibility() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_my_donor_eligibility()
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_donor_eligibility() TO authenticated;

CREATE FUNCTION public.list_my_donations(p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
RETURNS TABLE (donation_id uuid, donated_on date, note text, source text,
               recorded_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = ''
    SET lock_timeout = '5s'
    AS $list$
DECLARE
    actor_id uuid := auth.uid();
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.profiles AS p
                   WHERE p.id = actor_id AND p.role = 'donor' AND p.account_status = 'active') THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Active donor account required';
    END IF;
    IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50
       OR p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 100000 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid pagination';
    END IF;
    RETURN QUERY
    SELECT dn.id, dn.donated_on, dn.note, dn.source, dn.recorded_at
    FROM public.donor_donations AS dn
    WHERE dn.donor_id = actor_id
    ORDER BY dn.donated_on DESC, dn.id DESC
    LIMIT p_limit OFFSET p_offset;
END;
$list$;
ALTER FUNCTION public.list_my_donations(integer, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.list_my_donations(integer, integer)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_my_donations(integer, integer) TO authenticated;


-- Administrative correction of the most recent donation date (approved decision 3).
-- The corrected date must stay after the previous record and outside the 4-month
-- recovery period, so the history order and donor_profiles.last_donation_date stay
-- consistent. Profile and history change together; the audit reason is required.
CREATE FUNCTION public.admin_correct_donor_donation_date(
    target_user_id uuid, corrected_donated_on date, correction_reason text)
RETURNS TABLE (donor_id uuid, last_donation_date date,
               next_eligible_date date, availability_status text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = ''
    SET lock_timeout = '5s'
    AS $correct$
DECLARE
    actor_id uuid := auth.uid();
    cleaned_reason text;
    previous_status text;
    latest_id uuid;
    previous_on date;
    event_time timestamp with time zone;
    new_status text;
    next_date date;
BEGIN
    PERFORM 1 FROM public.profiles AS p
    WHERE p.id = actor_id AND p.account_status = 'active'
      AND p.role IN ('admin', 'super_admin')
    FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Active administrator required';
    END IF;
    IF target_user_id IS NULL OR corrected_donated_on IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid donation correction';
    END IF;
    IF corrected_donated_on > public.bms_local_date() THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
            MESSAGE = 'Donation date must be a past or present date';
    END IF;
    cleaned_reason := NULLIF(pg_catalog.btrim(correction_reason), '');
    IF cleaned_reason IS NULL
       OR pg_catalog.char_length(cleaned_reason) NOT BETWEEN 10 AND 500 THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
            MESSAGE = 'Correction reason must contain 10 to 500 characters';
    END IF;
    SELECT d.availability_status INTO previous_status
    FROM public.donor_profiles AS d
    JOIN public.profiles AS p ON p.id = d.user_id
    WHERE d.user_id = target_user_id
      AND p.role = 'donor' AND p.account_status = 'active'
      AND d.verification_status = 'approved'
    FOR UPDATE OF d;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Active approved donor required';
    END IF;
    SELECT dn.id INTO latest_id
    FROM public.donor_donations AS dn
    WHERE dn.donor_id = target_user_id
    ORDER BY dn.donated_on DESC, dn.id DESC
    LIMIT 1
    FOR UPDATE;
    previous_on := NULL;
    IF latest_id IS NULL THEN
        INSERT INTO public.donor_donations (donor_id, donated_on, note, source, recorded_by)
        VALUES (target_user_id, corrected_donated_on, NULL, 'admin', actor_id)
        RETURNING id INTO latest_id;
    ELSE
        SELECT dn.donated_on INTO previous_on
        FROM public.donor_donations AS dn
        WHERE dn.donor_id = target_user_id AND dn.id <> latest_id
        ORDER BY dn.donated_on DESC, dn.id DESC
        LIMIT 1
        FOR UPDATE;
        IF previous_on IS NOT NULL AND corrected_donated_on <= previous_on THEN
            RAISE EXCEPTION USING ERRCODE = '55000',
                MESSAGE = 'Correction must be after the previous donation record';
        END IF;
        IF previous_on IS NOT NULL
           AND corrected_donated_on < (previous_on + INTERVAL '4 months')::date THEN
            RAISE EXCEPTION USING ERRCODE = '55000',
                MESSAGE = 'Correction violates the 4-month recovery period after the previous donation';
        END IF;
        IF EXISTS (SELECT 1 FROM public.donor_donations AS dn
                   WHERE dn.donor_id = target_user_id
                     AND dn.donated_on = corrected_donated_on
                     AND dn.id <> latest_id) THEN
            RAISE EXCEPTION USING ERRCODE = '55000',
                MESSAGE = 'Correction conflicts with an existing donation record';
        END IF;
        UPDATE public.donor_donations AS dn
        SET donated_on = corrected_donated_on, source = 'admin', recorded_by = actor_id
        WHERE dn.id = latest_id;
    END IF;
    event_time := pg_catalog.clock_timestamp();
    next_date := public.donor_next_eligible_date(corrected_donated_on);
    new_status := CASE WHEN public.donor_is_eligible(corrected_donated_on)
                       THEN 'available' ELSE 'unavailable' END;
    UPDATE public.donor_profiles AS d
    SET last_donation_date = corrected_donated_on,
        availability_status = new_status,
        updated_at = event_time
    WHERE d.user_id = target_user_id;
    IF new_status = 'available' THEN
        DELETE FROM public.donor_availability_details AS det
        WHERE det.user_id = target_user_id
          AND det.unavailable_reason = 'Donation recovery period: automatically unavailable until the 4-month eligibility date.';
    ELSE
        INSERT INTO public.donor_availability_details
            (user_id, unavailable_reason, unavailable_since, updated_at)
        VALUES (target_user_id,
                'Donation recovery period: automatically unavailable until the 4-month eligibility date.',
                event_time, event_time)
        ON CONFLICT (user_id) DO UPDATE
        SET unavailable_reason = EXCLUDED.unavailable_reason,
            unavailable_since = EXCLUDED.unavailable_since,
            updated_at = EXCLUDED.updated_at;
    END IF;
    IF previous_status <> new_status THEN
        INSERT INTO public.donor_availability_history
            (user_id, previous_status, new_status, reason)
        VALUES (target_user_id, previous_status, new_status,
                'Administrative donation-date correction: ' || pg_catalog.left(cleaned_reason, 200));
    END IF;
    RETURN QUERY SELECT target_user_id, corrected_donated_on, next_date, new_status;
END;
$correct$;
ALTER FUNCTION public.admin_correct_donor_donation_date(uuid, date, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_correct_donor_donation_date(uuid, date, text)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_correct_donor_donation_date(uuid, date, text) TO authenticated;


-- Existing availability RPCs gain the eligibility guard; behaviour is otherwise unchanged.
CREATE OR REPLACE FUNCTION public.set_my_donor_availability(new_status text, reason text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  current_user_id uuid;
  old_status text;
  last_donation date;
  cleaned_reason text;
BEGIN
  current_user_id := (SELECT auth.uid());
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF new_status IS NULL OR new_status NOT IN ('available', 'unavailable') THEN
    RAISE EXCEPTION 'Invalid availability status';
  END IF;
  SELECT dp.availability_status, dp.last_donation_date
  INTO old_status, last_donation
  FROM public.donor_profiles AS dp
  JOIN public.profiles AS p ON p.id = dp.user_id
  WHERE dp.user_id = current_user_id
    AND dp.verification_status = 'approved'
    AND p.role = 'donor'
    AND p.account_status = 'active'
  FOR UPDATE OF dp;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only approved donors with active accounts can change availability';
  END IF;
  IF new_status = 'available' AND NOT public.donor_is_eligible(last_donation) THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = 'Availability returns after the 4-month donation recovery period';
  END IF;
  IF old_status = new_status THEN
    RAISE EXCEPTION 'Availability is already set to this status';
  END IF;
  cleaned_reason := NULLIF(BTRIM(reason), '');
  IF new_status = 'unavailable' THEN
    IF cleaned_reason IS NULL
       OR char_length(cleaned_reason) NOT BETWEEN 10 AND 500 THEN
      RAISE EXCEPTION 'Unavailable reason must contain 10 to 500 characters';
    END IF;
    INSERT INTO public.donor_availability_details
      (user_id, unavailable_reason, unavailable_since, updated_at)
    VALUES (current_user_id, cleaned_reason, now(), now())
    ON CONFLICT (user_id) DO UPDATE
    SET unavailable_reason = EXCLUDED.unavailable_reason,
        unavailable_since = EXCLUDED.unavailable_since,
        updated_at = now();
  ELSE
    DELETE FROM public.donor_availability_details WHERE user_id = current_user_id;
  END IF;
  UPDATE public.donor_profiles
  SET availability_status = new_status, updated_at = now()
  WHERE user_id = current_user_id;
  INSERT INTO public.donor_availability_history
    (user_id, previous_status, new_status, reason)
  VALUES
    (current_user_id, old_status, new_status,
     CASE WHEN new_status = 'unavailable' THEN cleaned_reason ELSE NULL END);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_my_donor_availability(new_status text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  current_user_id uuid;
  last_donation date;
BEGIN
  current_user_id := (SELECT auth.uid());
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF new_status IS NULL OR new_status NOT IN ('available', 'unavailable') THEN
    RAISE EXCEPTION 'Invalid availability status';
  END IF;
  SELECT dp.last_donation_date
  INTO last_donation
  FROM public.donor_profiles AS dp
  WHERE dp.user_id = current_user_id
    AND dp.verification_status = 'approved'
    AND EXISTS (
      SELECT 1 FROM public.profiles AS p
      WHERE p.id = current_user_id
        AND p.role = 'donor'
        AND p.account_status = 'active'
    )
  FOR UPDATE OF dp;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only approved donors with active accounts can change availability';
  END IF;
  IF new_status = 'available' AND NOT public.donor_is_eligible(last_donation) THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = 'Availability returns after the 4-month donation recovery period';
  END IF;
  UPDATE public.donor_profiles AS dp
  SET availability_status = new_status, updated_at = now()
  WHERE dp.user_id = current_user_id;
END;
$$;


-- Beneficiary search now requires eligibility as well as approval and availability.
CREATE OR REPLACE FUNCTION public.search_available_donors(
    requested_blood_group text DEFAULT NULL::text,
    requested_district text DEFAULT NULL::text,
    requested_thana text DEFAULT NULL::text)
RETURNS TABLE (donor_id uuid, full_name text, blood_group text, district text,
               thana text, local_area text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles AS requester
    WHERE requester.id = (SELECT auth.uid())
      AND requester.role = 'beneficiary'
      AND requester.account_status = 'active'
  ) THEN
    RAISE EXCEPTION 'Only active beneficiaries can search for donors';
  END IF;
  -- Restore donors whose 4-month recovery period has ended before matching.
  PERFORM public.refresh_eligible_donor_availability();
  RETURN QUERY
  SELECT p.id, p.full_name, dp.blood_group, p.district, p.thana, p.local_area
  FROM public.donor_profiles AS dp
  JOIN public.profiles AS p ON p.id = dp.user_id
  WHERE p.role = 'donor'
    AND p.account_status = 'active'
    AND dp.verification_status = 'approved'
    AND dp.availability_status = 'available'
    AND public.donor_is_eligible(dp.last_donation_date)
    AND (requested_blood_group IS NULL OR dp.blood_group = requested_blood_group)
    AND (requested_district IS NULL OR p.district ILIKE requested_district)
    AND (requested_thana IS NULL OR p.thana ILIKE requested_thana)
  ORDER BY p.full_name
  LIMIT 100;
END;
$$;


-- Fail closed on unexpected ownership, policy or ACL drift.
DO $effective_permissions$
DECLARE signature text; client_role text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class AS c
    WHERE c.oid = 'public.donor_donations'::pg_catalog.regclass
      AND c.relkind = 'r' AND c.relrowsecurity AND NOT c.relforcerowsecurity
      AND c.relowner = 'postgres'::pg_catalog.regrole
  ) THEN
    RAISE EXCEPTION 'donor_donations must be a postgres-owned RLS table';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_policy AS pol
             WHERE pol.polrelid = 'public.donor_donations'::pg_catalog.regclass) THEN
    RAISE EXCEPTION 'donor_donations must not have client policies';
  END IF;
  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF pg_catalog.has_table_privilege(client_role, 'public.donor_donations',
           'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
       OR pg_catalog.has_any_column_privilege(client_role, 'public.donor_donations',
           'SELECT,INSERT,UPDATE,REFERENCES') THEN
      RAISE EXCEPTION 'Client role % retains direct donor_donations access', client_role;
    END IF;
  END LOOP;
  FOREACH signature IN ARRAY ARRAY[
      'public.donor_next_eligible_date(date)',
      'public.donor_is_eligible(date)',
      'public.bms_local_date()',
      'public.refresh_eligible_donor_availability()',
      'public.apply_donation_ended(uuid,date,text,uuid,text)',
      'public.get_my_donor_eligibility()',
      'public.list_my_donations(integer,integer)',
      'public.admin_correct_donor_donation_date(uuid,date,text)'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc AS p
      WHERE p.oid = pg_catalog.to_regprocedure(signature)
        AND p.proowner = 'postgres'::pg_catalog.regrole
    ) THEN
      RAISE EXCEPTION 'Unexpected owner for %', signature;
    END IF;
  END LOOP;
  FOREACH signature IN ARRAY ARRAY[
      'public.donor_next_eligible_date(date)',
      'public.donor_is_eligible(date)',
      'public.bms_local_date()',
      'public.refresh_eligible_donor_availability()',
      'public.apply_donation_ended(uuid,date,text,uuid,text)'
  ] LOOP
    IF pg_catalog.has_function_privilege('anon', signature, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'Internal helper % must not be executable by clients', signature;
    END IF;
  END LOOP;
  FOREACH signature IN ARRAY ARRAY[
      'public.get_my_donor_eligibility()',
      'public.list_my_donations(integer,integer)',
      'public.admin_correct_donor_donation_date(uuid,date,text)'
  ] LOOP
    IF NOT pg_catalog.has_function_privilege('authenticated', signature, 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', signature, 'EXECUTE')
       OR pg_catalog.has_function_privilege('service_role', signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'Unexpected RPC execution grants for %', signature;
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger AS t
    WHERE t.tgrelid IN ('public.profiles'::pg_catalog.regclass,
                        'public.donor_profiles'::pg_catalog.regclass)
      AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'Unexpected profile trigger; review before deployment';
  END IF;
END;
$effective_permissions$;

