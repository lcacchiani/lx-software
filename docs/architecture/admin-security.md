# Admin console security

## Authentication

- **Cognito hosted UI** with **Google** federation and native Cognito sign-in
  enabled for the bootstrap administrator.
- **MFA is required** on the user pool with **TOTP only** (no SMS), reducing cost
  and avoiding SNS configuration.
- **Self sign-up is disabled**; additional operators are created by invitation.
- **Advanced Security Mode** is set to **AUDIT** (no extra charge on the free
  tier); you can move to enforced threat protection later if needed.
- **Password policy** enforces 14+ characters with mixed character classes for
  any native passwords (for example the bootstrap user).

OAuth **authorization code** flow with **PKCE** is used from the SPA. Tokens are
stored in **sessionStorage** so they are cleared when the browser tab closes.

## API authorization

API Gateway HTTP API uses an **`HttpJwtAuthorizer`** (`cognito-jwt`) with:

- **Issuer** `https://cognito-idp.<region>.amazonaws.com/<userPoolId>`
- **Audience** the app client ID

**Do not rely on the JWT authorizer alone for admin authorization.** Each Lambda
handler reads `event.requestContext.authorizer.jwt.claims["cognito:groups"]` and
returns **403** when the `admin` group is missing. This mirrors the defense-in-depth
pattern of a dedicated Lambda authorizer while keeping API Gateway’s built-in
JWT validation.

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

## Operational notes

- **Bootstrap password** is supplied as a CDK parameter with `noEcho: true`.
  Rotate it immediately after first successful sign-in, and prefer removing the
  native bootstrap user once Google-based admins are onboarded.
- **Cloudflare** must use **DNS-only (gray cloud)** for the ACM validation record
  and for the `admin` CNAME to CloudFront so TLS and renewals behave correctly.
