# Admin console architecture

The admin experience is a private Vite + React SPA (`apps/admin_web`) backed by
dedicated AWS CDK stacks. Traffic flows from operators through Cloudflare DNS
(gray cloud) to CloudFront, which serves static files from private S3. API
calls go to API Gateway HTTP API with a Cognito JWT authorizer; Lambda
functions enforce the `admin` Cognito group and integrate with DynamoDB and S3.

```mermaid
flowchart LR
  SPA[Admin SPA]
  CF[CloudFront]
  WB[S3 web bucket]
  APIGW[HTTP API]
  L[Python Lambda]
  DDB[(DynamoDB)]
  AS[S3 assets]
  COG[Cognito]
  GOO[Google IdP]
  SPA --> CF
  CF --> WB
  SPA --> APIGW
  APIGW --> L
  L --> DDB
  L --> AS
  SPA --> COG
  COG --> GOO
```

## CDK deploy order

`lx-admin-web` reads **CSP** values from Cognito and the HTTP API outputs, so it
must deploy **after** `lx-admin-auth` and `lx-admin-api`. A safe order is:

```mermaid
flowchart TD
  A[lx-admin-auth]
  B[lx-admin-data]
  C[lx-admin-assets]
  D[lx-admin-api]
  W[lx-admin-web]
  A --> D
  B --> D
  C --> D
  A --> W
  D --> W
```

`lx-admin-data` and `lx-admin-assets` have no dependency on auth and can deploy
in parallel with it; `lx-admin-api` depends on auth (JWT issuer), data, and
assets buckets/tables.

## Stacks

| Stack             | Purpose                                      |
|-------------------|----------------------------------------------|
| `lx-admin-auth`   | Cognito user pool, Google federation, MFA, Pre Token Generation |
| `lx-admin-data`   | `lx-admin-records` and `lx-admin-audit-log` |
| `lx-admin-assets` | Private uploads bucket with CORS for SPA   |
| `lx-admin-api`    | HTTP API, JWT authorizer, Python Lambdas     |
| `lx-admin-web`    | S3 + CloudFront for the SPA                  |

The public marketing site (`lxsoftware-public-www`) is unchanged and deploys
independently.
