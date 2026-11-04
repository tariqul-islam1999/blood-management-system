# BMS — User Deletion & Data Retention Policy Proposal

**PROPOSAL — NOT AN APPROVED POLICY — NOT IMPLEMENTED**

> This document is a proposal for discussion only. It is not an approved
> security, product, or legal/privacy policy, and none of it is implemented.
> Every recommendation below must be approved before any implementation work
> begins. It describes an intended direction, not completed features.

- Status: proposal draft (not approved, not implemented).
- Source of truth: the M-23 read-only investigation of user deletion, account
  retention, and data anonymization.
- Deployment status of any migration or remote database is **not established**
  here and must not be assumed.

---

## 1. Purpose

The Blood Management System (BMS) connects donors and beneficiaries and stores
identity, contact, availability, verification, administrative, and blood-request
information. Sooner or later, users will ask to close their accounts, and the
project will need a clear, safe answer.

Today there is no account-closure workflow at all: no screen, no server
function, and no agreed retention rule. If a user were deleted carelessly,
audit records could be destroyed, or private data could be left behind in the
database or in Storage. This proposal explains why a policy is needed and
suggests a safe first step.

Why this matters:

- **Trust and privacy:** users expect a clear way to stop using the app and to
  understand what happens to their data.
- **Accountability:** donor verification, admin activity, and blood-request
  history must stay trustworthy and attributable.
- **Data protection:** privacy expectations (for example, erasure or a "right
  to be forgotten") may apply to personal data, but the exact legal position for
  this project has not been decided.
- **Safety:** closing accounts the wrong way can silently destroy audit
  evidence or orphan uploaded photos.

---

## 2. Account Deactivation (recommended first step)

**Recommendation:** do not immediately and permanently delete accounts. Instead,
disable ("deactivate") the account so it can no longer be used, while keeping its
linked records intact.

The database already supports the idea: `public.profiles.account_status` can be
`active`, `suspended`, or `deactivated`, and a draft admin function already sets
an admin account to `deactivated` instead of deleting it.

Deactivation as the MVP direction means:

- The user can no longer log in and use the app (once access controls are
  completed — see Section 6).
- The profile row and its linked records remain available for audit, reporting,
  and dispute resolution.
- Deletion or anonymization can be offered later, once retention and legal rules
  are approved.

Deactivation is **not** the same as deletion. It is reversible by an authorized
operator, and it must be made a real access barrier (see Section 6).

---

## 3. Preserve Audit History

Certain records exist to prove what happened and who did it. They must be
preserved and must never be deleted as a side effect of closing an account.

The key audit/history records are:

- **Donor verification history** (`public.donor_verification_history`): records
  which admin reviewed which donor, when, and the decision.
- **Admin activity history** (`public.admin_access_history`): records admin
  appointments, revocations, and bootstrap events, including the actor and the
  target.
- **Blood request history** (`public.blood_requests` and
  `public.blood_request_interests`): records who requested blood and which
  donors expressed interest.

**Recommendation:** account closure must never rewrite or erase these records.
Attribution (which user did what) should be preserved. If privacy rules later
require removing personal details, do that through a reviewed anonymization step
(see Section 4) rather than by deleting the history rows.

Note: the donor-verification, admin-access, and blood-request tables are
introduced by **draft** migrations that are not deployed yet. The intent above
still applies once they are applied.

---

## 4. Personal Information: retain, anonymize, or erase

Personal information about a user includes, for example: name, phone number,
district/thana/local area, date of birth, last donation date, and availability
reason notes. These are sensitive and must be handled carefully.

There are three possible future directions, and **no decision has been made**:

1. **Retain (recommended for the first release).** Keep the profile records
   while the account is deactivated, protected by access controls. Useful for
   audit and support. Requires an agreed retention duration.
2. **Anonymize (future option).** Replace identifying fields with
   non-identifying values, while keeping a stable internal identifier so audit
   history stays meaningful. This is a design effort and has not been
   implemented.
3. **Erase (future option, highest risk).** Permanently remove personal data.
   This is difficult because audit and blood-request records intentionally block
   deletion (see Section 7) so that history stays attributable.

**Important:** no retention duration has been approved. This proposal does not
set one. The duration, the anonymization method, and any erasure procedure all
require separate approval, ideally with legal/privacy input.

---

## 5. Profile Photos (Storage cleanup)

Users can upload a profile photo, stored in Supabase Storage in the
`profile-photos` bucket. Deleting the Auth user or the profile row does **not**
automatically delete the stored photo object. Without a cleanup step, orphaned
photos would remain in Storage after account closure.

**Recommendation:** treat profile-photo cleanup as a required future step of any
closure workflow. It should be a reviewed, approved process that removes only
the closed user's own objects. This is not implemented today, and Storage
deletion behavior has not been verified against a real project.

---

## 6. Access Security (deactivation must actually lock the account)

Deactivating an account is only meaningful if it truly stops access. Access is
controlled at three separate layers, and all three must agree:

1. **Authentication (Supabase Auth).** A logged-in session keeps working until
   it is revoked. Deactivating a profile row does not by itself sign the user
   out or ban the Auth user. Session invalidation / ban behavior must be
   designed.
2. **Database row-level security (RLS).** Current RLS policies grant users
   access to their own rows based on ownership, and they do **not** uniformly
   check `account_status`. A deactivated user may still be able to read some of
   their own data.
3. **Storage policies.** The profile-photo policies are based on ownership
   (`auth.uid()` and file path). They do not check `account_status`, so a
   deactivated user may still access their own photo objects.

**Current status is incomplete.** The existing admin deactivation function is a
**draft**, and even when implemented it only changes `account_status`. It does
**not** guarantee complete access revocation across authentication, RLS, and
Storage.

**Do not describe deactivation as fully secure.** Closing this gap is future
work and requires an approved design that also handles Auth session
invalidation/banning and `account_status`-aware RLS and Storage policies.

---

## 7. Foreign Key Risks (baseline vs feature-specific relationships)

The database links user records with foreign keys that decide what happens when a
user is deleted. These come in two groups, and it is important to keep them
separate.

**Baseline relationships (part of the original reconstruction).**
These exist as soon as the baseline schema is reconstructed:

- `profiles.id → auth.users(id)` — `ON DELETE CASCADE`
- `donor_profiles.user_id → profiles(id)` — `ON DELETE CASCADE`
- `donor_profiles.verified_by → profiles(id)` — `ON DELETE SET NULL`
- `beneficiary_profiles.user_id → profiles(id)` — `ON DELETE CASCADE`
- `donor_availability_details.user_id → donor_profiles(user_id)` — `ON DELETE CASCADE`
- `donor_availability_history.user_id → donor_profiles(user_id)` — `ON DELETE CASCADE`
- `donor_availability_reminders.user_id → donor_profiles(user_id)` — `ON DELETE CASCADE`

**Feature-specific draft relationships (later drafts, not deployed).**
These belong to donor-verification, super-admin, and blood-request draft
migrations that are **not applied**:

- `donor_verification_history.donor_id → donor_profiles(user_id)` — `ON DELETE RESTRICT`
- `donor_verification_history.reviewer_id → profiles(id)` — `ON DELETE RESTRICT`
- `admin_access_history.target_user_id → profiles(id)` — `ON DELETE RESTRICT`
- `admin_access_history.actor_id → profiles(id)` — `ON DELETE RESTRICT`
- `blood_requests.beneficiary_id → beneficiary_profiles(user_id)` — `ON DELETE RESTRICT`
- `blood_request_interests.request_id → blood_requests(id)` — `ON DELETE RESTRICT`
- `blood_request_interests.donor_id → donor_profiles(user_id)` — `ON DELETE RESTRICT`

Total: **14 user-linked foreign key relationships** (7 baseline, 7
feature-specific drafts).

What this means:

- A **CASCADE** deletes the linked child rows (for example, deleting a profile
  deletes the donor/beneficiary sub-profile and the availability rows).
- A **RESTRICT** relationship **blocks** deletion while matching rows exist. So
  a reviewed donor, a reviewer, an appointment target, an admin actor, a
  beneficiary with requests, or a donor with expressed interest **cannot be hard
  deleted**.
- `verified_by` uses `ON DELETE SET NULL`, so deleting a reviewer could silently
  erase "who approved this donor". This can conflict with the goal of preserving
  attribution and needs its own decision.

**Do not assume any migration is deployed.** The RESTRICT relationships exist
only after the later drafts are applied in order; their real status in any remote
project is not established here. Do not change any foreign key without first
explaining the impact on audit and blood-request history.

---

## 8. Known Gaps

The following do **not** exist today and must not be described as available:

- No account deletion UI.
- No account deletion service or database function/RPC.
- No admin deletion functionality (only a draft deactivation function).
- No data anonymization process.
- No finalized retention or archival schedule.
- No profile-photo cleanup process.
- No designed handling of Auth session invalidation or `account_status`-aware
  RLS/Storage policies for closed accounts.
- Deployment status of the feature-specific draft migrations and of any remote
  database is not established.

---

## 9. Future Implementation Plan (before any closure feature is built)

The following steps should be completed, in order, before implementing account
closure, anonymization, or deletion:

1. **Approve the policy direction** (Section 10): deactivation-first, and
   whether/when anonymization or erasure is offered.
2. **Define a retention schedule** with legal/privacy input (how long data is
   kept and why). This proposal does not set one.
3. **Design complete deactivation** covering all three access layers: Auth
   session invalidation/ban, `account_status`-aware RLS, and `account_status`-
   aware Storage policies.
4. **Design the anonymization method** (which fields are replaced, and what
   identifier is kept so audit history stays meaningful).
5. **Design profile-photo cleanup** for closed accounts (owned objects only).
6. **Resolve the `verified_by` SET NULL vs attribution conflict**, with a plan
   for any existing data.
7. **Define the authorization model** for closure/anonymization/deletion (who may
   perform it, how it is audited, and how it is prevented from destroying
   protected history).
8. **Write and review tests** covering each foreign-key block, the anonymization
   outcome, and each access-revocation case.
9. **Verify on an isolated environment** with synthetic data before any real
   project is touched.

---

## 10. Open Decisions (require approval)

The following decisions are **not made** and block implementation:

- Is closure deactivation-only, or must anonymization and/or physical deletion
  also be offered?
- What is the retention duration for deactivated accounts and their personal
  data?
- What exactly is considered "personal data" to remove, and what must be kept
  for audit?
- How should reviewer attribution (`verified_by`, verification history, admin
  history) be preserved when a reviewer closes their account?
- What is the Auth session invalidation / ban policy on deactivation?
- Who is authorized to perform closure, anonymization, or deletion, and how is
  it logged?
- What legal/privacy obligations (erasure, data minimization) apply to this
  project?

---

## Recommended MVP Direction (for discussion)

- **Immediately:** deactivate the account and preserve all audit history.
- **Later, with separate approval:** personal-data anonymization, physical
  deletion, profile-photo cleanup, and a defined retention duration.

This is a recommendation only. It is **not an approved policy and not
implemented.**
