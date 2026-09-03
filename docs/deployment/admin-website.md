# Deploying the admin website and infrastructure

This runbook follows the same ordering as production bring-up: CDK Bootstrap,
issue the ACM certificate, deploy infrastructure, configure GitHub and Cognito,
then deploy the SPA.

## Pre-deploy checklist (junior dev)

Before triggering **Deploy Backend**:

1. **GitHub environment** — set `AWS_ACCOUNT_ID`, `AWS_REGION`, optional
   **`CDK_BOOTSTRAP_QUALIFIER`** (only if you did not use the default `hnb659fds`),
   `ADMIN_ACM_CERT_ARN`,
   `ADMIN_GOOGLE_CLIENT_ID`, **`ADMIN_FEDERATED_EMAIL_ALLOWLIST`** (comma-separated
   lower-case emails that should receive `admin` via Pre Token Generation — include
   every Google admin and the bootstrap email), `ADMIN_BOOTSTRAP_EMAIL`, and
   (after first deploy) SPA vars `ADMIN_COGNITO_*`, `ADMIN_API_BASE_URL`. Set
   **secrets** `ADMIN_GOOGLE_CLIENT_SECRET` (Google OAuth client secret) and
   `ADMIN_BOOTSTRAP_TEMP_PASSWORD` (bootstrap user password; CDK `noEcho`).
2. **Bootstrap password** — must satisfy the pool policy (14+ chars with mixed
   classes) or `adminCreateUser` fails.
3. **Region** — `AWS_REGION` for GitHub Actions must match the region where the
   stacks deploy (same as the public site). **CDK Bootstrap** must be complete in
   that same region (SSM `/cdk-bootstrap/<qualifier>/version` must exist), or
   **Deploy Backend** will fail. Cross-stack CSP wiring assumes this region.
4. **GitHubActionsRole** — must be allowed to `sts:AssumeRole` the CDK asset
   publishing / deploy roles (`cdk-hnb659fds-*` or your `CDK_BOOTSTRAP_QUALIFIER`)
   and `ssm:GetParameter` on `/cdk-bootstrap/*`. If logs show “could not be used
   to assume … file-publishing-role” and deploy fails on missing CDK Bootstrap SSM,
   fix CDK Bootstrap + IAM trust first.
5. **ACM** — `ADMIN_ACM_CERT_ARN` must be **ISSUED** in **us-east-1** (CloudFront).
6. **Cloudflare** — proxy **OFF** (gray cloud) for ACM validation and for the
   `admin` CNAME.
7. **Google OAuth client** — add `https://<cognito-domain>/oauth2/idpresponse` to
   authorized redirect URIs **before** the first Hosted UI sign-in.

After the first deploy, **verify** that `AdminFederatedEmailAllowlist` includes
every Google operator; otherwise they authenticate but the API returns **403**.

## 1. CDK Bootstrap

Run **CDK Bootstrap** for the target region used by the stacks (match the public site region),
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

Run the **Deploy Backend** workflow (or invoke CDK locally with the same
parameters). Confirm both admin stacks finish successfully:

- `lxsoftware`           — Cognito, DynamoDB, S3 assets, HTTP API
- `lxsoftware-admin-web` — S3 origin + CloudFront for the SPA

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

Run **Deploy Admin Web**. The workflow builds `apps/admin_web` with production
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

## Operating

For investigating production issues from CloudWatch, S3 access logs, and the
admin DynamoDB tables using the `cursor-cloud-agent` IAM identity, see
[`docs/deployment/cloud-agent-iam.md`](./cloud-agent-iam.md). That document
lists the exact inline IAM policy needed and the AWS CLI / Console commands
to attach it.

## Public read-only API keys

The HTTP API exposes read-only mirrors of the admin GET endpoints under
`/public/*`, authenticated with a static API key in the `x-api-key` header
instead of a Cognito JWT:

| Route | Mirrors |
|-------|---------|
| `GET /public/finance` | `GET /finance` |
| `GET /public/finance/quotes` | `GET /finance/quotes` |
| `GET /public/records` | `GET /records` |
| `GET /public/fx/v2/rates` | `GET /fx/v2/rates` |

Assets and parse-job endpoints are **not** mirrored (they presign S3 access to
bank statements / are owner-scoped). Every write route stays on the Cognito
JWT authorizer, and the Lambda handler enforces the same GET allowlist as
defense in depth (`PUBLIC_READ_PATHS` in `backend/lambda/admin/dispatch.py`).

Keys are validated by the `PublicApiKeyAuthorizerFn` Lambda authorizer, which
looks up the scrypt digest of the presented key in the records table
(`pk = APIKEY#<digest>`, `sk = META`; see
`backend/lambda/public_api_authorizer/api_key_hash.py` for the digest
rationale). Only the digest is ever stored or logged. API Gateway caches
authorizer verdicts for up to **5 minutes**, so revocation takes up to that
long to propagate.

Manage keys with admin AWS credentials (needs table read/write + CMK access):

```bash
# Mint (prints the key exactly once; keys look like lxpk_…)
python3 scripts/manage-public-api-keys.py create --label "reporting" \
  --expires-at 2027-01-01

# List / revoke
python3 scripts/manage-public-api-keys.py list
python3 scripts/manage-public-api-keys.py revoke --key-id <keyId>
```

### Via GitHub Actions (no local AWS setup)

The **Manage Public API Keys** workflow (`.github/workflows/manage-api-keys.yml`,
Actions tab > Run workflow) runs the same script through the `GitHubActionsRole`
OIDC role and the `production` environment.

One-time setup: add a `PUBLIC_API_KEY_GPG_PASSPHRASE` secret under
**Settings > Environments > production > Secrets** (any strong passphrase you
keep locally). Because this repository is public and workflow logs are
world-readable, a minted key is never printed — the job emits a
gpg-encrypted block in the run summary instead. Retrieve it with:

```bash
# paste the armored block from the job summary into key.asc, then:
gpg --decrypt key.asc   # enter the PUBLIC_API_KEY_GPG_PASSPHRASE value
```

`list` and `revoke` need no passphrase and print straight to the job summary.
If the run fails with `AccessDenied` on `dynamodb:PutItem` or `kms:Decrypt`,
grant `GitHubActionsRole` those actions on the records table and the shared
CMK.

Call the API:

```bash
curl -H "x-api-key: lxpk_..." "$ADMIN_API_BASE_URL/public/finance"
```

A `.gitleaks.toml` rule flags any `lxpk_…` value committed to the repo.

## Enable Banking account sync

The admin SPA's **Banking** page links open-banking (PSD2) bank accounts via
[Enable Banking](https://enablebanking.com) and refreshes `recordedValue` on
the finance **Accounts** sheet from live balances — manually ("Sync now") and
on a daily EventBridge schedule (05:30 HKT). Only balances are read; no
payment scopes are requested.

Authentication to the Enable Banking API uses an RS256 JWT signed by the
stack's asymmetric KMS key (`lxsoftware-admin/enable-banking`) — no private
key material is ever stored or exported.

One-time setup:

1. Deploy the stack (the KMS key is created even while the feature is off).
2. Export the public key with admin AWS credentials:

   ```bash
   python3 scripts/export-enable-banking-public-key.py
   ```

3. Create an account at [enablebanking.com](https://enablebanking.com/sign-in/)
   and register a **production** application, pasting the PEM public key as the
   certificate. Add the redirect URLs
   `https://<AdminWebDomainName>/banking/callback` and (for local dev)
   `http://localhost:5173/banking/callback`.
4. Activate the inactive production application by linking your own accounts
   ("Activate by linking accounts" in the Control Panel). Restricted
   applications can only read accounts you link — which is exactly this use
   case (no Enable Banking contract needed for individual non-commercial use).
5. Set the returned application id as the `EnableBankingAppId` parameter
   (`lxsoftware:EnableBankingAppId` in `backend/infrastructure/params/*.json`)
   and redeploy. Leaving it blank keeps the feature disabled.

Then, in the admin SPA: **Banking → Connect a bank** (redirects through the
bank's own consent screen and back to `/banking/callback`), map each linked
bank account to an Accounts-sheet record, and run **Sync now**. Consents
expire per PSD2 (90 days for most UK banks; the stack caps requests at 180
days) — reconnect from the same page when a session expires.

## Executive Board (AI board for Siu Tin Dei)

The **Siu Tin Dei → Executive Board** tab hosts a fixed board of eight AI
personas (CEO, CFO, COO, CPO, CTO, CIO, CISO, CMO) that chat with the owner,
run stand-ups and deep dives through OpenRouter, and keep a list of next
actions. Design notes live in
[`docs/architecture/executive-board-plan.md`](../architecture/executive-board-plan.md).

Everything runs on the existing `lxsoftware` stack (`AdminApiFn` + the records
table); there is no new Lambda, table, or bucket. Board rows use the
`BOARD#` prefix and are excluded from the generic `/records` scan.

Stack parameters (all optional, set in `backend/infrastructure/params/*.json`):

| Parameter | Purpose |
|-----------|---------|
| `lxsoftware:OpenRouterApiKeySecretArn` | Already required for statement parsing; the board reuses the same key. |
| `lxsoftware:GitHubReadTokenSecretArn` | Secrets Manager secret holding a **fine-grained, read-only** GitHub token scoped to the private `siutindei` repository. Blank disables the repository snapshot in the board's context pack. |
| `lxsoftware:BoardGitHubRepo` | `owner/name` of the repository to read (default `lx-software-ltd/siutindei`). |
| `lxsoftware:BoardChatModel` / `BoardMeetingModel` / `BoardDeepDiveModel` | Default OpenRouter model slugs (`openai/gpt-4.1-mini`, `openai/gpt-4.1-mini`, `anthropic/claude-sonnet-4`). The owner can override them per board in **Settings**. |

GitHub token setup (only if you want repository context):

1. On GitHub create a fine-grained personal access token with **Contents:
   read**, **Issues: read**, **Actions: read** and **Metadata: read** on the
   `siutindei` repository only. Set an expiry and rotate it like any other
   secret.
2. Store it as a plain-string secret:

   ```bash
   aws secretsmanager create-secret \
     --name lxsoftware-admin-github-read-token \
     --secret-string 'github_pat_…'
   ```

3. Put the returned ARN in `lxsoftware:GitHubReadTokenSecretArn` and
   redeploy. The stack adds a conditional `secretsmanager:GetSecretValue`
   grant to `AdminApiFn`.

Scheduled stand-ups: two EventBridge rules fire `AdminApiFn` with
`{ internal: "board_meeting", trigger: "schedule", slot: "morning" | "evening" }`
at 06:00 HKT and 18:00 HKT. Both are off until the owner turns them on in
**Executive Board → Settings**; the handler also refuses to start a meeting
when the daily budget is exhausted or another meeting is still running.

Cost controls: every OpenRouter call records usage under the board's daily
usage row, and chats/meetings stop when the configured daily budget
(default USD 5) is reached. OpenRouter requests are sent with data
collection denied. The context pack shares only aggregated finance totals
(never individual transactions) and no owner PII.

Smoke test after deploy: open the tab, save a company vision/mission, edit one
member's mandate, send a chat message to the CEO (reply arrives within ~30 s),
then **Run stand-up** and confirm minutes and action items appear.

## Scripts

Local or CI deploy of static files after a build:

```bash
bash scripts/deploy/deploy-admin-www.sh
```

The script reads `AdminWebBucketName` and `AdminWebDistributionId` from the
`lxsoftware-admin-web` stack outputs (override with `ADMIN_WEB_STACK_NAME`).
