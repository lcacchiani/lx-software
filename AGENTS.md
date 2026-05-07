# AGENTS.md

## Cursor Cloud specific instructions

### Project overview

This repo hosts a static SPA (LX Software public website) in `apps/public_www/` and AWS CDK infrastructure in `backend/infrastructure/`. There is no backend API, database, or external service dependency for local development.

### Running the dev server

```bash
cd apps/public_www && npm run dev
```

The Vite dev server starts on `http://localhost:5173/` with HMR enabled.

### Lint / Build / Test

| Command | Directory | Purpose |
|---------|-----------|---------|
| `npm run lint` | `apps/public_www` | ESLint (flat config, TS + React) |
| `npm run build` | `apps/public_www` | TypeScript check + Vite production build |
| `npm run build` | `backend/infrastructure` | Compile CDK TypeScript |

There are no automated test suites in this repo currently.

### Gotchas

- The website fetches `/content.json` at runtime (served from `public/content.json` in dev). If you see missing content, ensure that file exists.
- CDK synth/deploy requires AWS credentials and is not needed for local website development.
- Both `apps/public_www` and `backend/infrastructure` use npm (lockfiles are `package-lock.json`).
