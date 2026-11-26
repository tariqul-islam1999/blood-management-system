-- BMS Phase 3 — Donor donation history read RPC.
--
-- REVIEW DRAFT ONLY. NOT APPLIED. Do not run this file; the owner executes
-- approved SQL manually in the verified BMS-Development SQL Editor.
--
-- Requires: 20261027000100 (donor_donations, list_my_donations),
--           20261028000100 (blood_requests),
--           20261029000100 (donation_engagements).
--
-- Scope: exactly ONE new read-only function plus its grants. This migration
--   * adds no table, column, constraint, index, trigger or policy,
--   * does not modify donor_donations, apply_donation_ended, donor_end_donation
--     or any other P4 / eligibility object,
--   * does not touch the four-month eligibility rule, availability, RLS or the
--     existing lifecycle transitions.
--
-- Why a separate RPC instead of changing list_my_donations:
--   * list_my_donations cannot return a total count, and adding an output column
--     would change its RETURNS TABLE shape (and therefore its identity).
--   * The donor dashboard needs (a) the exact total completed donations and
--     (b) a location per entry. Both are additive reads, so a new function keeps
--     the existing contract unchanged.
--
-- Data source of truth (no duplication):
--   * completed donations  -> public.donor_donations rows
--                             (written only by apply_donation_ended)
--   * total count          -> count(*) of the caller's own rows
--   * donation location    -> donation_engagements -> blood_requests
--                             (district / thana / local_area)
--
-- Location linking note (read-only inference, no schema change):
--   donor_donations has no engagement_id, so the location is resolved by
--   matching the caller's engagements on donor + the Bangladesh calendar date
--   of donation_ended_at.
--
--   IMPORTANT — that match is NOT guaranteed to be unique. The 4-calendar-month
--   rule lives in apply_donation_ended and guards donor_donations, not the
--   engagement table, and donation_engagements_donor_active_idx is a PARTIAL
--   index (WHERE status <> 'reached_home_safely'), so it constrains only ACTIVE
--   engagements. A donor may therefore hold several completed
--   (reached_home_safely) engagements, and an admin date correction can move a
--   history row onto a date that already has a different engagement.
--
--   The location is therefore returned ONLY when exactly one completed
--   engagement matches the donor and date. Zero matches or multiple matches both
--   return NULL locations, so an ambiguous row shows no location instead of a
--   guess. In every case the donor_donations row is still listed and still
--   counted; nothing is dropped.
SET LOCAL search_path = '';
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL check_function_bodies = on;

DO $preflight$
BEGIN
    IF current_user <> 'postgres'
       OR pg_catalog.current_setting('server_version_num')::integer / 10000 <> 17 THEN
        RAISE EXCEPTION 'Requires PostgreSQL 17 and current_user postgres';
    END IF;

    IF pg_catalog.to_regclass('public.donor_donations') IS NULL
       OR pg_catalog.to_regclass('public.donation_engagements') IS NULL
       OR pg_catalog.to_regclass('public.blood_requests') IS NULL
       OR pg_catalog.to_regclass('public.profiles') IS NULL THEN
        RAISE EXCEPTION 'Apply 20261027000100, 20261028000100 and 20261029000100 first';
    END IF;

    -- Prerequisites must be the reviewed, grant-free tables.
    IF EXISTS (
        SELECT 1 FROM (VALUES ('donor_donations'), ('donation_engagements'), ('blood_requests')) AS t(name)
        WHERE NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_class c
            WHERE c.oid = pg_catalog.to_regclass('public.' || t.name)
              AND c.relkind = 'r' AND c.relrowsecurity AND NOT c.relforcerowsecurity
              AND c.relowner = 'postgres'::pg_catalog.regrole
        )
    ) THEN
        RAISE EXCEPTION 'Missing, unexpected owner, or RLS-disabled prerequisite table';
    END IF;

    IF pg_catalog.to_regprocedure('public.list_my_donations(integer,integer)') IS NULL THEN
        RAISE EXCEPTION 'Apply the donor eligibility migration 20261027000100 first';
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'donor_list_donation_history'
    ) THEN
        RAISE EXCEPTION 'donor_list_donation_history already exists; review schema drift instead of replacing objects';
    END IF;
END;
$preflight$;

-- ---------------------------------------------------------------------------
-- Donor read RPC: own completed donations + location + exact total.
-- The caller is always auth.uid(); there is no donor-id parameter, so a donor
-- cannot request another donor's history.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.donor_list_donation_history(
    p_page_size integer DEFAULT 20,
    p_page_offset integer DEFAULT 0)
RETURNS TABLE (donation_id uuid, donated_on date, note text, source text,
               recorded_at timestamp with time zone,
               location_district text, location_thana text, location_local_area text,
               total_count integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = ''
    SET lock_timeout = '5s'
    AS $history$
DECLARE
    actor_id uuid := auth.uid();
    history_total integer;
BEGIN
    -- Same authorization rule as list_my_donations / get_my_donor_eligibility.
    IF NOT EXISTS (SELECT 1 FROM public.profiles AS p
                   WHERE p.id = actor_id AND p.role = 'donor' AND p.account_status = 'active') THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Active donor account required';
    END IF;
    IF p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 50
       OR p_page_offset IS NULL OR p_page_offset NOT BETWEEN 0 AND 100000 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid pagination';
    END IF;

    -- Exact total, independent of the requested page, so an empty page still
    -- reports the true number of completed donations.
    SELECT pg_catalog.count(*)::integer INTO history_total
    FROM public.donor_donations AS dn
    WHERE dn.donor_id = actor_id;

    RETURN QUERY
    SELECT dn.id, dn.donated_on, dn.note, dn.source, dn.recorded_at,
           location.district, location.thana, location.local_area,
           history_total
    FROM public.donor_donations AS dn
    LEFT JOIN LATERAL (
        -- Read-only location lookup through the existing relationship.
        -- The location is emitted ONLY when exactly one completed engagement
        -- matches this donor and Bangladesh calendar date. The window count is
        -- taken over ALL matching engagements, so filtering match_count = 1
        -- yields either zero rows or exactly one row: the LEFT JOIN then either
        -- supplies that single location or NULLs, and the donor_donations row is
        -- never duplicated or dropped.
        SELECT m.district, m.thana, m.local_area
        FROM (
            SELECT r.district, r.thana, r.local_area,
                   pg_catalog.count(*) OVER () AS match_count
            FROM public.donation_engagements AS e
            JOIN public.blood_requests AS r ON r.id = e.request_id
            WHERE e.donor_id = dn.donor_id
              AND e.status IN ('donation_ended', 'reached_home_safely')
              AND e.donation_ended_at IS NOT NULL
              AND (e.donation_ended_at AT TIME ZONE 'Asia/Dhaka')::date = dn.donated_on
        ) AS m
        WHERE m.match_count = 1
    ) AS location ON true
    WHERE dn.donor_id = actor_id
    ORDER BY dn.donated_on DESC, dn.id DESC
    LIMIT p_page_size OFFSET p_page_offset;
END;
$history$;

ALTER FUNCTION public.donor_list_donation_history(integer, integer) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.donor_list_donation_history(integer, integer)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.donor_list_donation_history(integer, integer) TO authenticated;

-- Fail closed on accidental grant drift, mirroring the existing RPC guards.
DO $guards$
BEGIN
    IF pg_catalog.has_function_privilege('anon',
           'public.donor_list_donation_history(integer,integer)', 'EXECUTE')
       OR pg_catalog.has_function_privilege('service_role',
           'public.donor_list_donation_history(integer,integer)', 'EXECUTE') THEN
        RAISE EXCEPTION 'anon or service_role can execute donor_list_donation_history';
    END IF;
    IF NOT pg_catalog.has_function_privilege('authenticated',
           'public.donor_list_donation_history(integer,integer)', 'EXECUTE') THEN
        RAISE EXCEPTION 'authenticated cannot execute donor_list_donation_history';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc p
        CROSS JOIN LATERAL pg_catalog.aclexplode(
            COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS a
        WHERE p.oid = pg_catalog.to_regprocedure('public.donor_list_donation_history(integer,integer)')
          AND (a.grantee NOT IN (p.proowner, 'authenticated'::pg_catalog.regrole)
               OR (a.grantee = 'authenticated'::pg_catalog.regrole AND a.is_grantable))
    ) THEN
        RAISE EXCEPTION 'Unexpected execution grants on donor_list_donation_history';
    END IF;
END;
$guards$;
