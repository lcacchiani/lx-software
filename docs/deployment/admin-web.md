# Admin web deployment

The admin web is a static SPA hosted in S3 and served by CloudFront.

## Prerequisites

- ACM certificate in `us-east-1` for `siutindei.lx-software.com`
- CloudFront alias configured with the domain above
- Cognito callback/logout URLs updated for the admin web

## CDK parameters

Provide these parameters when deploying `lxsoftware-siutindei-admin-web`:

- `AdminWebDomainName`: `siutindei.lx-software.com`
- `AdminWebCertificateArn`: ACM certificate ARN (us-east-1)

## Build and deploy

```
cd apps/admin_web
npm ci
npm run build
```

From the repo root:

```
bash scripts/deploy/deploy-admin-web.sh
```

## CORS configuration

Set `CORS_ALLOWED_ORIGINS` (or CDK context `corsAllowedOrigins`) to include:

- `https://siutindei.lx-software.com`
- `http://localhost:3000`

This is required for the admin SPA to call the admin API endpoints.
