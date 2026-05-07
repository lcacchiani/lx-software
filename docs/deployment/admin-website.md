# Deploying the admin website and infrastructure

This runbook follows the same ordering as production bring-up: bootstrap CDK,
issue the ACM certificate, deploy infrastructure, configure GitHub and Cognito,
then deploy the SPA.

## Pre-deploy checklist (junior dev)

Before triggering **Deploy Admin Infra**:

1. **GitHub environment** — set `AWS_ACCOUNT_ID`, `AWS_REGION`, `ADMIN_ACM_CERT_ARN`,
   `ADMIN_GOOGLE_CLIENT_ID`, **`ADMIN_GOOGLE_CLIENT_SECRET_ARN`** (Secrets Manager
   ARN holding the Google client secret as a plain string),
   **`ADMIN_FEDERATED_EMAIL_ALLOWLIST`** (comma-separated lower-case emails that
   should receive `admin` via Pre Token Generation — include every Google admin
   and the bootstrap email), `ADMIN_BOOTSTRAP_EMAIL`, secrets
   `ADMIN_BOOTSTRAP_TEMP_PASSWORD`, and (after first deploy) SPA vars
   `ADMIN_COGNITO_*`, `ADMIN_API_BASE_URL`.
2. **Bootstrap password** — must satisfy the pool policy (14+ chars with mixed
   classes) or `adminCreateUser` fails.
3. **Region** — `AWS_REGION` for GitHub Actions must match the region where the
   stacks deploy (same as the public site). Cross-stack token wiring for CSP
   assumes this.
4. **ACM** — `ADMIN_ACM_CERT_ARN` must be **ISSUED** in **us-east-1** (CloudFront).
5. **Cloudflare** — proxy **OFF** (gray cloud) for ACM validation and for the
   `admin` CNAME.
6. **Google OAuth client** — add `https://<cognito-domain>/oauth2/idpresponse` to
   authorized redirect URIs **before** the first Hosted UI sign-in.

After the first deploy, **verify** that `AdminFederatedEmailAllowlist` includes
every Google operator; otherwise they authenticate but the API returns **403**.

## 1. CDK bootstrap

Bootstrap the target region used by the stacks (match the public site region),
and **us-east-1** for ACM certificates used by CloudFront:

```bash
cd backend/infrastructure
npm ci
npx cdk bootstrap aws://ACCOUNT_ID/REGION
npx cdk bootstrap aws://ACCOUNT_ID/us-east-1
```

## 2. ACM certificate (us-east-1 only)

Request a certificate for `admin.lx-software.com`, complete DNS validation in
Cloudflare with **proxy disabled**, wait until the certificate status is
**ISSUED**, and record the ARN for GitHub Actions variables.

## 3. GitHub environment configuration

Under **Settings → Environments → production**, configure variables and secrets
as described in the checklist above and in `docs/architecture/security.md`.

## 4. Deploy admin infrastructure

Run the **Deploy Admin Infra** workflow (or invoke CDK locally with the same
parameters). Confirm all five stacks finish successfully:

- `lx-admin-auth`
- `lx-admin-data`
- `lx-admin-assets`
- `lx-admin-api`
- `lx-admin-web`

Copy CloudFormation outputs for the user pool, client, hosted UI domain, API
URL, and CloudFront domain name into the GitHub environment variables used by
the **Deploy Admin Web** workflow.

## 5. DNS

Create a **CNAME** from `admin.lx-software.com` to the CloudFront distribution
domain name. Keep Cloudflare proxy **off** for this record.

## 6. Google OAuth client (IdP)

Add `https://<cognito-domain>/oauth2/idpresponse` to the Google Cloud OAuth
client’s authorized redirect URIs. **Do not** manually change Cognito app
client callback URLs in the console — they are owned by CDK from the
`AdminWebDomainName` parameter; console drift will be overwritten on the next
deploy.

## 7. Deploy the admin SPA

Run **Deploy Admin Web**. The workflow builds `apps/admin_www` with production
`VITE_*` values. The deploy script uploads hashed `dist/assets/**` with a long
immutable cache, then uploads `index.html` with `no-cache`, then invalidates
CloudFront.

## 8. Smoke tests

1. Open `https://admin.lx-software.com` and confirm the login screen appears.
2. Use **Sign in with Google** (allow-listed email) or **Sign in with email**
   for the bootstrap user; complete Hosted UI / MFA as applicable.
3. From DevTools, confirm session tokens exist in `sessionStorage`.
4. Call `GET /health` on the API without auth (expect **200**).
5. Call `GET /me` with `Authorization: Bearer <id_token>` (expect **200**).
6. Exercise presigned **POST** upload and confirm flows; verify a DynamoDB row
   under `ASSET#...` / `META`.
7. Sign out, reload, and confirm you return to the login screen.

## Scripts

Local or CI deploy of static files after a build:

```bash
bash scripts/deploy/deploy-admin-www.sh
```

The script reads `AdminWebBucketName` and `AdminWebDistributionId` from the
`lx-admin-web` stack outputs.
