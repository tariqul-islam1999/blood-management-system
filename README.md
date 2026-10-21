
# Blood Management System 🩸

A mobile-based Blood Management System developed as an academic software development project.

The application aims to connect verified blood donors with beneficiaries, support blood donation requests, and track donation activities.

## Project Status

🚧 Under Active Development

This project is currently being developed and tested. Some features are functional, while others are planned for upcoming releases.

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
- Beneficiary registration form (UI only)
- Password reset screen (UI only)

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

## Features Under Development

- Beneficiary authentication and dashboard
- Administrator dashboard
- Donor verification workflow
- Blood request creation and management
- Verified donor matching
- Live donation status tracking
- Automated donor availability reminders
- Notifications
- Final bottom-tab navigation
- APK release and deployment

## Project Structure

```text
blood-management-app/
├── assets/
├── src/
│   ├── app/
│   │   ├── index.tsx
│   │   ├── login.tsx
│   │   ├── register.tsx
│   │   ├── donor-register.tsx
│   │   ├── beneficiary-register.tsx
│   │   ├── donor-dashboard.tsx
│   │   ├── upload-profile-photo.tsx
│   │   └── forgot-password.tsx
│   ├── data/
│   └── lib/
│       └── supabase.ts
├── .env
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
- [ ] Beneficiary backend integration
- [ ] Administrator verification system
- [ ] Blood request management
- [ ] Donor matching
- [ ] Donation tracking
- [ ] Notification system
- [ ] Final UI improvements
- [ ] APK build and testing

## AI Assistance Disclosure

AI-assisted tools have been used during development for code generation, debugging assistance, technical explanations, and implementation guidance.

The project involves hands-on configuration, integration, testing, and iterative development.

## Academic Purpose

This application is being developed for educational and academic project work.

It is not currently intended for production medical use.

## License

No open-source license has been assigned yet.
