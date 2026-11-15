# P4 Complete Donation Workflow — Technical Design

Status: **Technical design draft for project-owner review.** Documentation only. No code,
SQL, migration, database, Supabase, feature-flag, or Git change accompanies this document.

Prepared: 2026-11-12.
Repository baseline: commit `2f69ff2b849e127288f42b71babbf1056ae8903a` (inspected read-only).

> **Status update — 2026-11-15.** The P4.1 schema migration
> (`supabase/migrations/20261029000100_p4_donation_schema.sql`) has now been **manually applied in
> BMS-Development** (`zbgqpqafvcxaoxxcuyxn`) through the SQL Editor and verified (see §12.3). The
> three tables exist (owner `postgres`, RLS enabled, not forced), all nine expected indexes exist,
> and the `anon`/`authenticated`/`service_role`/PUBLIC permission check returned
> `Success. No rows returned`. **CLI migration history is UNRECORDED / NOT VERIFIED** — a manual
> apply does not prove a `supabase_migrations.schema_migrations` row exists, so history reconciliation
> needs separate approval. Structural tests (P4.7) are **not** complete. Build order is unchanged:
> **P4.1 → P4.7 → P4.2**.

> **Limitation — missing source documents.** The approved **Project Proposal** and **SRS**
> are **not present in the repository** (verified by filename and content search across
> `PROJECT_CONTEXT.md`, `docs/`, and the tree). Where an approved repo document exists it
> is cited; where it does not, the item is a **project-owner confirmation (B)** or a
> **recommendation awaiting approval (C)**. Nothing is invented.

---

## 1. Purpose and scope

This document turns the confirmed P4 Complete Donation Workflow requirements
(`docs/donation-workflow.md` Revision 2; `PROJECT_CONTEXT.md` "Donation Workflow (P4)
Decisions — 2026-11-12") into a concrete technical design against the **current
repository implementation**.

It covers: database model; status transitions; active-donation vs. four-month eligibility;
live beneficiary status; two-day follow-up; notification architecture (proposal); security
and audit; and an ordered implementation plan.

It does **not** implement anything and does **not** authorise implementation.

### 1.1 Requirement classification legend

| Tag | Meaning |
|---|---|
| **A — Existing implementation** | Already present in the repository (verified read-only). |
| **B — Confirmed requirement** | Owner-confirmed P4 rule (from `docs/donation-workflow.md` / `PROJECT_CONTEXT.md`). |
| **C — Recommended design** | Technical recommendation requiring owner approval. |
| **D — Unresolved decision** | Genuinely undecided; recorded without an invented answer. |

### 1.2 Confirmed requirements to preserve (B)

Lifecycle: `SELECTED → REACHED_LOCATION → DONATION_STARTED → DONATION_ENDED → REACHED_HOME_SAFELY`

- Donor accepts/selects a matching beneficiary request (no separate beneficiary step).
- Beneficiary sees the donor's identity **only after** that donor accepts the request.
- `DONATION_ENDED` = the blood donation itself is complete; updates last donation date and
  starts the four-month eligibility cooldown.
- One-active-donation restriction **remains active until `REACHED_HOME_SAFELY`**.
- `REACHED_HOME_SAFELY` = full cycle complete; **releases** the active-donation restriction
  and **starts the two-day follow-up timer**.
- The associated beneficiary sees donor status updates **live / in real time**.
- The beneficiary who received blood can view the donor's submitted follow-up responses.
- Admin access follows approved documentation.
- Feeling at `REACHED_HOME_SAFELY`: **OK / So-so / Not well**.
- Follow-up questionnaire wording and notification architecture remain **proposals (C)**.
- **No GPS/location tracking.**

### 1.3 Owner-approved decisions (2026-11-12)

The project owner approved the P4 recommendations on 2026-11-12; later decisions D-11–D-13
added the first-migration schema scope, the status-event actor model, and timestamp
maintenance. These are **approved decisions (B)**, not open questions. Implementation, the
Realtime project setting, and the future migration still require separate implementation
authorization.

- **D-6 (concurrency): Option 2 selected.** Preserve the existing `blood_requests.status`
  contract (`open`/`cancelled`); do **not** modify the M7 CHECK. Identify accepted requests
  via `donation_engagements`; enforce `UNIQUE (request_id)`; exclude accepted requests from
  the donor open-request listing; a second donor gets a safe controlled rejection. Option 1
  (changing the CHECK) is **not** selected.
- **D-4 (live status): Supabase Private Broadcast approved.** Private channels; disable
  public channel access in Realtime settings; database-originated broadcast for status changes
  (no unnecessary client publish privileges); `realtime.messages` policies restrict access to
  the exact associated donor, beneficiary, and authorized Admin/Super Admin via an
  authorization helper validating the engagement and `auth.uid()`; keep application tables
  RPC-only/grant-free; load initial status via an authorized RPC; re-fetch after reconnect;
  handle duplicate/out-of-order events; document the JWT/policy-cache revocation limitation.
- **D-1 (follow-up timer): elapsed 48 hours** from `REACHED_HOME_SAFELY`; store an
  authoritative due timestamp (reached home 15:00 on 12 Nov → due 15:00 on 14 Nov).
- **D-2 (questionnaire): approved wording** (Section 8.4) — general wellbeing questions, not
  diagnosis or treatment advice.
- **D-8: feeling and follow-up are separate submissions** — never merged into one record.
- **D-3 (notifications): approved architecture** — Expo Push, secure token storage, Supabase
  Edge Functions, scheduled server-side job, DB outbox/records, retry/failure/dedup; the
  approved event categories in Section 9.2.
- **D-5 / D-10 (admin visibility): approved capability** — Admin and Super Admin may view
  donation details and follow-up evaluation per their administrative role; do not expose donor
  private contact information unnecessarily; record administrative reads in the audit design.
  This is **not** an unresolved capability.
- **D-7 / D-9 (storage/audit): approved** — one follow-up response per engagement; store
  `follow_up_due_at` and the submission timestamp; append-only status event history; keep the
  reached-home feeling separate from the follow-up response; preserve the original submitted
  response for audit; maintain the donor–beneficiary relationship via the engagement record.
- **Implementation defaults (R-1, approved):** internal status identifiers use **snake_case**
  (`selected, reached_location, donation_started, donation_ended, reached_home_safely`); the
  follow-up "due" state is **computed** from `follow_up_due_at` + the submission timestamp; the
  submission timestamp determines whether the follow-up was submitted; and **no separate
  `HEALTH_FOLLOW_UP_DUE` status is stored** unless a later approved design requires it.
- **D-11 (P4.1 schema scope): approved.** The first migration contains exactly the three core
  tables — `donation_engagements`, `donation_status_events`, `donation_followup_responses` — with
  constraints, indexes, RLS and privilege protections. **No `interest_id` column**; **no
  `submitted_by` column**; **both** follow-up submission timestamps retained
  (`donation_engagements.follow_up_submitted_at` and `donation_followup_responses.submitted_at`);
  `additional_comments` optional, max **500** characters; **all** P4 historical foreign keys
  `ON DELETE RESTRICT`; `UNIQUE (request_id)`; one active engagement per donor via a partial
  unique index (`status <> 'reached_home_safely'`); lifecycle timestamps are **mandatorily
  non-decreasing** (`selected_at ≤ reached_location_at ≤ donation_started_at ≤ donation_ended_at ≤
  reached_home_safely_at`) and consistent with `status`, enforced by row-level `CHECK` constraints.
- **D-12 (status-event actor): approved.** `donation_status_events.actor_role` is **NOT NULL** and
  **donor-only**; `actor_id` is **NOT NULL**; **no** Admin, Super Admin or system actor in the
  initial schema. The later transition RPC must verify `actor_id = engagement.donor_id`.
- **D-13 (timestamp / follow-up maintenance): approved.** `updated_at` is maintained explicitly by
  later RPCs — **no** automatic trigger in P4.1. The follow-up submission RPC **rejects submission
  before `follow_up_due_at`** and inserts the response **and** sets `follow_up_submitted_at`
  **atomically using the same authoritative timestamp**.

---

## 2. Source documents and references

| Source | Used for |
|---|---|
| `docs/donation-workflow.md` (Revision 2) | P4 requirements, lifecycle, visibility, follow-up, proposals |
| `PROJECT_CONTEXT.md` — "Donation Workflow (P4) Decisions — 2026-11-12"; "Privacy Rules"; "Blood Request Decisions"; "Current Database Status" | Confirmed decisions, privacy scoping, DB state |
| `docs/blood-request-management.md` (§"Donation Ended integration point") | The prescribed atomic completion contract |
| `docs/donor-donation-eligibility.md` (§"Approved decisions", "Objects", "Security model", "Ordering") | Eligibility rules, objects, security model |
| `supabase/migrations/20261027000100_donor_donation_eligibility.sql` | `donor_donations`, `apply_donation_ended`, helpers, eligibility RPCs |
| `supabase/migrations/20261028000100_blood_request_management.sql` | `blood_requests`, `blood_request_interests`, M7 RPCs, preflight/ACL pattern |
| `supabase/migrations/20261023000400_admin_donor_verification.sql`; `20261026000100_super_admin_management.sql` | Admin/super-admin role-check pattern, audit tables |
| `supabase/config.toml` | `[realtime] enabled = true` (no BMS table in a publication) |
| `package.json` | Dependencies (no `expo-notifications`; `@supabase/supabase-js ^2.118.0`) |
| `src/lib/*.ts`, `src/app/*.tsx`, `supabase/tests/database/*` | Existing services, screens, pgTAP conventions |

Reference line numbers used later are as observed at the baseline commit; re-verify before implementation.

**Missing source documents (limitation):** the approved Project Proposal and SRS. Any
requirement not traceable to a repo document above is labelled **B** or **C**.

---

## 3. Current implementation findings (A — verified read-only)

### 3.1 Existing objects relevant to P4

| Object | Kind | Notes |
|---|---|---|
| `public.blood_requests` | table | `id, beneficiary_id, blood_group, district, thana, local_area, units_requested, urgency, needed_by, status, created_at, updated_at, cancelled_at`. `status CHECK (status IN ('open','cancelled'))`. RLS enabled, **no policies**, no client grants. |
| `public.blood_request_interests` | table | `id, request_id, donor_id, expressed_at`. **No status column.** `UNIQUE (request_id, donor_id)`. RLS enabled, no policies, no client grants. |
| `public.donor_profiles` | table | `user_id` unique, `blood_group`, `verification_status`, `availability_status`, `last_donation_date`. |
| `public.beneficiary_profiles` | table | `user_id` unique. |
| `public.profiles` | table | `id, role ('donor'|'beneficiary'|'admin'|'super_admin'), account_status ('active'|'suspended'|'deactivated'), district, thana, local_area, ...`. |
| `public.donor_donations` | table | History: `id, donor_id, donated_on, note, source ('donor'|'admin'), recorded_by, recorded_at`, `UNIQUE (donor_id, donated_on)`. No client grants/policies. |
| `public.donor_availability_details` / `_history` / `_reminders` | tables | Availability state and history. |
| `public.donor_verification_history`, `public.admin_access_history` | tables | Existing audit tables. |
| `public.apply_donation_ended(uuid,date,text,uuid,text)` | fn (owner-only) | Single writer of donation history + `last_donation_date` + forced unavailability + availability history. **No client EXECUTE.** |
| `donor_is_eligible(date)`, `donor_next_eligible_date(date)`, `bms_local_date()`, `refresh_eligible_donor_availability()` | fns (owner-only) | Eligibility computation (4 calendar months; Dhaka calendar day). |
| `get_my_donor_eligibility()`, `list_my_donations(int,int)`, `admin_correct_donor_donation_date(uuid,date,text)` | RPCs (`authenticated`) | Eligibility/history read + admin correction. |
| M7 RPCs: `beneficiary_create_blood_request`, `beneficiary_list_my_blood_requests`, `beneficiary_cancel_blood_request`, `donor_list_open_blood_requests`, `donor_express_interest` | RPCs (`authenticated`) | Request/interest flow. |
| `admin_list_pending_donors`, `admin_review_donor`; `super_admin_list_admins` + 3 more | RPCs | M5 verification; M6 super-admin. |

### 3.2 Established security/ACL convention (A)

New objects follow the M7 / eligibility pattern (`docs/donor-donation-eligibility.md:84-91`;
`blood_request_management.sql:206-238`):

- `postgres`-owned; RLS **enabled**, **no RLS policies**; **no direct table/column grants**
  to `anon`/`authenticated`/`service_role`.
- All access through `SECURITY DEFINER` RPCs with `SET search_path=''`, fully qualified
  names, `SET lock_timeout='5s'`, and fail-closed preflights/permission guards.
- EXECUTE to `authenticated` only (never `anon`), verified by an `aclexplode`-based guard.

### 3.3 Findings that constrain the design

1. **No status machine / engagement table.** `blood_request_interests` has no status column;
   nothing holds `SELECTED…REACHED_HOME_SAFELY`.
2. **No client table grants anywhere.** Critical for the live-status decision (Section 7):
   Realtime *Postgres Changes* requires a client `SELECT` grant + RLS policy, which the
   project currently deliberately avoids.
3. **Realtime available but unused.** `supabase/config.toml` has `[realtime] enabled = true`,
   but **no migration adds any BMS table to the `supabase_realtime` publication**, and no
   source file references Realtime/channels.
4. **No notification dependency.** `expo-notifications` is **not** in `package.json`.
5. **Admin pattern (A).** Admin/super-admin RPCs check
   `profiles.role IN ('admin','super_admin') AND account_status='active'`
   (`admin_donor_verification.sql:125,172`; `donor_donation_eligibility.sql:384`).
6. **`blood_requests.status` allows only `('open','cancelled')`.** Acceptance must remove a
   request from the donor open list (`donor_list_open_blood_requests` filters `status='open'`).
   **Owner decision D-6 (Option 2, approved):** keep this constraint unchanged and exclude
   accepted requests via the `donation_engagements` row instead (Section 4.4).
7. **Runtime unverified.** No M7/eligibility RPC has been exercised at runtime; pgTAP suites
   are drafted but never executed (`PROJECT_CONTEXT.md:1543-1545`). Design must not assume
   runtime behaviour is proven.


---

## 4. A. Database model (recommended design — C)

### 4.1 Core idea

Add a **donation engagement** aggregate keyed to a single accepted request + donor, plus a
**status-event audit log**. Reuse `apply_donation_ended` and `donor_donations` unchanged for
eligibility/history; store the follow-up on the engagement (plus a response row).

### 4.2 Recommended new table: `public.donation_engagements` (C)

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK default gen_random_uuid | Engagement id. |
| `request_id` | `uuid` NOT NULL REFERENCES `blood_requests(id) ON DELETE RESTRICT` | Accepted request. |
| `donor_id` | `uuid` NOT NULL REFERENCES `donor_profiles(user_id) ON DELETE RESTRICT` | Accepting donor. |
| `beneficiary_id` | `uuid` NOT NULL REFERENCES `beneficiary_profiles(user_id) ON DELETE RESTRICT` | **Derived at creation from `blood_requests.beneficiary_id`** (§4.5). |
| `status` | `text` NOT NULL DEFAULT `'selected'` CHECK IN (`'selected','reached_location','donation_started','donation_ended','reached_home_safely'`) | Lifecycle enum (snake_case). **No `HEALTH_FOLLOW_UP_DUE` value** — follow-up "due" is computed. |
| `selected_at`, `reached_location_at`, `donation_started_at`, `donation_ended_at`, `reached_home_safely_at` | `timestamptz` | Server-set; **mandatory non-decreasing order** enforced by CHECK. |
| `feeling` | `text` CHECK IN (`'ok','so_so','not_well'`) NULL | Set only at `reached_home_safely`. |
| `follow_up_due_at` | `timestamptz` NULL | Set at `reached_home_safely` = time + **48 hours** (D-1 approved). |
| `follow_up_submitted_at` | `timestamptz` NULL | Set when the questionnaire is submitted. |
| `created_at`, `updated_at` | `timestamptz` NOT NULL DEFAULT clock_timestamp() | Standard. |

Constraints / indexes (C) — see also D-11:

**Row-level `CHECK`-enforceable (mandatory) — lifecycle timestamps:**
- Each stage timestamp is non-null **exactly** when its stage has been reached, consistent with
  `status`: `reached_location_at` non-null iff `status ∈ {reached_location, donation_started,
  donation_ended, reached_home_safely}`; `donation_started_at` non-null iff `status ∈
  {donation_started, donation_ended, reached_home_safely}`; `donation_ended_at` non-null iff
  `status ∈ {donation_ended, reached_home_safely}`; `reached_home_safely_at` non-null iff
  `status = reached_home_safely`. `selected_at` is always non-null.
- **Mandatory chronological (non-decreasing) order:** `selected_at ≤ reached_location_at ≤
  donation_started_at ≤ donation_ended_at ≤ reached_home_safely_at` (each comparison asserted only
  when both operands are non-null).
- `feeling` non-null iff `status = 'reached_home_safely'`; `follow_up_due_at` non-null iff
  `status = 'reached_home_safely'` and equal to `reached_home_safely_at + interval '48 hours'`;
  `follow_up_submitted_at` null unless the cycle is complete. **No `HEALTH_FOLLOW_UP_DUE`.**
- These CHECKs are written around the *current* `status`, so every legitimate forward transition
  (appending the next timestamp while advancing `status`) satisfies them; they never block a valid
  forward step.

**Not row-level CHECK-expressible → later RPC-enforced:**
- The legal *transition order* (only one forward step at a time) and actor authorization
  (`actor_id = engagement.donor_id`, `actor_role='donor'`).
- The cross-table rule that `beneficiary_id` equals `blood_requests.beneficiary_id`.
- `follow_up_submitted_at` consistency with the response row, `updated_at` maintenance, and the
  `donor_end_donation → apply_donation_ended` atomicity.
- **One active donation per donor (B):** partial unique index
  `CREATE UNIQUE INDEX <name> ON public.donation_engagements (donor_id) WHERE status <> 'reached_home_safely';`
- **One engagement per request:** `UNIQUE (request_id)` (D-6 approved backstop). Accepted
  requests are excluded from the donor open list via this engagement row (no `blood_requests`
  status change).
- `beneficiary_id, updated_at DESC` index (beneficiary live feed); `donor_id, updated_at DESC`
  index (donor view).
- RLS enabled, **no policies**, no client grants (per §3.2).

### 4.3 Recommended new tables

1. **`public.donation_status_events`** (append-only audit — D-11/D-12) — `id uuid PK`,
   `engagement_id uuid NOT NULL REFERENCES public.donation_engagements(id) ON DELETE RESTRICT`,
   `from_status text` (NULL only for the initial `selected` event), `to_status text NOT NULL`,
   `actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT`,
   `actor_role text NOT NULL CHECK (actor_role = 'donor')`,
   `occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()`, `note text NULL` (nullable text; **no length, minimum-length or whitespace restriction**). No
   update/delete path. The **donor-only** actor model means no Admin/Super-Admin/system actor in
   the initial schema; the later RPC verifies `actor_id = engagement.donor_id`. Mirrors
   `donor_verification_history` / `admin_access_history` style.
2. **`public.donation_followup_responses`** — **one row per engagement (D-7/D-11 approved):**
   `id uuid PK`, `engagement_id uuid UNIQUE NOT NULL REFERENCES public.donation_engagements(id) ON DELETE RESTRICT`,
   **no `submitted_by` column** (the donor is derived via `donation_engagements.donor_id`, D-11),
   `submitted_at timestamptz NOT NULL`, plus the six approved answer columns (§4.6) and optional
   `additional_comments` (max 500). `UNIQUE (engagement_id)` enforces the single response per
   engagement; the original submitted response is preserved for audit (append-only). Treat content
   as sensitive. The reached-home `feeling` lives on the engagement, **separately** from this
   follow-up response (D-8 approved).


### 4.4 Relationship to M7 tables (C)

- Keep `blood_request_interests` as the "willingness to help" record; do **not** repurpose it
  as the lifecycle record.
- On acceptance the request must leave the donor open list. **Owner decision D-6: Option 2
  selected (approved).** Keep the `blood_requests.status` contract (`open`/`cancelled`)
  unchanged and **do not modify the M7 CHECK**; exclude a request from the donor open list
  whenever an active `donation_engagements` row exists for it (modify
  `donor_list_open_blood_requests` accordingly, and add `UNIQUE (request_id)`).
  - Option 1 (extending the CHECK with `'in_progress'`/`'fulfilled'`) was **considered and not
    selected**. It is out of scope unless a separately approved migration is requested.

### 4.5 How the system identifies "the beneficiary who received blood" (B/C)

Authoritative link = **request ownership captured at acceptance**:
`donation_engagements.request_id → blood_requests.beneficiary_id`. The engagement also stores
`beneficiary_id` **copied from `blood_requests.beneficiary_id` inside the accept RPC**
(never client-supplied). Therefore:

- The beneficiary who received blood = `donation_engagements.beneficiary_id`.
- Live-status and follow-up reads for that beneficiary filter on
  `beneficiary_id = auth.uid()`.
- `donor_id` identifies the donor, `beneficiary_id` the receiver; unrelated beneficiaries
  (different `auth.uid()`) can never match. Enforced server-side.

### 4.6 Follow-up storage (C)

Approved schema (D-2/D-11): the six answers are stored as constrained columns —
`physical_condition`, `health_changes`, `compared_to_after`, `current_discomfort`,
`consulted_professional` (each with the allowed values in §8.4), plus optional
`additional_comments` (text, **max 500 characters**). The donor is derived through the
engagement; there is **no `submitted_by` column**. This is a general wellbeing record, not a
medical record.

### 4.7 Reuse — avoid duplication (C)

- **Do not** add a second donation-history table; `donor_donations` remains the completed-donation
  history written by `apply_donation_ended`.
- **Do not** duplicate eligibility computation; call the existing helpers.
- Notification records (if approved) live in a **separate** table (Section 8), not on the
  engagement.
- Do **not** store GPS/coordinates anywhere (B).


---

## 5. B. Status transition design (C)

### 5.1 RPC surface (one RPC per transition, donor-only)

| # | RPC (proposed name) | Actor | Preconditions | Effect | Audit event | Beneficiary sees |
|---|---|---|---|---|---|---|
| 0 | `donor_accept_blood_request(target_request_id uuid)` | Donor | Active `auth.uid()`; profile `role='donor'`, `account_status='active'`; `donor_profiles.verification_status='approved'`; `availability_status='available'`; `donor_is_eligible(last_donation_date)`; **no active engagement for this donor**; request `status='open'`, not expired, blood group matches; interest row exists (or is created here) | Create `donation_engagements` (`status='selected'`, `beneficiary_id` copied); request `status` **unchanged** (stays `open`); the request is excluded from the donor open list via the engagement | `selected` | Yes (identity now visible) |
| 1 | `donor_mark_reached_location(engagement_id uuid)` | Donor (owner) | Engagement belongs to `auth.uid()`; `status='selected'` | `status='reached_location'`, set timestamp | `selected→reached_location` | Yes |
| 2 | `donor_start_donation(engagement_id uuid)` | Donor (owner) | `status='reached_location'` | `status='donation_started'`, set timestamp | `reached_location→donation_started` | Yes |
| 3 | `donor_end_donation(engagement_id uuid)` | Donor (owner) | `status='donation_started'` | Set `status='donation_ended'`, timestamp, **and call `apply_donation_ended(donor, bms_local_date(), 'donor', auth.uid(), note)` in the same transaction** | `donation_started→donation_ended` | Yes |
| 4 | `donor_record_reached_home_safely(engagement_id uuid, feeling text)` | Donor (owner) | `status='donation_ended'`; `feeling IN ('ok','so_so','not_well')` | `status='reached_home_safely'`, timestamp, `feeling`, `follow_up_due_at` | `donation_ended→reached_home_safely` | Yes |
| 5 | `donor_submit_donation_followup(engagement_id uuid, <answers>)` | Donor (owner) | `status='reached_home_safely'`; not already submitted; `now() >= follow_up_due_at` | Insert `donation_followup_responses` **and** set `donation_engagements.follow_up_submitted_at` **atomically, same timestamp** | `followup_submitted` | Response visible |
| — | `beneficiary_get_donation_status(...)` / `beneficiary_list_my_donations(...)` | Beneficiary (owner) | `beneficiary_id = auth.uid()` | Read engagement status (+ identity after acceptance) | none (read) | read |
| — | `beneficiary_get_followup_response(engagement_id uuid)` | Beneficiary (owner) | `beneficiary_id = auth.uid()`; response exists | Read response | none (read) | read |
| — | `admin_list_donations(...)` / `admin_get_donation(...)` (D-10) | Admin / Super admin | `role IN ('admin','super_admin')`, `account_status='active'` | Read engagements/audit | none (read) | — |

Each lifecycle transition RPC also inserts one `donation_status_events` row with `actor_role='donor'`
and `actor_id = auth.uid()`, verifying the actor equals the engagement's `donor_id` (D-12). The
reached-home feeling and the follow-up questionnaire are **separate** submissions (D-8).

All client-facing RPCs use `SECURITY DEFINER` **because the design intentionally denies
clients direct table privileges and policies** (deny-by-default, §3.2/§10.1); a
`SECURITY INVOKER` function would run as `authenticated` and fail on grant-free tables. See
§10.3 for the per-RPC classification. Every Definer function uses `SET search_path=''`,
fully schema-qualified references, an explicit in-function caller authorization check,
`postgres` ownership, `SET lock_timeout='5s'`, and restricted EXECUTE (`REVOKE ALL … FROM
PUBLIC, anon, authenticated, service_role` then `GRANT EXECUTE … TO authenticated`).
**Clients never write tables directly** — they cannot forge a status or skip a step because
the only writer is the RPC, and each RPC validates the current status before updating.

### 5.2 Per-transition detail

- **Authorized actor:** every status-transition RPC requires the engagement's own donor.
  Ownership is checked by `donor_id = auth.uid()` under `FOR UPDATE` on the engagement row.
- **Preconditions:** the exact current `status` (no skipping, no going backwards); the donor's
  active/approved/available/eligible state; for acceptance, the request's open/matching state.
- **DB operation:** single-transaction `UPDATE ... WHERE id=... AND status=<expected>`
  (compare-and-set). If `UPDATE` affects 0 rows, the state changed underneath → raise a
  domain error.
- **Timestamp + audit:** the transition timestamp column and one `donation_status_events`
  row are written in the same transaction.
- **Beneficiary-visible update:** every transition changes `donation_engagements.updated_at`
  and `status`; the beneficiary feed (Section 7) reads these.
- **Failure / duplicate handling:**
  - Illegal `status` (wrong step, already advanced) → `SQLSTATE 55000` with a clear message
    (the established "no longer in the expected state" pattern) → client reloads state.
  - Duplicate submit / repeated same call → compare-and-set fails idempotently; no double
    audit row.
  - Unknown engagement / not owner → `P0002` (not found) or `42501` (unauthorized) to avoid
    leaking existence of others' engagements.

### 5.3 Anti-forgery / anti-bypass guarantees (C)

- No INSERT/UPDATE/DELETE/EXECUTE on tables for `anon`/`authenticated` (only the RPCs are
  EXECUTE-granted). The `donation_engagements`, `donation_status_events` and
  `donation_followup_responses` tables have **no client grants and no RLS policies**.
- The partial unique index (one active donation) is enforced regardless of RPC logic.
- Transitions are compare-and-set, so concurrent duplicate taps cannot skip or double-advance.
- `apply_donation_ended` stays owner-only; the client can never call it directly.


---

## 6. C. Active donation and eligibility (two independent rules)

Two rules must never be conflated:

| Rule | Starts / releases at | Owner-confirmed meaning |
|---|---|---|
| **Four-month eligibility cooldown** | starts at `DONATION_ENDED` | Blood donation complete → last donation date set, 4-month cooldown starts (existing contract). |
| **One-active-donation restriction** | released at `REACHED_HOME_SAFELY` | Full cycle complete → donor may accept a new request. |

### 6.1 Rule 1 — eligibility at `DONATION_ENDED` (A extension)

`donor_end_donation` must call the existing owner-only helper inside the **same transaction**:

```
PERFORM public.apply_donation_ended(p_donor_id => donor_id,
                                    p_donated_on => bms_local_date(),
                                    p_source     => 'donor',
                                    p_recorded_by=> auth.uid(),
                                    p_note       => NULL);
```

This matches the prescribed contract in `docs/blood-request-management.md:159-166`, and keeps
`donor_donations` / `last_donation_date` / availability as the single source of truth. Do not
re-read or re-implement the eligibility maths.

### 6.2 Rule 2 — active-donation release at `REACHED_HOME_SAFELY` (B)

The partial unique index (one active row per donor, `status <> 'reached_home_safely'`) means the
restriction is automatically released only when the row reaches `reached_home_safely`, and a new
acceptance is permitted afterwards. No separate flag is needed.

### 6.3 Avoiding partial updates (atomicity) (C)

- Each transition is a single transaction: status column + timestamp + audit row (+ eligibility
  call for `donation_ended`). PostgreSQL rolls the whole statement/transaction back on error, so
  a status can never advance without its side effects, and vice-versa.
- `apply_donation_ended` itself already fails closed (raises) if the donor is not active/approved,
  the date is in the future, the date is not after the previous donation, or the 4-month cooldown
  has not passed. If it raises, the whole `donor_end_donation` transaction aborts and the
  engagement stays at `donation_started`.

### 6.4 Concurrency (D-6 approved — Option 2)

Two distinct races must both be handled:

**Race 1 — one donor, two different requests (concurrent).**
- Serialization point: lock the donor row first —
  `SELECT ... FROM public.donor_profiles d JOIN public.profiles p ... WHERE d.user_id = auth.uid() ... FOR SHARE OF d, p` (as M7 donor RPCs already do).
- The **partial unique index** `UNIQUE (donor_id) WHERE status <> 'reached_home_safely'` is the
  hard guarantee: only one INSERT succeeds; the second raises a unique violation, mapped by the
  RPC to `55000` ("You already have an active donation").
- `donor_is_eligible` is re-evaluated inside the accept RPC under the same lock.

**Race 2 — two different donors, the same request (concurrent).**
- Lock the request row `FOR UPDATE`:
  `SELECT ... FROM public.blood_requests WHERE id = :request_id AND status = 'open' FOR UPDATE;`
  the second transaction waits, then (after the first commits) sees the request as already
  accepted and is rejected with a safe, controlled error.
- With **Option 2** the request status is **not** changed; the accepted request is identified by
  its `donation_engagements` row, and `UNIQUE (request_id)` on `donation_engagements` is the
  integrity backstop preventing a second engagement for the same request.
- The donor open list excludes any request that already has an active engagement (Section 4.4).

**Lock order:** always **donor first, request second**, in both acceptance RPCs, to avoid
deadlocks. Unique indexes remain the final integrity backstop.

**Eligibility vs. acceptance:** `donor_is_eligible` is re-evaluated inside the accept RPC under
the same lock, so a donor cannot accept while inside an unexpired cooldown or with an active
engagement.

### 6.5 Interaction with M7 donor RPCs (A)

`donor_list_open_blood_requests` / `donor_express_interest` already refresh availability and reject
ineligible donors with `55000`. The design **adds** an "already has an active donation" rejection
so a donor with an in-flight engagement cannot start a second one, and excludes accepted requests
(those with an active engagement) from `donor_list_open_blood_requests`. Per D-6 (Option 2), the
`blood_requests.status` contract is **not** changed.


---

## 7. D. Live beneficiary status (C)

Requirement (B): the **associated beneficiary** sees donor status updates **live / in real
time**. This is **status visibility only — not GPS tracking**.

### 7.1 The core constraint (unchanged)

The project's security model intentionally grants **no client table privileges** and uses
**RPC-only** access (§3.2). Any live-status transport **must not** relax that. Therefore the
approved design does **not** use Realtime **Postgres Changes**, which would require a client
`SELECT` grant + a `FOR SELECT` policy on `donation_engagements`, plus adding the table to the
`supabase_realtime` publication — weakening the invariant.

### 7.2 Approved design — Supabase Private Broadcast (D-4)

**Owner-approved (2026-11-12).** Application tables stay grant-free; authorization lives in the
separate `realtime` schema.

1. **Private Broadcast channels.** One private topic per engagement, e.g.
   `donation:<engagement_id>`. **Disable public channel access in Realtime settings** (a
   project-configuration change, separate from migration work).
2. **Database-originated broadcast.** Status changes are published **from the database** (a
   trigger on `donation_engagements` using the Realtime broadcast-from-database function) so
   clients get **no publishing privilege**.
3. **`realtime.messages` policies.** Receive access is granted only via RLS policies on
   `realtime.messages` (`for select to authenticated`), matching the topic through
   `realtime.topic()` and `realtime.messages.extension = 'broadcast'`. **Do not** add
   `ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY` — RLS is already enabled, and that
   statement fails with `42501` and aborts the migration.
4. **Authorization helper.** Because a topic name alone cannot be compared to `auth.uid()`
   inline, add a narrow `SECURITY DEFINER` helper, e.g.
   `public.is_donation_participant(p_topic text)`, that parses the engagement id and returns true
   only when the caller is that engagement's donor, its exact beneficiary, or an authorized
   Admin/Super Admin. The helper **discloses no protected data** and **fails closed**.
   - **Privilege detail:** an authenticated user's RLS policy must be able to **EXECUTE** this
     helper. Do **not** revoke the EXECUTE permission the policy needs. Grant EXECUTE to
     `authenticated` (and to the role that evaluates the policy) while keeping the function body
     minimal and reading only what the check requires.
5. **Not selected:** Realtime Postgres Changes (weakens the RPC-only model). RPC polling remains a
   valid fallback if Broadcast is not adopted.

**Project configuration vs. migration work (kept distinct).**
- *Project setting (dashboard):* disable public Realtime channel access — requires separate
  implementation authorization.
- *Migration work:* `realtime.messages` select policies + the broadcast trigger + the helper
  function — requires separate implementation authorization.

### 7.3 Isolation, reconnection, initial state, ordering

- **Isolation:** only the engagement's **donor**, its **exact beneficiary**
  (`auth.uid() = donation_engagements.beneficiary_id`), and an **authorized Admin/Super Admin**
  may receive updates. Enforced by the `realtime.messages` policy + `is_donation_participant`
  helper, never in the UI.
- **Initial state:** on mount, load the current status through an **authorized RPC** (source of
  truth) — never assume an empty initial state.
- **Reconnection:** on app foreground / network regain, **re-fetch the authoritative status via
  RPC** and re-subscribe; do not rely on missed events.
- **Duplicate / out-of-order events:** treat each event as a *hint*; apply the maximally advanced
  status (server timestamps are monotonic) and ignore stale statuses older than the last applied
  one. The DB is the source of truth, so a re-fetch resolves any doubt.
- **JWT / policy-cache limitation (documented):** Realtime caches channel access policies for the
  duration of a connection and only refreshes them when a new JWT is provided. A revoked
  participant may therefore keep receiving messages until their JWT refreshes or expires. Keep the
  JWT expiry short; the client re-fetches via RPC after reconnect.
- **No GPS:** status values are workflow states only; no coordinates, no location payload, ever.

---

## 8. E. Two-day follow-up (C)

### 8.1 Flow (B)

1. Donor reaches `REACHED_HOME_SAFELY` → `follow_up_due_at` is set (timer starts here only).
2. When due, the donor is prompted (on-screen and/or via notification — Section 9) to complete
   the questionnaire.
3. Only the associated donor submits via `donor_submit_donation_followup`; a submission **before**
   `follow_up_due_at` is **rejected**. The RPC inserts the `donation_followup_responses` row **and**
   sets `donation_engagements.follow_up_submitted_at` **atomically with the same timestamp** (D-13).
4. The **associated beneficiary** (`beneficiary_id`) can read the submitted response via
   `beneficiary_get_followup_response` (ownership-checked).
5. **Admin** access is **approved (D-5/D-10)**: authorized admins may view donation details and
   follow-up evaluation.
6. **Unrelated users cannot read it:** no client grants; reads go through owner-checked RPCs only.

### 8.2 Timing basis — approved (D-1)

**Owner-approved (2026-11-12): elapsed 48 hours**, measured from `REACHED_HOME_SAFELY`, stored as
an authoritative absolute `follow_up_due_at` (`reached_home_safely_at + interval '48 hours'`).
Example: reached home 15:00 on 12 Nov → follow-up due 15:00 on 14 Nov. The Asia/Dhaka calendar is
used only for display. (Elapsed 48h is simpler than a calendar-day rule and matches "two days
after".)

### 8.3 "Due" stored vs computed (D-9)

**Approved (D-7/D-9):** store the authoritative `follow_up_due_at` and the `follow_up_submitted_at`
timestamp; compute "due" on read as `now() >= follow_up_due_at AND follow_up_submitted_at IS NULL`.
No scheduler is needed for correctness; a scheduler is only needed for *push reminders*
(Section 9). **Also approved (D-13):** the submission RPC rejects a submission made **before**
`follow_up_due_at`, and writes the response row and `follow_up_submitted_at` **atomically with the
same authoritative timestamp**.

### 8.4 Questionnaire — approved (D-2)

**Owner-approved (2026-11-12).** General **wellbeing** questions, **not** medical diagnosis or
treatment advice:

1. How is your physical condition now? — Good / Moderate / Not well.
2. Have you noticed any changes since donating? — No problems / Yes / Not sure.
3. Are you feeling better than immediately after donation? — Yes / Same / Worse.
4. Are you currently experiencing any discomfort? — No / Yes / Prefer not to say.
5. If you experienced problems, have you consulted a healthcare professional? — Yes / Not yet / Not
   needed.
6. Additional comments — optional text.

The schema stores answer *slots* (§4.6). The reached-home **feeling** (OK / So-so / Not well) is a
**separate** submission from this questionnaire (D-8 approved).


---

## 9. F. Notifications — approved architecture (D-3)

> Owner-**approved** architecture (2026-11-12). The storage tables, Edge Functions, the scheduled
> job, and `expo-notifications` installation still require separate implementation authorization.

### 9.1 Approved architecture

- **Expo Push Notifications** for mobile delivery. **`expo-notifications` is not currently
  installed** (`package.json`), so this is a new dependency (install approval required).
- **Expo Push Token storage** — new table `public.push_tokens` (`id, user_id, expo_token UNIQUE,
  device_info, platform, created_at, last_seen_at, revoked_at`). Service-role/Edge-Function only;
  no client grants; tokens never logged.
- **Supabase Edge Functions** for server-side dispatch, invoked by database triggers/webhooks or a
  scheduler. **Never** call privileged APIs from the mobile app.
- **Database-backed outbox** — `public.notification_outbox` (`id, user_id, event_type, payload,
  dedupe_key UNIQUE, status, attempts, next_attempt_at, created_at, sent_at, last_error`).
- **Scheduled job** for the two-day follow-up reminder (Supabase scheduled Edge Function or
  `pg_cron`). Scheduler choice is an implementation detail (§13.2 R-3).

### 9.2 Approved event categories

Proposed events (from `docs/donation-workflow.md` §9.2): new matching request; donor acceptance
(→beneficiary); relevant status updates (→beneficiary); reached-home-safely (→beneficiary);
two-day follow-up reminder (→donor); four-month eligibility restoration (→donor); admin alerts.
Generate events from the transition RPCs into `notification_outbox` in the same transaction, then
dispatch asynchronously — so a notification failure never rolls back a donation transition.

### 9.3 Delivery, dedup, retry, failures

- **Deduplication:** `dedupe_key` (e.g. `event:engagement_id:status` or
  `followup:<engagement_id>`) unique constraint; re-runs cannot double-send.
- **Retry / backoff:** `attempts` + `next_attempt_at`; bounded retries with backoff; after a limit
  → `status='failed'` (dead-letter) for admin inspection.
- **Delivery status:** `status` (`pending|sent|failed`), `sent_at`, `last_error`.
- **Invalid tokens:** on Expo "DeviceNotRegistered", mark the token `revoked_at` and stop using it.
- **Failure handling:** dispatch is idempotent and separate from the DB transition; a stuck outbox
  row is retried without affecting donation state.

### 9.4 Authorization

- Notifications are delivered only to the correct authenticated user's registered tokens.
- Edge Functions run with privileged credentials on a trusted server only; the mobile client never
  holds any service key.


---

## 10. G. Security and audit (C)

### 10.1 RLS and least privilege

- New tables (`donation_engagements`, `donation_status_events`, `donation_followup_responses`,
  and notification tables) → `postgres`-owned, **RLS enabled, no policies, no client grants**
  (matching §3.2). Access only through owner-checked `SECURITY DEFINER` RPCs.
- Exception: if a Realtime Postgres-Changes option (Section 7.2 B) is approved, exactly one narrow
  `FOR SELECT` policy + `SELECT` grant for the owning beneficiary is added — nothing more.

### 10.2 RPC execution permissions

- Each new RPC: `REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role;` then
  `GRANT EXECUTE ... TO authenticated;` only. A fail-closed guard (à la M7) verifies `authenticated`
  has EXECUTE and `anon`/`service_role` do not.

### 10.3 SECURITY INVOKER/DEFINER classification

The proposed client-facing RPCs **must** be `SECURITY DEFINER` because the design intentionally
**denies clients direct table privileges and policies** (deny-by-default). A `SECURITY INVOKER`
function runs as `authenticated`, which holds no privileges on the new tables, so it would fail.
`INVOKER` is used only for **pure helpers** that need no elevated table access.

| Function | Boundary | Why |
|---|---|---|
| `donor_accept_blood_request` | **DEFINER** | Writes grant-free `donation_engagements`; locks the request |
| `donor_mark_reached_location` / `donor_start_donation` / `donor_end_donation` / `donor_record_reached_home_safely` | **DEFINER** | Update grant-free `donation_engagements` + insert `donation_status_events`; `donor_end_donation` also calls owner-only `apply_donation_ended` |
| `donor_submit_donation_followup` | **DEFINER** | Inserts grant-free `donation_followup_responses` |
| `beneficiary_get_donation_status` / `beneficiary_list_my_donations` / `beneficiary_get_followup_response` | **DEFINER** | Read grant-free tables the caller cannot select |
| `admin_list_donations` / `admin_get_donation` / admin follow-up read | **DEFINER** | Read grant-free tables + explicit admin role check |
| `apply_donation_ended` | **DEFINER, owner-only helper** | Internal privilege boundary; **no client EXECUTE** |
| `is_donation_participant(text)` (Realtime policy helper) | **DEFINER, narrow** | Called by the `realtime.messages` RLS policy; discloses no protected data; fails closed; **EXECUTE must be granted to the policy role** (do not revoke it) |
| Pure date/format helpers (none currently client-callable) | **INVOKER** | No elevated access needed |

For **every** DEFINER function: `SET search_path=''`; fully schema-qualified object references;
an explicit in-function caller authorization check; `postgres` ownership; `SET lock_timeout='5s'`;
**restricted EXECUTE** (`REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role` then
`GRANT EXECUTE … TO authenticated` for client RPCs only); fail-closed errors; and no unnecessary
privilege exposure (no table grants, no service-role access from the app).

### 10.4 Ownership and role checks

- Donor transitions: `donor_id = auth.uid()` under lock + `profiles.role='donor' AND
  account_status='active'` + `donor_profiles` approved/available/eligible. Each status event is
  written with `actor_role='donor'` and `actor_id = engagement.donor_id` (D-12); the RPC verifies
  the actor equals the engagement donor.
- Beneficiary reads: `donation_engagements.beneficiary_id = auth.uid()` + active beneficiary.
- Admin reads (**approved, D-5/D-10**): Admin and Super Admin may view donation details —
  **including donor and beneficiary identities** — and follow-up evaluation according to their
  administrative role; `profiles.role IN ('admin','super_admin') AND account_status='active'`
  (existing pattern). Unnecessary exposure of donor private **contact** information is prohibited,
  and administrative reads are recorded in the audit design. **Never trust a role from the client.**

### 10.5 Audit immutability and admin corrections

- `donation_status_events` is append-only (no UPDATE/DELETE path; no client grants).
- Administrative corrections (e.g. a wrong donation date) continue to use the reviewed
  `admin_correct_donor_donation_date`, not an ad-hoc engagement edit. Any future admin engagement
  correction must be a separate reviewed RPC that writes its own audit row. Administrative reads
  and corrections are recorded in the audit design (D-5/D-10 approved).

### 10.6 Cross-beneficiary isolation

- Every beneficiary read is filtered on `beneficiary_id = auth.uid()`. Unrelated beneficiaries and
  donors receive `P0002`/empty results, never another user's data.
- Tests must prove beneficiary A cannot read B's engagement/response/follow-up and vice-versa.

### 10.7 Idempotency and concurrency

- Compare-and-set transitions (Section 5.3); partial unique index for one-active-donation;
  `UNIQUE (engagement_id)` for one follow-up submission; outbox `dedupe_key`.
- Lock ordering **donor → request** to avoid deadlocks; unique indexes are the final backstop.

### 10.8 Sensitive data

- Donor identity, contact details, and follow-up/wellbeing responses are sensitive: not logged,
  not printed, not exposed beyond the authorized reader.
- **No GPS/coordinates are stored or transmitted anywhere** in P4.
- No privileged/service credentials in the mobile app.


---

## 11. Implementation mapping

### A. Existing implementation (reuse as-is)

- Tables: `blood_requests`, `blood_request_interests`, `donor_profiles`, `beneficiary_profiles`,
  `profiles`, `donor_donations`, availability tables, audit tables.
- Functions/helpers: `apply_donation_ended`, `donor_is_eligible`, `donor_next_eligible_date`,
  `bms_local_date`, `refresh_eligible_donor_availability`.
- RPCs: M7 request/interest RPCs; eligibility RPCs; admin verification RPCs; super-admin RPCs.
- Client: `src/lib/supabase.ts`, `src/lib/blood-requests.ts`, `src/lib/donor-eligibility.ts`,
  `src/lib/admin-donor-verification.ts`, `src/lib/admin-management.ts`; screens
  `open-blood-requests.tsx`, `donor-dashboard.tsx`, `beneficiary-dashboard.tsx`,
  `my-blood-requests.tsx`, `create-blood-request.tsx`, `admin-dashboard.tsx`.
- Tests: pgTAP files in `supabase/tests/database/`.

### B. Required implementation gaps (not yet built)

- No `donation_engagements`, `donation_status_events`, `donation_followup_responses`.
- No `SELECTED…REACHED_HOME_SAFELY` transitions or RPCs.
- No donor-accept RPC; no beneficiary identity disclosure logic.
- No live-status transport (no Realtime publication/channel).
- No follow-up storage, due calculation, or reminder.
- No notifications (`expo-notifications` absent; no outbox/tokens/Edge Functions).
- No admin donation-workflow/audit read surface.
- `blood_requests.status` does not model acceptance; the design keeps its `open`/`cancelled`
  contract and tracks acceptance via `donation_engagements` (D-6 Option 2, approved).

### C. Recommended technical design

As described in Sections 4–10.

### D. Decisions requiring owner approval

**All owner recommendations (D-1…D-13) were approved on 2026-11-12** (see §1.3). Only residual
implementation details remain open (not requirement decisions) — see Section 13.2.


---

## 12. Ordered implementation plan

Each step lists the proposed file and whether it is **existing** or **new**. **Nothing is edited
here** — this is the plan only. Deployment and activation remain separately approved.

| Phase | Contents | Proposed file | Existing / New |
|---|---|---|---|
| **P4.1** (first migration) | Three core tables (`donation_engagements`, `donation_status_events`, `donation_followup_responses`) + constraints + indexes (incl. the partial unique index) + RLS + ACL protections. **No functions/triggers/RPCs/grants/Realtime/notifications/app code** (D-11). | `supabase/migrations/20261029000100_p4_donation_schema.sql` | **New** |
| **P4.2** | Transition + read RPCs (`donor_accept_blood_request`, the four lifecycle transitions, `donor_submit_donation_followup`, beneficiary/admin read RPCs) + modify `donor_list_open_blood_requests` (exclude engaged requests) and `beneficiary_cancel_blood_request` (reject when an engagement exists) + ACL guards | `supabase/migrations/<next>_p4_donation_rpcs.sql` | **New** |
| **P4.3** | Realtime: `is_donation_participant` helper + `realtime.messages` select policies + broadcast-from-database trigger (D-4) | new migration | **New** |
| **P4.4** | Realtime project setting: disable public channel access (dashboard) | — | **Config** |
| **P4.5** | Notifications: `public.push_tokens`, `public.notification_outbox`, Edge Function, scheduler (D-3) | new migration + Edge Function | **New** |
| **P4.6** | Application: `src/lib/donation-workflow.ts`; donor screens (accept + active-donation), beneficiary status screen, admin screen | new/edited | Mix |
| **P4.7** | Tests: structural + behavioral pgTAP suites | `supabase/tests/database/donation_workflow.test.sql` | **New** (mirrors existing pgTAP style) |

Suggested build order: **P4.1 → P4.7 (structural tests) → P4.2 → P4.7 (behavioral tests) → P4.6 →
P4.3 → P4.4 → P4.5**. Schema first; RPCs and their tests next; screens then; Realtime, the project
setting and notifications last (each after its own separate approval). **P4.1 contains no
functions, triggers, RPCs, grants, Realtime policies, notification tables or application code**
(D-11).

### 12.1 Migration conventions to follow (A)

- Single migration-runner transaction, `SET LOCAL search_path=''`, `lock_timeout='5s'`,
  `check_function_bodies=on`.
- Fail-closed preflight `DO` block (PostgreSQL 17 + `current_user='postgres'` + prerequisites +
  no pre-existing objects), as in M7.
- No auto-down migration; document recovery limits (as M7 does).
- PostgreSQL 17 parser validation before deployment.

### 12.2 Focused tests to add (C)

- Transition legality per step; illegal/duplicate transitions rejected (`55000`).
- One-active-donation: concurrent second accept fails (unique index).
- Authorization: non-owner donor, unrelated beneficiary, `anon` rejected (`42501`).
- `donation_ended` atomically writes `donor_donations` + `last_donation_date` (eligibility).
- Beneficiary sees identity only after acceptance; unrelated beneficiary sees nothing.
- Follow-up: due calculation, single submission, beneficiary read, unrelated read denied.
- ACL guards: `anon`/`service_role` cannot EXECUTE; no client table grants.

### 12.3 P4.1 applied status and verification (2026-11-15)

- **Manual apply (BMS-Development).** The full migration
  `supabase/migrations/20261029000100_p4_donation_schema.sql` was **manually executed in the
  BMS-Development** (`zbgqpqafvcxaoxxcuyxn`) **SQL Editor** and reported `Success. No rows returned`.
  Owner-supplied verification: the three target tables (`donation_engagements`,
  `donation_status_events`, `donation_followup_responses`) exist, are owned by `postgres`, with RLS
  enabled and not forced; all nine expected indexes exist; and the `anon` / `authenticated` /
  `service_role` / PUBLIC permission verification returned `Success. No rows returned`. This
  **supersedes** the earlier "P4.1 NOT APPLIED" status. These results were recorded as supplied and
  were **not** independently re-verified from this environment.
- **Migration-history caveat.** A manual SQL-Editor apply does **not** prove that
  `supabase_migrations.schema_migrations` contains this migration. **CLI migration history for
  `20261029000100` is UNRECORDED / NOT VERIFIED.** Do not run `migration repair`, `db push`, or any
  Supabase operation to reconcile it without separate approval. (A future `db push` would fail-closed
  on the migration's own "P4.1 objects already exist" preflight.)
- **Structural tests not complete.** The P4.7 suites do **not** exist/run yet; passing the apply's
  fail-closed ACL guard is not a structural or behavioural test result. Approved build order is
  unchanged: **P4.1 → P4.7 → P4.2**.
- **Offline parser validation (historical).** The 2026-11-15 offline check with `pglast` 7.22
  (PostgreSQL 17 grammar) returned **`PARSE OK; top-level statements = 20`**. PL/pgSQL bodies inside
  `DO` blocks were **not** compiled or executed; this proves syntax only. No project dependencies or
  files were changed by the parser installation.
- **Pre-apply read-only preflight (historical, superseded).** Before the apply, a read-only
  BMS-Development preflight (PostgreSQL `17.11` / `170011`; current database/user `postgres` /
  `postgres`) confirmed: all six prerequisite tables present, owned by `postgres`, RLS enabled and not
  forced; both required donor eligibility functions present (definitions inspected, not executed);
  the required Supabase Auth schema, `auth.users`, `auth.uid()`, and roles `anon`, `authenticated`,
  `service_role` present; and the three target P4.1 tables and nine index names **absent at that time**
  — which is exactly why the apply could create them. All preflight queries were read-only.

---

## 13. Decision status — approved (2026-11-12) and residual

### 13.1 Approved owner decisions

D-1 elapsed-48h timer · D-2 questionnaire wording · D-3 notification architecture · D-4 private
Broadcast live status · D-5/D-10 admin visibility of donation details + follow-up evaluation ·
D-6 concurrency Option 2 · D-7 one response per engagement · D-8 feeling separate from follow-up ·
D-9 due timestamp stored + append-only status history · D-11 P4.1 three-table schema scope (no
`interest_id`, no `submitted_by`, both follow-up timestamps, `additional_comments` ≤ 500, RESTRICT
FKs, one-per-request, one-active-per-donor) · D-12 status-event actor (donor-only, NOT NULL; RPC
verifies `actor_id = donor_id`) · D-13 `updated_at` RPC-maintained (no trigger) + follow-up
rejection before `follow_up_due_at` and atomic same-timestamp write. See §1.3 and the affected
sections.

### 13.2 Residual implementation details (not requirement decisions)

| ID | Residual detail | Notes | Ref |
|---|---|---|---|
| R-2 | Notification delivery preferences (opt-in/out, quiet hours, channel mix) | architecture approved; preferences not fixed | §9 |
| R-3 | Scheduler choice for the follow-up reminder (`pg_cron` vs scheduled Edge Function) | implementation detail | §9.1 |
| R-4 | Exact admin contact-field access, plus read filtering/pagination | **Admin can see donor + beneficiary identities (approved)**; only the precise private contact fields and list filtering/pagination remain open | §10.4 |
| R-5 | ~~Exact audit-event column naming~~ **resolved (D-11/D-12)** | columns fixed in §4.3 | §4.3 |

> No approved requirement is listed here. Status identifiers (former R-1) are **resolved** —
> snake_case; `follow_up_due_at` stored as an authoritative timestamp; follow-up "due" computed
> from the timestamp + submission state; the submission timestamp determines whether it was
> submitted; and no separate `HEALTH_FOLLOW_UP_DUE` status is stored. The approved visibility
> requirement (D-5/D-10) is **not** unresolved: Admin and Super Admin **can** view donation
> details, including donor and beneficiary identities.

---

## 14. Source references, checklist, change log

### 14.1 Key source references used

- `docs/donation-workflow.md` (Revision 4): §4 identity disclosure; §5 lifecycle; §6 live status;
  §7 follow-up; §9 notifications.
- `PROJECT_CONTEXT.md`: "Donation Workflow (P4) Decisions — 2026-11-12"; "Privacy Rules";
  "Current Database Status" (`:1457-1466`); runtime-untested notes (`:1543-1545`).
- `docs/blood-request-management.md`: "Donation Ended integration point" (`:151-170`); scope note
  (`:149`).
- `docs/donor-donation-eligibility.md`: "Approved decisions" (`:27-37`); "Objects" (`:39-67`);
  "Security model" (`:84-91`); "Ordering" (`:93-100`).
- `supabase/migrations/20261027000100_donor_donation_eligibility.sql` (`apply_donation_ended`
  `:198-292`); `20261028000100_blood_request_management.sql` (tables `:73-101`, RPCs, ACL guards);
  `20261023000400_admin_donor_verification.sql:125,172`; `20261026000100_super_admin_management.sql`.
- `supabase/config.toml` (`[realtime] enabled = true`); `package.json` (no `expo-notifications`).
- Supabase Realtime Authorization documentation (`realtime.messages` RLS policies, private channels).

### 14.2 Owner review checklist

- [x] D-1 Follow-up timer basis — approved (elapsed 48h).
- [x] D-2 Questionnaire wording — approved.
- [x] D-3 Notification architecture — approved.
- [x] D-4 Real-time transport — approved (private Broadcast).
- [x] D-5 Admin follow-up visibility — approved (per Proposal).
- [x] D-6 `blood_requests.status` model — approved (Option 2).
- [x] D-7 Follow-up storage shape — approved (one per engagement).
- [x] D-8 Feeling vs follow-up — approved (separate submissions).
- [x] D-9 Identifiers / due-storage / audit shape — approved.
- [x] D-10 Admin donation-workflow read permissions — approved.
- [x] D-11 P4.1 three-table schema scope — approved.
- [x] D-12 Status-event actor model — approved (donor-only, NOT NULL).
- [x] D-13 `updated_at` maintenance + follow-up submission rules — approved.
- [ ] Separate implementation authorization for: the P4.1 schema migration, the P4.2 RPC migration,
  `realtime.messages` policies + helper, the Realtime project setting, `expo-notifications` install,
  Edge Functions, and the scheduler.

### 14.3 Change log

| Date | Change | Author |
|---|---|---|
| 2026-11-12 | Initial P4 technical design draft created from repository inspection. No code/SQL/Supabase/Git changes. | — |
| 2026-11-12 | Final documentation update: recorded all eight owner-approved decisions (D-1…D-10); DEFINER/INVOKER classification; approved Private Broadcast design; admin visibility moved to approved; concurrency split (Option 2); approved 48h timer and questionnaire; §8.3 cross-reference fix. No code/SQL/Supabase/Git changes. | — |
| 2026-11-12 | P4.1 synchronization: recorded D-11 (three-table schema scope — no `interest_id`, no `submitted_by`, both follow-up timestamps, `additional_comments` ≤ 500, RESTRICT FKs, one-per-request, one-active-per-donor), D-12 (status-event actor donor-only, NOT NULL), D-13 (`updated_at` RPC-maintained; reject follow-up before `follow_up_due_at`; atomic same-timestamp write); restructured §12 into schema-first P4.1 + later phases; corrected the §5.1 accept effect (request status unchanged). No code/SQL/Supabase/Git changes. | — |
| 2026-11-12 | Lifecycle-timestamp consistency correction: made the non-decreasing lifecycle timestamp ordering a **mandatory** CHECK invariant (previously stated as optional in the P4.1 plan) and separated row-level CHECK rules from later-RPC transition-order/authorization rules (§1.3, §4.2). No code/SQL/Supabase/Git changes. | — |
| 2026-11-15 | Recorded P4.1 validation status (§12.3): offline parser validation (`pglast` 7.22, PostgreSQL 17 grammar; `PARSE OK; top-level statements = 20`) and a read-only BMS-Development preflight (PostgreSQL 17.11; prerequisites, Auth objects and absence of the three P4.1 tables plus nine index names confirmed). **P4.1 remains NOT APPLIED.** No code/SQL/Supabase/Git changes. | — |
| 2026-11-15 | P4.1 **manually applied in BMS-Development** via the SQL Editor (`Success. No rows returned`) and verified: three tables (owner `postgres`, RLS enabled, not forced), nine indexes, and the `anon`/`authenticated`/`service_role`/PUBLIC permission check (`Success. No rows returned`). Supersedes the earlier "NOT APPLIED" entries. **CLI migration history UNRECORDED / NOT VERIFIED.** No `migration repair`/`db push`/SQL was run by this documentation pass; P4.1 structural tests not complete. No code/SQL/Supabase/Git changes. | — |

### 14.4 Safety confirmation

Documentation only. No application source code, SQL/migration, database schema, Supabase project or
setting, or feature flag was changed. No Git stage/commit/push/mutation was performed. No tests were
run or repeated. This final update modified only documentation: `docs/p4-technical-design.md`,
`docs/donation-workflow.md`, and `PROJECT_CONTEXT.md`.

The 2026-11-15 status update added §12.3, the header status block and the change-log row above. This
documentation reconciliation records a **manual** P4.1 apply performed by the owner in the
BMS-Development SQL Editor and its verification; the documentation pass itself changed no code, SQL,
migration, database object, Supabase project or setting, or feature flag, and ran no `migration
repair`, `db push`, or SQL. The Main project was not accessed. CLI migration history for
`20261029000100` remains **UNRECORDED / NOT VERIFIED**, and P4.1 structural tests are not complete.

