# LX Software websites

This repository hosts the LX Software **public** marketing site and a
separate **admin** console. Both are Vite + React Router SPAs with Bootstrap 5.
Static assets deploy to private S3 buckets and are served through CloudFront.

## Quick start (public site)

```bash
cd apps/public_www
npm install
npm run dev
```

## Quick start (admin console)

```bash
cd apps/admin_www
npm install
npm run dev
```

Copy `apps/admin_www/.env.example` to `.env` and fill in Cognito and API values.

Infra deploy expects GitHub variables **`ADMIN_GOOGLE_CLIENT_SECRET_ARN`** (Secrets Manager) and **`ADMIN_FEDERATED_EMAIL_ALLOWLIST`** (comma-separated admin emails); see `docs/deployment/admin-website.md`.

## Documentation

- Architecture: `docs/architecture/overview.md`, `docs/architecture/admin-overview.md`
- Deployment setup: `docs/architecture/setup.md`
- Deploying the public site: `docs/deployment/public-website.md`
- Deploying the admin site: `docs/deployment/admin-website.md`
