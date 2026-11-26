
# Blood Management System 🩸

A mobile-based Blood Management System developed as an academic software development project.

The application aims to connect verified blood donors with beneficiaries, support blood donation requests, and track donation activities.

## Project Status

🚧 Under Active Development

This project is currently being developed and tested. The core donor, beneficiary, Admin and
Super Admin screens are implemented; a few runtime states remain untested and are listed in
`PROJECT_CONTEXT.md`.

**Last documentation update: 2026-11-26.**

## Technology Stack

- **Mobile Framework:** React Native
- **Development Platform:** Expo
- **Programming Language:** TypeScript
- **Navigation:** Expo Router
- **Backend:** Supabase
- **Database:** PostgreSQL
- **Authentication:** Supabase Auth
- **File Storage:** Supabase Storage
- **Security:** Row Level Security (RLS)
- **Version Control:** Git & GitHub
- **Development Environment:** Visual Studio Code

## Implemented Features

### Authentication and Registration
- Donor registration with form validation
- Email verification
- Secure donor login
- Role-based account information
- Beneficiary registration with form validation and Supabase Auth sign-up (`role: 'beneficiary'`)
- Password reset flow (request email, recovery session, set new password) — implemented in code, **runtime-unverified on a device** (see `PROJECT_CONTEXT.md`)

### Donor Management
- Donor dashboard
- Personal and blood group information
- Profile photo upload and replacement
- Private profile photo storage
- Donor verification status display
- Availability status management
- Mandatory explanation when becoming unavailable
- Availability change history

### Backend and Security
- PostgreSQL database tables
- Automatic profile creation using database triggers
- Row Level Security
- Authenticated access to personal profiles
- Secure database functions for availability management
- Storage access policies

### Beneficiary, Admin and Super Admin
- Beneficiary dashboard, create blood request, my blood requests, find donors
- Admin dashboard and donor verification (approve / reject with reason)
- Super Admin dashboard, admin listing, appointment/revocation and Admin account creation
- Donor donation history (count, date and location per completed donation)
- Four-month donor eligibility and donation lifecycle tracking (accept, reached location,
  donation started/ended, reached home safely, 48-hour follow-up)

> **Status:** these screens are implemented and the related migrations are applied in
> **BMS-Development** only. Per the Phase 3 record in `PROJECT_CONTEXT.md`, some runtime states
> remain **NOT TESTED** (zero history, >20 records pagination, ambiguous location, error/Retry,
> non-donor rejection). **Admin login with newly created Admin credentials is still untested.**

## Features Under Development

- Realtime live donation status for beneficiaries (P4.3/P4.4)
- Notifications and the two-day follow-up reminder dispatch (P4.5)

## Project Structure

```text
blood-management-app/
├── assets/
├── docs/          # approved design and deployment records (see PROJECT_CONTEXT.md)
├── src/
│   ├── app/       # Expo Router routes
│   │   ├── _layout.tsx            # root Stack
│   │   ├── index.tsx, login.tsx, register.tsx
│   │   ├── donor-register.tsx, beneficiary-register.tsx
│   │   ├── forgot-password.tsx, reset-password.tsx
│   │   ├── upload-profile-photo.tsx
│   │   ├── (donor)/               # donor tabs: dashboard, requests, history, active donation
│   │   ├── (beneficiary)/         # beneficiary tabs
│   │   ├── (admin)/               # admin tabs
│   │   └── (super-admin)/         # super admin tabs
│   ├── components/ui/             # shared design-system primitives
│   ├── constants/                 # design tokens
│   ├── data/
│   └── lib/                       # Supabase client and service wrappers
├── supabase/
│   ├── functions/                 # Edge Functions (admin-create)
│   ├── migrations/                # applied SQL migrations
│   └── tests/database/            # pgTAP drafts (never executed)
├── .gitignore
├── app.json
├── package.json
└── README.md
```

## Getting Started

### Requirements

- Node.js
- npm
- Expo Go
- Supabase project

### Installation

1. Clone the repository:

```bash
git clone https://github.com/YOUR_USERNAME/blood-management-system.git
```

2. Navigate to the project:

```bash
cd blood-management-system
```

3. Install dependencies:

```bash
npm install
```

4. Create a `.env` file in the project root:

```env
EXPO_PUBLIC_SUPABASE_URL=YOUR_SUPABASE_PROJECT_URL
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_SUPABASE_PUBLISHABLE_KEY
```

5. Start the application:

```bash
npx expo start
```

Scan the QR code using Expo Go.

**Note:** A properly configured Supabase backend, database schema, and access policies are required for backend functionality.

## Development Roadmap

- [x] Project initialization
- [x] Donor registration integration
- [x] Email verification and login
- [x] Donor dashboard
- [x] Profile photo storage
- [x] Donor availability management
- [x] Availability history
- [x] Beneficiary registration, dashboard and blood request management
- [x] Administrator donor verification
- [x] Super Admin admin management and Admin account creation
- [x] Donor donation lifecycle tracking
- [x] Donor donation history (count, date and location)
- [ ] Realtime live donation status
- [ ] Notification system
- [ ] APK build and release
- [ ] Final acceptance testing

> **Roadmap note (2026-11-26).** Items marked complete are implemented in the repository, and
> their migrations are applied in **BMS-Development** only. Phase 4 — Beneficiary workflow
> completion is **NOT STARTED** per `PROJECT_CONTEXT.md` Section 12. Admin login with newly
> created Admin credentials remains untested.

## AI Assistance Disclosure

AI-assisted tools have been used during development for code generation, debugging assistance, technical explanations, and implementation guidance.

The project involves hands-on configuration, integration, testing, and iterative development.

## Academic Purpose

This application is being developed for educational and academic project work.

It is not currently intended for production medical use.

## License

No open-source license has been assigned yet.
