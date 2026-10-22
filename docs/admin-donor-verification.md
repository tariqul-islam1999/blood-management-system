# Admin donor verification: Phase 1 database drafts

Status: local review drafts only, prepared 2026-10-23. Nothing has been applied.
Approval to create these files is not approval to execute SQL, connect a project,
install test tools, change migration history, provision an admin, or deploy an app.
There is no Admin UI in this phase.

## Files and source evidence

- supabase/migrations/20261023000400_admin_donor_verification.sql
- supabase/tests/database/admin_donor_verification.test.sql
- docs/admin-donor-verification.md (this document)

Reviewed against the three existing historical migrations and
docs/database-baseline-review.md. Those files remain unchanged. Original exports
are documented there; this phase did not reread external exports or credentials.
Local definitions are evidence of intended structure, not current live state.

Historical migration SHA-256 values before this phase:
- 20261023000100_baseline_public.sql:
  C64BD0CD59B9F44CE6382167D40F48435BDE114D610CB0E1B7205698833D2B08
- 20261023000200_baseline_auth_storage.sql:
  04D79D639D452BAC600C19EF730EB71F4EFD4B6FFAD9809D356A8398A23B950F
- 20261023000300_revoke_client_truncate.sql:
  02808824818BC456945E37447D24B4904EB7EBCA7DF33A1E107C0CDF5371796A

## Prerequisites and safe failure

Use only a separately approved, isolated Supabase PostgreSQL 17 target with
synthetic users. Docker/local testing remains postponed. Do not substitute the
live project as a test target.

An initialized Supabase platform, all three prior migrations, and the separately
reviewed TRIGGER hardening below are prerequisites. Reconstruct with migrations
1..3, perform the approved hardening step, then migration 4. Use the reviewed
transactional CLI runner for migration files.
The new migration requires current_user postgres, the expected six postgres-owned
RLS-enabled BMS tables, auth.uid(), API roles, and no effective client TRUNCATE on
those six tables. This checks observable prerequisites, not migration-history
adoption or full schema equivalence.

The migration has no outer BEGIN/COMMIT. SET LOCAL, permission guards and DDL
depend on one transaction managed by the runner. A failure must roll back this
entire file, including default/NOT NULL changes, audit table, indexes, and RPCs.
Earlier files remain committed: an incomplete sequence is not a secure environment.
Keep it inaccessible to real users. Never bypass guards to force success.

A 5-second migration lock timeout and 60-second statement timeout bound ordinary
lock waits/statements. The donor table is locked ACCESS EXCLUSIVE while checking
and altering verification_status. Even a correct migration can block traffic;
this draft is not approval to apply it to an active system.

Existing NULL/invalid verification statuses cause a stop, not a silent backfill
or promotion. Existing approved/rejected statuses and existing verification
timestamps are preserved. Existing admin objects or conflicting index names also
fail instead of being replaced. Review schema drift separately.

The remote migration-history table was reported absent. Do not run db push on the
existing project: it could attempt to replay fresh-environment baseline files.
A separately reviewed adoption/deployment procedure is still required.

## Data and behavior

The new migration changes verification_status to DEFAULT 'pending' and NOT NULL.
The signup trigger already explicitly inserts pending/unavailable donors and
does not need modification. No existing donor is automatically reclassified.

New table: public.donor_verification_history.
It stores a random UUID event ID, donor ID, reviewer ID, reviewer role at decision
time, pending previous status, approved/rejected new status, optional rejection
reason, and server-generated decision time. No photos, passwords, contact numbers,
email addresses, tokens or connection strings are stored.

Reasons are sensitive administrative text. The future UI should ask for a brief
operational reason and discourage medical details or unnecessary personal data.
No history-reading endpoint or donor-visible reason UI is included in Phase 1.
Only trusted database operators can directly read history under this design.

Foreign keys use ON DELETE RESTRICT to preserve attributable history. This can
block deletion of a reviewed donor or reviewer, including cascaded auth-account
deletion. That is an intentional review decision, not a completed retention policy.
Before deployment, approve retention/anonymization/account-deletion behavior.
Do not silently change these links to CASCADE and erase audit history.

Only pending -> approved or pending -> rejected is supported. Re-review, appeal,
approval revocation and account suspension need separate designs. Approval is
administrative registration review, not proof of medical fitness or blood safety.

## RPC contract

### admin_list_pending_donors(page_size integer = 20, page_offset integer = 0)

Returns donor_id, full_name, blood_group, age_years, last_donation_date, district,
thana, local_area, and registered_at for active pending donors. Age replaces exact
birth date to reduce exposure. It returns no contact details, photos, sessions,
private availability remarks or rejection history.

page_size must be 1..50 and page_offset 0..100000, neither NULL. Results are ordered
by created_at then user_id. This is simple bounded offset pagination: decisions
can move rows between pages, so the future UI should refresh from page zero after
review and tolerate duplicates/skips during concurrent list changes. Keyset
pagination is a later scaling improvement.

### admin_review_donor(target_donor_id uuid, decision text, rejection_reason text = NULL)

decision must be exactly approved or rejected. After authorization, the raw reason
must be at most 4096 bytes before normalization, even when it contains padding.
A rejection needs 10..500 characters
after trimming PostgreSQL POSIX whitespace at both ends. Approval accepts NULL/blank
reason only. Space/tab/newline-only reasons are rejected. Unicode classification
still depends on the target locale and needs runtime testing. This length check
is not content moderation.

Returns donor_id, verification_status, reviewed_at, history_id.
The client supplies neither reviewer identity nor timestamps.

Every privileged RPC:
1. Reads auth.uid(); no JWT user_metadata or client role argument is trusted.
2. Locks and checks the caller's current profiles row: active admin or super_admin.
3. Rejects other callers even though authenticated has permission to invoke the RPC.

The decision RPC additionally locks the active donor's account row and donor row,
rechecks pending status, updates reviewer/status/timestamps, leaves availability
unavailable, and inserts the audit record in the same transaction. It catches no
audit errors. An audit failure must undo the update. Concurrent decisions serialize
on the donor row; a later caller sees no-longer-pending (or must retry after a
serialization/lock failure), rather than overwriting another decision.

FOR SHARE account locks serialize concurrent suspension/demotion with authorized
operations. An already authorized operation can finish before the administrative
change acquires its lock; this does not provide retroactive cancellation.
Locks last until the calling transaction ends. Keep API transactions short.

Responses:
- 42501: active administrator required (or ordinary database permission denial).
- 22023: invalid request, reason, or pagination.
- P0002: active donor not found (also non-donor/inactive targets).
- 55000: donor is no longer pending.
- Lock/serialization errors: refresh state before retrying; never report success.
- Network failure after submission: outcome can be unknown. Refresh queue and,
  if needed, ask a trusted operator to inspect history; do not claim rollback.

## SECURITY DEFINER and permissions

The two functions are deliberately postgres-owned SECURITY DEFINER operations.
They can bypass table RLS, so explicit authorization is mandatory inside BOTH
functions. Each uses an empty search_path, qualified application/platform objects,
fixed SQL, bounded inputs, and no dynamic SQL or caller-supplied actor identity.
Both are VOLATILE (default): listing locks the caller profile and must not be marked
STABLE/read-only. Calls need a writable transaction even for listing.

Functions retain lock_timeout but no longer set statement_timeout inside a running
RPC. Such a setting is not a reliable outer-request deadline. An approved API/role
configuration must supply the top-level statement/transaction deadline. The
migration-runner statement timeout is established before migration statements.

New function ACLs are cleared for PUBLIC, anon, authenticated and service_role
before granting only EXECUTE to authenticated. This grant permits calling, not
administrative authorization. Ordinary signed-in users still fail the internal
role check. No service-role invocation or privileged client key is needed.
No broad UPDATE policy or direct verification/role write grant is added.

The audit table has RLS enabled with no client policies and no client grants.
It uses a UUID key, so it needs no sequence with separate privilege risks.
Existing broad creator defaults are explicitly removed on these new objects.
Schema-wide defaults and existing historical grants remain unchanged.

The final guard checks anon/authenticated and every database role whose rights
they can inherit or reach with SET ROLE. It rejects:
- superuser, BYPASSRLS or CREATEROLE paths;
- ANY effective table/column access to the audit table, including TRUNCATE;
- effective TRIGGER on all six existing BMS tables;
- direct INSERT/UPDATE/DELETE/TRUNCATE on profiles/donor_profiles and column writes;
- anonymous execution of either RPC;
- missing authenticated EXECUTE grants.

has_table_privilege accounts for PUBLIC and inherited rights; SET-role paths are
also enumerated explicitly. Unknown default grantees retaining reachable rights
cause failure and require separate review, not broad automatic revocation.
No TRUNCATE is executed to test privileges.

This is a scoped guard, not a whole-database security proof. It does not audit all
existing functions, policies, unknown privileged operators, role administration,
schema ownership, or future grants. Trusted postgres can still alter history or
bypass business rules. This is an application audit trail, not tamper-proof storage.
Broad future-object defaults and other historical privileges still need separately
approved least-privilege hardening. Existing availability details/history are not
rewritten; review acts only on pending donors and does not invent availability events.

## SQL test draft

The test file is a future pgTAP test, not a migration. It uses BEGIN/ROLLBACK on
purpose. It requires pgTAP already installed in the extensions schema, postgres
with approved fixture role/membership administration, all four migrations plus
the separate TRIGGER hardening, and empty public.profiles. It stops on unsuitable
prerequisites.
It does not install an extension or fetch packages.

It inserts synthetic auth.users records to exercise the existing signup trigger,
then promotes only synthetic fixtures as trusted postgres. Fixed fixture metadata
includes invented phone-shaped values needed by the trigger; these are not real
users, credentials or seed production admins. Any extra target-specific auth
triggers remain a compatibility risk. No real signup email or Storage operation
is part of this test.

The test switches to actual anon/authenticated database roles and supplies synthetic
JWT claims. Privileged postgres does setup/assertions only; authorization calls are
made under the client roles. This verifies SQL permissions and claims handling,
not Supabase Auth token issuance, signature checking, or the HTTP API.

Assertions cover:
- pending default and NOT NULL;
- audit RLS and effective client TRUNCATE denial;
- anonymous, missing identity/profile, donor, beneficiary, suspended admin and
  deactivated super_admin denial for BOTH RPCs;
- forged metadata cannot elevate a donor; conflicting metadata cannot demote a
  valid database admin's authorization;
- active admin/super_admin listing, bounded pagination and inactive-target filtering;
- forbidden direct role/verification updates and audit reads/inserts/deletes;
- invalid decisions, targets and rejection reasons;
- approval, rejection, timestamps, reviewer attribution, unavailable status,
  duplicate/stale decisions and normalized rejection reason;
- injected audit failure rolls back both decision and audit insert.

The test-only failure trigger/function and synthetic records are inside its
transaction. Rollback removes them; never commit this test transaction. Runners
must stop on SQL errors and treat TAP failures as failures. Identity/UUID generation
and other platform side effects are not evidence of a production-safe rehearsal.

Additional isolated tests still needed:
1. Two-session race: approve the same pending synthetic donor from two active
   admins. Keep transaction A open after its RPC, submit B before committing A,
   then commit A within B's lock timeout. B must fail as no-longer-pending;
   exactly one audit row must exist. Also test timeout and serialization retries.
2. Two-session demotion/suspension: hold A's review/list transaction, change its
   actor's role/status from B, and verify blocking; after commit, the next RPC
   must be denied. Repeat with target account suspension.
3. Disposable drift scenarios: existing NULL status, conflicting RPC/object,
   reachable role/PUBLIC grants, column grants, default ACLs and failed
   prerequisites. Confirm failure rolls back the entire migration file and
   preserves earlier migration state. Restore/recreate only the isolated target.
4. Verify the existing donor availability/search/photo RPCs and storage access
   after migration. Test signed-out/inactive users and donor opt-in after approval.
5. Verify real PostgREST RPC discovery, response shapes, JWT handling, top-level
   timeouts and later mobile UI behavior, using only approved synthetic accounts.
6. Verify that account deletion is blocked as documented, then agree retention
   handling before production. Test reason boundaries and non-ASCII input.

Do not start these tests now. Exact execution commands, target selection, tooling,
and any fixture cleanup require separate approval. No live migration-history
repair or baseline replay is authorized.

## Offline verification and limits

Performed only local text/structural checks, a credential-pattern scan reporting
counts rather than values, whitespace checks, and historical-file hash comparison.
These checks do not execute SQL, compile PL/pgSQL, evaluate RLS/ACLs, prove rollback
or concurrency, or certify compatibility with the installed CLI / managed platform.
The SQL test file is drafted, not passed. Database-aware parsing and isolated
runtime tests remain outstanding. No app code changed; TypeScript and app lint
are outside this database-only verification and were not run.

## Official references consulted

- Supabase database functions: definer/search_path and execution privileges:
  https://supabase.com/docs/guides/database/functions
- Supabase database testing / pgTAP:
  https://supabase.com/docs/guides/database/testing
- PostgreSQL 17 privilege inquiry functions, including pg_has_role SET/USAGE:
  https://www.postgresql.org/docs/17/functions-info.html

Before Admin UI implementation, review these drafts, audit-retention behavior,
and test limitations. Approval to prepare the UI or execute database tests is
a separate next step.

## Corrections after the security audit

The six review findings are addressed in the draft design as follows:
1. Effective TRIGGER checks now cover all six existing BMS tables, both directly
   during preflight and through inherited/SET ROLE paths in the final guard.
   No old guard, privilege check, RLS setting or rejection condition was removed.
2. Live deployment remains blocked on migration-history adoption, schema/ACL drift
   review, the separate TRUNCATE fix, and the separate TRIGGER hardening below.
3. Audit foreign keys remain ON DELETE RESTRICT. Proposed closure is deactivation,
   with preserved reviewer identity and history; physical deletion is not enabled.
4. Test drafts now include self-promotion, privileged signup, the complete inactive
   admin role/status matrix, raw reason limits, audit UPDATE/trigger tampering,
   account deletion/deactivation and direct/PUBLIC/inherited/SET ROLE faults.
5. The exclusive migration lock and 5-second lock timeout are retained. Misleading
   function-local statement_timeout clauses were removed; the outer request must
   have an approved top-level deadline. No nontransactional indexes were introduced.
6. Rejection text processing now follows authorization, a 4096-byte raw bound,
   whitespace normalization, then the existing 10..500-character normalized bound.

This changes only drafts. No finding is considered runtime-verified.

## Separate TRIGGER hardening procedure: proposal only

Do not execute this section now. It needs separate approval identifying the exact
target and impact, followed by an isolated rehearsal before any live operation.
This is a targeted permission change, not part of the historical baselines or an
automatic action in migration 4.

The unchanged baseline grants client TRIGGER on profiles, donor_profiles and
beneficiary_profiles. Therefore migration 4 now intentionally FAILS after an
otherwise unchanged three-migration reconstruction. The approved future sequence
must include this separately reviewed prerequisite between migration 3 and 4.
Do not remove the new guard or mark migration 4 applied to avoid that failure.

1. Inventory effective TRIGGER privileges on the six BMS tables for anon and
   authenticated, including PUBLIC, all immediately inherited roles, SET ROLE
   paths, grantors and ownership. Inventory existing noninternal triggers and
   their function ownership/definitions through an approved, secrets-aware review.
   Revoking TRIGGER does not remove triggers already attached to a table.
2. Confirm the original three direct client grants are the only rights needing
   removal. Check legitimate trusted jobs and managed trigger workflows. This
   procedure must not change function execution, table data, ownership, managed
   auth/storage objects, or role memberships.
3. After exact target approval and rehearsal, a trusted operator would run the
   following separately reviewed transaction. This code is documentation, not an
   executed export or migration. A future operator must stop on every SQL error:

~~~sql
BEGIN;
SET LOCAL search_path = '';
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

REVOKE TRIGGER ON TABLE
    public.profiles,
    public.donor_profiles,
    public.beneficiary_profiles
FROM anon, authenticated;

DO $verify_trigger_hardening$
DECLARE
    client_role text;
    reachable record;
    relation_name text;
BEGIN
    FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        FOR reachable IN
            SELECT r.oid FROM pg_catalog.pg_roles AS r
            WHERE pg_catalog.pg_has_role(client_role, r.oid, 'USAGE')
               OR pg_catalog.pg_has_role(client_role, r.oid, 'SET')
        LOOP
            FOREACH relation_name IN ARRAY ARRAY[
                'profiles', 'donor_profiles', 'beneficiary_profiles',
                'donor_availability_details', 'donor_availability_history',
                'donor_availability_reminders'
            ] LOOP
                IF pg_catalog.has_table_privilege(reachable.oid,
                    'public.' || relation_name, 'TRIGGER') THEN
                    RAISE EXCEPTION 'Effective client TRIGGER remains; separate grant-source review required';
                END IF;
            END LOOP;
        END LOOP;
    END LOOP;
END;
$verify_trigger_hardening$;
COMMIT;
~~~

4. Unexpected PUBLIC, parent-role, owner or other grant sources cause rollback;
   do not automatically revoke them, change memberships, or add CASCADE. Review
   the actual sources and obtain approval for any additional exact changes.
   A failed transaction leaves original permissions in place, so keep the target
   isolated/inaccessible until remediation and verification finish.
5. After successful commit, recheck effective ACLs and trusted workflows. Capture
   the approved change and result in version control through a separately reviewed
   forward migration/adoption plan; no additional file is created in this phase.
   Do not leave an undocumented dashboard-only security change.
6. Only then consider migration 4. The new audit table clears its own default
   grants and checks effective privileges. Global/default privileges on other
   future objects remain a separate least-privilege hardening task. Never grant
   TRIGGER back as an automatic rollback; stop rollout and review recovery.

Existing triggers require a separate decision if unexpected: this procedure does
not silently delete or disable them. Postgres-owned definer functions remain a
powerful trust boundary even after this narrow revoke.

## Proposed account-deactivation policy

For a reviewed donor or reviewer, propose a trusted, separately authorized
operation that sets profiles.account_status to deactivated and updates its
updated_at, retaining auth identity, profile identifiers, verification fields and
audit history. Do not delete accounts, anonymize foreign keys, overwrite past
reviewer roles, or cascade-delete history as a shortcut. Retention/anonymization
rules and any exceptional physical deletion require separate approval.

Current login/search/admin/availability checks reject inactive accounts at their
respective entry points. Existing own-row RLS and Storage policies do not uniformly
check account_status. Deactivation alone is therefore NOT a complete session or
data-access revocation mechanism. A future closure workflow must separately
review Auth session invalidation/ban behavior and inactive-account Storage/RLS
access, without privileged keys in the app. Those changes are not implemented here.

Tests draft the intended preservation and admin-RPC denial, not a complete
account-closure product or an approved retention duration.

## Concurrency rehearsal: separate sessions, isolated database only

The single-connection pgTAP file tests stale sequential calls and injected audit
failure. It cannot prove real concurrent scheduling or whole-migration rollback.
No concurrency test has run.

Use two independently authenticated synthetic admins and one fresh active pending
synthetic donor. The pgTAP transaction rolls back its fixtures, so it does NOT
leave reusable users behind. A separately approved disposable fixture setup must
create and commit these accounts first; never change ROLLBACK to COMMIT in the
test file. Do not reuse real users or reset existing production verification.

Draft protocol (also included as comments in the SQL test file):
- Session A: start a writable transaction, set a top-level statement timeout before
  calling the RPC, use the authenticated database role and synthetic admin A claims.
  Approve the pending donor but leave the transaction open.
- Session B: start another transaction with synthetic admin B identity and submit
  rejection for the same donor. It should wait on A's donor-row lock.
- Commit A within B's 5-second lock timeout. B must receive 55000 at READ COMMITTED,
  or a documented serialization error at stricter isolation; roll back B.
- A trusted assertion session checks exactly one audit record, approved status,
  A's reviewer identity, equal decision/audit timestamps and unavailable status.
- Repeat with A rejecting first, A rolling back instead of committing, B timing
  out, and actor/target suspension or demotion racing a held account-row lock.
  After A rolls back, B may succeed: verify only B's event and final status.
- Hold an admin listing transaction open and attempt demotion from another session.
  Verify blocking and that the next call after demotion is denied.
- Use explicit transaction cleanup and the disposable fixture lifecycle approved
  for this target. Do not assume a lost connection proves whether COMMIT happened.

Whole-migration rollback needs another isolated scenario: inject a late permission
failure after the default/table/function changes would have run, apply the draft
through the approved transactional runner, and verify that ALL changes from this
file and its history entry are absent afterward. Earlier migrations remain.
The test helper only exercises the identical guard body under controlled grants;
it does not execute the migration or prove runner/history atomicity.

## Updated test prerequisites and deployment gates

The expanded test file deliberately creates two NOLOGIN nonprivileged fixture
roles, temporarily grants unsafe rights to PUBLIC/client/fixture roles, and changes
test memberships inside its outer rollback-only transaction. These are isolated
fault injections, not examples to run live. The runner needs separately approved
CREATEROLE and membership administration for these fixtures. Managed restrictions
may reject that setup; report the blocker rather than granting broader powers.
No extensions or roles are installed/created during offline review.

The test-only invoker permission helper contains an exact copy of migration 4's
final guard body. Offline comparison must keep both identical. It is not a new
production RPC and it is not an alternative to the actual migration guard.

Before deployment, resolve ALL of:
- Approved isolated target, tooling and test execution, including real PostgREST
  calls, top-level request/transaction deadlines and failure recovery.
- Existing schema, owner, custom-trigger, ACL, role-membership, default-privilege
  and NULL-status inventory. No automatic promotion/backfill is approved.
- Separate TRUNCATE and TRIGGER fixes verified; no guard suppression.
- Migration history adoption for the existing project; no baseline replay/db push.
- Baseline bucket/auth prerequisites on reconstructed targets, without real data.
- Account-deactivation/retention policy and the remaining inactive-session/RLS/
  Storage gaps. Public admin signup and app-based role management stay disabled.
- A separately approved first-admin provisioning process and later Admin UI.
- Regression checks for donor login, availability, photo access and beneficiary
  search; existing approved donors must remain unchanged and new approvals must
  remain unavailable until donor opt-in.
- An effective-permission review after deployment and after later grants/default
  changes. The guard is a point-in-time scoped check, not permanent enforcement
  against trusted operators or all existing privileged functions.

Migration locking remains conservative and transactional. The exclusive donor lock
and ordinary index builds can block application traffic until commit; statement
timeouts are per statement, not a guaranteed bound on the whole migration. Test
timings with synthetic volume and plan a maintenance window before any approved
live rollout. Keep lock timeouts; do not add concurrent index operations or split
atomic security changes solely to force an active deployment through.

Official guidance checked again:
- PostgreSQL 17 CREATE TRIGGER privilege requirements:
  https://www.postgresql.org/docs/17/sql-createtrigger.html
- PostgreSQL 17 timeout timing and lock behavior:
  https://www.postgresql.org/docs/17/runtime-config-client.html
- PostgreSQL 17 role membership INHERIT/SET options:
  https://www.postgresql.org/docs/17/sql-grant.html

## Correction verification record

Offline lexical checks cover both SQL drafts, nested dollar bodies and the SQL
hardening example. Source assertions check both role/status authorizations, raw
validation order, all six TRIGGER targets, original permission guards and exact
test-helper parity. The pgTAP draft contains 84 assertions; none has run.
Whitespace/encoding and obvious credential-pattern scans passed without printing
sensitive values. All three historical migration SHA-256 hashes still match the
values above. Git scope remains exactly these three approved draft paths.
These checks are not PostgreSQL parsing, PL/pgSQL compilation, executed tests,
concurrency proof, or migration/transaction rollback verification.
