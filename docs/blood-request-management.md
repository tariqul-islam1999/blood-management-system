# Blood Request Management Ã¢â‚¬â€ Phase 1 database (deployed to BMS-Development 2026-11-10)

## Status

**Deployed to BMS-Development (`zbgqpqafvcxaoxxcuyxn`) on 2026-11-10.** The mobile
client must still keep blood-request actions unavailable until runtime behavioural
testing and a separate activation approval are complete.

> Historical note (superseded): this document previously stated "This is a local,
> review-only database draft. It has not been applied to Supabase, and the mobile client
> must keep blood-request actions unavailable until a separately approved deployment and
> verification are complete." That was accurate until the approved deployment on
> 2026-11-10 and is kept here for the record.

**Amended 2026-11-10 (applied the same day):** both donor RPCs refresh automatic
availability and enforce the four-month donor-eligibility rule (SQLSTATE 55000 while
the donor is inside the recovery period). The file depends on
`20261027000100_donor_donation_eligibility.sql`, which was applied first; the preflight
fails closed otherwise. Reviewed and deployed SHA-256:
`9E6ABA56F00C5A171C3149889DFEED050AB130B2503F33C735C699F618745953`
(the previously reviewed hash is superseded). Deployment order is
M6 → donor eligibility → M7.

**2026-11-10 correction:** the eligibility dependency check was moved out of the
verification-status branch so it always executes inside the preflight; the reviewed
SHA-256 above reflects that change. Re-validated offline with the PostgreSQL 17 parser
(pglast 7.22, libpg_query 17.7): 28 top-level statements, 7 PL/pgSQL bodies, 0 syntax
errors. That validation was parser-only and was performed before deployment — see the
deployment record below.

## Deployment record — 2026-11-10 (BMS-Development)

- **Target:** BMS-Development, project ref `zbgqpqafvcxaoxxcuyxn`. The Main project
  `zmxtxuuooviwjsdghqlt` was not accessed or modified.
- **Method:** project-pinned Supabase CLI 2.121.0 over an IPv4 pooler link, run from an
  isolated temporary workdir containing `config.toml` plus M1–M6, the eligibility
  migration and M7; every copied migration hash was verified before use.
- **Preflight:** `migration list --linked` recorded M1–M6 and `20261027000100` as
  applied and `20261028000100` as pending; `db push --dry-run --linked --skip-vault
  --yes` proposed exactly `20261028000100_blood_request_management.sql`.
- **Apply:** `db push --linked --skip-vault --yes` applied only
  `20261028000100_blood_request_management.sql` and finished successfully. No other
  migration was applied and no `migration repair`, reset or manual SQL was used.
- **Deployed SHA-256:** `9E6ABA56F00C5A171C3149889DFEED050AB130B2503F33C735C699F618745953`.
- **Verification (read-only, after the apply):** migration history records M7 in both
  Local and Remote columns; `public.blood_requests` and `public.blood_request_interests`
  exist with RLS enabled (not forced), owned by `postgres`, and **zero** RLS policies;
  all six expected indexes are present; the five RPCs are `postgres`-owned,
  `SECURITY DEFINER`, `search_path=""`, `lock_timeout=5s`, executable by
  `authenticated` to the exclusion of `anon`; `anon` and `authenticated` hold no direct
  table or column privileges on either new table; the eligibility dependencies
  (`donor_donations`, `donor_is_eligible(date)`,
  `refresh_eligible_donor_availability()`) still resolve.
- **Not verified:** no RPC has been called as a real beneficiary or donor. Runtime
  authorization, cross-user isolation, the `55000` cooldown behaviour, and
  cancellation/interest concurrency remain untested. **Frontend activation is still
  gated** behind a separate approval; do not enable the blood-request UI on the basis of
  a successful migration alone.

M7 is unchanged by the 2026-11-10 eligibility/date fixes: its donor RPCs call the eligibility helper, which now uses the Asia/Dhaka calendar day (UTC+6). Request `needed_by` validity inside M7 still compares the UTC date and is intentionally unchanged.

The migration creates a deliberately small request workflow:

- An active `beneficiary` creates, lists, and cancels only their own requests.
- An active `donor` may browse open requests only when their donor profile is `approved` and `available`.
- A donor can express interest only when their blood group exactly matches the requested group.
- Interest is a willingness to help. It is never a confirmed or completed donation.
- A cancelled request cannot receive new interest. Phase 1 has no fulfilment, matching, contact sharing, or donation-completion state.

## Data and privacy model

`public.blood_requests` stores the owning beneficiary, requested blood group, a snapshot of the beneficiary profile location, requested units, urgency, needed-by date, and `open`/`cancelled` status. It intentionally contains no phone number, email address, name, medical notes, or beneficiary contact details.

`public.blood_request_interests` stores the donor/request association internally. Neither listing RPC returns the association identity:

- Beneficiaries receive an aggregate `interest_count` only.
- Donors receive request details suitable for browsing and their own boolean `has_expressed_interest` only.

Exact blood-group equality is an application rule for this first version. It is not medical compatibility advice and must not be widened without a reviewed clinical policy.

## RPC contract

All functions use `auth.uid()` for identity, obtain role and account state from `public.profiles`, and run as `SECURITY DEFINER` with `search_path = ''`.

| RPC | Caller | Inputs | Result |
| --- | --- | --- | --- |
| `beneficiary_create_blood_request` | active beneficiary | blood group, units 1Ã¢â‚¬â€œ10, `routine`/`urgent`, needed-by date | newly created request, with zero interests |
| `beneficiary_list_my_blood_requests` | active beneficiary | page 1Ã¢â‚¬â€œ50, offset 0Ã¢â‚¬â€œ100000 | caller-owned requests and aggregate interest counts |
| `beneficiary_cancel_blood_request` | active beneficiary | request UUID | cancelled caller-owned open request |
| `donor_list_open_blood_requests` | active, approved, available donor | page 1Ã¢â‚¬â€œ50, offset 0Ã¢â‚¬â€œ100000 | exact-group open requests and callerÃ¢â‚¬â„¢s interest flag |
| `donor_express_interest` | active, approved, available exact-group donor | request UUID | `interest_status = interested` |

Create validates the supplied fields and derives location from the protected beneficiary profile. Request dates must be today through 90 days ahead. The migration performs no historical data update and does not alter donor availability, verification, profiles, authentication, photos, or administrative objects.

## Security design

Both new tables have RLS enabled and deliberately have no client-facing RLS policies or direct table grants. `PUBLIC`, `anon`, `authenticated`, and `service_role` receive no direct table privileges. Only `authenticated` receives execute permission on the five intended RPC signatures; anonymous callers receive none. The PostgreSQL-owned definer functions access the tables through fully qualified names.

Each function locks the profile rows needed for its authorization decision. Cancellation and interest both lock the target request row with `FOR UPDATE`, so they serialize: after cancellation wins, a later interest fails; after an interest commits, a cancellation may proceed while retaining the internal historical interest row. The unique `(request_id, donor_id)` constraint and conflict handling prevent duplicate interest under concurrent calls.

The migration preflight refuses to proceed if expected BMS prerequisite relations have a different owner, lack RLS, required Supabase roles/functions are absent, target objects already exist, or the existing baseline has unsafe effective `TRUNCATE`, `TRIGGER`, or protected-profile DML privileges. It also rechecks effective privileges after creating the objects. Do not weaken those guards to deploy it.

## Prerequisites and deployment order

Before any deployment, an authorized database reviewer must confirm the target is the intended non-production or production project and that it has:

1. PostgreSQL 17 with the `postgres` migration role, Supabase `auth.uid()`/`auth.users`, and `anon`, `authenticated`, and `service_role` roles.
2. The existing BMS baseline schema: `profiles`, `donor_profiles`, `beneficiary_profiles`, and donor-availability tables, owned by `postgres` with RLS enabled.
3. No existing blood-request tables, indexes, or RPCs with the names in this migration.
4. **Deployment blocker (satisfied on BMS-Development):** a separately reviewed and applied hardening migration must remove all effective client `TRIGGER` privileges, including inherited and `SET ROLE` paths, from the six existing BMS tables. The repository contains a dedicated migration at `supabase/migrations/20261023000350_revoke_client_trigger.sql` that hardens client `TRIGGER`, `REFERENCES` and `MAINTAIN` privileges. That migration **was applied to BMS-Development on 2026-11-09**, so the earlier wording "that draft has **not been applied or runtime-verified**" is superseded for that project; its pgTAP and runtime checks remain unexecuted. The baseline and TRUNCATE-only migration do not themselves provide the hardening.
5. **Deployment blocker (satisfied on BMS-Development):** a separately reviewed and deployed donor-verification workflow must prevent unverified donors from becoming eligible. At minimum this migration requires a non-null `verification_status` with a `pending` default; deployment must also verify the workflow's authorization and review controls. Donor verification `20261023000400` (M5) **is applied to BMS-Development**, so the prerequisite is satisfied there, although its end-to-end runtime behaviour is still untested. On any other target this blocker still applies in full.

The super-admin and donor-verification draft migrations are not modified or replayed by this migration. If a database has no Supabase migration history, do **not** run `db push`, reset, repair, or replay baseline migrations. After both blockers are independently deployed and verified, execute only this migration through the approved migration runner as one transaction with stop-on-error. First apply and verify in an isolated development project with representative, non-sensitive fixtures. Do not enable a frontend feature flag merely because SQL applied.

On BMS-Development both blockers were already in place when this migration was applied on 2026-11-10, and the preflight confirmed the eligibility dependencies. The fail-closed guard exercise below and the pgTAP suite have still **not** been executed anywhere.

## Test setup and verification

`supabase/tests/database/blood_request_management.test.sql` is a pgTAP integration draft. It expects an isolated disposable database where the baseline schema and this migration have already been applied, pgTAP is available as `extensions`, and the listed fixture UUIDs are unused. It creates only rollback-scoped fixtures and ends with `ROLLBACK`.

The tests cover forged signup metadata rejection, signed-out/wrong-role denial, server-side validation, ownership, pagination bounds, exact matching, expired-request exclusion, inactive/pending/unavailable donor denial for both browsing and interest, duplicate interest, direct table access denial, cancellation, post-cancellation rejection, aggregate-only beneficiary results, a source-level lock assertion, and rollback after a synthetic insert failure.

The post-migration pgTAP file cannot safely prove that this migration's pre-apply ACL guard would reject a bad existing permission: by that point the guard has already run. Before deployment, use an isolated disposable target and run the migration through the intended migration runner in separate transactions after injecting each fault below. Each run must fail and roll back without leaving the new objects behind:

1. Grant `TRIGGER` on an existing BMS table directly, through `PUBLIC`, through an inherited role, and through a `SET ROLE`-only role reachable by `anon` or `authenticated`.
2. Grant protected profile `INSERT`, `UPDATE`, or `DELETE` directly or through an inherited/`SET ROLE` path.
3. Grant a direct privilege on either new table through a default privilege for a custom role reachable by `anon` or `authenticated`, then confirm the post-create guard rejects it. (The migration intentionally revokes direct grants to `PUBLIC`, `anon`, `authenticated`, and `service_role`.)
4. Grant anonymous execution of one request RPC and confirm the guard rejects it.

Remove every injected grant inside the disposable test transaction. Do not run these fault injections on a shared or production database.

Before enabling the client, also perform these manual, isolated-environment checks:

1. In two sessions, hold `donor_express_interest` on one open request while another session cancels it; verify serial execution and that no interest commits after a completed cancellation.
2. Inspect `information_schema.routine_privileges`, table privileges, RLS status, and function definitions to confirm only the five authenticated RPCs are executable and no direct client table privileges exist.
3. Test expired session, inactive profile, unapproved donor, unavailable donor, mismatched group, cross-beneficiary cancellation, and no contact details in either RPC result.
4. Verify existing approved and pending donors, availability data, profiles, photos, admin features, and authentication remain unchanged.

> Historical note (superseded): while these files were being drafted, "no Supabase
> connection or SQL execution occurred", so none of the runtime checks above had been
> performed at that time. The migration is now applied to BMS-Development, but the
> runtime checks listed above are **still outstanding**: no beneficiary or donor RPC has
> been invoked as a real user, and no concurrency test has been run.

## Recovery and limitations

The migration has no automatic down migration. It adds tables, indexes, functions, grants, and RLS configuration, but no direct-table RLS policies and no existing-row changes. If a deployment fails inside a transaction, PostgreSQL rolls it back atomically. If a successful deployment must be reversed, first disable the client feature and preserve any request/interest records required for audit or support. A reviewed rollback migration can revoke RPC execution and drop the new objects only after confirming no dependent code or retained records need them. Do not delete user, donor, beneficiary, or verification-history records as a rollback shortcut.

This phase does not notify donors, exchange contact details, select a donor, record a collection, or mark a donation complete. Those capabilities require a later reviewed workflow, privacy model, and audit design.

## Donation Ended integration point (four-month eligibility)

The donor-eligibility migration `20261027000100_donor_donation_eligibility.sql` adds
`public.apply_donation_ended(p_donor_id, p_donated_on, p_source, p_recorded_by, p_note)`
as an **owner-only internal helper** with no client EXECUTE grant. It is the single
place that writes donation history, updates `donor_profiles.last_donation_date`, makes
the donor unavailable and starts the calendar-month recovery period.

This phase deliberately exposes no donor-facing "record donation" action. When the
approved **Complete Donation Workflow** is implemented, its completion RPC must:

1. lock and authorise the request/interest rows for the current donor and request;
2. transition the interest row (or its approved replacement) to the reviewed
   "donation ended" / completed status inside the same transaction;
3. call `public.apply_donation_ended(p_donor_id, p_donated_on, 'donor', auth.uid(), p_note)`
   before committing, so the status transition and the eligibility data are atomic.

`public.admin_correct_donor_donation_date(uuid, date, text)` remains the reviewed
correction path for administrators and is not a substitute for that transition.
M7's donor RPCs already fail closed for donors who are inside the recovery period.
