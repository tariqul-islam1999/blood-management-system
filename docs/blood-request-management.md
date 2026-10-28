# Blood Request Management Ã¢â‚¬â€ Phase 1 database draft

## Status

This is a local, review-only database draft. It has not been applied to Supabase, and the mobile client must keep blood-request actions unavailable until a separately approved deployment and verification are complete.

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
4. **Deployment blocker:** a separately reviewed and applied hardening migration must remove all effective client `TRIGGER` privileges, including inherited and `SET ROLE` paths, from the six existing BMS tables. This repository's baseline and TRUNCATE-only migration do not provide that hardening.
5. **Deployment blocker:** a separately reviewed and deployed donor-verification workflow must prevent unverified donors from becoming eligible. At minimum this migration requires a non-null `verification_status` with a `pending` default; deployment must also verify the workflow's authorization and review controls. Do not assume the existing donor-verification draft is safe or deployed.

The super-admin and donor-verification draft migrations are not modified or replayed by this migration. If a database has no Supabase migration history, do **not** run `db push`, reset, repair, or replay baseline migrations. After both blockers are independently deployed and verified, execute only this migration through the approved migration runner as one transaction with stop-on-error. First apply and verify in an isolated development project with representative, non-sensitive fixtures. Do not enable a frontend feature flag merely because SQL applied.

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

No Supabase connection or SQL execution occurred while drafting these files, so none of those runtime checks have been performed here.

## Recovery and limitations

The migration has no automatic down migration. It adds tables, indexes, functions, grants, and RLS configuration, but no direct-table RLS policies and no existing-row changes. If a deployment fails inside a transaction, PostgreSQL rolls it back atomically. If a successful deployment must be reversed, first disable the client feature and preserve any request/interest records required for audit or support. A reviewed rollback migration can revoke RPC execution and drop the new objects only after confirming no dependent code or retained records need them. Do not delete user, donor, beneficiary, or verification-history records as a rollback shortcut.

This phase does not notify donors, exchange contact details, select a donor, record a collection, or mark a donation complete. Those capabilities require a later reviewed workflow, privacy model, and audit design.