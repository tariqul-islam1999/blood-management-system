-- BMS P4.1 — Donation workflow schema (first P4 migration).
-- Scope: exactly three tables (donation_engagements, donation_status_events,
-- donation_followup_responses) with constraints, indexes, RLS and privilege protections.
-- This file contains NO RPCs, functions, triggers, Realtime policies, notifications,
-- notification tables, EXECUTE grants or application code.
-- Run as one migration-runner transaction with stop-on-error; never with autocommit.
-- Requires the eligibility migration (20261027000100) and M7 (20261028000100) first.
-- This migration adds new objects only; it never rewrites existing BMS records.
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
                WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname = x.role_name)) THEN
    RAISE EXCEPTION 'Supabase Auth and API roles are required';
  END IF;
  FOREACH relation_name IN ARRAY ARRAY['profiles','donor_profiles','beneficiary_profiles','blood_requests','blood_request_interests','donor_donations'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c
                   WHERE c.oid = pg_catalog.to_regclass('public.' || relation_name)
                     AND c.relkind = 'r' AND c.relrowsecurity AND NOT c.relforcerowsecurity
                     AND c.relowner = 'postgres'::pg_catalog.regrole) THEN
      RAISE EXCEPTION 'Missing, unexpected owner, or RLS-disabled prerequisite table: %', relation_name;
    END IF;
  END LOOP;
  IF pg_catalog.to_regprocedure('public.donor_is_eligible(date)') IS NULL
     OR pg_catalog.to_regprocedure('public.refresh_eligible_donor_availability()') IS NULL THEN
    RAISE EXCEPTION 'Apply the donor eligibility migration 20261027000100 before P4.1';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public'
               AND c.relname IN ('donation_engagements','donation_status_events','donation_followup_responses',
                                 'donation_engagements_pkey','donation_engagements_request_id_key',
                                 'donation_engagements_donor_active_idx','donation_engagements_beneficiary_idx',
                                 'donation_engagements_donor_idx','donation_status_events_pkey',
                                 'donation_status_events_engagement_idx','donation_followup_responses_pkey',
                                 'donation_followup_responses_engagement_key')) THEN
    RAISE EXCEPTION 'P4.1 objects already exist; review schema drift instead of replacing objects';
  END IF;
END;
$preflight$;

-- ---------------------------------------------------------------------------
-- Table 1: public.donation_engagements
-- The lifecycle aggregate for one accepted request + donor.
-- beneficiary_id is copied from blood_requests.beneficiary_id by the later accept RPC.
-- ---------------------------------------------------------------------------
CREATE TABLE public.donation_engagements (
    id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
    request_id uuid NOT NULL REFERENCES public.blood_requests(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
    donor_id uuid NOT NULL REFERENCES public.donor_profiles(user_id) ON DELETE RESTRICT ON UPDATE NO ACTION,
    beneficiary_id uuid NOT NULL REFERENCES public.beneficiary_profiles(user_id) ON DELETE RESTRICT ON UPDATE NO ACTION,
    status text NOT NULL DEFAULT 'selected',
    selected_at timestamp with time zone NOT NULL DEFAULT pg_catalog.clock_timestamp(),
    reached_location_at timestamp with time zone,
    donation_started_at timestamp with time zone,
    donation_ended_at timestamp with time zone,
    reached_home_safely_at timestamp with time zone,
    feeling text,
    follow_up_due_at timestamp with time zone,
    follow_up_submitted_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT pg_catalog.clock_timestamp(),
    updated_at timestamp with time zone NOT NULL DEFAULT pg_catalog.clock_timestamp(),
    CONSTRAINT donation_engagements_status_check
        CHECK (status IN ('selected','reached_location','donation_started','donation_ended','reached_home_safely')),
    CONSTRAINT donation_engagements_feeling_check
        CHECK (feeling IS NULL OR feeling IN ('ok','so_so','not_well')),
    CONSTRAINT donation_engagements_reached_location_presence_check
        CHECK ((reached_location_at IS NOT NULL) = (status IN ('reached_location','donation_started','donation_ended','reached_home_safely'))),
    CONSTRAINT donation_engagements_donation_started_presence_check
        CHECK ((donation_started_at IS NOT NULL) = (status IN ('donation_started','donation_ended','reached_home_safely'))),
    CONSTRAINT donation_engagements_donation_ended_presence_check
        CHECK ((donation_ended_at IS NOT NULL) = (status IN ('donation_ended','reached_home_safely'))),
    CONSTRAINT donation_engagements_reached_home_safely_presence_check
        CHECK ((reached_home_safely_at IS NOT NULL) = (status = 'reached_home_safely')),
    CONSTRAINT donation_engagements_feeling_presence_check
        CHECK ((feeling IS NOT NULL) = (status = 'reached_home_safely')),
    CONSTRAINT donation_engagements_follow_up_due_check
        CHECK ((follow_up_due_at IS NOT NULL) = (status = 'reached_home_safely')
               AND (follow_up_due_at IS NULL OR follow_up_due_at = reached_home_safely_at + interval '48 hours')),
    CONSTRAINT donation_engagements_follow_up_submitted_check
        CHECK (follow_up_submitted_at IS NULL OR status = 'reached_home_safely'),
    CONSTRAINT donation_engagements_timestamp_order_check
        CHECK ((reached_location_at IS NULL OR selected_at <= reached_location_at)
               AND (donation_started_at IS NULL OR reached_location_at <= donation_started_at)
               AND (donation_ended_at IS NULL OR donation_started_at <= donation_ended_at)
               AND (reached_home_safely_at IS NULL OR donation_ended_at <= reached_home_safely_at)),
    CONSTRAINT donation_engagements_request_id_key UNIQUE (request_id)
);
ALTER TABLE public.donation_engagements OWNER TO postgres;
ALTER TABLE public.donation_engagements ENABLE ROW LEVEL SECURITY;

-- One active engagement per donor; a donor may accumulate completed (reached_home_safely) rows.
CREATE UNIQUE INDEX donation_engagements_donor_active_idx
    ON public.donation_engagements (donor_id)
    WHERE status <> 'reached_home_safely';
CREATE INDEX donation_engagements_beneficiary_idx
    ON public.donation_engagements (beneficiary_id, updated_at DESC, id);
CREATE INDEX donation_engagements_donor_idx
    ON public.donation_engagements (donor_id, updated_at DESC, id);


-- ---------------------------------------------------------------------------
-- Table 2: public.donation_status_events
-- Append-only lifecycle audit. Donor-only actor model (no Admin/Super-Admin/system actor yet).
-- The later transition RPC verifies actor_id = engagement.donor_id.
-- ---------------------------------------------------------------------------
CREATE TABLE public.donation_status_events (
    id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
    engagement_id uuid NOT NULL REFERENCES public.donation_engagements(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
    from_status text,
    to_status text NOT NULL,
    actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
    actor_role text NOT NULL,
    occurred_at timestamp with time zone NOT NULL DEFAULT pg_catalog.clock_timestamp(),
    note text,
    CONSTRAINT donation_status_events_from_status_check
        CHECK (from_status IS NULL OR from_status IN ('selected','reached_location','donation_started','donation_ended','reached_home_safely')),
    CONSTRAINT donation_status_events_to_status_check
        CHECK (to_status IN ('selected','reached_location','donation_started','donation_ended','reached_home_safely')),
    CONSTRAINT donation_status_events_actor_role_check
        CHECK (actor_role = 'donor'),
    CONSTRAINT donation_status_events_transition_check
        CHECK ((from_status IS NULL AND to_status = 'selected')
               OR (from_status IS NOT NULL AND from_status <> to_status))
);
ALTER TABLE public.donation_status_events OWNER TO postgres;
ALTER TABLE public.donation_status_events ENABLE ROW LEVEL SECURITY;

CREATE INDEX donation_status_events_engagement_idx
    ON public.donation_status_events (engagement_id, occurred_at, id);

-- ---------------------------------------------------------------------------
-- Table 3: public.donation_followup_responses
-- One response per engagement. No submitted_by column: the donor is derived via the
-- engagement (donation_engagements.donor_id). Questionnaire answers are general wellbeing
-- fields, not a medical record. additional_comments is optional (max 500 characters).
-- ---------------------------------------------------------------------------
CREATE TABLE public.donation_followup_responses (
    id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
    engagement_id uuid NOT NULL REFERENCES public.donation_engagements(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
    physical_condition text NOT NULL,
    health_changes text NOT NULL,
    compared_to_after text NOT NULL,
    current_discomfort text NOT NULL,
    consulted_professional text NOT NULL,
    additional_comments text,
    submitted_at timestamp with time zone NOT NULL DEFAULT pg_catalog.clock_timestamp(),
    CONSTRAINT donation_followup_responses_engagement_key UNIQUE (engagement_id),
    CONSTRAINT donation_followup_responses_physical_condition_check
        CHECK (physical_condition IN ('good','moderate','not_well')),
    CONSTRAINT donation_followup_responses_health_changes_check
        CHECK (health_changes IN ('no_problems','yes','not_sure')),
    CONSTRAINT donation_followup_responses_compared_to_after_check
        CHECK (compared_to_after IN ('yes','same','worse')),
    CONSTRAINT donation_followup_responses_current_discomfort_check
        CHECK (current_discomfort IN ('no','yes','prefer_not_to_say')),
    CONSTRAINT donation_followup_responses_consulted_professional_check
        CHECK (consulted_professional IN ('yes','not_yet','not_needed')),
    CONSTRAINT donation_followup_responses_additional_comments_check
        CHECK (additional_comments IS NULL OR pg_catalog.char_length(additional_comments) <= 500)
);
ALTER TABLE public.donation_followup_responses OWNER TO postgres;
ALTER TABLE public.donation_followup_responses ENABLE ROW LEVEL SECURITY;


-- ---------------------------------------------------------------------------
-- Access model: RLS enabled, no policies, no direct client/service grants.
-- All access is via later SECURITY DEFINER RPCs (not part of this migration).
-- ---------------------------------------------------------------------------
REVOKE ALL ON TABLE public.donation_engagements, public.donation_status_events, public.donation_followup_responses
    FROM PUBLIC, anon, authenticated, service_role;

-- Fail closed on accidental drift. Scoped to ONLY the three new P4.1 tables so that the
-- legitimate baseline SELECT grants on profiles/donor_profiles/beneficiary_profiles are
-- not rejected.
DO $effective_permissions$
DECLARE
  client_role text;
  reachable record;
  relation_name text;
  relation_oid oid;
  public_privilege record;
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    FOR reachable IN SELECT r.oid, r.rolsuper, r.rolbypassrls, r.rolcreaterole
                     FROM pg_catalog.pg_roles r
                     WHERE pg_catalog.pg_has_role(client_role, r.oid, 'USAGE')
                        OR pg_catalog.pg_has_role(client_role, r.oid, 'SET') LOOP
      IF reachable.rolsuper OR reachable.rolbypassrls OR reachable.rolcreaterole THEN
        RAISE EXCEPTION 'Client can reach a privileged database role';
      END IF;
      FOREACH relation_name IN ARRAY ARRAY['donation_engagements','donation_status_events','donation_followup_responses'] LOOP
        IF pg_catalog.has_table_privilege(reachable.oid, 'public.' || relation_name,
             'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
           OR pg_catalog.has_any_column_privilege(reachable.oid, 'public.' || relation_name,
             'SELECT,INSERT,UPDATE,REFERENCES') THEN
          RAISE EXCEPTION 'Client retains direct donation workflow access on %', relation_name;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  FOREACH relation_name IN ARRAY ARRAY['donation_engagements','donation_status_events','donation_followup_responses'] LOOP
    relation_oid := pg_catalog.to_regclass('public.' || relation_name);
    -- service_role must hold no table-level and no column-level privilege on the new tables.
    IF pg_catalog.has_table_privilege('service_role', 'public.' || relation_name,
         'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
       OR pg_catalog.has_any_column_privilege('service_role', 'public.' || relation_name,
         'SELECT,INSERT,UPDATE,REFERENCES') THEN
      RAISE EXCEPTION 'service_role retains direct donation workflow access on %', relation_name;
    END IF;
    -- PUBLIC is a pseudo-role (oid 0) with no pg_roles row, so has_*_privilege cannot test it.
    -- Inspect the expanded relation ACL directly; grantee = 0 means PUBLIC.
    FOR public_privilege IN
      SELECT acl.privilege_type
      FROM pg_catalog.aclexplode(
             COALESCE(
               (SELECT c.relacl FROM pg_catalog.pg_class c WHERE c.oid = relation_oid),
               pg_catalog.acldefault('r', (SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = relation_oid))
             )
           ) AS acl
      WHERE acl.grantee = 0
    LOOP
      RAISE EXCEPTION 'PUBLIC retains % privilege on %', public_privilege.privilege_type, relation_name;
    END LOOP;
  END LOOP;
END;
$effective_permissions$;

