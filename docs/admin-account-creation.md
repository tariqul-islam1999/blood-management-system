# Admin Account Creation (Super Admin direct provisioning)

Status as of **2026-11-26**: implemented, and **active in BMS-Development**.
`ADMIN_MANAGEMENT_ACTIVE` is `true`.

- **Owner-reported, not independently re-verified in this documentation pass:** the migration
  `20261125000100_admin_creation.sql` was applied to BMS-Development, the `admin-create` Edge
  Function was deployed to BMS-Development, and a Super Admin successfully created an Admin
  account that now appears in the Admin Accounts card.
- **NOT tested:** logging in with the newly created Admin credentials, and the resulting Admin
  dashboard/permissions. Do not describe Admin login as working.
- The Main Supabase project was not accessed or modified.

## 1. What the feature does

An authenticated, active Super Admin creates an Admin account directly:

1. The Super Admin fills in Full name, Email, Password, Bangladesh phone,
   District, Thana and Local area, plus a management reason.
2. The app opens a *creation intent* in the database.
3. The `admin-create` Edge Function creates the Auth user, links it to the
   intent, then promotes it to `admin` with an audit event.

Public registration is unchanged: only Donor and Beneficiary can self-register.
`handle_new_user()` remains untouched. There is no invitation workflow.

The feature stays disabled until `ADMIN_MANAGEMENT_ACTIVE` is set to `true` in
`src/lib/admin-management.ts` (separate approval).

## 2. Why the form collects more than name/email/password

`public.handle_new_user()` (baseline `20261023000100`) rejects any role except
`donor`/`beneficiary` and requires `full_name`, `phone`, `district`, `thana` and
`local_area`, with `phone` matching `^01[3-9][0-9]{8}$`. It inserts the
`profiles` row and the role sub-profile in the same transaction.

The design therefore creates the Auth user as a **beneficiary shell** with
truthful metadata and promotes it immediately afterwards. No placeholder or fake
value is ever written:

- `profiles.phone` is `NOT NULL UNIQUE`, so a shared placeholder would fail on
  the second Admin ever created.
- `beneficiary_profiles` is only `(user_id, created_at, updated_at)`, so the shell
  adds no misleading business data.

The residual cost is a brief window where the identity is an active beneficiary.
It holds a password known only to the Super Admin, and promotion follows in the
next server call.

## 3. Email confirmation policy

The Edge Function calls `createUser` with **`email_confirm: false`**.

- Nothing pretends the mailbox was verified. `email_confirmed_at` stays `NULL`.
- Ownership is established **out of band, in person**, by the Super Admin and
  recorded as `verification_method = 'out_of_band_in_person'` on the intent.
- The password is handed over face to face, never by message or email.
- The UI states plainly that no invitation email is sent and the address is not
  verified by email.

Why not `email_confirm: true`: it would fabricate a confirmation for an address
nobody proved. A mistyped address would then belong to a stranger who could use
the project password-reset flow to take over a live Admin. Confirmation is *not*
the mitigation for a typo — out-of-band verification is.

## 4. Sequence and the durable link

```
Super Admin app        Edge Function (admin-create)          Postgres
      |                        |                                |
      |-- begin -------------->|                                |  intent (pending)
      |                        |-- get_creation_status -------->|  creation_allowed?
      |                        |-- auth.admin.createUser ------>|  (service role)
      |                        |      handle_new_user() ------->|  profiles + beneficiary_profiles
      |                        |-- link_admin_creation_user --->|  user_id persisted  <== durable
      |                        |-- commit_admin_creation ------>|  promote + audit (one transaction)
      |                        |                                |
      |                        |  on any failure:               |
      |                        |-- abort_admin_creation ------->|  user_id -> cleanup_target_user_id
      |                        |-- auth.admin.deleteUser ------>|  exact id returned by abort
```

**The single most important property:** the Auth user id is persisted by its own
RPC in its own transaction *before* the promotion is attempted. If the commit
fails, the intent still records which identity was created, so `abort` can return
the exact id to delete. A link written inside the commit would be rolled back
with it and strand the Auth user with no record.

## 5. Expiry semantics

`expires_at` (15 minutes) controls **only** whether a *new* Auth identity may be
created. It is exposed to the client as `creation_allowed`.

`link` and `commit` do **not** compare the current time with `expires_at`. Doing
so would orphan an identity legitimately created inside the window but linked a
moment late. The binding rule is that the Auth user's own `created_at` falls
inside `[intent.created_at - 60s, intent.expires_at + 60s]`, which
`_admin_creation_verify_identity` enforces on both paths. `is_expired` is
advisory and never changes the status.

## 6. Status contract

`super_admin_get_creation_status` returns a single row with:

| Column | Meaning |
|---|---|
| `status` | `pending`, `committed`, `aborted` or `inconsistent` |
| `target_user_id` | the linked Auth user, `NULL` when unlinked |
| `creation_allowed` | a **new** identity may be created |
| `deletion_authorized` | advisory: an uncommitted linked intent exists |
| `cleanup_state` / `cleanup_target_user_id` | derived cleanup progress |
| `target_email`, `target_full_name`, `target_phone`, `target_district`, `target_thana`, `target_local_area` | authoritative `createUser` payload |

`inconsistent` means the state cannot be proven safe. It never authorizes a
deletion.

Only a `pending` intent with `target_user_id` set may lead to a deletion, and
only through `abort`. A missing intent, a malformed response, a timeout, an
authorization error or an `inconsistent` verdict **must never** authorize a
deletion.

## 7. Successor Super Admin

`requested_by` records who opened the intent; `committed_by` records who actually
promoted. Audit replay compares the audit actor with `committed_by`, not with the
caller.

Every RPC also allows access when the original requester is no longer an active
Super Admin, so a successor can inspect, finish or clean up an abandoned run.
Authorization is still enforced per call against the caller's own profile.

## 8. Applying the migration (requires separate approval)

Prerequisite: `20261026000100_super_admin_management.sql` (M6) must already be
deployed. The preflight aborts if it is missing, if
`public.admin_creation_pending` already exists, or if any of the new functions
already exist.

```bash
# NOT executed as part of this work. Dry run first, on an approved target.
npx supabase db push --dry-run --linked
npx supabase db push --linked
```

The file is a normal migration: one implicit transaction per file, no explicit
`BEGIN`/`COMMIT`. Verify afterwards that the objects are `postgres`-owned,
`SECURITY DEFINER`, carry `search_path=''`, that `EXECUTE` is granted only to
`authenticated`, and that `anon`/`service_role` have no access to
`public.admin_creation_pending`.

## 9. Deploying the Edge Function (requires separate approval)

```bash
npx supabase functions deploy admin-create
```

Server-side secrets, configured in the dashboard or with `supabase secrets set` —
**never** committed and never placed in the app:

| Name | Purpose |
|---|---|
| `SUPABASE_URL` | project URL (provided automatically by the platform) |
| `SUPABASE_ANON_KEY` | used with the caller's JWT for the RPCs |
| `SUPABASE_SERVICE_ROLE_KEY` | used **only** for `auth.admin.createUser`/`deleteUser` |

The mobile app never receives the service-role key. It sends only its own user
JWT plus the publishable key.

## 10. Dev rollout order

1. Deploy M6 if not already deployed.
2. Apply `20261125000100_admin_creation.sql` to the approved target.
3. Deploy `admin-create` and set the three server secrets.
4. Test with a synthetic Super Admin and a synthetic email address.
5. Only then consider flipping `ADMIN_MANAGEMENT_ACTIVE` to `true` (separate
   approval). Until then the UI calls nothing.

**Status 2026-11-26:** steps 1–5 have been carried out on **BMS-Development** only
(owner-reported for the migration and Edge Function deployment; the flag is verified as `true`
in `src/lib/admin-management.ts`). Admin login with the created credentials remains untested.

## 11. Failure recovery and orphan handling

| Situation | Behaviour |
|---|---|
| `createUser` fails | No consumption, nothing deleted. Intent stays `pending`; retry or abort. |
| `createUser` succeeds, `link` fails | The function aborts; if the link never landed there is nothing to clean up in the database and the case is reported. |
| `commit` fails after a successful link | `abort` returns the exact `cleanup_target_user_id`; only that id is deleted. |
| `commit` timed out but may have committed | Status is re-read first. A `committed` result is reported as success and **nothing is deleted**. |
| Status RPC times out or returns malformed data | Refuse; report an unconfirmed outcome. Never delete. |
| Caller revoked mid-flight | Every RPC returns `42501`. The function refuses to delete and reports an orphan; a successor Super Admin can finish the cleanup. |
| `deleteUser` fails | Reported as an orphan for operator follow-up. No blind retry. |
| `inconsistent` state | Reported as an orphan. Never auto-repaired, never deleted. |

**Never** delete an Auth user based on an email match. The only deletion target is
the id returned by a successful `super_admin_abort_admin_creation` call.

Operator detection query for an unlinked candidate (read-only, for human review —
**not** an authorization to delete):

```sql
SELECT i.intent_id, i.target_email, i.created_at, i.expires_at,
       u.id AS candidate_auth_user_id, u.created_at AS auth_created_at
FROM public.admin_creation_pending AS i
JOIN auth.users AS u
  ON pg_catalog.lower(pg_catalog.btrim(u.email)) = i.target_email
 AND u.deleted_at IS NULL
WHERE i.user_id IS NULL
  AND i.consumed_at IS NULL
  AND i.cancelled_at IS NULL
  AND u.created_at BETWEEN i.created_at - interval '60 seconds'
                       AND i.expires_at + interval '60 seconds';
```

If the requester is no longer an active Super Admin, a successor can run the
cleanup explicitly:

```sql
SELECT *
FROM public.super_admin_get_creation_status('<INTENT_UUID>'::uuid);

SELECT *
FROM public.super_admin_abort_admin_creation(
    '<INTENT_UUID>'::uuid,
    'Abandoned provisioning run cleaned up after owner change.');
```

`abort` is idempotent: calling it again returns the same
`cleanup_target_user_id` and reports whether the Auth user still exists. That is
the safe retry path when a previous `deleteUser` call failed.

## 12. Retention

`ON DELETE RESTRICT` on both intent link columns means:

- A committed intent and its audit event can never be purged while either exists.
- An aborted intent keeps `cleanup_target_user_id` as the record of what was
  removed.
- `inconsistent` intents are never purged or auto-repaired; they are operator
  cases.

## 13. Verification status (2026-11-26)

**Verified in the repository**

- The migration parses cleanly against the PostgreSQL 17 grammar with `pglast` 7.22
  (45 statements, 6 function bodies, no syntax errors). This is **syntax only**: no catalog,
  object, privilege or RLS behaviour is exercised without a database.
- `node node_modules/typescript/bin/tsc --noEmit` → exit code 0.
- `git diff --check` → exit code 0.

**Owner-reported (not independently re-verified here)**

- Migration applied and Edge Function deployed to **BMS-Development**.
- A Super Admin created an Admin account, and it appears in the Admin Accounts card.

**NOT verified — do not describe as working**

- **Logging in with the newly created Admin credentials.** This is untested.
- The Admin dashboard and its permissions for the new account.
- No pgTAP or concurrency tests exist for this feature, so none were run.
- GoTrue error shapes for `createUser` were not verified against a live project. The function
  classifies RPC failures by SQLSTATE and treats an ambiguous `createUser` failure as a plain
  failure, never as a duplicate email.

**Known open issue:** the Admin creation success message is cleared during the list refresh
(`submitNewAdmin` sets it, then `load()` calls `clearPrivateData()`, which resets it). The account
is created correctly; only the confirmation text is lost. Not yet fixed.

**Known limitation:** `super_admin_list_admins` orders by `created_at` ascending, so with more than
one page a newly created Admin appears on the last page, not page 0.


