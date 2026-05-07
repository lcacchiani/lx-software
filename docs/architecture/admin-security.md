# Admin console security

## Authentication

- **Cognito hosted UI** with **Google** federation and native Cognito sign-in for
  the break-glass **bootstrap** administrator (“Sign in with email (Hosted UI)”).
- **Pre Token Generation** Lambda adds the `admin` **group override** in issued
  tokens when the user’s `email` attribute matches the comma-separated
  `AdminFederatedEmailAllowlist` parameter. Federated Google users are not added
  to Cognito groups in the data plane; claims-only injection keeps the pool
  clean.
- **MFA (native)**: the user pool requires **TOTP** for native accounts (no SMS).
- **MFA (federated)**: Cognito’s `mfa: REQUIRED` applies to native sign-in only.
  Google Workspace accounts follow **Google’s** MFA / 2-Step Verification policy.
  Require **2-Step Verification org-wide** in Google Admin so federated admins
  meet your bar.
- **Self sign-up is disabled**; invite additional operators as needed.
- **Threat protection**: CDK sets `standardThreatProtectionMode` to
  `NO_ENFORCEMENT` to avoid deprecated `advancedSecurityMode` and to stay off
  Cognito **PLUS** feature-plan charges until you deliberately opt in. Re-check
  current Cognito pricing before enabling enforced modes.
- **Password policy** enforces 14+ characters with mixed character classes for
  native passwords (bootstrap user).

OAuth **authorization code** flow with **PKCE** and a random **`state`** value
is used from the SPA. The callback rejects mismatched or missing `state` to
mitigate login CSRF. Tokens live in **sessionStorage**, so closing the browser
tab clears the session and forces a full Hosted UI round-trip on the next
visit (intentional for admin consoles).

### Google single sign-out

`AuthProvider.logout()` calls Cognito **`/oauth2/revoke`** (fire-and-forget) for
the refresh token, clears local storage, then redirects to Cognito **`/logout`**
which ends the Cognito session. **Google may still have an active browser
session**, so the next “Sign in with Google” can succeed without prompting.
True Google sign-out would require additional IdP-specific steps (for example
Google’s revoke endpoint) and is not implemented here by design.

## API authorization

API Gateway HTTP API uses an **`HttpJwtAuthorizer`** (`cognito-jwt`) with:

- **Issuer** `https://cognito-idp.<region>.amazonaws.com/<userPoolId>`
- **Audience** the app client ID (matches **`aud` on ID tokens**, not access
  tokens).

**Do not rely on the JWT authorizer alone for admin authorization.** Each Lambda
handler reads `event.requestContext.authorizer.jwt.claims["cognito:groups"]` and
returns **403** when the `admin` group is missing.

An optional **Lambda authorizer** layout is documented under
`backend/lambda/authorizers/cognito_group/handler.py`; the HTTP API path does
not wire it today.

## Content Security Policy

CloudFront attaches a response headers policy including a strict **CSP** whose
`connect-src` includes the SPA origin, the Cognito hosted UI domain, and the
execute-api origin. If either URL changes, redeploy `lx-admin-web` after
updating dependent stacks so the CSP stays accurate.

## IAM

- Lambda execution roles grant **DynamoDB** access only to the admin tables and
  **S3** object access only to the assets bucket, plus standard CloudWatch Logs
  permissions.
- GitHub Actions uses **OIDC** into `GitHubActionsRole`; extend that role’s
  inline or attached policies so it can deploy the new stacks and invalidate the
  admin distribution. See `docs/architecture/security.md`.
- The Google OAuth **client secret** is supplied as a **GitHub Actions secret**
  and passed into CDK as a CloudFormation parameter with **`noEcho: true`** (same
  pattern as evolvesprouts). GitHub redacts it in logs, but like any CLI deploy it
  can appear briefly in the runner process environment; prefer rotating the
  secret in Google Cloud if it is ever exposed.

## Operational notes

- **Bootstrap password** is supplied as a CDK parameter with `noEcho: true`.
  **AwsCustomResource** only runs `adminSetUserPassword` / `adminAddUserToGroup`
  on **Create**, not on **Update**, so rotating the password in GitHub and
  redeploying does **not** reset the live Cognito password.
- **Cloudflare** must use **DNS-only (gray cloud)** for the ACM validation record
  and for the `admin` CNAME to CloudFront so TLS and renewals behave correctly.

## Uploads

- Presigned **POST** policies pin **Content-Type** (`image/*` prefix), **object
  key** (per-user prefix), and **content-length-range** (default 20 MiB). The SPA
  must submit `multipart/form-data` per S3’s POST policy (not a raw PUT).
- **`/assets/confirm`** persists **S3 `head_object`** `ContentLength` and `ETag`;
  client-supplied `sha256` / `size` are stored only as informational fields.

## CloudFront distribution logging

The `lx-admin-web` stack uses CloudFront’s **classic logging to S3** (same
pattern as the public site). Some AWS Organizations block this logging delivery
with strict bucket policies. If deploy fails with `InvalidViewerLogging`, switch
to **logging to CloudWatch Logs** or follow the org-approved pattern.

## Logging

- **API Gateway** default stage writes **access logs** to a dedicated CloudWatch
  log group (30-day retention).
- **S3 server access logging** is enabled for the SPA origin bucket and the
  assets bucket (separate prefixes / buckets) so direct S3 access (including
  presigned URLs) leaves an audit trail in addition to CloudFront logs.

## CloudFront error mapping

Only **404** responses are rewritten to `/index.html` (HTTP 200) for SPA
routing. **403** responses pass through so misconfigured bucket policies remain
visible during debugging.
