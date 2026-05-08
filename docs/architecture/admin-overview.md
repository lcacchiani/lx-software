# Admin console architecture

The admin experience is a private Vite + React SPA (`apps/admin_web`) backed by
two AWS CDK stacks. Traffic flows from operators through Cloudflare DNS
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

`lxsoftware-admin-web` reads **CSP** values from Cognito and the HTTP API
outputs in `lxsoftware`, so it must deploy **after** `lxsoftware`:

```mermaid
flowchart TD
  L[lxsoftware]
  W[lxsoftware-admin-web]
  L --> W
```

## Stacks

The repository ships **three** CDK stacks. The admin backend lives in a single
consolidated stack rather than the previous five-stack split.

| Stack                     | Purpose                                                                                  |
|---------------------------|------------------------------------------------------------------------------------------|
| `lxsoftware-public-www`   | Public marketing site: S3 origin + CloudFront.                                           |
| `lxsoftware`              | Admin backend: Cognito + Pre Token Generation Lambda, DynamoDB tables, private uploads bucket, HTTP API + admin Lambda. |
| `lxsoftware-admin-web`    | Admin SPA delivery: S3 + CloudFront + WAF/CSP.                                           |

All physical resource names use the `lxsoftware-admin-*` prefix
(DynamoDB tables `lxsoftware-admin-records` and
`lxsoftware-admin-audit-log`, the user pool `lxsoftware-admin-user-pool`,
S3 buckets `lxsoftware-admin-assets-*`, `lxsoftware-admin-assets-logs-*`,
`lxsoftware-admin-web-*`, `lxsoftware-admin-web-logs-*`, the HTTP API
`lxsoftware-admin-api`, and the Cognito hosted UI prefix
`lxsoftware-admin-auth`).
