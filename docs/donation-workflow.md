# Donation Workflow (P4) — Documentation

Status: **Approved P4 requirements (owner-approved 2026-11-12).** No code, SQL, migration,
Supabase request, feature flag, or Git change accompanies this document. Implementation is a
separate, ungranted approval.

Prepared: 2026-11-12.
Repository baseline reviewed: commit `2f69ff2b849e127288f42b71babbf1056ae8903a`.
Revision 2 (2026-11-12): donor identity-disclosure scoping and the one-active-donation release
point **resolved**; `DONATION_ENDED` vs. `REACHED_HOME_SAFELY` semantics and the two-day timer
clarified.
Revision 3 (2026-11-12): recorded the owner-approved decisions — 48-hour timer, approved
questionnaire, approved notification architecture, private-Broadcast live status, admin
visibility, separate feeling/follow-up, and the one-response-per-engagement storage model.
Revision 4 (2026-11-12): synchronized the P4.1 schema decisions — D-11 (three-table schema scope),
D-12 (donor-only status-event actor), D-13 (`updated_at` RPC-maintained; reject follow-up before
`follow_up_due_at`; atomic same-timestamp write). See Section 12 and `docs/p4-technical-design.md`.
Revision 5 (2026-11-12): lifecycle timestamps are a **mandatory** non-decreasing invariant
(`selected_at ≤ reached_location_at ≤ donation_started_at ≤ donation_ended_at ≤
reached_home_safely_at`), enforced by row-level CHECKs (Section 5.2).

> Note on source authority: this document does **not** invent requirements. The
> detailed P4 workflow rules were **not found in any repository document** (see
> Section 13, "Missing source documents"). Where a rule is not in an approved repo
> document, it is labelled as a **project-owner confirmation** or a **proposal**, not
> as an inherited Proposal/SRS requirement.

---

## 1. Purpose and scope

This document describes the approved **Complete Donation Workflow (P4)**: how a donor
accepts a matching beneficiary blood request, how the donation progresses through its
lifecycle, what the receiving beneficiary can see live, how the two-day health
follow-up works, and how this connects to the already-deployed four-month donor
eligibility feature.

It is a **documentation and planning artifact**. It:

- Records the workflow the project owner has confirmed and approved.
- Records the current repository implementation and gaps (based on actual inspection).
- Records the approved notification architecture.
- Distinguishes approved decisions (Section 12.1) from residual implementation details (Section 12.2).

It does **not** authorise implementation. Per `AGENTS.md`, approval to draft
documentation is not approval to apply or execute anything.

### 1.1 In scope

- Donor-driven acceptance of a beneficiary request (no separate beneficiary step).
- Donation lifecycle statuses and their meaning.
- Beneficiary live-status visibility (in-app status only, **not** GPS tracking).
- Two-day health follow-up timing, questionnaire, and response visibility.
- Relationship to four-month donor eligibility and donation history.
- A proposal for notification architecture.
- Security, authorization, RLS, and data-isolation requirements.

### 1.2 Out of scope

- GPS or geographic location tracking of any kind (explicitly excluded).
- Any change to already-approved modules (donor verification M5, super-admin M6,
  blood request M7, donor eligibility).
- Implementation, deployment, or activation of any feature.

---

## 2. How to read this document (requirement classification)

Every substantive statement is tagged with one of four classes:

| Tag | Meaning |
|---|---|
| **A — Approved requirement** | Traceable to an approved repo document (`PROJECT_CONTEXT.md`, `docs/blood-request-management.md`, `docs/donor-donation-eligibility.md`). |
| **B — Owner confirmation** | Not present in a repo document, but explicitly confirmed by the project owner for P4. |
| **C — Proposal (awaiting approval)** | A recommendation that requires the project owner's approval before implementation. |
| **D — Unresolved** | A genuinely undecided detail; recorded without inventing an answer. |

`PROJECT_CONTEXT.md` records that "the previously approved Project Proposal and the
available approved project documents remain the **source of truth**"
(`PROJECT_CONTEXT.md`, "Project Requirements — Source of Truth"). The Project Proposal
and SRS themselves are **not present in the repository** (Section 13), so classes **B**
and **C** in this document are intentionally used where the repository provides no
authoritative text.

---

## 3. Source documents and references

| Document | Used for | Section / line references |
|---|---|---|
| `PROJECT_CONTEXT.md` | Priorities, decisions, DB status, verification records | §9 "Current Development Priority — Complete the Core Application" (`:1005-1019`); "Approved Development Priority — 2026-11-06" (`:1025-1049`); "Blood Request Decisions" (`:650-665`); "Project Requirements — Source of Truth" (`:682-688`); "Current Database Status" (`:1457-1466`); deployment/verification entries (`:1543-1547`) |
| `docs/blood-request-management.md` | M7 scope, "Donation Ended" integration contract | Status (`:1-29`); "Recovery and limitations" (`:145-149`); "Donation Ended integration point" (`:151-170`) |
| `docs/donor-donation-eligibility.md` | Eligibility rules, donation history, objects | "Approved decisions implemented" (`:27-37`); "Objects" (`:39-67`); "Existing functions replaced" + "M7 changes" (`:69-82`); "Security model" (`:84-91`); "Ordering and dependencies" (`:93-100`); "Known risks / limitations" (`:165-188`) |
| `supabase/migrations/20261027000100_donor_donation_eligibility.sql` | Implemented eligibility/history objects | `donor_donations` table; helpers `bms_local_date`, `donor_next_eligible_date`, `donor_is_eligible`, `refresh_eligible_donor_availability`; `apply_donation_ended` (`:198-292`) |
| `supabase/migrations/20261028000100_blood_request_management.sql` | Implemented request/interest objects | `blood_requests` (`:73-90`); `blood_request_interests` (`:92-101`); `beneficiary_*` RPCs; `donor_list_open_blood_requests` (`:164-180`); `donor_express_interest` (`:182-204`) |
| `src/lib/blood-requests.ts`, `src/lib/donor-eligibility.ts` | Client activation flags and wrappers | `BLOOD_REQUEST_SERVICE_ACTIVE = true` (`blood-requests.ts:5`); `DONOR_ELIGIBILITY_SERVICE_ACTIVE = false` (`donor-eligibility.ts:7`) — see the dated clarification in Section 11.2 |
| `src/app/open-blood-requests.tsx`, `src/app/donor-dashboard.tsx`, `src/app/beneficiary-dashboard.tsx`, `src/app/admin-dashboard.tsx` | Current UI surfaces | — |

**Missing source document:** the approved **Project Proposal** and **SRS**. See Section 13.

---

## 4. Role-wise permissions and visibility

This table summarises who may do or see what during P4.

| Capability | Donor | Receiving beneficiary | Other beneficiaries | Admin / Super admin |
|---|---|---|---|---|
| Accept / select a matching request | Yes (own, eligible) **B** | No (no separate beneficiary acceptance) **B** | No | Read-only **A/C** |
| See donor identity | Own identity | **Only after donor acceptance**, for the accepted donor **B** | **No** | Per approved Proposal **D** |
| Update donation status (Reached / Started / Ended / Home Safely) | Yes (own active donation) **B** | No (read-only live status) **B** | No | Read-only |
| See live donation status | Own active donation | **Live status of the accepted donation only** **B** | **No** | Per approved Proposal **D** |
| Submit feeling + two-day follow-up answers | Yes (own) **B** | No | No | Per approved Proposal **D** |
| View follow-up responses | Own | **The receiving beneficiary for that donation** **B** | **No** | Per approved Proposal **D** |
| Four-month eligibility / donation history | Own (existing feature) **A** | No | No | Correction path `admin_correct_donor_donation_date` **A** |

Notes:

- **A — Approved requirement:** Donor eligibility is enforced server-side and shown on
  the donor dashboard when `DONOR_ELIGIBILITY_SERVICE_ACTIVE` is enabled
  (`docs/donor-donation-eligibility.md:27-37`; `PROJECT_CONTEXT.md:1016`).
- **B — Owner confirmation:** Donor-driven acceptance, live beneficiary status, and
  follow-up response visibility are confirmed for P4.
- **B — Identity disclosure (resolved for P4):** the beneficiary can view the donor's
  identity **only after the donor accepts that beneficiary's blood request** (the
  `SELECTED` status). Before acceptance the donor's identity stays hidden; after
  acceptance it is revealed only to that request's owner. This is the agreed scoping of
  the older rule below.
- **Separate documentation issue (not fixed here):** the older statement in
  `PROJECT_CONTEXT.md:657-658` ("Beneficiary sees aggregate interest counts, **not**
  donor identities") is narrower than the scoped P4 rule and is now **inconsistent** with
  it. It needs a **separate documentation synchronisation update**; this task does not
  modify `PROJECT_CONTEXT.md` (see Section 13.2). Ordinary interest browsing, before
  acceptance, must still keep donor identities hidden.

---

## 5. Complete donation lifecycle and status definitions

### 5.1 Lifecycle (as confirmed **B**)

```
Matching request
      │  donor accepts / selects
      ▼
[1] SELECTED                (donor identity becomes visible to that beneficiary)
      │  donor marks reached location
      ▼
[2] REACHED_LOCATION
      │  donor marks donation started
      ▼
[3] DONATION_STARTED
      │  donor marks donation ended
      ▼
[4] DONATION_ENDED          → blood donation itself is complete
      │                       → updates last_donation_date + starts 4-month cooldown
      ▼
[5] REACHED_HOME_SAFELY     → FULL CYCLE COMPLETE
      │                       → releases the one-active-donation restriction
      │                       → starts the two-day follow-up timer
      │  (+ donor submits feeling: OK / So-so / Not well)
      ▼
[6] follow-up due            → two days after [5] (computed condition, not a stored status);
                               donor completes questionnaire
```

### 5.2 Status definitions

| # | Status | Meaning | Who sets it | Visible to beneficiary live? |
|---|---|---|---|---|
| 1 | **SELECTED** | The donor has accepted/selected the request; the beneficiary may now see the donor's identity. | Donor | Yes |
| 2 | **REACHED_LOCATION** | The donor has arrived at the donation location. | Donor | Yes |
| 3 | **DONATION_STARTED** | The blood donation procedure has begun. | Donor | Yes |
| 4 | **DONATION_ENDED** | The blood donation itself is complete. Triggers the eligibility update (Section 8). | Donor | Yes |
| 5 | **REACHED_HOME_SAFELY** | The donor has reached home safely; the **full donation cycle is complete**. Captures feeling (OK / So-so / Not well). | Donor | Yes |
| 6 | **(follow-up due — computed)** | Two days after **REACHED_HOME_SAFELY**; the donor should complete the health follow-up questionnaire. This is a **computed condition** (`follow_up_due_at` stored and `follow_up_submitted_at` null), **not** a stored status value. | *(computed; no actor — no system actor role exists)* | Per approved Proposal |

- **B — Owner confirmation:** stored statuses 1-5 and their order, and the two meanings in §5.3.
- **B — Owner confirmation (explicit):** "Donation Ended" = the blood donation is
  complete; "Reached Home Safely" = the full donation cycle is complete.
- **Approved defaults (D-9/R-1):** internal status identifiers use **snake_case**
  (`selected, reached_location, donation_started, donation_ended, reached_home_safely`);
  `follow_up_due_at` is stored as an authoritative timestamp; follow-up "due" is **computed**
  from that timestamp plus the submission state; the submission timestamp determines whether the
  follow-up was submitted; and **no separate `HEALTH_FOLLOW_UP_DUE` status is stored** unless a
  later approved design requires it.
- **D-11/D-12 (schema):** the status is stored on `donation_engagements` with **mandatorily
  non-decreasing** lifecycle timestamps (`selected_at ≤ reached_location_at ≤ donation_started_at ≤
  donation_ended_at ≤ reached_home_safely_at`), each present exactly when its stage is reached and
  consistent with the current status (enforced by row-level `CHECK` constraints); the legal
  transition order and actor authorization are enforced by later RPCs. Each status change is recorded
  in `donation_status_events` with a **donor-only** actor (`actor_role='donor'`, `actor_id NOT
  NULL`; the RPC verifies `actor_id = engagement.donor_id`). There is **no** Admin/Super-Admin/
  system actor in the initial schema.

### 5.3 Two distinct completion points (**B**)

- **`DONATION_ENDED`** completes the **blood donation itself** and drives the four-month
  eligibility cooldown (updates the donor's last donation date and starts the cooldown,
  per the existing eligibility contract in Section 8). It does **not** release the
  one-active-donation restriction.
- **`REACHED_HOME_SAFELY`** completes the **full donation cycle**, **releases the
  one-active-donation restriction**, and starts the two-day follow-up timer.

### 5.4 One active donation per donor

- **B — Owner confirmation:** a donor may have **only one active donation at a time**.
- **B — Release point (resolved):** the restriction is released **only when the donor
  marks `REACHED_HOME_SAFELY`** (full cycle complete). It is **not** released at
  `DONATION_ENDED`; the donor cannot start a second donation until the cycle is closed.


---

## 6. Beneficiary live-status visibility

**B — Owner confirmation.** Whenever the donor updates a donation workflow status, the
**specific beneficiary who received blood from that donor** must be able to see the
updated status live / in real time inside the app.

### 6.1 Which beneficiary can see the status

- Only the **specific beneficiary whose accepted request the donor is fulfilling** —
  i.e. the beneficiary who received the blood from that donor.
- This is **not** exposed to any other beneficiary, and not to donors other than the
  one performing the donation.
- **Approved (D-7/D-9):** the donor–beneficiary relationship is maintained through the
  donation **engagement** record: the engagement stores `donor_id` and `beneficiary_id`
  (copied from the request owner at acceptance), so the beneficiary who received blood is the
  engagement's `beneficiary_id`. See `docs/p4-technical-design.md` §4.5.

### 6.2 Which status updates are visible

All donor-set transitions are visible live to that beneficiary:

1. SELECTED (acceptance — also the point of identity disclosure, Section 8)
2. REACHED_LOCATION
3. DONATION_STARTED
4. DONATION_ENDED
5. REACHED_HOME_SAFELY (with the donor's feeling value)

`D — Residual detail:` whether the follow-up **responses** appear to the beneficiary as a
**live status** event or a separate view (the beneficiary **can view the submitted follow-up
responses** — see Section 7). Follow-up "due" is a computed condition, not a stored status
(Section 5.2); this presentation detail is residual, not an open requirement.

### 6.3 Required real-time behaviour

- **B — Owner confirmation:** updates must appear **live / in real time** in the app.
- **Approved (D-4):** the transport is **Supabase Private Broadcast**. Application tables stay
  grant-free (RPC-only); authorization is enforced by `realtime.messages` policies plus a narrow
  authorization helper. Initial status is loaded via an authorized RPC; after reconnect the
  client re-fetches the authoritative status. Duplicate/out-of-order events are treated as hints.
  Full design: `docs/p4-technical-design.md` §7.

### 6.4 Authorization and data-isolation requirements

Regardless of transport, these are mandatory:

- The beneficiary may read status **only** for donations belonging to their own accepted
  request.
- No cross-beneficiary leakage: beneficiary A must never see any status tied to
  beneficiary B's request. Beneficiary B must never see beneficiary A's donor.
- Reading status must not reveal donor identity before SELECTED.
- Enforce in the backend (RLS and/or `SECURITY DEFINER` RPCs), not only in the UI
  (`AGENTS.md`; `PROJECT_CONTEXT.md` "Development Rules" item 10).
- **No GPS / location data.** This is status visibility only. Do not introduce device
  location, coordinates, or map tracking anywhere in this workflow.

---

## 7. Two-day follow-up: timing, questionnaire, response visibility

### 7.1 Timing (**B**)

- The two-day timer starts **only after the donor marks Reached Home Safely**
  (Section 5.3). It does **not** start at Donation Ended.
- After two days the donor is prompted to complete the health follow-up questionnaire.
- **Approved (D-1):** "two days" is **elapsed 48 hours** from Reached Home Safely, stored as an
  authoritative due timestamp (e.g. reached home 15:00 on 12 Nov → due 15:00 on 14 Nov). The
  Asia/Dhaka calendar is used only for display.

### 7.2 Donor completes the questionnaire (**B**)

- **Only the associated donor** submits the follow-up questionnaire (Section 7.4).
- A submission **before `follow_up_due_at`** is **rejected** (D-13).
- The response row is inserted **and** `donation_engagements.follow_up_submitted_at` is set
  **atomically with the same timestamp** (D-13).
- Responses are stored as structured answers tied to the donation; **one response per engagement**
  (D-7).

### 7.3 Who can view the follow-up responses (**B**)

- The **specific beneficiary who received blood from that donor** can view the donor's
  submitted follow-up responses.
- **Admin / Super admin** visibility follows the **approved Proposal** (**approved, D-5/D-10**):
  authorized administrators may view donation details and follow-up evaluation according to their
  administrative role; donor private contact information is not exposed unnecessarily;
  administrative reads are recorded in the audit design.
- **Protection requirement (B):** unrelated beneficiaries and unrelated donors must
  **never** be able to access the responses.

### 7.4 Follow-up questionnaire — **approved (D-2)**

> **Owner-approved (2026-11-12).** General **wellbeing** questions, **not** medical diagnosis or
> treatment advice.

1. **How is your physical condition now?**
   - Good
   - Moderate
   - Not well
2. **Have you noticed any changes since donating?**
   - No problems
   - Yes
   - Not sure
3. **Are you feeling better than immediately after donation?**
   - Yes
   - Same
   - Worse
4. **Are you currently experiencing any discomfort?**
   - No
   - Yes
   - Prefer not to say
5. **If you experienced problems, have you consulted a healthcare professional?**
   - Yes
   - Not yet
   - Not needed
6. **Additional comments.**
   - Optional text.

### 7.5 Relationship to the donor's feeling at home-safely (**B, approved**)

- At Reached Home Safely the donor records a **feeling** value: **OK / So-so / Not well**
  (Section 5.1).
- **Approved (D-8):** the feeling and the two-day questionnaire are **separate submissions** and
  must **not** be merged into one record. The questionnaire is a distinct, later submission.


---

## 8. Eligibility and donation-history relationship

**A — Approved requirement** (deployed to BMS-Development 2026-11-10).

- **Donation Ended** is the integration point with the already-deployed four-month
  eligibility feature. It must:
  1. lock and authorise the request/interest rows for the current donor and request;
  2. transition to the "donation ended" status inside the same transaction;
  3. call `public.apply_donation_ended(p_donor_id, p_donated_on, 'donor', auth.uid(), p_note)`
     before committing, so the status transition and the eligibility data are atomic.
  (`docs/blood-request-management.md:159-166`.)
- `apply_donation_ended` is the **single** writer that: inserts a `donor_donations`
  history row, updates `donor_profiles.last_donation_date`, makes the donor
  **unavailable**, and starts the **four calendar month** recovery period
  (`docs/blood-request-management.md:153-157`; `docs/donor-donation-eligibility.md:29-34`;
  migration `20261027000100`, `apply_donation_ended` at `:198-292`).
- Eligibility returns **four calendar months** after the donation date
  (`donation + INTERVAL '4 months'`, so 31 Jan → 31 May — **not** 120 days)
  (`docs/donor-donation-eligibility.md:29-30`).
- The donor automatically regains eligibility and availability after the period via
  `donor_is_eligible(date)` and `refresh_eligible_donor_availability()`
  (`docs/donor-donation-eligibility.md:34`).
- `apply_donation_ended` is **owner-only** with **no client EXECUTE grant**; it is called
  by the completion RPC, never directly by the client
  (`docs/donor-donation-eligibility.md:55-57`; migration `:288-290`).
- `admin_correct_donor_donation_date(uuid, date, text)` remains the approved admin
  correction path and is **not** a substitute for the transition
  (`docs/blood-request-management.md:168-169`).

### 8.1 Donation history and audit

- `donor_donations` records donation history (`id`, `donor_id`, `donated_on`, `note`,
  `source ('donor'|'admin')`, `recorded_by`, `recorded_at`, `UNIQUE(donor_id, donated_on)`)
  (`docs/donor-donation-eligibility.md:41-45`).
- **Gap (see Section 11):** there is currently **no workflow status-transition audit
  table**, and no record of feeling / home-safely / follow-up responses. P4 must add an
  append-only audit trail consistent with the project's existing audit style
  (`donor_verification_history`, `admin_access_history`).

### 8.2 Interaction with M7 donor RPCs

- M7's `donor_list_open_blood_requests` and `donor_express_interest` already
  refresh availability and reject donors inside the recovery period with SQLSTATE `55000`
  (`docs/donor-donation-eligibility.md:81-82`). P4 must keep this behaviour.

---

## 9. Notification architecture — **approved (D-3)**

> **Owner-approved architecture (2026-11-12).** The storage tables, Edge Functions, the scheduled
> job, and `expo-notifications` installation still require separate implementation authorization.

### 9.1 Approved components

- **Expo Push Notifications** for mobile push delivery.
- **Secure storage/management of Expo Push Tokens** (per user, per device).
- **Supabase Edge Functions** for server-side notification dispatch.
- A **scheduled server-side job** for two-day follow-up reminders.
- **Database-backed notification records** with delivery status.
- **Retry / failure handling** and **duplicate-notification prevention**.
- **Authorization**: notifications are delivered only to the correct authenticated user.

### 9.2 Approved event categories

| Event | Recipient |
|---|---|
| New matching blood request for donors | Eligible, matching donors |
| Donor acceptance notification | The requesting beneficiary |
| Relevant donation status updates | The receiving beneficiary |
| Reached Home Safely confirmation | The receiving beneficiary |
| Two-day follow-up reminder | The donor |
| Four-month eligibility restoration | The donor |
| Administrative alerts | Admin / Super admin |

### 9.3 Residual implementation details

- Scheduler choice (e.g. `pg_cron` vs. Edge Function scheduler) — implementation detail.
- Retry policy, backoff, and dead-letter handling — implementation detail.
- Duplicate-suppression key design — implementation detail.
- Delivery preferences (opt-in/out, quiet hours) — not fixed.
- Live status is provided by Private Broadcast (Section 6.3); notifications are complementary.

These are residual implementation details, not open requirement decisions.


---

## 10. Security, RLS, authorization and data-isolation considerations

These requirements apply to any future implementation. They are derived from `AGENTS.md`,
`PROJECT_CONTEXT.md` "Supabase security", and the existing migration security model.

### 10.1 General principles (A)

- Authentication identifies the user; authorization decides access. Enforce in database
  policies and trusted backend logic, not only in the app UI.
- Never trust a role, approval status, or donor identity supplied by the client.
- New objects should follow the established M7/eligibility pattern:
  `postgres`-owned, RLS enabled, `SECURITY DEFINER` where applicable,
  `search_path = ''`, fully qualified references, `lock_timeout = '5s'`, fail-closed
  preflight, `authenticated`-only EXECUTE, no `anon` EXECUTE, and **no direct client
  table/column privileges** on the new tables
  (`docs/donor-donation-eligibility.md:84-91`; `docs/blood-request-management.md:45-53`).
  `SECURITY DEFINER` is required for client-facing RPCs because clients hold no direct table
  privileges; see `docs/p4-technical-design.md` §10.3 for the per-RPC SECURITY INVOKER/DEFINER
  classification (INVOKER only for pure helpers).

### 10.2 Donor-side rules

- A donor may act only on **their own** active donation and only while an active,
  approved, available, eligible donor.
- Transitions must be **atomic** and lock the relevant rows (`FOR UPDATE`) to prevent
  double transitions and races.
- The "one active donation per donor" rule must be enforced at the **database level**
  (constraint/unique guard), not only in the UI.

### 10.3 Beneficiary-side rules (data isolation)

- A beneficiary may read status/identity/follow-up **only** for the donation of **their
  own accepted request**. This must be enforced by RLS and/or `SECURITY DEFINER` RPCs.
- Cross-beneficiary isolation must be tested: beneficiary A cannot read any data tied to
  beneficiary B, and vice versa.
- Donor identity must remain hidden until SELECTED, and then revealed **only** to that
  request's owner.

### 10.4 Sensitive data handling

- Treat donor identity, contact information, birth dates, and health/wellbeing
  responses as sensitive. Do not log, print, or expose them beyond the authorised reader.
- Health follow-up responses are sensitive: restrict to the donor (owner), the receiving
  beneficiary, and admins only as the approved Proposal permits.

### 10.5 No geolocation

- The "Reached Location" status records that the donor **reached the donation location**;
  it must **not** capture, transmit, or store GPS coordinates or device location.

### 10.6 Concurrency and integrity

- Prevent duplicate submissions (idempotent transitions; reject illegal state jumps with
  the existing `55000` pattern).
- Completion must keep the status transition and the eligibility write in one
  transaction (Section 8).


---

## 11. Current implementation status and gaps (repo inspection)

Verified read-only against commit `2f69ff2b849e127288f42b71babbf1056ae8903a`.

### 11.1 Already implemented — eligible for P4 reuse (A)

| Item | Location | Status |
|---|---|---|
| `donor_donations` history table | migration `20261027000100` | deployed (Development) |
| `apply_donation_ended(...)` owner-only writer | migration `20261027000100` (`:198-292`) | deployed |
| Eligibility helpers `bms_local_date`, `donor_next_eligible_date`, `donor_is_eligible`, `refresh_eligible_donor_availability` | migration `20261027000100` | deployed |
| `get_my_donor_eligibility()`, `list_my_donations(int,int)`, `admin_correct_donor_donation_date(uuid,date,text)` | migration `20261027000100` | deployed |
| `blood_requests`, `blood_request_interests` tables | migration `20261028000100` (`:73-101`) | deployed |
| `beneficiary_create_blood_request`, `beneficiary_list_my_blood_requests`, `beneficiary_cancel_blood_request` | migration `20261028000100` | deployed |
| `donor_list_open_blood_requests`, `donor_express_interest` | migration `20261028000100` (`:164-204`) | deployed |
| Donor eligibility UI | `src/app/donor-dashboard.tsx`, `src/lib/donor-eligibility.ts` | present, **gated** |
| Donor open-request / interest UI | `src/app/open-blood-requests.tsx`, `src/lib/blood-requests.ts` | present, **gated** |

### 11.2 Not implemented — P4 gaps (verified by inspection)

- **No donor acceptance/selection** RPC or column. `blood_request_interests` has only
  `id, request_id, donor_id, expressed_at` — **no status column**
  (migration `20261028000100:92-98`). `donor_express_interest` returns a hardcoded
  `'interested'` status (`:201-202`).
- **No status machine** (SELECTED → REACHED_LOCATION → DONATION_STARTED → DONATION_ENDED
  → REACHED_HOME_SAFELY). No `reached_location` / `start_donation` / `end_donation`
  objects exist (searches returned nothing).
- **No beneficiary identity disclosure** logic. Beneficiary RPCs return only
  `interest_count`; the current approved rule is that beneficiaries do **not** see donor
  identity (`PROJECT_CONTEXT.md:658`).
- **No "one active donation"** constraint or concept.
- **No feeling capture** (OK / So-so / Not well), **no home-safely** step.
- **No two-day follow-up** mechanism, questionnaire, or response storage.
- **No notifications** infrastructure (no push tokens, no Edge Functions, no scheduler,
  no notification records). None found in the repository.
- **No workflow status-transition audit table.**
- **No admin visibility** for donation workflow status/audit. Admin UI
  (`src/app/admin-dashboard.tsx`) covers **donor verification only**; admin RPCs are
  `admin_list_pending_donors` and `admin_review_donor`.
- **Frontend activation gates remain `false`:** `BLOOD_REQUEST_SERVICE_ACTIVE = false`
  (`src/lib/blood-requests.ts:5`) and `DONOR_ELIGIBILITY_SERVICE_ACTIVE = false`
  (`src/lib/donor-eligibility.ts:7`).

> **Dated clarification (2026-11-26).** The bullets above record the state at the commit
> named in Section 11 (`2f69ff2`). Several are now out of date and the earlier text is kept
> as history:
>
> - `BLOOD_REQUEST_SERVICE_ACTIVE` is **`true`** in `src/lib/blood-requests.ts:5`; it was enabled
>   for controlled Development device testing.
> - `DONATION_WORKFLOW_SERVICE_ACTIVE` is **`true`** in `src/lib/donation-workflow.ts:7`; the P4
>   lifecycle RPCs (`20261030000100`) are deployed and the donor flow was device-tested through
>   `reached_home_safely`.
> - `DONOR_ELIGIBILITY_SERVICE_ACTIVE` remains **`false`** in `src/lib/donor-eligibility.ts:7`.
>   Phase 3 (Donor Donation History) was runtime-tested with it **temporarily** enabled and it was
>   then restored to `false`. See the Phase 3 completion record in `PROJECT_CONTEXT.md`.
> - The "Not implemented" items in Section 11.2 (status machine, feeling capture, home-safely,
>   follow-up, status-event audit) were implemented by the P4.1/P4.2 migrations; they are not
>   listed as gaps any more. Realtime live status (P4.3/P4.4) and notifications (P4.5) remain
>   **not implemented**.

### 11.3 Deployment/runtime caveats (A)

- M7, eligibility and the earlier migrations are **applied to BMS-Development
  `zbgqpqafvcxaoxxcuyxn`** only; the Main project `zmxtxuuooviwjsdghqlt` is untouched
  (`PROJECT_CONTEXT.md:1461-1466`).
- **No runtime behavioural testing** has been performed for M7 or eligibility: no RPC has
  been called as a real beneficiary or donor; the `55000` cooldown, cross-user isolation,
  and concurrency remain untested; the pgTAP suites are drafted but **never executed**
  (`PROJECT_CONTEXT.md:1543-1545`; `:1463`).
- The repository has **no Project Proposal or SRS** (Section 13).


---

## 12. Decision status — approved (2026-11-12) and residual

### 12.1 Approved owner decisions

Recorded 2026-11-12 (see Sections 4, 5.4, 6, 7, 9 and `docs/p4-technical-design.md`):

- **D-1** Follow-up timer: **elapsed 48 hours** from Reached Home Safely (Section 7.1).
- **D-2** Follow-up questionnaire wording approved (Section 7.4).
- **D-3** Notification architecture approved (Section 9).
- **D-4** Live status: **Supabase Private Broadcast** (Section 6.3).
- **D-5 / D-10** Admin/Super-admin visibility of donation details and follow-up evaluation
  approved (Section 7.3).
- **D-6** Concurrency: **Option 2** — preserve the `blood_requests.status` contract; identify
  accepted requests via the engagement with `UNIQUE (request_id)`.
- **D-7** One follow-up response per engagement (Section 7.2).
- **D-8** Feeling and follow-up are **separate** submissions (Section 7.5).
- **D-9** Store the authoritative due timestamp; append-only status-event history; preserve the
  original submitted response for audit.
- **D-11** P4.1 three-table schema scope: `donation_engagements`, `donation_status_events`,
  `donation_followup_responses`; no `interest_id`; no `submitted_by`; both follow-up timestamps;
  `additional_comments` ≤ 500; RESTRICT FKs; one engagement per request; one active engagement per
  donor.
- **D-12** Status-event actor: donor-only, NOT NULL (`actor_role='donor'`, `actor_id = donor_id`).
- **D-13** `updated_at` maintained by later RPCs (no trigger); reject follow-up before
  `follow_up_due_at`; insert response and set `follow_up_submitted_at` atomically.

### 12.2 Residual implementation details (not requirement decisions)

- Exact contact-field access for admins (donor and beneficiary **identities** are approved, but
  the precise set of private contact fields an admin may see is not fixed).
- Notification delivery preferences and scheduler choice.
- Admin read filtering/pagination and exact audit-event column naming.

(No longer residual: internal status identifiers use snake_case; `follow_up_due_at` is stored as
an authoritative timestamp; follow-up "due" is computed from that timestamp plus the submission
state; the submission timestamp determines whether the follow-up was submitted; and no separate
`HEALTH_FOLLOW_UP_DUE` status is stored.)

No approved requirement is listed here. The approved Proposal visibility capability (D-5/D-10)
is **not** unresolved.

---

## 13. Missing source documents and conflicts

### 13.1 Missing source document (recommended, not blocking)

- The approved **Project Proposal** and **SRS** are **not present in the repository**.
  Root files are `PROJECT_CONTEXT.md`, `README.md`, `AGENTS.md`, `LICENSE`, and config;
  `docs/` contains only `admin-donor-verification.md`, `blood-request-management.md`,
  `database-baseline-review.md`, `donor-donation-eligibility.md`,
  `super-admin-management.md`, and `user-deletion-data-retention-policy-proposal.md`.
- A recursive filename search for `proposal|srs|requirement` found **no** such file
  (only the unrelated `user-deletion-data-retention-policy-proposal.md`).
- **Consequence:** the detailed P4 rules (acceptance, disclosure, statuses, feeling,
  follow-up, one-active-donation) have **no authoritative repo text**. They are recorded
  here as **owner confirmations (B)**. The project owner has now confirmed these P4 rules
  for the workflow; it is still recommended that the approved Proposal/SRS be added to the
  repository so they become fully traceable source-of-truth requirements.

### 13.2 Identity visibility — **resolved (scoped P4 rule)**; older statement needs sync

- **Resolved for P4 (B):** the beneficiary can view the donor's identity **only after the
  donor accepts that beneficiary's blood request** (i.e. at `SELECTED`). Before acceptance
  the donor's identity stays hidden; after acceptance it is revealed only to that
  request's owner. This is the agreed scoping; the conflict is no longer open for P4.
- **Documentation synchronisation — done:** the older `PROJECT_CONTEXT.md` statement
  ("Beneficiary sees aggregate interest counts, **not** donor identities") was corrected in the
  P4 documentation synchronisation so it now records the scoped P4 rule (identity hidden before
  acceptance; visible to that beneficiary only after acceptance).
- Ordinary interest browsing (before acceptance) must still keep donor identities hidden.

### 13.3 Consistency check — M7 scope note

- `docs/blood-request-management.md:149` states the M7 phase "does not notify donors,
  exchange contact details, **select a donor**, record a collection, or mark a donation
  complete. Those capabilities require a later reviewed workflow, privacy model, and
  audit design." This **agrees** with this document: P4 is that later workflow. No
  conflict — it confirms P4 is a new, separately-reviewed phase.

### 13.4 Requirement classification summary

- **A — Approved requirement (repo-traceable):** donor eligibility four-month rule and
  automatic restoration; `apply_donation_ended` integration contract; donation history
  via `donor_donations`; admin donation-date correction; server-side enforcement; M7
  donor RPC eligibility gating.
- **B — Owner-approved (2026-11-12):** donor-driven acceptance; **identity visible only after
  acceptance**; the SELECTED → REACHED_LOCATION → DONATION_STARTED → DONATION_ENDED →
  REACHED_HOME_SAFELY lifecycle; Donation Ended vs. Reached Home Safely meanings (Donation Ended
  = donation complete + 4-month cooldown starts; Reached Home Safely = full cycle complete);
  feeling values OK/So-so/Not well; **48-hour** timer starting at Reached Home Safely; **one
  active donation per donor, released only at REACHED_HOME_SAFELY**; beneficiary live status;
  beneficiary may view follow-up responses; admin visibility (Proposal); notification
  architecture; separate feeling/follow-up submissions; no GPS tracking.
- **C — No longer pending:** the former proposals (notification architecture, questionnaire
  wording, real-time transport) are now **approved** (D-2/D-3/D-4).
- **D — Residual implementation details only:** Section 12.

---

## 14. Review checklist and change log

### 14.1 Owner review checklist

- [x] Identity-disclosure scoping — **approved**: donor identity visible to the beneficiary only
  after donor acceptance (Section 4, Section 13.2).
- [x] One-active-donation release point — **approved**: released only at `REACHED_HOME_SAFELY`
  (Section 5.4).
- [x] Questionnaire wording — **approved** (Section 7.4).
- [x] Real-time transport — **approved**: Supabase Private Broadcast (Section 6.3).
- [x] Notification architecture — **approved** (Section 9).
- [x] Admin/Super-admin visibility of donation details + follow-up evaluation — **approved**
  (Section 7.3).
- [x] Two-day measurement basis — **approved**: elapsed 48 hours (Section 7.1).
- [x] Feeling vs. follow-up — **approved**: separate submissions (Section 7.5).
- [x] Synchronise the older identity-visibility statement in `PROJECT_CONTEXT.md` — done
  (Section 13.2).
- [x] D-11 P4.1 three-table schema scope — **approved**.
- [x] D-12 Status-event actor (donor-only, NOT NULL) — **approved**.
- [x] D-13 `updated_at` maintenance + follow-up submission rules — **approved**.
- [ ] Separate implementation authorization for the migration, the Realtime setting,
  notifications, and the scheduler.

### 14.2 Change log

| Date | Change | Author |
|---|---|---|
| 2026-11-12 | Initial documentation draft created from repo inspection and owner confirmations. No code/SQL/Supabase/Git changes. | — |
| 2026-11-12 | Revision 2: resolved donor identity-disclosure scoping (Section 4/13.2) and the one-active-donation release point (Section 5.4); clarified lifecycle and two-day-timer semantics (Sections 5.1/5.3); removed the two resolved items from Section 12; updated Section 14.1 checklist. No code/SQL/Supabase/Git changes. | — |
| 2026-11-12 | Revision 3: recorded all owner-approved decisions (D-1…D-10) — 48-hour timer, approved questionnaire, approved notification architecture, private-Broadcast live status, admin visibility, separate feeling/follow-up, one response per engagement; updated Sections 6, 7, 9, 12, 13, 14. No code/SQL/Supabase/Git changes. | — |
| 2026-11-12 | Revision 4: synchronized D-11 (three-table schema scope), D-12 (donor-only status-event actor), D-13 (`updated_at` RPC-maintained; reject follow-up before `follow_up_due_at`; atomic same-timestamp write); updated Sections 5, 7, 12, 14. No code/SQL/Supabase/Git changes. | — |
| 2026-11-12 | Revision 5: made the non-decreasing lifecycle timestamp ordering a **mandatory** invariant (Section 5.2) and clarified that row-level CHECKs enforce the timestamp rules while later RPCs enforce transition order and actor authorization. No code/SQL/Supabase/Git changes. | — |

### 14.3 Safety confirmation

This document was created and revised (Revisions 2–4) under the P4 documentation-only tasks. No
application source code, SQL migration, database schema, feature flag, Supabase project, or Git
state was modified. The update changed only documentation: `docs/donation-workflow.md`,
`docs/p4-technical-design.md`, and `PROJECT_CONTEXT.md`.

