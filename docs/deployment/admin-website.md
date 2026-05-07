# Deploying the admin website and infrastructure

This runbook follows the same ordering as production bring-up: bootstrap CDK,
issue the ACM certificate, deploy infrastructure, configure GitHub and Cognito,
then deploy the SPA.

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
as described in the repository security documentation. At minimum you need
Google OAuth values, the bootstrap admin email and temporary password, the ACM
certificate ARN, and (after the first Cognito deploy) the Cognito identifiers
and API base URL for the SPA build.

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

## 6. Cognito and Google OAuth

In the Cognito app client, ensure callback and logout URLs include
`https://admin.lx-software.com/auth/callback` and `https://admin.lx-software.com/`
(the CDK stack wires these from the `AdminWebDomainName` parameter). In Google
Cloud Console, add both your app callback and
`https://<cognito-domain>/oauth2/idpresponse` to the OAuth client’s authorized
redirect URIs.

## 7. Deploy the admin SPA

Run **Deploy Admin Web**. The workflow builds `apps/admin_www` with production
`VITE_*` values, syncs `dist/` to the admin web bucket, and invalidates
CloudFront.

## 8. Smoke tests

1. Open `https://admin.lx-software.com` and confirm the login screen appears.
2. Use **Sign in with Google**, complete Hosted UI + MFA, and land on the
   dashboard.
3. From DevTools, confirm session tokens exist in `sessionStorage`.
4. Call `GET /health` on the API without auth (expect **200**).
5. Call `GET /me` with `Authorization: Bearer <id_token>` (expect **200**).
6. Exercise presigned upload and confirm flows; verify a DynamoDB row under
   `ASSET#...` / `META`.
7. Sign out, reload, and confirm you return to the login screen.

## Scripts

Local or CI deploy of static files after a build:

```bash
bash scripts/deploy/deploy-admin-www.sh
```

The script reads `AdminWebBucketName` and `AdminWebDistributionId` from the
`lx-admin-web` stack outputs.
