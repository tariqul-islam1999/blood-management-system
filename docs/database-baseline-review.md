# BMS database migration drafts

Status: review drafts only, prepared 2026-10-23. No SQL has been executed.
Approval to create these files is not approval to apply them, link a project,
change migration history, or alter live permissions.

## Source evidence

- Public export: E:\DeveloperTools\PostgreSQL\17.11\exports\bms_schema_review.sql
- User-provided path ended in bms_schema_review\.sql; the actual file is
  bms_schema_review.sql directly inside exports.
- Public export size: 28,814 bytes.
- Public SHA-256: F0A5FFBE41A7D6909DB9A6DB6596659ECBB59163F6F9D2BE3A701CD4B5EBD171
- Auth/storage CSV: E:\DeveloperTools\PostgreSQL\17.11\exports\bms_auth_storage_definitions.csv
- CSV size: 1,174 bytes; four rows.
- CSV SHA-256: B9C8CF39178430EC3FEFA5EEF70AF5CBA14D2E34F9A0C4A35EB69EF1A976135B
- User-confirmed: PostgreSQL 17.11; six tables and five functions owned by
  postgres; one enabled auth trigger; three public and three storage policies.
- User-confirmed via Supabase SQL Editor: profile-photos is private, with
  file_size_limit exactly 5242880 bytes (5 MiB), JPEG/PNG only.
- User-confirmed remote migration history table is absent.
- Original exports are unchanged and remain outside this repository.

## Ordered files

1. 20261023000100_baseline_public.sql: tables, identity sequences, constraints,
   functions, confirmed ownership, public RLS/policies, ACLs and default ACLs.
2. 20261023000200_baseline_auth_storage.sql: bucket configuration, enabled
   auth trigger, and exact three CSV storage policies.
3. 20261023000300_revoke_client_truncate.sql: separate security behavior change.

These baselines are for reconstructing an empty BMS application schema inside
an already initialized Supabase environment. They are not idempotent and must
not be replayed over the existing BMS database. Matching bucket settings alone
can be reused; conflicting settings raise an exception.
Do not rename applied migrations or mark these baselines applied remotely
without a separately approved, verified adoption procedure.
Do not run db push on the existing database while its history is absent:
the CLI would consider these files pending, not automatically recognize them.

## Platform and ownership prerequisites

- Supabase-managed auth/storage schemas, auth.users, storage.objects,
  storage.buckets, auth.uid(), storage.foldername(text), and standard roles
  must already exist. These drafts never create managed tables or roles.
- public may already exist: CREATE SCHEMA IF NOT EXISTS handles that case.
  The schema's owner and privileges outside the exported USAGE grants are not
  asserted or replaced.
- Run future validation in an isolated development target as current_user
  postgres. Public tables/functions explicitly retain confirmed postgres ownership.
  Identity sequences follow their owning tables.
- The applying role must be allowed to change postgres and supabase_admin
  defaults, create the auth trigger and storage policies, and configure the
  bucket. Managed-role restrictions may prevent this even as postgres.
  Such a failure is a blocker: do not suppress errors, disable RLS, or grant
  extra privileges to force the migration through.
- Owner defaults and memberships outside the exports are not fully known.
  Fresh-target ACLs for PUBLIC/anon/authenticated/service_role are cleared on
  newly created BMS objects before replaying source grants. This prevents
  target defaults adding rights absent from the source. Unknown roles remain
  a verification gap.
- Use the Supabase CLI transactional migration runner, with the installed
  CLI 2.121.0 as the intended validation target. The files have no outer
  BEGIN/COMMIT; SET LOCAL settings and exception guards rely on the runner's
  transaction. Do not execute statements individually or use psql autocommit.
  Each file keeps an empty local search_path and bounded lock/statement timeouts.
  Never run on an active production target.

## Dependency and compatibility adaptations

Create all tables and identity sequences first, then primary/unique keys,
then foreign keys. profiles references auth.users. Donor and beneficiary
profiles reference profiles. Availability tables reference donor_profiles.
verified_by references profiles. Functions follow these relations; the auth
trigger follows its handler; storage policies follow platform helpers.

The original dump's session switches, psql restrict/unrestrict commands and
check_function_bodies=false are not migration content. Fresh-target functions
are checked with check_function_bodies=on. Function definitions, constraints,
policy expressions, exported grants/default grants and comments are otherwise
preserved. No live users, sessions, photos, connection strings, or data inserts
are copied; INSERT/UPDATE/DELETE inside function bodies remain stored behavior.

The auth trigger CSV omitted its terminator and used an unqualified function:
the draft adds a semicolon and public.handle_new_user(). Its ordinary enabled
state comes from the user's confirmation. CREATE TRIGGER normally creates that
state, so the redundant ALTER TABLE auth.users ENABLE TRIGGER was removed.
A pg_trigger catalog assertion now checks the name, relation, handler,
noninternal flag and ordinary enabled state, raising an error on mismatch.
No managed table ownership is changed. Creating the trigger and storage policies
still needs the target's supported permissions.

Supabase's specific Creating Buckets guide explicitly supports SQL bucket
creation. Its general storage-schema guide recommends API operations and warns
against editing managed metadata. This draft uses the narrow bucket-configuration
case: one reviewed INSERT into storage.buckets, no writes to storage.objects,
no uploaded files, no copied object rows, and no managed ownership changes.
Retaining SQL bucket provisioning is justified for this migration draft; it
has not been executed or certified against the target Storage service version.
If managed permissions reject it, stop and propose a separately approved API
provisioning approach; do not grant extra managed-schema rights or ignore errors.

The exact 5242880-byte limit is now confirmed by the user from Supabase SQL
Editor, not inferred from the label "5 MB". Private visibility and JPEG/PNG
restrictions are unchanged. Existing different settings still fail instead
of being overwritten. Other bucket settings and managed storage grants are not
invented. Local config.toml is intentionally unchanged.

## SECURITY DEFINER and execution-grant review

All five functions have postgres ownership and an explicitly empty search_path.
PUBLIC execution is revoked and target API-role ACLs are normalized.
The export grants EXECUTE (spelled GRANT ALL for functions) as follows:

| Function | Explicit API/service grants | Static observations |
| --- | --- | --- |
| handle_new_user() | service_role | Whitelists donor/beneficiary signup roles; validates required metadata, phone and donor data; inserts common and role profiles. Trigger-only use is retained. |
| search_available_donors(text,text,text) | authenticated, service_role | Checks active beneficiary; filters active approved available donors; returns restricted fields; limit 100. NULL filters and ILIKE wildcards can broaden searches; preserved. |
| set_my_donor_availability(text,text) | authenticated, service_role | Checks authenticated active approved donor; locks donor row; validates status/reason; updates details and records history. |
| update_my_donor_availability(text) | service_role | Older alternative updates status without reason/history; retained, not granted to authenticated. Review removal separately. |
| update_my_profile_photo(text) | authenticated, service_role | Checks identity, own allowed path, matching storage object/owner, and active profile. |

postgres retains implicit owner rights. Trigger execution and service-role RPC
behavior are not proven by these grants: functions using auth.uid() still
require the appropriate caller context. No runtime tests have occurred.
Review source search-path safety, role membership, and effective ACLs on the
isolated target. Do not add FORCE RLS blindly: definer functions intentionally
perform operations ordinary clients cannot perform.

## RLS and known baseline risks

RLS is enabled on all six public tables, without FORCE. Three SELECT policies
allow own profile, own donor profile, and own unavailable reason.
No public write policies or extra storage DELETE policy are invented.
Missing policies on beneficiary/history/reminder tables mean ordinary client
row access is denied unless a privileged path is used; validate intended UX.

The baseline deliberately retains and labels these source permissions:
- anon/authenticated TRUNCATE on profiles, donor_profiles, beneficiary_profiles.
- REFERENCES, TRIGGER, MAINTAIN on those tables.
- Broad identity sequence privileges.
- Broad future table/function/sequence defaults for postgres/supabase_admin.

These are historical behavior, not recommended production permissions.
RLS does not protect TRUNCATE; table-wide privileges need their own review.
The broad defaults cover ALL future tables/functions/sequences in public
created by postgres or supabase_admin, including objects unrelated to BMS.
Removing TRUNCATE alone does not make these remaining defaults least privilege.

### Incomplete sequence is not a secure environment

Each migration is a separate transaction. If migration 2 or 3 fails, previous
successful migrations remain committed. If migration 3's guard fails, its own
revokes roll back and the historical TRUNCATE grants can remain in place.
Do not expose that environment to real users, production applications, or
untrusted clients. Use synthetic data only; keep it isolated until every
migration and effective-permission check succeeds. Do not retry by removing
guards or falsely recording migrations as applied. A failed sequence requires
a separately reviewed diagnosis; it is not evidence of a secured environment.

### Proposed separate least-privilege hardening (not implemented)

Keep historical grants in baseline_public. Propose an additional migration
only after effective ACL and role-membership inventory and approval:
1. Define a per-table/function/sequence privilege matrix for anon,
   authenticated and trusted service workflows.
2. Replace public-schema GRANT ALL defaults with explicit opt-in grants,
   accounting for both creator roles, global defaults and PUBLIC execution.
   Changes affect non-BMS future objects too, so review schema-wide impact.
3. Review REFERENCES, TRIGGER, MAINTAIN, sequence rights, unknown grantees,
   inherited memberships and SET ROLE paths. Do not revoke blindly.
4. Require explicit RPC EXECUTE grants, review the older availability RPC,
   and evaluate whether narrower definer ownership can preserve behavior.
5. Decide whether storage policies must also reject inactive BMS accounts;
   their current checks only require authentication, bucket and own folder.
6. Test expected successes and denials before approving any broader changes.
No hardening beyond the separate TRUNCATE fix is silently included here.

## Separate TRUNCATE fix and boundaries

The third migration revokes TRUNCATE on all six named BMS tables from anon and
authenticated, and removes the exported public-schema table default TRUNCATE
for both creator roles. Other privileges and service_role access are preserved.

It checks effective table privileges and global/public-schema default ACLs,
including PUBLIC and immediately inherited grants. If access remains, it raises
an error and the CLI-owned transaction for this file rolls back. It does not automatically alter global defaults,
memberships, or unrelated schemas. Those are not fully captured and require
separate approval if the guard fails. SET ROLE paths, other creators, later
platform changes and new grants require further audit.
A schema-only default revoke cannot override a global default grant.
Never verify this fix by actually running TRUNCATE. Use privilege inspection
and role-based tests against synthetic data after approval.

## Transaction correction and official evidence

Official guidance checked for the intended installed CLI 2.121.0:
- Supabase's embedded-transactions troubleshooting page explicitly advises
  removing BEGIN/COMMIT from migration files because embedded commits can
  separate durable changes from migration-history recording.
- The CLI workflow guide describes transactional migration execution and the
  optional transaction=false directive for nontransactional operations.
  These files require no such opt-out and do not include it.
- The correction removes only outer transaction-control statements, not
  PL/pgSQL BEGIN/END blocks. SET LOCAL and all exception guards remain.

Evidence scope: current official docs were checked; they are not a versioned
2.121.0 implementation specification. Attempts to inspect tagged source did
not resolve, and no runtime behavior of the installed binary was exercised.
Confirm per-file rollback and migration-history atomicity in an approved,
isolated test before deployment. Do not claim this as a tested CLI guarantee.
The full three-file sequence is not one atomic transaction.

## Verification performed and limitations

Only offline text/lexical checks were run:
- PostgreSQL-style strings, comments, dollar bodies, parentheses and statement
  terminators checked without executing SQL.
- Six tables, five unchanged function definitions, two identity sequences,
  fourteen PK/unique/FK constraints, three public policies and six RLS enables.
- All source public DDL/ACL/default-ACL statements retained (with documented
  session/schema adaptations), exact storage policies retained, trigger qualified.
- Ownership, creation order, confirmed bucket bytes and TRUNCATE revokes inspected.
- Outer transaction commands removed; PL/pgSQL blocks and existing guards retained.
- Redundant managed-table trigger enabling replaced by a catalog assertion.
- Obvious credential/token/private-key patterns scanned without printing values.
- Original source hashes checked before and after preparation.

No PostgreSQL-aware parser is installed. Lexical checks are NOT a PostgreSQL
syntax certification and do not compile PL/pgSQL bodies. No PostgreSQL
connection, SQL execution, migration, reset, container startup, history repair
or remote change has occurred. psql/pg_dump do not provide a full offline
compile-only check for these migrations. Database-backed CLI lint is out of scope.
App lint/typechecking is unrelated to SQL validation; no application files or
dependencies are changed, and missing lint tools are not installed.

Before deployment approval, validate with a compatible offline PostgreSQL parser
if separately approved, then an isolated Supabase 17 environment. Test clean
reconstruction, signup trigger, exact/effective ACLs, bucket limits/privacy,
own/other-user storage operations, active/inactive and wrong-role RPC access,
availability history, and rollback on conflicting bucket/global defaults.
Verify no duplicate functions, grants, triggers or policies relative to source.
Check auth confirmation/redirect settings separately; they are not database DDL.
A schema baseline is not a backup of users or uploaded files.

## References

- https://supabase.com/docs/guides/storage/buckets/creating-buckets
- https://www.postgresql.org/docs/17/sql-alterdefaultprivileges.html
- https://www.postgresql.org/docs/17/ddl-rowsecurity.html
- https://www.postgresql.org/docs/17/sql-createfunction.html

- https://supabase.com/kb/troubleshooting/partial-migrations-and-schema-inconsistencies-from-embedded-transactions
- https://supabase.com/docs/guides/local-development/cli-workflows
- https://supabase.com/docs/guides/storage/schema/design
- https://www.postgresql.org/docs/17/catalog-pg-trigger.html
