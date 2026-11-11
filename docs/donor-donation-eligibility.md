# Four-Month Donor Eligibility and Donation History — database (deployed to BMS-Development 2026-11-10)

## Status

**Applied to BMS-Development (`zbgqpqafvcxaoxxcuyxn`) on 2026-11-10.** The mobile
client still keeps the feature behind `DONOR_ELIGIBILITY_SERVICE_ACTIVE = false` in
`src/lib/donor-eligibility.ts`; frontend activation remains a separate, ungranted
approval.

> Historical note (superseded): this document previously stated "Local, review-only
> draft. **Not applied to any Supabase project.**" That was accurate until the approved
> deployment on 2026-11-10 and is kept here for the record.

- Migration: `supabase/migrations/20261027000100_donor_donation_eligibility.sql` —
  **applied 2026-11-10** and recorded in the remote migration history.
- Amends: `supabase/migrations/20261028000100_blood_request_management.sql` (M7) —
  **applied 2026-11-10**, after this migration (the earlier "(unapplied)" label is
  superseded).
- Reviewed and deployed SHA-256:
  - eligibility `A651CC4BD198C8575065F91DEC8DA83BAEA7382B2523179764EF876B032A02D3`
  - M7 `9E6ABA56F00C5A171C3149889DFEED050AB130B2503F33C735C699F618745953`
    (supersedes `D99C25911443135F6205694863CE37BD69356E789C46C18D27FD4A85EB60FCCC`
    after the unconditional eligibility-dependency-check correction)
- Applied prerequisite hashes: M5 `3DE66B4C…7E3ECF` (applied),
  M6 `4458B5A3…C2CF5D` (applied).

## Approved decisions implemented

1. Eligibility returns **four calendar months** after the donation date
   (`donation + INTERVAL '4 months'`, so 31 Jan → 31 May). Not 120 days.
2. A "Donation Ended" event creates the history row and updates
   `donor_profiles.last_donation_date` automatically (single database helper).
3. Administrators can correct a donor's donation date with a required reason.
4. Donors automatically regain eligibility and availability after the period.
5. Eligibility is enforced in donor search and in blood-request matching.
6. M7 is amended to enforce eligibility; both files were applied to BMS-Development on
   2026-11-10 (this bullet previously read "it is still unapplied").

## Objects

**Table `public.donor_donations`**: `id uuid PK`, `donor_id → donor_profiles(user_id)
ON DELETE CASCADE`, `donated_on date ≤ CURRENT_DATE`, optional `note` (1–200 chars),
`source ('donor'|'admin')`, `recorded_by → profiles(id)`, `recorded_at`,
`UNIQUE (donor_id, donated_on)`. Owner `postgres`, RLS enabled, **no policies and no
client grants**, index `(donor_id, donated_on DESC, id DESC)`.

**Helpers (owner-only, no client EXECUTE)**
- `bms_local_date() → date` — the Bangladesh calendar day (`now() AT TIME ZONE
  'Asia/Dhaka'`), used by every eligibility decision instead of the UTC `CURRENT_DATE`.
- `donor_next_eligible_date(date) → date` — calendar-month arithmetic (IMMUTABLE).
- `donor_is_eligible(date) → boolean` — STABLE, compares against `CURRENT_DATE`.
- `refresh_eligible_donor_availability() → integer` — restores `available` and writes
  availability history **only** for donors made unavailable by the system donation
  reason; personal reasons are untouched.
- `apply_donation_ended(p_donor_id, p_donated_on, p_source, p_recorded_by, p_note)` —
  the single writer of donation history + `last_donation_date` + forced unavailability
  + availability history. **No donor-facing recording RPC exists.**

**RPCs (`authenticated` only)**
- `get_my_donor_eligibility()` → last donation, next eligible date, eligible flag,
  days remaining, availability (runs the refresh first).
- `list_my_donations(limit, offset)` → own history, bounded pagination.
- `admin_correct_donor_donation_date(target, date, reason)` → active admin/super admin,
  10–500-char reason, updates the latest record (or inserts an admin record). It now
  loads the second-latest record as well and rejects the correction (no data changed)
  when the date is not after it or falls inside the 4-month cooldown; it also rejects
  date conflicts. Availability and history are recalculated on success.

**Existing functions replaced (signatures unchanged)**
- `set_my_donor_availability` / `update_my_donor_availability` — reject `available`
  during the recovery period (SQLSTATE 55000).
- `search_available_donors` — refreshes, then requires eligibility in addition to
  approved + available.

**M7 changes**
- Preflight requires `donor_donations`, `donor_is_eligible(date)` and
  `refresh_eligible_donor_availability()` (fails closed if the eligibility migration
  was not applied first). The check is a standalone sibling `IF … END IF` inside the
  preflight `DO` block, so it always runs; it is not nested inside the
  `verification_status` default check.
- `donor_list_open_blood_requests` and `donor_express_interest` refresh availability
  and reject ineligible donors with `55000`.

## Security model

All objects are `postgres`-owned, `SECURITY DEFINER` where applicable, with
`search_path = ''`, fully qualified references and a 5 s lock timeout. The migration
fails closed on: unexpected prerequisites, pre-existing objects, unexpected ownership,
RLS disabled, client policies on `donor_donations`, any client table privilege, any
client EXECUTE on internal helpers, and anon/service_role EXECUTE on public RPCs.
Existing client write restrictions on `donor_profiles` (M3/M6) are unchanged.

## Ordering and dependencies

`M6 (20261026000100)` → **eligibility (20261027000100)** → `M7 (20261028000100)`.
M7's preflight enforces the dependency, so applying M7 first fails instead of creating
unenforced donor RPCs.

This order was executed on 2026-11-10 against BMS-Development: eligibility was applied
first, and the M7 dry-run then proposed only `20261028000100`.

## Validation performed

- PostgreSQL 17 parser (pglast 7.22, libpg_query 17.7), run offline with no database:
  eligibility migration **43 top-level statements, 10 PL/pgSQL bodies, 0 syntax
  errors**; M7 (hash above) **28 top-level statements, 7 PL/pgSQL bodies (2 `DO`
  blocks and 5 functions), 0 syntax errors**. Re-measured on 2026-11-10 after the
  unconditional dependency-check correction with `pglast.parser.split`; this
  supersedes the earlier "38 statements" count for the eligibility file.
- `tsc --noEmit` clean.

> Historical note (superseded): the parser validation above was performed before
> deployment, so the earlier statement "No SQL executed, no migration applied, and no
> ACL/runtime behaviour exercised" described that moment only. Both migrations were
> subsequently applied on 2026-11-10 and the deployment was verified as recorded below.

## Post-deployment verification — 2026-11-10 (BMS-Development)

Read-only catalogue checks after the approved apply; no schema change was made during
verification.

- Target: BMS-Development `zbgqpqafvcxaoxxcuyxn`. Main project `zmxtxuuooviwjsdghqlt`
  was not accessed or modified.
- `migration list --linked`: `20261027000100` and `20261028000100` are recorded in both
  the Local and Remote columns; M1–M6 remain applied.
- Eligibility dependencies resolve: `public.donor_donations`,
  `public.donor_is_eligible(date)` and `public.refresh_eligible_donor_availability()`.
- M7 tables: `public.blood_requests` and `public.blood_request_interests` exist with
  RLS enabled (not forced), owned by `postgres`, and **zero** RLS policies.
- M7 indexes present: `blood_requests_pkey`,
  `blood_requests_beneficiary_created_idx`, `blood_requests_open_browse_idx`,
  `blood_request_interests_pkey`,
  `blood_request_interests_request_id_donor_id_key`,
  `blood_request_interests_request_idx`.
- M7 RPCs: all five are owned by `postgres`, `SECURITY DEFINER`, configured with
  `search_path=""` and `lock_timeout=5s`; `authenticated` has EXECUTE and `anon` does
  not.
- Direct client privileges on both new tables: none for `anon` or `authenticated`
  (table-level and column-level).

**Still pending:** runtime behavioural tests. No RPC has been called as a real
beneficiary or donor, so authorization paths, cross-user isolation, the `55000`
recovery-period rejection, cancellation/interest concurrency and runtime ACL behaviour
remain unverified. Frontend activation is still gated behind a separate approval.

## Deployment outline (executed 2026-11-10)

This outline was followed for BMS-Development on 2026-11-10, with one recorded
difference: eligibility had already been applied, so the M7 dry-run correctly proposed
only M7. Step 5 is only partly done — objects and ACLs were verified read-only, but the
frontend gate was **not** activated and no donor smoke test was run.

1. Confirm remote history: M1–M6 applied, M7 unapplied (historical state; M7 is now
   applied as recorded above).
2. Isolated temporary workdir with `config.toml` plus M1–M6 **and** the eligibility
   migration (M7 excluded); verify every copied hash; the dry-run must propose exactly
   that one file.
3. Apply with the project-pinned CLI (`db push --linked --skip-vault --yes`), then
   confirm `migration list` records it.
4. Re-review and deploy the amended M7 separately (its hash changed), using the same
   procedure with M1–M6 + eligibility + M7 present; the dry-run must propose only M7.
5. Verify objects and ACLs through an approved read-only SQL channel, then activate the
   frontend gate and run a donor smoke test.

## Known risks / limitations

- **Writes during read RPCs**: the refresh runs inside search, eligibility and M7 donor
  RPCs. On a busy database this adds row locks and availability-history rows; it is
  bounded to donors whose recovery has ended but should be revisited before scale.
- **Exact-reason coupling**: automatic restoration depends on the system reason text
  `Donation recovery period: automatically unavailable until the 4-month eligibility
  date.` Editing that row prevents automatic restoration.
- **Date basis**: eligibility, availability restoration, donor search and M7 donor RPCs
  now use the Asia/Dhaka calendar day (UTC+6, no DST), including the two donation-date
  constraints. Blood-request `needed_by` expiry inside M7 still compares the UTC date;
  that is a request-validity rule, not donor eligibility, and is unchanged pending a
  separate decision.
- **Admin correction ordering**: enforced against the second-latest record (strictly
  later, and at least four calendar months after it). Only the newest record can be
  corrected; older-history repairs remain a separate reviewed operation.
- **No donor-facing recording** until the Complete Donation Workflow exists; until then
  history changes only through admin correction.
- **No runtime tests**: the files were syntax-validated with the real PostgreSQL 17
  parser and then applied, but no RPC has been exercised at runtime; concurrency
  (interest vs. completion) and ACL behaviour remain unverified.
- ~~M7 remains unapplied~~ — superseded on 2026-11-10: M7 was applied with SHA-256
  `9E6ABA56F00C5A171C3149889DFEED050AB130B2503F33C735C699F618745953`, superseding its
  earlier reviewed hash `D99C2591…EB60FCCC`.

