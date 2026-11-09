# 1. Project Overview

## App Name
**Blood Management System (BMS)**

## Purpose
A mobile application designed to connect people who need blood with suitable blood donors.

The application aims to simplify blood donation coordination by allowing:
- Donors to register and manage their donor profiles.
- Beneficiaries (people who need blood) to search for donors.
- Beneficiaries to create and manage blood requests.
- Donors to browse open blood requests and express interest in helping.
- Administrators to manage the system and eventually handle donor verification.

## Problem It Solves
Finding an available blood donor can be difficult and time-consuming, especially when someone urgently needs blood.

BMS aims to make the process easier by providing a centralized platform for donor discovery, blood requests, and donor interest management.

## Target Users

| User | Purpose |
|---|---|
| Donor | Register as a donor, manage donor information, availability, search for open blood requests, and express interest. |
| Beneficiary | Register, search for suitable donors, create blood requests, view personal requests, and cancel open requests. |
| Admin | Manage administrative operations and eventually verify donors. |
| Super Admin | Intended to manage administrative access and permissions. |
| Hospitals / Blood Banks | Potential future users; no hospital-specific workflow has been implemented or confirmed. |

---

# 2. Tech Stack

## Confirmed Technologies

| Category | Technology | Version / Details |
|---|---|---|
| Frontend | React Native | Version UNKNOWN - needs to be checked in the code |
| Framework | Expo | SDK 57 was used when the project was created |
| Language | TypeScript | Used throughout the application |
| Navigation | Expo Router | File-based routing |
| Backend | Supabase | PostgreSQL database and authentication |
| Database | PostgreSQL | Supabase-managed PostgreSQL |
| Authentication | Supabase Auth | Authentication and user sessions |
| Image selection | Expo Image Picker | Installed and used for profile pictures |
| Code editor | Visual Studio Code | Used for development |
| AI coding tool | Codex VS Code extension | Used for code implementation and review |
| Version control | Git | Main branch |
| Remote repository | GitHub | Repository: `YOUR_GITHUB_REPO_URL` |
| Mobile testing | Expo Go | Tested on an Android phone |
| Runtime | Node.js | v22.14.0 was reported |
| Operating system | Windows 10 Pro | Build 19045 was reported |

### Important Version Notes

- Expo SDK 57 was used during project creation.
- Node.js v22.14.0 was installed.
- Exact React Native, Expo Router, Supabase JS, and TypeScript package versions are UNKNOWN - needs to be checked in the code.
- The Supabase project was reported to use the free plan and Singapore region. Confirm this before future deployment work.

## Local Project Location

    E:\BMS\blood-management-app

## How to Run Locally

Open the project folder in VS Code.

Open the integrated terminal:

    cd E:\BMS\blood-management-app

Start the Expo development server:

    npx.cmd expo start

Then:
1. Open Expo Go on the Android phone.
2. Scan the QR code displayed by Expo.
3. Open the application.

### TypeScript Check

    node_modules\.bin\tsc.cmd --noEmit

### Git Status

    git status --short

### Check for Whitespace Errors

    git diff --check

### Install Dependencies

If dependencies are missing, inspect `package.json` and the available lockfile first. Then use the appropriate npm installation command.

PowerShell note:
- `npm` and `npx` script execution was blocked by the user's PowerShell environment.
- `npm.cmd` and `npx.cmd` worked successfully.
- Prefer `npm.cmd` and `npx.cmd` in PowerShell.

### Linting

Expo lint was attempted but failed because its CLI attempted environment loading and ESLint auto-configuration, then encountered an access/network aggregate error.

Linting has not been successfully completed.

---

# 3. Folder and File Structure

## Confirmed / Known Project Structure

    blood-management-app/
    │
    ├── src/
    │   ├── app/
    │   │   ├── login.tsx
    │   │   ├── donor-register.tsx
    │   │   ├── beneficiary-dashboard.tsx
    │   │   ├── donor-dashboard.tsx
    │   │   ├── admin-dashboard.tsx
    │   │   ├── super-admin-dashboard.tsx
    │   │   ├── create-blood-request.tsx
    │   │   ├── my-blood-requests.tsx
    │   │   └── open-blood-requests.tsx
    │   │
    │   └── lib/
    │       └── blood-requests.ts
    │
    ├── docs/
    │   ├── super-admin-management.md
    │   └── blood-request-management.md
    │
    └── supabase/
        ├── migrations/
        │   ├── 20261023000100_baseline_public.sql
        │   ├── 20261023000200_baseline_auth_storage.sql
        │   ├── 20261023000300_revoke_client_truncate.sql
        │   ├── 20261023000350_revoke_client_trigger.sql
        │   ├── 20261023000400_admin_donor_verification.sql
        │   ├── 20261026000100_super_admin_management.sql
        │   └── 20261028000100_blood_request_management.sql
        │
        └── tests/
            └── database/
                ├── admin_donor_verification.test.sql
                ├── super_admin_management.test.sql
                ├── blood_request_management.test.sql
                ├── revoke_client_trigger.test.sql
                └── revoke_client_truncate.test.sql

This is a partial project tree based on files explicitly mentioned during development. Other files and folders may exist.

## Important File Descriptions

### `src/app/`

| File | Purpose |
|---|---|
| `login.tsx` | User login and existing authentication flow. |
| `donor-register.tsx` | Donor registration form. |
| `beneficiary-dashboard.tsx` | Beneficiary dashboard and navigation to Blood Request screens. |
| `donor-dashboard.tsx` | Donor dashboard and navigation to Open Blood Requests. |
| `admin-dashboard.tsx` | Existing admin dashboard. |
| `super-admin-dashboard.tsx` | Super Admin Management UI draft. |
| `create-blood-request.tsx` | Beneficiary screen for creating a blood request. |
| `my-blood-requests.tsx` | Beneficiary screen for viewing and cancelling personal requests. |
| `open-blood-requests.tsx` | Donor screen for browsing open requests and expressing interest. |

Other registration, welcome, and shared UI files exist or were discussed, but their exact paths are UNKNOWN - needs to be checked in the code.

### `src/lib/`

| File | Purpose |
|---|---|
| `blood-requests.ts` | Typed Blood Request RPC wrappers, runtime validation, authorization-related checks, and disabled-by-default activation gate. |

The exact location of the Supabase client, authentication helpers, and other shared services is UNKNOWN - needs to be checked in the code.

### `docs/`

| File | Purpose |
|---|---|
| `super-admin-management.md` | Documents the Super Admin Management draft. |
| `blood-request-management.md` | Documents Blood Request database design, deployment prerequisites, and testing requirements. |

### `supabase/migrations/`

Contains SQL migration drafts and historical migrations.

Important:
- `20261023000100_baseline_public.sql` is an existing baseline migration.
- `20261023000200_baseline_auth_storage.sql` is an existing baseline migration for the authentication trigger and the storage bucket/policies.
- `20261023000300_revoke_client_truncate.sql` revokes client TRUNCATE privileges.
- `20261023000350_revoke_client_trigger.sql` is a dedicated client TRIGGER, REFERENCES and MAINTAIN privilege-hardening review draft.
- `20261023000400_admin_donor_verification.sql` is a donor verification migration draft.
- `20261026000100_super_admin_management.sql` is a Super Admin Management migration draft.
- `20261028000100_blood_request_management.sql` is the Blood Request Management migration draft.

These files do not imply that the corresponding changes have been deployed to the live Supabase database.

### `supabase/tests/database/`

Contains database test drafts using pgTAP.

- `admin_donor_verification.test.sql`
- `super_admin_management.test.sql`
- `blood_request_management.test.sql`
- `revoke_client_trigger.test.sql`
- `revoke_client_truncate.test.sql`

The existing database test suites, including the new TRIGGER, REFERENCES and MAINTAIN hardening pgTAP drafts, have not been executed against an isolated PostgreSQL/Supabase environment.

---

# 4. Features Status

## COMPLETED

These features have been implemented and were reported working in local Android testing, subject to the limitations noted below.

### Project Setup
- Expo React Native project created.
- Expo Router configured.
- TypeScript configured.
- Git repository initialized and connected to GitHub.
- Expo Go successfully used to test the app on Android.

### Authentication and Navigation
- Existing login flow.
- Role-based navigation for donor and beneficiary.
- Login checks the user's profile role and account status.
- Donor and beneficiary dashboards.
- Registration role selection.
- Login navigation was tested successfully.

### Donor Registration UI
- Profile picture required.
- Image selection through Expo Image Picker.
- Date of birth calendar.
- 18+ age validation.
- Last donation date calendar.
- Last donation date can be cleared.
- Blood group selection.
- Inline validation errors.
- Strong password validation.
- Confirm password field.
- Bangladesh 11-digit phone number validation.
- Location is entered manually rather than through a location dropdown system.

### Beneficiary Registration UI
- Profile picture required.
- No date of birth field.
- Manual District, Thana, and Local Area fields.
- Strong password validation.
- Confirm password field.
- Bangladesh phone number validation.
- Inline validation.
- Registration validation was manually tested.

### Donor Features
- Donor dashboard.
- Donor availability functionality using an existing server-side RPC.
- Donor search from the beneficiary side.
- Donor search filters for active, approved, and available donors.
- Donor contact information is not exposed in donor search results.
- Profile photo functionality.
- Existing donor availability and search behavior passed the reported Android regression tests.

### Blood Request Frontend
The following frontend files have been implemented:

- `src/lib/blood-requests.ts`
- `src/app/create-blood-request.tsx`
- `src/app/my-blood-requests.tsx`
- `src/app/open-blood-requests.tsx`

Dashboard navigation was added for both beneficiary and donor users.

Implemented frontend behavior:
- Create Blood Request screen.
- My Blood Requests screen.
- Open Blood Requests screen.
- Loading states.
- Empty states.
- Error and retry states.
- Confirmation before cancellation.
- Confirmation before expressing donor interest.
- Duplicate-submission protection.
- Runtime validation in RPC wrappers.
- Session and role checks.
- Expired request handling.
- Privacy-limited donor-facing request cards.
- No fake blood requests, donor interest counts, or success messages.

**Important:** These screens have not been connected to a deployed Blood Request backend. The disabled activation gate prevents RPC calls. Android testing confirmed that the screens show the backend-not-enabled state.

### GitHub
- Main branch is connected to `origin/main`.
- Latest confirmed commit:

    79b376c86ee6b6ca0f2428feee972a28a2bf3f8d

- Commit message:

    feat: add blood request management frontend drafts

- Push to `origin/main` succeeded.
- Final reported Git status was clean:

    main...origin/main

- TypeScript check passed.
- `git diff --check` passed.

## IN PROGRESS

### 1. Blood Request Management Backend

Draft migration:

    supabase/migrations/20261028000100_blood_request_management.sql

Draft tests:

    supabase/tests/database/blood_request_management.test.sql

Documentation:

    docs/blood-request-management.md

The migration draft contains:
- `blood_requests` table.
- `blood_request_interests` table.
- Five SECURITY DEFINER RPC functions.
- RLS enabled.
- No direct client-facing policies or direct table grants.
- Server-side role and account-status validation.
- Ownership validation.
- Donor eligibility validation.
- Request locking and duplicate-interest prevention.
- Aggregate-only interest counts for beneficiaries.

Missing:
- Migration has not been executed.
- SQL parsing has not been completed.
- pgTAP tests have not been run.
- ACL fault-injection tests have not been run.
- Concurrency tests have not been run.
- Real RPC integration has not been tested.
- Backend activation gate must remain disabled.

### 2. Donor Verification / Admin Management

Existing drafts:
- `src/app/super-admin-dashboard.tsx`
- `src/lib/admin-management.ts`
- `docs/super-admin-management.md`
- `supabase/migrations/20261026000100_super_admin_management.sql`
- `supabase/tests/database/super_admin_management.test.sql`

The Super Admin Management UI and backend drafts were added.

Missing:
- Migration deployment.
- Database tests.
- Live authorization testing.
- Confirmation that the donor verification workflow prevents unverified donors from becoming eligible.

The existing donor verification migration draft is also undeployed:

    supabase/migrations/20261023000400_admin_donor_verification.sql

### 3. Donor Dashboard Layout

**Status: RESOLVED — verified by the user on the device.**

The user confirmed that the previously reported Donor Dashboard layout issue is now fixed when checked on the device. No code changes were made for this issue in that session.

The user reported:
- The area beside the donor's name is visually broken.
- The area near/below the Profile Update button is visually broken.
- Other tested app functionality works.

Three original emoji/text strings had also suffered an encoding regression during development. These were restored before the latest commit:
- `👤`
- `❤️ My Donor Information`
- `📷 Upload / Change Profile Photo`

The original symptoms are retained above as project history. No new tests are claimed as part of the session in which the user verified the fix.

### 4. Deployment and Database Testing

Production database deployment is intentionally blocked until the required security prerequisites and isolated tests are complete.

---

## NOT STARTED

The following features were not confirmed implemented:

- Completed donation/fulfillment workflow.
- Contact exchange between donors and beneficiaries.
- Donation completion confirmation.
- Notifications for new blood requests or donor interest.
- Push notifications.
- Hospital or blood bank workflows.
- Advanced request matching.
- Complete admin verification workflow in a deployed environment.
- Full production deployment and acceptance testing.
- Any additional analytics/reporting functionality not already present in the code.

Do not assume these features exist.

---

# 5. Database Design

## Existing Database Context

Supabase PostgreSQL is used.

The existing application uses profile information for authentication and authorization.

Known profile-related fields:
- `profiles.role`
- `profiles.account_status`

Other existing donor-related data includes:
- Verification status.
- Donor availability.
- Blood group.

Exact table names, all columns, PostgreSQL types, constraints, and relationships for existing donor-related data are UNKNOWN - needs to be checked in the code.

The existing donor availability feature uses a SECURITY DEFINER RPC with server-side role, approval, active-account, and row-lock checks.

## Proposed Blood Request Tables

The following tables exist in the Blood Request migration draft. They have NOT been deployed.

### A. `blood_requests`

Purpose:
Stores requests created by beneficiaries.

Known logical data:
- Request identifier.
- Beneficiary ownership/reference.
- Blood group.
- Units required.
- Urgency.
- Needed-by date/time.
- Approximate location.
- Request status.
- Creation/update information, if defined in the migration.

Known status behavior:
- `open`
- `cancelled`

Expired requests are excluded from donor listing, and donors cannot express interest in expired requests.

Exact column names, PostgreSQL types, nullability, defaults, and timestamp fields are UNKNOWN - needs to be checked in the code, specifically in:

    supabase/migrations/20261028000100_blood_request_management.sql

### B. `blood_request_interests`

Purpose:
Stores donor interest in a particular blood request.

Known logical data:
- Interest identifier.
- Blood request reference.
- Donor reference.
- Interest status or associated metadata, if defined.

Known constraints:
- One donor can express interest only once for a given request.
- A unique request/donor combination prevents duplicate interest.
- Interest means willingness to help, not a completed donation or medical clearance.

Exact columns and PostgreSQL types are UNKNOWN - needs to be checked in the migration.

## Relationships

Known intended relationships:

- A beneficiary owns their blood requests.
- A blood request can have multiple donor interests.
- Each donor can have only one interest per request.
- The request and interest tables use foreign-key constraints.
- Restrictive foreign-key behavior is used in the draft.

Exact foreign-key column names and referenced tables are UNKNOWN - needs to be checked in the migration.

## Blood Request Authorization Rules

### Beneficiary
- Must be authenticated.
- Must have the beneficiary role in the database profile.
- Must have an active account.
- Can create requests.
- Can list only their own requests.
- Can cancel only their own eligible open requests.

### Donor
- Must be authenticated.
- Must have the donor role.
- Must have an active account.
- Must be approved.
- Must be available to donate.
- Must match the request's blood group exactly.
- Cannot express interest in expired or cancelled requests.
- Cannot express duplicate interest.

The backend must remain the authority for these checks. Frontend state alone is never sufficient.

## Privacy Rules

Donor-facing request cards must not expose:
- Beneficiary name.
- Beneficiary phone number.
- Beneficiary profile photo.
- Precise private notes.
- Other private identifying information.

Beneficiary request listing returns aggregate interest counts only. It must not reveal donor identities or contact details.

## RPC Functions

Five Blood Request RPC functions are defined in the migration draft.

| RPC | Purpose |
|---|---|
| `beneficiary_create_blood_request(...)` | Create a request for the authenticated beneficiary. |
| `beneficiary_list_my_blood_requests(...)` | List requests belonging to the authenticated beneficiary. |
| `beneficiary_cancel_blood_request(request_id)` | Cancel an eligible request owned by the beneficiary. |
| `donor_list_open_blood_requests(...)` | List eligible open, non-expired blood requests for donors. |
| `donor_express_interest(request_id)` | Allow an eligible donor to express interest in an open request. |

Exact parameter types, return columns, and full function signatures must be read from the migration before changing the frontend service wrappers.

## Important Database Security Decisions

- Enable RLS on the new request tables.
- Do not grant direct client table access.
- No client-facing RLS policies or direct table grants are intended for these tables.
- Use explicitly granted SECURITY DEFINER RPC functions.
- Use an empty function search path and fully qualified database object references.
- Derive user identity from `auth.uid()`.
- Validate authorization and ownership on the server.
- Lock request rows when handling cancellation and donor interest.
- Prevent duplicate interests through a unique constraint.
- Return aggregate interest counts to beneficiaries rather than donor identities.

## Critical Deployment Blockers

### 1. Client TRIGGER Privileges

The baseline migration grants TRIGGER privileges to `anon` and `authenticated` on core profile-related tables.

The Blood Request migration has a fail-closed permission guard that rejects this unsafe privilege state.

A separately reviewed and applied TRIGGER, REFERENCES and MAINTAIN privilege-hardening migration is required before deployment. A dedicated draft now exists at:

    supabase/migrations/20261023000350_revoke_client_trigger.sql

Its matching pgTAP draft is:

    supabase/tests/database/revoke_client_trigger.test.sql

Both drafts have received static review. The review corrections cover the inherited-role expected error, restoration of both table and global default ACLs in the rollback rehearsal, an unknown creator default-ACL case, and preservation checks for the Auth signup trigger. No SQL or pgTAP was executed. The drafts are ready for isolated testing preparation only; syntax and runtime verification remain pending.

### 2. Donor Verification

The baseline migration defaults new donors to approved.

The donor verification migration draft changes the default to pending, but it is not deployed.

A separately reviewed and deployed donor-verification workflow must prevent unverified donors from becoming eligible for blood requests.

### 3. Isolated Testing

Before production deployment:
- Use an isolated Supabase/PostgreSQL 17 environment.
- Parse and execute the migration.
- Run pgTAP tests.
- Run migration-runner ACL fault-injection tests.
- Run two-session concurrency tests.
- Verify authorization, RLS, function grants, and privacy.
- Verify the existing application still works.

## Important Supabase Warning

The live Supabase migration history is missing or not reliably established.

Do NOT run:
- `supabase db push`
- `supabase db reset`
- Baseline migration replay
- Any production migration command

until the actual live database state and migration history have been safely reconciled.

---

# 6. Key Decisions and Rules

## Product and UX Decisions

1. Donor and beneficiary registration are separate flows.
2. Both registration forms require a profile picture.
3. Donor registration includes date of birth and an 18+ validation rule.
4. Beneficiary registration does not require date of birth.
5. Donor registration includes last donation date.
6. Location is entered manually.
7. The previous District → Thana → Local Area dropdown/dataset approach was dropped because it was too complex.
8. Manual location fields are used instead:
   - District
   - Thana
   - Local Area
9. Bangladesh phone numbers use 11-digit validation.
10. Password confirmation is required.
11. Password validation must enforce a strong password.
12. Inline validation errors are preferred.
13. Existing dashboard and authentication functionality must not be unnecessarily rewritten.

## Blood Request Decisions

1. Beneficiaries create blood requests.
2. Beneficiaries can view and cancel their own eligible open requests.
3. Donors can browse open requests.
4. Donors can express interest in a request.
5. Donor interest does not mean donation completion or medical clearance.
6. Donor-facing request cards must preserve beneficiary privacy.
7. Beneficiaries see aggregate interest counts, not donor identities.
8. Expired requests must not appear in the donor listing.
9. The server rejects interest in expired requests.
10. Donor eligibility is checked server-side.
11. Exact blood group matching is required by the current Blood Request draft.
12. Blood request creation and interest must never display success unless the real RPC confirms success.
13. No fake requests or fabricated interest counts are allowed.
14. The Blood Request activation gate must remain disabled until backend deployment and security testing are complete.

## Account Deletion (DEFERRED)

**Status: DEFERRED.** The project has decided **not** to implement the Account
Deletion feature for now.

- Do not treat Account Deletion as an immediate development task.
- Requirement preserved for the future: when Account Deletion is implemented,
  it must completely remove the account **and all related application data**
  (profile, donor/beneficiary sub-profiles, availability data, verification and
  admin history handling, blood requests and their interests, and the
  profile-photo object in Storage).
- This decision does not change any migration or SQL file.
- Related analysis is recorded in
  `docs/user-deletion-data-retention-policy-proposal.md`.

## Project Requirements — Source of Truth

- The previously approved Project Proposal and the available approved project
  documents remain the **source of truth**.
- Do not redesign or change already-approved workflows.
- Identify implementation gaps against those approved documents.
- Avoid unnecessary scope expansion. Focus on finishing the required features.

## Super Admin Scope (2026-11-06)

Approved decisions recorded 2026-11-06:

- BMS is an academic SDP project, not a production enterprise system.
- Keep the existing approved Super Admin design simple.
- Only **one** initial Super Admin will be created, through the documented
  trusted-operator bootstrap procedure (`docs/super-admin-management.md`). No
  second Super Admin is expected at this stage.
- The existing M6 Admin appointment/revocation design and its audit history
  (`public.admin_access_history`) are retained unchanged.
- Do **not** add a second Super Admin creation system, a recovery system, or an
  MFA requirement at this stage.
- Do not add enterprise-level complexity (for example multi-tenant or
  organization-identity features).
- Do not redesign already-approved Super Admin workflows.

## Development Rules

1. Inspect the existing code before modifying it.
2. Preserve existing functionality.
3. Keep changes narrowly scoped.
4. Do not rewrite complete dashboards unnecessarily.
5. Use accurate TypeScript types.
6. Follow existing project conventions.
7. Prefer complete, copy-paste-ready code when providing code to the user.
8. Explain exactly which file to open, replace, or edit.
9. Use simple, beginner-friendly instructions.
10. For major features, explain the plan and obtain approval before implementation.
11. Verify the Git diff before staging or committing.
12. Do not claim a feature works unless it has actually been tested.
13. Do not claim database integration based only on TypeScript checks.
14. Do not deploy database changes without explicit approval.

## AI Coding Tool Rules

When using Codex or another AI coding tool:
- Tell it to inspect the current Git status first.
- Tell it to preserve existing uncommitted changes.
- Specify the exact allowed files.
- Tell it not to access credentials or expose environment variables.
- Do not allow database deployment or SQL execution unless explicitly approved.
- Do not allow Git commit or push unless explicitly requested.
- Ask for actual check results and a final Git status.
- If an operation is unclear, the AI tool should stop and ask rather than guess.

## Naming and Coding Conventions

Known conventions:
- TypeScript screens use `.tsx`.
- TypeScript service files use `.ts`.
- Expo Router uses file-based routes.
- Database tables and RPC names use snake_case.
- The Blood Request frontend has a centralized activation constant:

    BLOOD_REQUEST_SERVICE_ACTIVE = false

- Use typed RPC wrappers and runtime validation.
- Use server-side authorization rather than trusting frontend state.

Exact shared component naming and full project naming conventions are UNKNOWN - needs to be checked in the code.

---

# 7. API / Routes / Screens

## Existing Screens

| File | Purpose |
|---|---|
| `login.tsx` | Login and authentication. |
| `donor-register.tsx` | Donor registration. |
| Beneficiary registration screen | Beneficiary registration; exact file path UNKNOWN - needs to be checked in the code. |
| `donor-dashboard.tsx` | Donor dashboard. |
| `beneficiary-dashboard.tsx` | Beneficiary dashboard. |
| `admin-dashboard.tsx` | Admin dashboard. |
| `super-admin-dashboard.tsx` | Super Admin Management UI draft. |

## Blood Request Screens

| File / Route | User | Purpose |
|---|---|---|
| `create-blood-request.tsx` | Beneficiary | Create a blood request. |
| `my-blood-requests.tsx` | Beneficiary | View and cancel personal requests. |
| `open-blood-requests.tsx` | Donor | Browse open requests and express interest. |

Dashboard navigation:
- Beneficiary dashboard → Create Blood Request.
- Beneficiary dashboard → My Blood Requests.
- Donor dashboard → Open Blood Requests.

These screens currently show the backend-not-enabled state because the activation gate is false.

Exact route URL strings and route parameter types are UNKNOWN - needs to be checked in the code.

## Blood Request RPC API

| Function | Caller | Purpose |
|---|---|---|
| `beneficiary_create_blood_request(...)` | Beneficiary | Create a request. |
| `beneficiary_list_my_blood_requests(...)` | Beneficiary | List own requests. |
| `beneficiary_cancel_blood_request(request_id)` | Beneficiary | Cancel own request. |
| `donor_list_open_blood_requests(...)` | Donor | Browse eligible requests. |
| `donor_express_interest(request_id)` | Donor | Express interest. |

These RPC functions are draft-only and have not been executed against a live or isolated database.

## Existing Donor Availability API

An existing SECURITY DEFINER RPC manages donor availability with server-side role, approval, active-account, and row-lock checks.

Its exact function name and parameters are UNKNOWN - needs to be checked in the code.

## Existing Authentication API

Supabase Auth is used.

The application reads profile role and account status from the database.

Exact authentication helper function names and Supabase client file path are UNKNOWN - needs to be checked in the code.

---

# 8. Known Bugs and Problems

## 1. Donor Dashboard Layout Issue

**Status:** RESOLVED

The user verified on the device that the previously reported layout issue is
fixed; no code change was required in that session (see Section 9, "Priority 1").

User reported:
- UI beside the donor's name is visually broken.
- UI near/below the Profile Update button is visually broken.
- Other tested functionality works.

The issue appeared after Blood Request navigation was added.

The exact cause is UNKNOWN - needs to be checked in the code.

Do not rewrite the dashboard. Inspect its current layout and fix only the affected spacing/alignment.

## 2. Expo Lint Failure

**Status:** OPEN

Expo lint was attempted.

The CLI attempted environment loading and ESLint auto-configuration, then failed with an access/network aggregate error.

No environment values were printed or used.

TypeScript checking passed, but linting remains unverified.

## 3. Expo Router Generated Route Types

**Status:** KNOWN LIMITATION

During local TypeScript checking, Expo Router's generated route union had not yet included the newly created Blood Request screens.

The three new route literals use `Href` typing until Expo regenerates route types.

Check whether route types regenerate correctly after restarting Expo or running the project's configured route-generation process.

Do not change route typing without inspecting the installed Expo Router version and existing conventions.

## 4. Blood Request Backend Not Deployed

**Status:** INTENTIONALLY BLOCKED

The frontend exists, but:
- No Blood Request RPC has been executed.
- No database integration has been tested.
- The activation gate is false.
- Screens must not fabricate requests or success messages.

## 5. Baseline Client TRIGGER Privileges

**Status:** DEPLOYMENT BLOCKER

The baseline migration grants client TRIGGER privileges on core profile-related tables.

The Blood Request migration fails closed when unsafe effective client TRIGGER privileges remain.

A separate reviewed hardening migration is required.

## 6. Donor Verification Default

**Status:** DEPLOYMENT BLOCKER

The baseline migration defaults new donors to approved.

The donor verification migration draft changes the default to pending but is not deployed.

The donor verification workflow must be reviewed and deployed before allowing donor participation in Blood Request workflows.

## 7. Database Migration History

**Status:** UNKNOWN / HIGH RISK

The live Supabase migration history is missing or not reliably established.

Do not push, reset, or replay migrations against production.

## 8. Database Tests Not Executed

**Status:** OPEN

Not completed:
- SQL parsing.
- Migration execution.
- pgTAP tests.
- ACL fault-injection tests.
- Concurrency testing.
- Real Supabase RPC integration testing.

`psql` and `pg_prove` were unavailable in the previous development environment.

## 9. Supabase Test Project

A separate test Supabase project was desired.

An attempt to create one encountered a Supabase incident. An hourly automation was created to check for incident resolution.

Current test-project creation status is UNKNOWN - needs to be checked.

## 10. Historical Encoding Regression

**Status:** FIXED

Three existing donor dashboard strings had temporarily changed to mojibake:
- `👤`
- `❤️ My Donor Information`
- `📷 Upload / Change Profile Photo`

They were restored exactly before commit `79b376c`.

The user has since verified on the device that the donor dashboard layout issue is resolved. No code changes were made for this issue in that session.

---

# 9. Next Steps

Prioritized list:

## Current Development Priority — Complete the Core Application

Finish the core application as soon as possible, in support of the approved
project documents:

1. Blood request creation and management.
2. Exact blood-group donor matching.
3. Eligible donor notifications.
4. Donor acceptance and beneficiary information disclosure according to the
   approved workflow.
5. Donation status tracking.
6. Four-month donor eligibility and automatic availability.
7. Two-day post-donation health follow-up.
8. Admin features and reports.
9. Frontend-backend integration and testing.

Account Deletion is **DEFERRED** (see the "Account Deletion (DEFERRED)" decision
in Section 6) and is not part of this priority list. The numbered priorities
below remain valid for the current draft-review and testing work.

## Approved Development Priority — 2026-11-06

Primary goal: complete a functional Blood Management System feature by feature,
following the approved Project Proposal and approved project documents as the
source of truth.

Approved priority sequence:

1. Donor Verification
2. Four-month donor eligibility and donation history
3. Blood Request and Matching
4. Complete Donation Workflow
5. Notifications and Health Follow-up
6. Admin Reports and Statistics
7. Remaining UI and integration work

For each feature, complete and verify all four layers:
- Frontend
- Backend
- Database
- Integration

This sequence sets the primary feature-completion order. The earlier
"Current Development Priority" list and the "Priority 1–9" subsections below
remain recorded as working notes and history.

## Priority 1 — Donor Dashboard Layout (Resolved)

- The user verified on the device that the previously reported layout issue is fixed.
- No code changes were made for this issue in that session.
- No new tests are claimed for that session.

## Priority 2 — Review Blood Request Frontend

Files:
- `src/lib/blood-requests.ts`
- `src/app/create-blood-request.tsx`
- `src/app/my-blood-requests.tsx`
- `src/app/open-blood-requests.tsx`

Tasks:
- Review exact RPC arguments against the migration.
- Verify runtime validation.
- Verify backend activation gate remains false.
- Review authorization checks.
- Verify privacy restrictions.
- Check navigation and route types.
- Test loading, empty, retry, and disabled-backend states.

## Priority 3 — Review Database Migration Draft

File:

    supabase/migrations/20261028000100_blood_request_management.sql

Tasks:
- Review exact table fields and PostgreSQL types.
- Review foreign keys and constraints.
- Review RLS and grants.
- Review SECURITY DEFINER functions.
- Review function search paths.
- Review effective permission guards.
- Review request expiry and row locking.
- Review authorization and privacy.

Do not deploy this migration yet.

## Priority 4 — Prepare Trigger Privilege Hardening

Drafts prepared and statically reviewed:

    supabase/migrations/20261023000350_revoke_client_trigger.sql
    supabase/tests/database/revoke_client_trigger.test.sql

The static review found no new obvious blocker. They are ready for isolated testing preparation only; they have not been parsed or run against PostgreSQL. The pgTAP test helper duplicates some migration guard logic and may drift, so keep the two implementations aligned during future review.

Tasks:
- Inspect BMS-Development and confirm its target identity/schema before any testing.
- Separately approve isolated testing operations before applying the draft or running pgTAP.
- Test effective ACLs, direct/PUBLIC/inherited/SET ROLE paths, default ACLs, and rollback in isolation.
- Verify the existing Auth signup trigger remains intact.

Do not connect to or modify the Original/Main Supabase project. Do not deploy production migrations without explicit approval.

## Priority 5 — Complete Donor Verification Workflow

Relevant draft:

    supabase/migrations/20261023000400_admin_donor_verification.sql

Tasks:
- Review the donor verification migration.
- Review admin permissions.
- Ensure new donors cannot participate before verification.
- Verify approval and suspension behavior.
- Test server-side eligibility checks.
- Review Super Admin Management integration.

## Priority 6 — Set Up Isolated Supabase Environment

The user reports that a separate Supabase Development project has been created. Its identity and schema have not yet been inspected or independently verified. The next step is to inspect BMS-Development first, then separately approve any isolated testing operations.

Environment details reported by the user: region `eu-north-1`, PostgreSQL `17.11.0.011`.

Never use or modify the Original/Main Supabase project for experimental migration testing. Establish and verify a safe baseline in Development before testing drafts.

## Priority 7 — Execute Database Tests

Tasks:
- Use an isolated Supabase PostgreSQL 17 environment.
- Parse and execute the Blood Request migration.
- Run pgTAP.
- Test invalid roles and account states.
- Test donor availability and verification rules.
- Test duplicate interests.
- Test cancellation and expiry.
- Test direct table access restrictions.
- Run ACL fault injection.
- Run two-session concurrency tests.

## Priority 8 — Enable Blood Request Backend Only After Approval

Only after all deployment prerequisites pass:
- Review migration deployment sequence.
- Reconcile production migration history safely.
- Obtain explicit deployment approval.
- Deploy through a reviewed process.
- Verify real RPC behavior.
- Enable the frontend activation gate through a separate reviewed code change.
- Test end-to-end donor and beneficiary workflows.

## Priority 9 — Future Features

After Blood Request is stable:
- Donation completion workflow.
- Contact exchange.
- Notifications.
- Hospital/blood bank workflows, if approved.
- Additional reporting and analytics, if required.

---

# 10. Important Code References

## Latest Git Commit

    fd86e26b600ac19f41f44424de1227e1b8d5bf23

Commit message:

    harden client trigger references and maintain privileges

Branch:

    main

Remote:

    origin/main

Last confirmed state:

    main...origin/main

Working tree has six modified, unstaged files (not committed or pushed):

    PROJECT_CONTEXT.md
    docs/admin-donor-verification.md
    docs/blood-request-management.md
    docs/database-baseline-review.md
    docs/super-admin-management.md
    supabase/tests/database/admin_donor_verification.test.sql

## Blood Request Activation Gate

File:

    src/lib/blood-requests.ts

Important constant:

    BLOOD_REQUEST_SERVICE_ACTIVE = false

This must remain false until backend deployment, security review, and testing are complete.

## Blood Request RPC Names

    beneficiary_create_blood_request(...)
    beneficiary_list_my_blood_requests(...)
    beneficiary_cancel_blood_request(request_id)
    donor_list_open_blood_requests(...)
    donor_express_interest(request_id)

## Important Database Draft Files

    supabase/migrations/20261028000100_blood_request_management.sql

    supabase/tests/database/blood_request_management.test.sql

    docs/blood-request-management.md

## Important Admin Draft Files

    src/app/super-admin-dashboard.tsx

    src/lib/admin-management.ts

    supabase/migrations/20261026000100_super_admin_management.sql

    supabase/tests/database/super_admin_management.test.sql

    docs/super-admin-management.md

## Existing Database Migration References

    supabase/migrations/20261023000100_baseline_public.sql

    supabase/migrations/20261023000200_baseline_auth_storage.sql

    supabase/migrations/20261023000300_revoke_client_truncate.sql

    supabase/migrations/20261023000350_revoke_client_trigger.sql

    supabase/migrations/20261023000400_admin_donor_verification.sql

## Useful Commands

Start Expo:

    npx.cmd expo start

TypeScript:

    node_modules\.bin\tsc.cmd --noEmit

Git status:

    git status --short

Git branch status:

    git status -sb

Check whitespace:

    git diff --check

Inspect current changes:

    git diff

Inspect a previous committed file:

    git show HEAD:src/app/donor-dashboard.tsx

## Important Testing History

Reported successful:
- Donor login and dashboard.
- Beneficiary login and dashboard.
- Donor search.
- Profile photo.
- Donor availability.
- Logout.
- Blood Request screens show the disabled-backend state.
- TypeScript check.
- `git diff --check`.

Not tested:
- Real Blood Request RPC calls.
- Database integration.
- SQL migration execution.
- pgTAP.
- ACL fault injection.
- Concurrency.
- Production deployment.

---

# 11. Ready-to-Use Resume Prompt

I am continuing development of my Blood Management System (BMS).

First, read the complete `PROJECT_CONTEXT.md` file carefully. Treat it as the current project handoff and source of truth, but verify important details against the actual repository before making changes.

Project path:

    E:\BMS\blood-management-app

Current Git branch:

    main

Latest confirmed commit:

    fd86e26b600ac19f41f44424de1227e1b8d5bf23

Commit message:

    harden client trigger references and maintain privileges

Start by:
1. Inspecting `git status -sb`.
2. Inspecting the current donor dashboard and its Git diff.
3. Confirming that existing changes are preserved.
4. Identifying the highest-priority incomplete item in Section 9.

The Donor Dashboard layout issue is RESOLVED (see Section 8) and is not the top-priority task. See Section 9, "Current Development Priority — Complete the Core Application", for the current priorities.

Only make the minimal necessary changes to `src/app/donor-dashboard.tsx`. Preserve all existing features, including Blood Request navigation, profile photo, donor information, availability, and logout.

Follow these rules:
- Explain the proposed fix before making significant changes.
- Do not rewrite unrelated files.
- Do not delete or overwrite existing work.
- Run `node_modules/.bin/tsc.cmd --noEmit` and `git diff --check`.
- Report the exact files changed and actual test results.
- Do not commit or push unless I explicitly ask.
- Do not connect to Supabase, execute SQL, deploy migrations, or change database migration history.
- Keep `BLOOD_REQUEST_SERVICE_ACTIVE = false`.
- Do not claim that any database feature works until it has been tested against an isolated database.

Use simple explanations and practical step-by-step instructions. If something is unclear, write "UNKNOWN - needs to be checked in the code" and inspect the repository instead of guessing.

## Supabase Manual Database Workflow

Important: This project uses Supabase for its backend database. Database setup and management are performed manually through the Supabase Dashboard by the project owner.

Rules for AI assistants:

1. Never assume that a SQL migration file has been executed just because it exists in the repository.
2. Always distinguish between drafted, reviewed, tested, and deployed migrations.
3. Before suggesting database changes, inspect the existing migration files and project schema.
4. Explain each SQL operation in beginner-friendly language.
5. Provide the exact SQL file or SQL query and explain where it should be executed in Supabase.
6. Never execute SQL against the live Supabase project without explicit approval.
7. Do not run destructive SQL or modify existing tables without explaining the impact and obtaining approval.
8. Prefer testing database migrations in an isolated test project before production.
9. After manual execution, ask the owner to share the result or error message.
10. Update this context document with the verified database progress.

### Current Database Status

Status snapshot: 2026-11-09.

- Blood Request migration: Drafted, not deployed.
- Blood Request database tests: Drafted, not executed.
- Donor verification workflow: Not yet deployed.
- Client TRIGGER, REFERENCES and MAINTAIN hardening migration and pgTAP test: Drafted, statically reviewed, and now capability-adapted for the hosted platform; still not applied anywhere.
- BMS-Development project: Confirmed target `zbgqpqafvcxaoxxcuyxn` (eu-north-1, PostgreSQL 17.11.0.011), linked locally. The Original/Main project `zmxtxuuooviwjsdghqlt` remains untouched.
- Verified pre-flight state of BMS-Development (2026-11-09): remote migration history empty (all seven local versions unrecorded); `public` schema empty (`inspect db table-sizes` returned no tables, `db stats` reported 0 bytes of table/index storage). `auth.users` row count and the `profile-photos` bucket configuration were NOT verifiable with the available read-only tooling.
- Apply attempt (2026-11-09, approved): `supabase db push` of M1-M4 against BMS-Development. **M1 failed** with `permission denied to change default privileges (SQLSTATE 42501)` on `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin ...` because hosted `postgres` is not a member of `supabase_admin`. Push stopped immediately; M2, M3 and M3.5 were not attempted. Post-failure verification: history still empty, `public` still empty, M1 fully rolled back.
- Remediation (implemented, not applied): M1, M3 and M3.5 capability-gate the supabase_admin default-ACL statements, cast the role name to `text` in the `pg_has_role` capability check (avoiding overload ambiguity), and add a supabase_admin-owned **relation** assertion covering relkind r/p/v/f/m. Migration guards and both pgTAP guard copies are synchronized. See docs/database-baseline-review.md.
- Hashes after the corrections: M1 `A5322AEB…403E39DA`, M3 `3A970396…15364BD2`, M3.5 `A34675CA…185CF222`; M2 unchanged.
- Applied successfully (2026-11-09): M1, M2, M3 and M3.5 pushed to BMS-Development from an isolated workdir. Verified afterwards: all four recorded in remote history, M6/M7 still unrecorded, the six baseline tables present, and `db lint` reported no schema errors. ACL, bucket and policy details rest on the migrations' own fail-closed guards because no read-only SQL channel is available.
- M5 apply attempt (2026-11-09, approved): **failed** at statement 5 with `LOCK TABLE can only be used in transaction blocks (SQLSTATE 25P01)`. Cause: PostgreSQL rejects `LOCK TABLE` unless an explicit `BEGIN … COMMIT` block is open, while the CLI applies a file in one *implicit* transaction only. The whole file aborted, so this failure is not evidence of a partial commit. Nothing was applied, history is unchanged, and no partial objects exist (`donor_verification_history` absent, baseline tables untouched).
- M5 correction (2026-11-09, approved Option 2): the standalone `LOCK TABLE public.donor_profiles IN ACCESS EXCLUSIVE MODE` was removed; the `ALTER TABLE ... SET DEFAULT / SET NOT NULL` statements remain the ACCESS EXCLUSIVE serialization point. The status preflight, constraints, RPCs, RLS and permission guards are unchanged. New M5 SHA-256: `3DE66B4C9C28E8E169FA41A5443C345F6D11354FF76292237FE2EA571D7E3ECF`. This correction was subsequently applied successfully — see the progress entry below.
- No pgTAP test has ever been executed. Both revoke tests are LOCAL-ONLY: they inject `FOR ROLE supabase_admin` default ACLs and therefore need a local/self-hosted superuser environment, not hosted Development.
- Production database changes: Require explicit approval.

### Progress entry — 2026-11-09 (frontend activation and housekeeping)

- App `.env` now points to the Development project ref `zbgqpqafvcxaoxxcuyxn`. The operator repointed it during this session: the first boolean-only check returned False and, after the file changed, the same check returned True.
- Presence checks passed for both client variables: the URL contains the Development ref, and the publishable key is present, non-empty and `sb_publishable_` prefixed.
- Key ownership by the Development project was **not** independently verified through an authenticated API call; the `sb_publishable_` prefix identifies the key type only.
- The operator restarted Expo with a cleared cache and opened the app successfully in Expo Go.
- No database changes, migrations, registrations or Supabase connections were performed in this housekeeping session. (The M1–M3.5 and M5 deployments earlier on 2026-11-09 are recorded above.)
- M1, M2, M3, M3.5 and M5 remain applied to BMS-Development. M6 and M7 remain unapplied.
- The approved initial Super Admin bootstrap requires M6 first, because `public.admin_access_history` is created only by M6. The M6 RPCs also require an existing active super admin, so they cannot bootstrap themselves.
- Admin donor-verification frontend is activated in code (`VERIFICATION_SERVICE_ACTIVE = true`, review dialog wired to `adminReviewDonor`); the two-account end-to-end smoke test is still outstanding.
- Next planned work: approve and apply M6 from an isolated workdir with `supabase db push --linked --skip-vault --yes` (one implicit transaction per file, history row included), then confirm `migration list` shows M6 applied and M7 unapplied. The Super Admin bootstrap remains a separate approved operation.
- The Main Supabase project (`zmxtxuuooviwjsdghqlt`) remains untouched.

### Progress entry - 2026-11-09 (M6 read-only review, dry-run and documentation correction)

- M6 reviewed read-only; reviewed SHA-256 `E3516117D1825BBDC4FF7E46D8C6410AE963973FC6DB1DB4D195AD1C1A9E0552` (the documentation correction recorded here changed no SQL).
- Repository state at review: branch `main`, HEAD `363521d1205f95de01d1dc6878db7a4e079851bd` equal to `origin/main`, clean working tree; nothing staged, committed or pushed.
- Development target re-confirmed: CLI link `zbgqpqafvcxaoxxcuyxn` (BMS-Development). Remote history records M1, M2, M3, M3.5 and M5; M6 and M7 are unapplied. Main `zmxtxuuooviwjsdghqlt` was never accessed.
- M6-only dry-run from a fresh temporary workdir (`config.toml` plus M1-M6, M7 excluded, every copied file hash verified) listed exactly one pending migration: `20261026000100_super_admin_management.sql`. Nothing was applied.
- Runner behavior confirmed from the installed CLI 2.121.0 documentation and source: `db push` sends each compatible migration file as one implicit extended-protocol transaction with a single final `Sync`, and the `supabase_migrations.schema_migrations` insert commits in that same batch. It is not an explicit BEGIN/COMMIT block. Per-file atomicity is lost only at pipeline-incompatible statements (`CREATE INDEX CONCURRENTLY`, `DROP INDEX CONCURRENTLY`, `REINDEX ... CONCURRENTLY`, `VACUUM`, `ALTER SYSTEM`, `CLUSTER`); M6 contains none.
- Consequences: M5's `LOCK TABLE` failure reflects PostgreSQL's explicit-transaction-block requirement and did not prove a partial commit; M6 needs no BEGIN/COMMIT wrapper and no `migration repair`.
- `SET LOCAL` in M6 is a warning-only no-op under `db push`, so the in-file `search_path`, 5 s `lock_timeout`, 60 s `statement_timeout` and `check_function_bodies` do not take effect during deployment. Impact is limited because M6 only creates new objects and never alters an existing table, but the deployed objects must still be verified afterwards.
- Documentation corrected (SQL unchanged): `docs/super-admin-management.md`, `docs/admin-donor-verification.md` and this file.
- M6 remains unapplied; a live apply requires separate explicit approval.