# Backup frontend: Phase 1A

Work only on `sixtus/frontend-backup` in the separate backup worktree.
The backend contract is commit `65dd58318b8bbbea9d80dd0cb7ed983ba21a52b9`.

## Local configuration

Create an ignored `.env.local` in this worktree with `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY`. Use the public anon/publishable key only. Do not copy
worker secrets, service credentials, or another developer's environment files.
Missing/invalid configuration renders a blocking configuration screen, with
specific setup instructions in development. No credentials are included here.

Run `npm run dev -- --strictPort`. The existing port is 5174; avoid starting a
second server on a port already occupied by the original checkout. No Supabase
Auth redirect changes are required for the email/password flow in this phase.
The backup frontend uses its own Auth storage key.

## Architecture

Supabase handles password authentication, persistent sessions and token refresh.
The Auth provider subscribes synchronously to Auth events, restores the session,
and loads the profile in a separate effect. Requests time out and are cancelled
on session changes. A stale profile is never used for another session.
Sign out uses local scope, leaving sessions on other devices intact.

Profiles use only id, display_name, role, is_active, created_at and updated_at.
Database profiles, not Auth user metadata, determine the portal. New backend
profiles are inactive/unassigned until an administrator activates them.

Loading, offloading, operations and administrator roles have separate placeholder
routes. Finance and audit go to an explicit unsupported-portal page. Missing,
inactive and failed profile requests deny portal access. No signup, password
reset, social login or operational workflows are provided.

React Router guards are UX controls. Database RLS/RPC permissions remain the
authority. Role changes are rechecked when a new session event loads a profile
or the user retries account verification; this phase does not subscribe to
profile updates in realtime.

Hosting must serve index.html for frontend paths such as /loading and /login.

## Verification

- `npm run typecheck`
- `npm run build`

The build does not prove hosted Auth or RLS integration. Live verification needs
an explicitly configured test project and existing accounts for all six roles,
plus inactive and missing-profile scenarios.

API references:
- https://supabase.com/docs/reference/javascript/auth-onauthstatechange
- https://supabase.com/docs/reference/javascript/auth-signinwithpassword
- https://reactrouter.com/6.30.4/start/overview