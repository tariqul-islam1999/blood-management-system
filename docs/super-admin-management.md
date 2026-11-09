# Super Admin Management: Phase 1 database drafts

Prepared 2026-10-26. **Drafted and reviewed; not deployed.** The M6 file passed
read-only review, an isolated-workdir SHA-256 check and an M6-only Development
dry-run on 2026-11-09. It has **not** been applied. Approval to write these three
files does not authorize a database connection, SQL execution, bootstrap,
migration-history changes, package installation, or frontend activation. No
account is created or promoted by the migration.

## Scope and prerequisites

New files only:

- `supabase/migrations/20261026000100_super_admin_management.sql`
- `supabase/tests/database/super_admin_management.test.sql`
- `docs/super-admin-management.md`

The donor verification migration `20261023000400` (M5) remains a prerequisite; its
RPCs and `donor_verification_history` must exist before this draft can be
applied. M5 **is now applied** to BMS-Development (`zbgqpqafvcxaoxxcuyxn`), so the
prerequisite is satisfied there; on a fresh target this draft still fails closed.

Reviewed file hashes (the 2026-11-09 documentation corrections changed no SQL):

- M5 `20261023000400_admin_donor_verification.sql`:
  `3DE66B4C9C28E8E169FA41A5443C345F6D11354FF76292237FE2EA571D7E3ECF`
- M6 `20261026000100_super_admin_management.sql`:
  `E3516117D1825BBDC4FF7E46D8C6410AE963973FC6DB1DB4D195AD1C1A9E0552`

M5's earlier apply attempt failed on a standalone `LOCK TABLE`. The cause is
PostgreSQL's own rule: `LOCK TABLE` is rejected unless an **explicit**
`BEGIN … COMMIT` block is open, and the runner provides only an implicit
per-file transaction. That rejection aborts the whole file, so the incident is
**not** evidence that anything was partially committed. See "How the approved
runner executes this file" below.

Target assumptions: initialized Supabase on PostgreSQL 17, executing role
`postgres`, existing `profiles.role` values `donor`, `beneficiary`, `admin`,
`super_admin`, and `account_status` values `active`, `suspended`, `deactivated`.
These are application roles in profiles; users still connect through Supabase's
`authenticated` database role. No new production PostgreSQL login role is added.

The migration checks:

- Supabase `auth.uid()`, API roles and expected Auth identity columns exist.
- The six BMS tables and donor verification history are ordinary postgres-owned,
  RLS-enabled tables; the donor review RPC signatures exist, are postgres-owned
  and SECURITY DEFINER; donor verification has DEFAULT pending and NOT NULL.
- No noninternal trigger exists on profiles, donor profiles or donor verification
  history. Unlike `information_schema.triggers`, this uses `pg_catalog.pg_trigger`.
  Unexpected legitimate triggers require separate review; none are removed.
- No name conflicts exist for the new table, sequence, indexes or RPC overloads.
- `anon`/`authenticated`, including inherited and SET ROLE paths, cannot reach
  superuser/BYPASSRLS/CREATEROLE roles, unsafe TRUNCATE/TRIGGER on the six tables,
  direct protected-profile writes, either audit table, or the new sequence.
- Only authenticated has client EXECUTE on the four new RPCs, without grant
  option. PUBLIC, anon and service_role grants on new objects are revoked.
  Unknown additional default grantees cause an abort, not automatic changes to
  existing permissions or global default privileges.

These checks do not establish complete schema/function equivalence or inspect
all unrelated SECURITY DEFINER functions. The unchanged reviewed baseline and
verification backend must be compared with the target before deployment; an
old or altered function with the same signature is not proven safe by ownership.
Public signup security depends on the existing `handle_new_user()` whitelist,
which only accepts donor/beneficiary. The new migration does not replace it.

The reported live checks from the earlier review (PostgreSQL 17.11, postgres,
six RLS tables, restricted client grants, one approved and one pending donor)
are user-provided evidence, not a live inspection performed in this phase.
In particular, the reported live approved/nullable default has not yet been
changed by 20261023000400_admin_donor_verification.sql;
20261026000100_super_admin_management.sql requires that predecessor first.

## How the approved runner executes this file

The approved deployment tool is the project-pinned Supabase CLI
(`supabase@2.121.0`, `supabase db push`). Its v2.121.0 documentation and source
describe the following behavior:

- Each compatible migration file is applied in **one implicit transaction**: the
  migration statements and the `INSERT` into
  `supabase_migrations.schema_migrations(version, name, statements)` are sent as
  one extended-protocol batch with a single final `Sync`, so the schema changes
  and the migration-history row commit together. A failure anywhere aborts the
  whole file, leaving no objects and no history row, so the identical file can be
  retried.
- This is **not** an explicit `BEGIN/COMMIT` block. M6 contains no transaction
  control statements, and none must be added: the CLI treats explicit
  transaction control specially and would flush it out of the batch.
- Per-file atomicity is lost at any "pipeline-incompatible" statement. The CLI
  commits the open batch, runs that statement standalone, then resumes batching,
  so earlier statements stay committed while no history row is written:
  `CREATE [UNIQUE] INDEX CONCURRENTLY`, `DROP INDEX CONCURRENTLY`,
  `REINDEX … CONCURRENTLY`, `VACUUM`, `ALTER SYSTEM` and `CLUSTER`. The reviewed
  M6 file contains none of these; adding one later would break atomicity unless
  it is isolated in its own migration.
- Atomicity is per file, not per push. M6 is the only pending file for this
  deployment (M7 remains unapplied), so one push is one transaction.

### `SET LOCAL` limitation when M6 is deployed

M6 opens with `SET LOCAL search_path = ''`, `lock_timeout = '5s'`,
`statement_timeout = '60s'` and `check_function_bodies = on`. Because there is
no explicit transaction block, PostgreSQL reports
`SET LOCAL can only be used in transaction blocks` as a **warning** and the
settings have **no effect** during a `db push` deployment. The warning is not an
error, so it does not block the deployment.

The practical impact is limited, and it must not be overstated:

- The functions M6 creates carry their own `SET search_path = ''` and use fully
  qualified names; the preflight and permission-guard blocks are fully qualified
  too. The unset session `search_path` therefore does not change what resolves.
- The 5-second `lock_timeout` and 60-second `statement_timeout` do **not** bound
  the deployment. That is acceptable here only because M6 creates new objects
  (plus grants/revokes on those new objects) and does not `ALTER` or rewrite any
  existing table, so it takes no long-lived lock on a busy relation.
- `check_function_bodies` is `on` by default anyway.

Consequences: read the SQL file's header comment ("run this entire file in one
runner-owned transaction") as intent, not as an enforced setting. Rely on the
CLI's implicit per-file transaction for rollback, and re-verify the resulting
objects (ownership, RLS, indexes, grants, RPC behavior) after deployment instead
of assuming the in-file timeouts applied.

## Four RPCs

All four require `auth.uid()` to identify an **active super_admin in profiles**.
They authorize before validation or data lookup. Client role arguments and
user-editable metadata never authorize a request.

| RPC | Inputs | Returned columns |
| --- | --- | --- |
| `super_admin_list_admins` | `page_size integer = 20`, `page_offset integer = 0` | `user_id uuid`, `full_name text`, `account_status text`, `last_action text`, `last_changed_at timestamptz` |
| `super_admin_get_admin_candidate` | `target_user_id uuid` | `user_id uuid`, `full_name text`, `current_role text`, `account_status text`, `eligible boolean` |
| `super_admin_appoint_admin` | `target_user_id uuid`, `reason text` | `user_id uuid`, `assigned_role text`, `account_status text`, `history_id uuid`, `changed_at timestamptz` |
| `super_admin_revoke_admin` | `target_user_id uuid`, `reason text` | Same as appointment |

The list includes active, suspended and deactivated admins, excludes super admins,
and uses stable `created_at, id` ordering. Page size is 1-50 and offset 0-100000;
NULL bounds are invalid. Legacy admins without events have NULL latest-event
fields. No fake historical appointment is inserted. Offset pages can shift when
accounts change between calls; refresh the list after a mutation.

Lookup takes an exact account UUID obtained through an approved operator process.
It is not an email search or a public user directory. It returns no email, phone,
birth date, address or private donor information. The eligibility result is
advisory; appointment rechecks everything while locking the target.

Appointment requires all of the following:

1. Target is not the caller or a super admin; it exists in profiles.
2. Auth identity has a nonempty confirmed email and `is_anonymous = false`.
3. A beneficiary subtype row exists and **no donor subtype row exists**.
4. The target is either an active beneficiary or an admin deactivated through
   this management workflow. For reappointment, the latest event by monotonic
   event number must be `revoked`, with its timestamp exactly matching the
   current profile's `updated_at`. A suspension, unrelated deactivation or later
   profile change cannot be silently undone.
5. A mandatory reason trims to 10-500 PostgreSQL characters. Raw input is limited
   to 4096 bytes before regex processing. Whitespace-only input is rejected.

Use a separate administrative identity, registered normally as a beneficiary,
with verified email and required signup fields. The super admin must verify its
ownership and dedicated purpose out of band. Structural checks exclude donor
accounts, but the database cannot prove that someone intends to dedicate an
otherwise eligible beneficiary identity exclusively to administration. Do not
repurpose an ordinary beneficiary's personal account. MFA and organizational
identity checks are operational follow-up, not implemented by these drafts.

Appointment changes only that target's `role`, `account_status` and `updated_at`.
Its Auth identity, beneficiary row, photo and other profile fields remain.
The retained beneficiary row does not grant beneficiary-only RPC access: those
existing functions also check the current role/status in profiles.

Revocation accepts an active, non-donor admin and changes only account_status to
`deactivated` and updated_at. The role stays `admin`, preventing accidental
fallback to normal beneficiary access. Revocation deliberately does not require
continued email verification or a beneficiary subtype, allowing a legacy or
compromised non-donor admin to be revoked. A legacy admin with a donor subtype
is refused for separate operator remediation; these RPCs never repurpose donors.
No account is deleted, no super admin is appointed or revoked, and neither self
management nor last-super-admin removal is possible through these RPCs.

A trusted operator must update `updated_at` on any independent account/status
change; the reappointment timestamp check relies on that convention. It is not
a protection against a privileged operator intentionally forging database data.
If a revoked account fails reappointment after a separate change, investigate
and use a separately reviewed recovery, rather than editing the audit event.

## Authorization, atomicity and history

Each function is owned by postgres, SECURITY DEFINER, has an empty search_path,
fully qualified object references, no dynamic SQL and a 5-second lock timeout.
RPCs do not accept actor identity. Errors use controlled messages:

| SQLSTATE | Meaning |
| --- | --- |
| `42501` | Missing/inactive/wrong-role caller, or missing SQL EXECUTE privilege |
| `22023` | Invalid target, pagination or reason |
| `P0002` | Target account not found |
| `55000` | Target state/identity is not eligible; refresh before retrying |
| `55P03`, `40P01` | Lock timeout/deadlock; transaction fails, refresh and retry intentionally |

UUID parsing may fail with `22P02` before PL/pgSQL begins. Expired JWT validation
belongs to Supabase Auth/PostgREST; SQL tests impersonating claims do not test it.
Future clients must map errors to safe messages and never expose raw server
errors or log private administrative reasons.

Authorization holds a SHARE row lock on the caller until transaction end.
Mutations acquire an UPDATE row lock on the target, then recheck eligibility.
Auth identity and the existing beneficiary row are also locked for appointment.
No exception handler swallows an audit failure: the profile update and history
insert succeed or fail as one RPC statement transaction. A failed audit insert
must leave both the profile and history unchanged. Identity sequence gaps after
failed requests are normal and are not missing committed history.

The existing donor review RPCs already lock the caller's profile FOR SHARE.
Therefore a donor review already in flight may finish before revocation obtains
its target lock. Once revocation commits, subsequent requests using the same JWT
fail the fresh database status check. This does not cancel a completed decision
or revoke Auth refresh tokens, sign-in ability, or all Storage access. Those
would be separate account-wide security work; existing own-profile/Storage
policies must not be described as globally disabled by this feature.

The new `admin_access_history` contains target, actor, actor's role snapshot,
action, before/after role and status, trimmed reason, UUID event ID, ordered
identity event number and server timestamp. Bootstrap has NULL actor/actor_role
and a mandatory operator reference. A partial unique index allows one bootstrap
event. Table constraints restrict allowed transition shapes.

RLS is enabled with no client policies. All client table/sequence grants are
removed. Super admins see only the bounded RPC results; full history inspection
is a trusted-operator task. Clients cannot write or alter audit events. This is
an application audit trail, not tamper-proof storage against postgres/platform
operators. Do not include medical details, contact data or secrets in reasons.

ON DELETE RESTRICT foreign keys retain target and actor attribution, including
when Auth deletion would cascade into profiles. They can intentionally block a
future account deletion. Deactivation is the supported operation. Existing donor
verification history, reviewer snapshots and approved/pending donor records are
never rewritten. Deployment of
20261026000100_super_admin_management.sql performs no account/donor DML.

## First super admin bootstrap: documented, NOT executed

There is no public bootstrap RPC, signup flag, hardcoded user UUID, service key
in the client or automatic promotion. Only a separately authorized trusted
operator, on a named environment after both migrations pass review/testing,
may run the following procedure. Prepare an approved backup/recovery point first.

Create a dedicated account through the existing beneficiary signup flow with
all required fields, confirm its email, and verify the intended owner out of
band. Do not sign up with privileged metadata or disable the signup trigger.
Resolve its exact UUID through the approved trusted operator workflow. Replace
the angle-bracket placeholders in the reviewed transaction below; they are
intentionally not executable values. No real identifiers or credentials belong
in this repository. Choose a non-sensitive operator/change reference and reason.

```sql
-- Documentation template only. Requires separate target-specific execution approval.
BEGIN;
SET LOCAL search_path = '';
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
-- Serialize concurrent bootstrap and profile writes, including new signups.
LOCK TABLE public.profiles IN SHARE ROW EXCLUSIVE MODE;
DO $bootstrap$
DECLARE
    target_id uuid := '<DEDICATED_ACCOUNT_UUID>'::uuid;
    operator_ref text := '<APPROVED_OPERATOR_AND_CHANGE_REFERENCE>';
    bootstrap_reason text := '<APPROVED_BOOTSTRAP_REASON>';
    target_profile public.profiles%ROWTYPE;
    verified_identity boolean;
    event_time timestamp with time zone;
BEGIN
    IF current_user <> 'postgres'
       OR pg_catalog.current_setting('server_version_num')::integer / 10000 <> 17 THEN
        RAISE EXCEPTION 'Trusted postgres operator on PostgreSQL 17 required';
    END IF;
    IF EXISTS (SELECT 1 FROM public.profiles AS p WHERE p.role = 'super_admin')
       OR EXISTS (SELECT 1 FROM public.admin_access_history AS h
                  WHERE h.action = 'bootstrap_super_admin') THEN
        RAISE EXCEPTION 'Bootstrap already used or super admin already exists; stop for recovery review';
    END IF;
    SELECT p.* INTO target_profile FROM public.profiles AS p
    WHERE p.id = target_id FOR UPDATE;
    IF NOT FOUND OR target_profile.role <> 'beneficiary'
       OR target_profile.account_status <> 'active' THEN
        RAISE EXCEPTION 'Active dedicated beneficiary required';
    END IF;
    SELECT u.email_confirmed_at IS NOT NULL AND u.is_anonymous IS FALSE
           AND NULLIF(pg_catalog.btrim(u.email), '') IS NOT NULL
    INTO verified_identity FROM auth.users AS u WHERE u.id = target_id FOR SHARE;
    PERFORM 1 FROM public.beneficiary_profiles AS b WHERE b.user_id = target_id FOR SHARE;
    IF NOT FOUND OR verified_identity IS NOT TRUE
       OR EXISTS (SELECT 1 FROM public.donor_profiles AS d WHERE d.user_id = target_id) THEN
        RAISE EXCEPTION 'Verified non-anonymous dedicated account without donor row required';
    END IF;
    event_time := pg_catalog.clock_timestamp();
    UPDATE public.profiles AS p SET role = 'super_admin', account_status = 'active', updated_at = event_time
    WHERE p.id = target_id;
    INSERT INTO public.admin_access_history (
        target_user_id, actor_id, actor_role, action, previous_role, previous_account_status,
        new_role, new_account_status, reason, occurred_at, operator_reference
    ) VALUES (
        target_id, NULL, NULL, 'bootstrap_super_admin', 'beneficiary', 'active',
        'super_admin', 'active', bootstrap_reason, event_time, operator_ref
    );
END;
$bootstrap$;
COMMIT;
```

The history checks enforce trimmed reason length 10-500 and operator reference
length 10-200; an invalid insert must roll back the promotion. The future runner
must stop on the first error; after any error, ROLLBACK and investigate rather
than continue. A concurrent/second bootstrap or an inactive existing super admin
is a recovery case, not a reason to bypass the check. Creating additional super
admins or recovering the first is a separate trusted-operator procedure outside
these four RPCs. Enable MFA and a secure recovery process before real use.

## Future deployment and recovery (requires new approval)

1. Review schema/function definitions, effective grants, pg_trigger entries and
   object-name conflicts in the approved target. Record donor UUIDs and complete
   verification fields securely for comparison without pasting personal data
   into chat or logs. Confirm backup/PITR availability and a tested restoration
   procedure for that Supabase plan; do not assume backups exist.
2. In an approved disposable environment, initialize reviewed baseline 001/002,
   apply 003 and the separately approved TRIGGER, REFERENCES and MAINTAIN
   hardening, then 004 and 005 (M5). The historical baseline's grants
   intentionally require hardening. Run the SQL suites only with installed pgTAP
   and an empty synthetic fixture target.
3. BMS-Development (`zbgqpqafvcxaoxxcuyxn`) already records M1, M2, M3, M3.5 and
   M5 in `supabase_migrations.schema_migrations`; M6 and M7 are unapplied. The
   approved process for that project is the project-pinned CLI run from an
   isolated temporary workdir:
   - Copy `supabase/config.toml` and the six migration files M1, M2, M3, M3.5, M5
     and M6 into the temporary `supabase/migrations` directory. M1–M5 must be
     present so the CLI's history comparison passes; they are already recorded
     and are not re-run. M7 stays out.
   - Verify every copied file's SHA-256 against the repository (M6 must be
     `E3516117D1825BBDC4FF7E46D8C6410AE963973FC6DB1DB4D195AD1C1A9E0552`), link
     the workdir to Development only, and confirm the target project ref.
   - Run `supabase db push --dry-run --linked --skip-vault --yes` and confirm the
     plan lists exactly M6.
   - After separate explicit approval, run
     `supabase db push --linked --skip-vault --yes`, then confirm with
     `supabase migration list --linked` that M6 appears in both columns while M7
     remains unapplied. Do not use `migration repair`, `db reset`, baseline
     replay or manual SQL, and do not add `BEGIN/COMMIT` to migration files.
   - Delete the temporary workdir afterwards and keep the deployed file hashes
     and operation record in the approved deployment log.
4. The push is atomic per migration file (migration SQL and its history row
   commit together), so a guard/DDL failure leaves nothing to clean up: do not
   remove a guard or broaden grants to force deployment; investigate, then retry
   the identical file. Execute bootstrap only as a separately approved, audited
   operation after the migration succeeds. Validate RPCs through real
   Auth/PostgREST synthetic users.
5. Recheck all four RPC owners, SECURITY DEFINER flags, empty search_path, grants,
   absence of PUBLIC/anon/service_role execution, audit RLS and no policies or
   direct/sequence access, including inherited and SET-role grants. Exercise
   unauthorized roles and direct table access. Compare the recorded donor fields
   and verification history with predeployment snapshots.
6. Before any use, a failed atomic deployment can simply roll back. After real
   management events, do not drop history or replay old profile snapshots. Freeze
   management access through a reviewed EXECUTE-grant change if needed, preserve
   both histories, and use a forward corrective migration. Restoring a whole DB
   can discard later legitimate donor actions; use tested recovery with explicit
   approval and reconcile post-backup changes. Revocation/reappointment are new
   audited actions, not deletion of earlier events.

## Test coverage and limitations

The pgTAP draft refuses a populated Auth/profiles/history target. All changes,
including synthetic Auth users, grants, trigger fault injection and temporary
NOLOGIN test roles, live inside BEGIN/ROLLBACK. It requires postgres role
administration for those test roles and pgTAP already installed in `extensions`.
It never installs tooling. A future runner must evaluate TAP output, not merely
psql's process exit code; roll back after unexpected SQL errors too.

Drafted cases cover anonymous and signed-out calls, forged JWT metadata,
donor/beneficiary/admin/inactive callers, pagination, ineligible/missing targets,
confirmed/non-anonymous identity, missing subtype, self/super-admin protection,
reason bounds/Unicode, duplicate actions, appointment/revocation/reappointment,
independent deactivation protection, audit fault rollback, direct table/sequence
bypass, inherited/SET-only privilege guards, signup rejection of privileged roles,
revocation using an existing JWT context and preservation of synthetic approved/
pending donors, beneficiary records and previous donor review history.

These tests do not establish JWT authenticity: they set claims as a trusted test
operator. Real expired/forged tokens, Auth schema differences, PostgREST schema
cache/discovery, rate limiting and mobile integration still need isolated tests.
The documented bootstrap transaction and migration preflight/late-failure atomic
rollback must also be exercised separately, not inferred from pgTAP fixtures.

Required two-session tests after separate authorization:

- Pause a donor review transaction holding the admin's profile SHARE lock;
  revocation must wait or fail at its lock timeout. After the review commits,
  retry revocation and confirm subsequent calls with the same token fail.
- Race two appointments/revocations of one target: only a valid serialized state
  transition may commit; no duplicate event or unaudited profile change.
- Pause a super admin's RPC; concurrent operator deactivation must serialize.
  After it commits, the next RPC is denied. Confirm lock timeouts/deadlocks roll
  back cleanly and the client does not blindly retry a stale mutation.
- Race two bootstrap transactions; one must abort without a second promotion.
- Deliberately fail the final migration guard inside a transaction; every new
  object must disappear, with existing profiles/donors/history unchanged.

Offline checks performed for this phase are structural/text checks only, not SQL
parsing or database execution: draft dollar-quote balance, four RPC definitions,
matching security/authorization settings, exact migration/test permission-guard
parity, scoped grants, no migration donor DML, whitespace checks, allowed-file
scope and unchanged historical migration hashes. See the completion report for
actual results. No SQL, pgTAP, bootstrap, Supabase API or device flow has been run.
TypeScript/lint are not relevant to this SQL/docs-only scope and were not run;
Expo tools could generate files or access configuration outside this phase.

The frontend remains unchanged, including the donor-verification activation flag
currently false. Future frontend work needs separately approved scope; deploy
and test both backends before enabling administrative actions.

Official references reviewed:

- [Supabase database functions](https://supabase.com/docs/guides/database/functions)
- [Supabase database testing](https://supabase.com/docs/guides/database/testing)
- [PostgreSQL 17 SECURITY DEFINER guidance](https://www.postgresql.org/docs/17/sql-createfunction.html)
- [PostgreSQL 17 row locking](https://www.postgresql.org/docs/17/explicit-locking.html)
