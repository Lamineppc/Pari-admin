# Pari Admin

Next.js 16 super-admin panel for the [Pari](../pari) tontine platform. Built with
TypeScript, Tailwind, shadcn/ui, and the Firebase Web SDK.

## Setup

```bash
npm install
cp .env.example .env.local
# Fill in NEXT_PUBLIC_FIREBASE_API_KEY and NEXT_PUBLIC_FIREBASE_APP_ID
# from the Firebase console → Project settings → Web app.
npm run dev
```

The app runs on http://localhost:3000. Sign in with the super-admin Firebase Auth
account — the uid is checked against `NEXT_PUBLIC_SUPER_ADMIN_UID`, which must match
`isSuperAdmin()` in the mobile repo's `firestore.rules`.

## Structure

```
src/
  app/
    (app)/                Authed shell (sidebar layout, guard)
      dashboard/          Landing page
      groups/             All groups (placeholder)
      users/              All users (placeholder)
      store-applications/ Marketplace approval queue (placeholder)
    login/                Sign-in page
    access-denied/        Shown when a non-super-admin signs in
    page.tsx              Root redirect
  components/
    app-sidebar.tsx       Sidebar with nav
    user-menu.tsx         Top-bar user dropdown
    auth-guard.tsx        Client-side guard for the (app) group
    ui/                   shadcn/ui components
  lib/
    firebase.ts           Firebase client init
    auth-context.tsx      Auth provider + useAuth hook
```

## Deploy (Vercel)

1. Push to GitHub.
2. Import the repo in Vercel (auto-detects Next.js).
3. Add the four `NEXT_PUBLIC_*` env vars from `.env.example` in Vercel's project settings.
4. Deploy.

The mobile Firestore rules are the source of truth for what the super admin can do —
this panel only issues client writes as the signed-in super admin.

## Roadmap

- [ ] Wire `/groups` to Firestore, mirror mobile All Groups + escalation actions.
- [ ] Wire `/users` (list + ban).
- [ ] Wire `/store-applications` (approve / reject).
- [ ] Cycle-correction section (parity with mobile).
