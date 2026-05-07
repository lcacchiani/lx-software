# AGENTS.md

## Cursor Cloud specific instructions

### Project overview

This repository hosts the LX Software public website in `apps/public_www/`, a
separate **admin** SPA in `apps/admin_www/`, and AWS CDK infrastructure in
`backend/infrastructure/`. There is no backend API for the public site; the admin
console calls the `lx-admin-api` stack deployed from the same CDK app.

### Running the dev server

```bash
cd apps/public_www && npm run dev
```

The Vite dev server starts on `http://localhost:5173/` with HMR enabled.

### Admin website dev server

```bash
cd apps/admin_www && npm run dev
```

Use a local `.env` copied from `apps/admin_www/.env.example` so `VITE_*` values
resolve (Cognito and API URLs can point to a dev stack or be stubbed for UI-only work).

### Lint / Build / Test

| Command | Directory | Purpose |
|---------|-----------|---------|
| `npm run lint` | `apps/public_www` | ESLint (flat config, TS + React) |
| `npm run build` | `apps/public_www` | TypeScript check + Vite production build |
| `npm run lint` | `apps/admin_www` | ESLint (flat config, TS + React) |
| `npm run build` | `apps/admin_www` | TypeScript check + Vite build |
| `npm run build` | `backend/infrastructure` | Compile CDK TypeScript |

There are no automated test suites in this repo currently.

### Gotchas

- The public website fetches `/content.json` at runtime (served from `public/content.json` in dev). If you see missing content, ensure that file exists.
- The admin SPA requires `VITE_*` Cognito and API settings; see `apps/admin_www/.env.example`.
- Admin tokens are stored in **sessionStorage**; closing the browser tab ends the session and requires signing in again.
- CDK synth/deploy requires AWS credentials and is not needed for local website development.
- `apps/public_www`, `apps/admin_www`, and `backend/infrastructure` use npm (lockfiles are `package-lock.json`).
