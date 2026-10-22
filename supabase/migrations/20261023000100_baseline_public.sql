-- REVIEW DRAFT ONLY. Not executed or approved for deployment.
-- Target: an initialized, isolated Supabase PostgreSQL 17 environment.
-- Read docs/database-baseline-review.md before any future application.
-- Supabase CLI owns the per-file transaction and migration-history recording.
-- Do not add outer BEGIN/COMMIT or run this file with autocommit.
SET LOCAL search_path = '';
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';



-- Do not impersonate or create managed roles. Abort if prerequisites are absent.
DO $bms_prerequisites$
BEGIN
    IF current_user <> 'postgres' THEN
        RAISE EXCEPTION 'BMS baseline requires current_user postgres for confirmed ownership';
    END IF;
    IF pg_catalog.to_regclass('auth.users') IS NULL
       OR pg_catalog.to_regclass('storage.objects') IS NULL
       OR pg_catalog.to_regclass('storage.buckets') IS NULL
       OR pg_catalog.to_regprocedure('auth.uid()') IS NULL
       OR pg_catalog.to_regprocedure('storage.foldername(text)') IS NULL THEN
        RAISE EXCEPTION 'Initialize the Supabase-managed Auth and Storage services first';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM (VALUES ('anon'), ('authenticated'), ('service_role'), ('supabase_admin')) AS required(role_name)
        WHERE NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_roles AS role_entry
            WHERE role_entry.rolname = required.role_name
        )
    ) THEN
        RAISE EXCEPTION 'Required Supabase roles are missing';
    END IF;
END;
$bms_prerequisites$;


-- Supabase already provides public. Never drop or replace the managed schema.
CREATE SCHEMA IF NOT EXISTS public;
SET LOCAL check_function_bodies = on;

-- Create tables before the PL/pgSQL functions that use them.


CREATE TABLE public.profiles (
    id uuid NOT NULL,
    full_name text NOT NULL,
    phone text NOT NULL,
    role text NOT NULL,
    district text NOT NULL,
    thana text NOT NULL,
    local_area text NOT NULL,
    profile_photo_path text,
    account_status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT profiles_account_status_check CHECK ((account_status = ANY (ARRAY['active'::text, 'suspended'::text, 'deactivated'::text]))),
    CONSTRAINT profiles_role_check CHECK ((role = ANY (ARRAY['donor'::text, 'beneficiary'::text, 'admin'::text, 'super_admin'::text])))
);

CREATE TABLE public.donor_profiles (
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    blood_group text NOT NULL,
    date_of_birth date NOT NULL,
    last_donation_date date,
    verification_status text DEFAULT 'approved'::text,
    verified_by uuid,
    verified_at timestamp with time zone,
    availability_status text DEFAULT 'unavailable'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT donor_availability_status_check CHECK ((availability_status = ANY (ARRAY['available'::text, 'unavailable'::text]))),
    CONSTRAINT donor_blood_group_check CHECK ((blood_group = ANY (ARRAY['A+'::text, 'A-'::text, 'B+'::text, 'B-'::text, 'AB+'::text, 'AB-'::text, 'O+'::text, 'O-'::text]))),
    CONSTRAINT donor_date_of_birth_check CHECK ((date_of_birth < CURRENT_DATE)),
    CONSTRAINT donor_last_donation_date_check CHECK (((last_donation_date IS NULL) OR (last_donation_date <= CURRENT_DATE))),
    CONSTRAINT donor_verification_status_check CHECK ((verification_status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))
);

CREATE TABLE public.beneficiary_profiles (
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.donor_availability_details (
    user_id uuid NOT NULL,
    unavailable_reason text NOT NULL,
    unavailable_since timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT donor_availability_details_unavailable_reason_check CHECK (((char_length(btrim(unavailable_reason)) >= 10) AND (char_length(btrim(unavailable_reason)) <= 500)))
);

CREATE TABLE public.donor_availability_history (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    previous_status text NOT NULL,
    new_status text NOT NULL,
    reason text,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT donor_availability_history_new_status_check CHECK ((new_status = ANY (ARRAY['available'::text, 'unavailable'::text]))),
    CONSTRAINT donor_availability_history_previous_status_check CHECK ((previous_status = ANY (ARRAY['available'::text, 'unavailable'::text])))
);

CREATE TABLE public.donor_availability_reminders (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    reminder_type text DEFAULT 'availability_check'::text NOT NULL,
    sent_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.donor_availability_history ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.donor_availability_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

ALTER TABLE public.donor_availability_reminders ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.donor_availability_reminders_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

ALTER TABLE ONLY public.beneficiary_profiles
    ADD CONSTRAINT beneficiary_profiles_pkey PRIMARY KEY (user_id);

ALTER TABLE ONLY public.donor_availability_details
    ADD CONSTRAINT donor_availability_details_pkey PRIMARY KEY (user_id);

ALTER TABLE ONLY public.donor_availability_history
    ADD CONSTRAINT donor_availability_history_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.donor_availability_reminders
    ADD CONSTRAINT donor_availability_reminders_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.donor_profiles
    ADD CONSTRAINT donor_profiles_pkey PRIMARY KEY (user_id);

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_phone_key UNIQUE (phone);

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.beneficiary_profiles
    ADD CONSTRAINT beneficiary_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.donor_availability_details
    ADD CONSTRAINT donor_availability_details_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.donor_profiles(user_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.donor_availability_history
    ADD CONSTRAINT donor_availability_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.donor_profiles(user_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.donor_availability_reminders
    ADD CONSTRAINT donor_availability_reminders_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.donor_profiles(user_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.donor_profiles
    ADD CONSTRAINT donor_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.donor_profiles
    ADD CONSTRAINT donor_profiles_verified_by_fkey FOREIGN KEY (verified_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.profiles OWNER TO postgres;

ALTER TABLE public.donor_profiles OWNER TO postgres;

ALTER TABLE public.beneficiary_profiles OWNER TO postgres;

ALTER TABLE public.donor_availability_details OWNER TO postgres;

ALTER TABLE public.donor_availability_history OWNER TO postgres;

ALTER TABLE public.donor_availability_reminders OWNER TO postgres;

COMMENT ON SCHEMA public IS 'standard public schema';

COMMENT ON TABLE public.beneficiary_profiles IS 'Beneficiary-specific information';

COMMENT ON TABLE public.donor_profiles IS 'Donor-specific information';

COMMENT ON TABLE public.profiles IS 'Common information for all users';

-- Original function bodies are unchanged. Ownership is confirmed as postgres.

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
DECLARE
  registration_data jsonb;
  selected_role text;
  donor_blood_group text;
  donor_dob date;
  donor_last_date date;
BEGIN

  registration_data :=
    COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);

  selected_role := registration_data ->> 'role';

  -- Only donor and beneficiary public registration

  IF selected_role IS NULL
     OR selected_role NOT IN ('donor', 'beneficiary')
  THEN
    RAISE EXCEPTION 'Invalid registration role';
  END IF;

  -- Validate required information

  IF NULLIF(BTRIM(registration_data ->> 'full_name'), '') IS NULL
     OR NULLIF(BTRIM(registration_data ->> 'phone'), '') IS NULL
     OR NULLIF(BTRIM(registration_data ->> 'district'), '') IS NULL
     OR NULLIF(BTRIM(registration_data ->> 'thana'), '') IS NULL
     OR NULLIF(BTRIM(registration_data ->> 'local_area'), '') IS NULL
  THEN
    RAISE EXCEPTION 'Required registration information is missing';
  END IF;

  -- Validate Bangladesh mobile number

  IF BTRIM(registration_data ->> 'phone')
     !~ '^01[3-9][0-9]{8}$'
  THEN
    RAISE EXCEPTION 'Invalid phone number';
  END IF;

  -- Validate donor-specific data before inserting

  IF selected_role = 'donor' THEN

    donor_blood_group :=
      registration_data ->> 'blood_group';

    IF donor_blood_group IS NULL
       OR donor_blood_group NOT IN (
         'A+', 'A-', 'B+', 'B-',
         'AB+', 'AB-', 'O+', 'O-'
       )
    THEN
      RAISE EXCEPTION 'Invalid blood group';
    END IF;

    donor_dob :=
      (registration_data ->> 'date_of_birth')::date;

    IF donor_dob IS NULL
       OR donor_dob > (
         CURRENT_DATE - INTERVAL '18 years'
       )::date
    THEN
      RAISE EXCEPTION 'Donor must be at least 18 years old';
    END IF;

    donor_last_date :=
      NULLIF(
        registration_data ->> 'last_donation_date',
        ''
      )::date;

    IF donor_last_date > CURRENT_DATE THEN
      RAISE EXCEPTION 'Invalid last donation date';
    END IF;

  END IF;

  -- Common user profile

  INSERT INTO public.profiles (
    id,
    full_name,
    phone,
    role,
    district,
    thana,
    local_area,
    profile_photo_path,
    account_status
  )
  VALUES (
    NEW.id,
    BTRIM(registration_data ->> 'full_name'),
    BTRIM(registration_data ->> 'phone'),
    selected_role,
    BTRIM(registration_data ->> 'district'),
    BTRIM(registration_data ->> 'thana'),
    BTRIM(registration_data ->> 'local_area'),
    NULL,
    'active'
  );

  -- Donor-specific profile

  IF selected_role = 'donor' THEN

    INSERT INTO public.donor_profiles (
      user_id,
      blood_group,
      date_of_birth,
      last_donation_date,
      verification_status,
      availability_status
    )
    VALUES (
      NEW.id,
      donor_blood_group,
      donor_dob,
      donor_last_date,
      'pending',
      'unavailable'
    );

  -- Beneficiary-specific profile

  ELSIF selected_role = 'beneficiary' THEN

    INSERT INTO public.beneficiary_profiles (
      user_id
    )
    VALUES (
      NEW.id
    );

  END IF;

  RETURN NEW;

END;
$_$;

CREATE FUNCTION public.search_available_donors(requested_blood_group text DEFAULT NULL::text, requested_district text DEFAULT NULL::text, requested_thana text DEFAULT NULL::text) RETURNS TABLE(donor_id uuid, full_name text, blood_group text, district text, thana text, local_area text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN

  -- Only authenticated beneficiary accounts
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles AS requester
    WHERE requester.id = (SELECT auth.uid())
      AND requester.role = 'beneficiary'
      AND requester.account_status = 'active'
  ) THEN
    RAISE EXCEPTION
      'Only active beneficiaries can search for donors';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.full_name,
    dp.blood_group,
    p.district,
    p.thana,
    p.local_area
  FROM public.donor_profiles AS dp
  JOIN public.profiles AS p
    ON p.id = dp.user_id
  WHERE p.role = 'donor'
    AND p.account_status = 'active'
    AND dp.verification_status = 'approved'
    AND dp.availability_status = 'available'
    AND (
      requested_blood_group IS NULL
      OR dp.blood_group = requested_blood_group
    )
    AND (
      requested_district IS NULL
      OR p.district ILIKE requested_district
    )
    AND (
      requested_thana IS NULL
      OR p.thana ILIKE requested_thana
    )
  ORDER BY p.full_name
  LIMIT 100;

END;
$$;

CREATE FUNCTION public.set_my_donor_availability(new_status text, reason text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  current_user_id uuid;
  old_status text;
  cleaned_reason text;
BEGIN

  current_user_id := (SELECT auth.uid());

  -- Authentication required

  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Validate requested status

  IF new_status IS NULL
     OR new_status NOT IN ('available', 'unavailable') THEN
    RAISE EXCEPTION 'Invalid availability status';
  END IF;

  -- Check approval and lock donor row

  SELECT dp.availability_status
  INTO old_status
  FROM public.donor_profiles AS dp
  JOIN public.profiles AS p
    ON p.id = dp.user_id
  WHERE dp.user_id = current_user_id
    AND dp.verification_status = 'approved'
    AND p.role = 'donor'
    AND p.account_status = 'active'
  FOR UPDATE OF dp;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Only approved donors with active accounts can change availability';
  END IF;

  IF old_status = new_status THEN
    RAISE EXCEPTION
      'Availability is already set to this status';
  END IF;

  cleaned_reason := NULLIF(BTRIM(reason), '');

  -- Unavailable requires an explanation

  IF new_status = 'unavailable' THEN

    IF cleaned_reason IS NULL
       OR char_length(cleaned_reason) NOT BETWEEN 10 AND 500 THEN
      RAISE EXCEPTION
        'Unavailable reason must contain 10 to 500 characters';
    END IF;

    INSERT INTO public.donor_availability_details (
      user_id,
      unavailable_reason,
      unavailable_since,
      updated_at
    )
    VALUES (
      current_user_id,
      cleaned_reason,
      now(),
      now()
    )
    ON CONFLICT (user_id)
    DO UPDATE SET
      unavailable_reason = EXCLUDED.unavailable_reason,
      unavailable_since = EXCLUDED.unavailable_since,
      updated_at = now();

  ELSE

    -- Clear current unavailable information.
    -- Previous reasons remain in history.

    DELETE FROM public.donor_availability_details
    WHERE user_id = current_user_id;

  END IF;

  -- Update donor availability

  UPDATE public.donor_profiles
  SET
    availability_status = new_status,
    updated_at = now()
  WHERE user_id = current_user_id;

  -- Record availability history

  INSERT INTO public.donor_availability_history (
    user_id,
    previous_status,
    new_status,
    reason
  )
  VALUES (
    current_user_id,
    old_status,
    new_status,
    CASE
      WHEN new_status = 'unavailable'
        THEN cleaned_reason
      ELSE NULL
    END
  );

END;
$$;

CREATE FUNCTION public.update_my_donor_availability(new_status text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  current_user_id uuid;
BEGIN
  current_user_id := (SELECT auth.uid());

  -- Only logged-in users
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Only valid availability values
  IF new_status IS NULL
     OR new_status NOT IN ('available', 'unavailable') THEN
    RAISE EXCEPTION 'Invalid availability status';
  END IF;

  -- Only approved donors with active accounts
  UPDATE public.donor_profiles AS dp
  SET
    availability_status = new_status,
    updated_at = now()
  WHERE dp.user_id = current_user_id
    AND dp.verification_status = 'approved'
    AND EXISTS (
      SELECT 1
      FROM public.profiles AS p
      WHERE p.id = current_user_id
        AND p.role = 'donor'
        AND p.account_status = 'active'
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Only approved donors with active accounts can change availability';
  END IF;
END;
$$;

CREATE FUNCTION public.update_my_profile_photo(new_photo_path text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  current_user_id uuid;
BEGIN

  current_user_id := auth.uid();

  -- Login required
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Only accept the user's own folder and an image filename
  IF new_photo_path IS NULL
     OR new_photo_path NOT IN (
       current_user_id::text || '/profile.jpg',
       current_user_id::text || '/profile.jpeg',
       current_user_id::text || '/profile.png'
     )
  THEN
    RAISE EXCEPTION 'Invalid profile photo path';
  END IF;

  -- Verify that the photo exists in the private bucket
  IF NOT EXISTS (
    SELECT 1
    FROM storage.objects
    WHERE bucket_id = 'profile-photos'
      AND name = new_photo_path
      AND owner_id = current_user_id::text
  ) THEN
    RAISE EXCEPTION 'Profile photo not found or not owned by user';
  END IF;

  -- Only update the current user's photo path
  UPDATE public.profiles
  SET
    profile_photo_path = new_photo_path,
    updated_at = now()
  WHERE id = current_user_id
    AND account_status = 'active';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active profile not found';
  END IF;

END;
$$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;

ALTER FUNCTION public.search_available_donors(text, text, text) OWNER TO postgres;

ALTER FUNCTION public.set_my_donor_availability(text, text) OWNER TO postgres;

ALTER FUNCTION public.update_my_donor_availability(text) OWNER TO postgres;

ALTER FUNCTION public.update_my_profile_photo(text) OWNER TO postgres;

ALTER TABLE public.beneficiary_profiles ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.donor_availability_details ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.donor_availability_history ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.donor_availability_reminders ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.donor_profiles ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Donors can view own donor profile" ON public.donor_profiles FOR SELECT TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "Donors can view own unavailable reason" ON public.donor_availability_details FOR SELECT TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'donor'::text) AND (p.account_status = 'active'::text))))));

CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT TO authenticated USING ((auth.uid() = id));

-- Normalize fresh-target API-role ACLs before restoring the exported ACLs.
-- Otherwise the target's automatic default grants can add rights absent in the source.
-- This preserves the source ACLs for the listed roles; it is not the security fix.
-- Unknown target roles/inheritance require separate review.


REVOKE ALL ON TABLE public.profiles FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON TABLE public.donor_profiles FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON TABLE public.beneficiary_profiles FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON TABLE public.donor_availability_details FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON TABLE public.donor_availability_history FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON TABLE public.donor_availability_reminders FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON SEQUENCE public.donor_availability_history_id_seq FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON SEQUENCE public.donor_availability_reminders_id_seq FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.search_available_donors(text, text, text) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.set_my_donor_availability(text, text) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.update_my_donor_availability(text) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.update_my_profile_photo(text) FROM PUBLIC, anon, authenticated, service_role;

-- WARNING: ORIGINAL UNSAFE PERMISSIONS PRESERVED FOR HISTORICAL FIDELITY.
-- Export grants TRUNCATE to anon/authenticated on profiles, donor_profiles,
-- beneficiary_profiles, and broad defaults for future objects.
-- Apply the separately reviewed security migration before exposing any new target.
-- REFERENCES/TRIGGER/MAINTAIN, broad sequence rights and future function execution
-- are also retained and need a separate least-privilege review.
-- Defaults affect ALL future objects in public for these creators, not only BMS.
-- An incomplete sequence, including a failed security fix, is NOT secure.


GRANT USAGE ON SCHEMA public TO postgres;

GRANT USAGE ON SCHEMA public TO anon;

GRANT USAGE ON SCHEMA public TO authenticated;

GRANT USAGE ON SCHEMA public TO service_role;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;

GRANT ALL ON FUNCTION public.handle_new_user() TO service_role;

REVOKE ALL ON FUNCTION public.search_available_donors(requested_blood_group text, requested_district text, requested_thana text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.search_available_donors(requested_blood_group text, requested_district text, requested_thana text) TO service_role;

GRANT ALL ON FUNCTION public.search_available_donors(requested_blood_group text, requested_district text, requested_thana text) TO authenticated;

REVOKE ALL ON FUNCTION public.set_my_donor_availability(new_status text, reason text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.set_my_donor_availability(new_status text, reason text) TO service_role;

GRANT ALL ON FUNCTION public.set_my_donor_availability(new_status text, reason text) TO authenticated;

REVOKE ALL ON FUNCTION public.update_my_donor_availability(new_status text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.update_my_donor_availability(new_status text) TO service_role;

REVOKE ALL ON FUNCTION public.update_my_profile_photo(new_photo_path text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.update_my_profile_photo(new_photo_path text) TO authenticated;

GRANT ALL ON FUNCTION public.update_my_profile_photo(new_photo_path text) TO service_role;

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.beneficiary_profiles TO anon;

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.beneficiary_profiles TO authenticated;

GRANT ALL ON TABLE public.beneficiary_profiles TO service_role;

GRANT ALL ON TABLE public.donor_availability_details TO service_role;

GRANT SELECT ON TABLE public.donor_availability_details TO authenticated;

GRANT ALL ON TABLE public.donor_availability_history TO service_role;

GRANT ALL ON SEQUENCE public.donor_availability_history_id_seq TO anon;

GRANT ALL ON SEQUENCE public.donor_availability_history_id_seq TO authenticated;

GRANT ALL ON SEQUENCE public.donor_availability_history_id_seq TO service_role;

GRANT ALL ON TABLE public.donor_availability_reminders TO service_role;

GRANT ALL ON SEQUENCE public.donor_availability_reminders_id_seq TO anon;

GRANT ALL ON SEQUENCE public.donor_availability_reminders_id_seq TO authenticated;

GRANT ALL ON SEQUENCE public.donor_availability_reminders_id_seq TO service_role;

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.donor_profiles TO anon;

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.donor_profiles TO authenticated;

GRANT ALL ON TABLE public.donor_profiles TO service_role;

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.profiles TO anon;

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.profiles TO authenticated;

GRANT ALL ON TABLE public.profiles TO service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;
