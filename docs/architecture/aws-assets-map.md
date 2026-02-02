# AWS Assets Map - Backend Deploy

This document maps all AWS resources created by the `backend-deploy` workflow (`.github/workflows/deploy-backend.yml`).

**Stack Name:** `lxsoftware-siutindei`  
**CDK App:** `backend/infrastructure/bin/app.ts`  
**Stack Definition:** `backend/infrastructure/lib/api-stack.ts`

---

## CDK Bootstrap Stack (CDKToolkit)

Created once per account/region when `cdk bootstrap` runs. Not part of the main stack but required for deployment.

| Resource Type | Logical ID | Physical Name/ID | Notes |
|--------------|------------|------------------|-------|
| S3 Bucket | `StagingBucket` | `cdk-*-assets-{account}-{region}` | Stores CDK assets (Lambda bundles, etc.) |
| ECR Repository | `StagingRepository` | `cdk-*-container-assets-{account}-{region}` | For container-based assets (unused in this stack) |
| KMS Key | `StagingKey` | Auto-generated | Encrypts assets in S3/ECR |
| IAM Role | `DeployActionRole` | Auto-generated | Role for CDK deployments |
| IAM Role | `FilePublishingRole` | Auto-generated | Role for publishing to S3 |
| IAM Role | `ImagePublishingRole` | Auto-generated | Role for publishing to ECR |
| IAM Role | `LookupRole` | Auto-generated | Role for cross-account lookups |
| SSM Parameter | `/cdk-bootstrap/{qualifier}/version` | `/cdk-bootstrap/*/version` | Tracks bootstrap version |

---

## Network Infrastructure

### VPC and Subnets

**Created only if `EXISTING_VPC_ID` is not provided.**

| Resource Type | Logical ID | Physical Name/ID | Notes |
|--------------|------------|------------------|-------|
| VPC | `SiutindeiVpc` | `lxsoftware-siutindei-vpc` | 2 AZs, CIDR auto-assigned |
| Internet Gateway | `SiutindeiVpcIGW*` | Auto-generated | Attached to VPC |
| Public Subnet | `SiutindeiVpcPublicSubnet*` | Auto-generated | 2 subnets (1 per AZ) |
| Private Subnet | `SiutindeiVpcPrivateSubnet*` | Auto-generated | 2 subnets (1 per AZ) |
| NAT Gateway | `SiutindeiVpcNATGateway*` | Auto-generated | 1 NAT gateway (shared across AZs) |
| Elastic IP | `SiutindeiVpcNATGatewayEIP*` | Auto-generated | For NAT gateway |
| Route Table | `SiutindeiVpcPublicSubnet*RouteTable*` | Auto-generated | Public route table |
| Route Table | `SiutindeiVpcPrivateSubnet*RouteTable*` | Auto-generated | Private route table |
| Route | `SiutindeiVpcPublicSubnet*DefaultRoute*` | Auto-generated | 0.0.0.0/0 → IGW |
| Route | `SiutindeiVpcPrivateSubnet*DefaultRoute*` | Auto-generated | 0.0.0.0/0 → NAT |
| VPC Gateway Attachment | `SiutindeiVpcVPCGW*` | Auto-generated | IGW attachment |

---

## Security Groups

**Created only if corresponding `EXISTING_*_SECURITY_GROUP_ID` is not provided.**

| Resource Type | Logical ID | Physical Name/ID | Notes |
|--------------|------------|------------------|-------|
| Security Group | `LambdaSecurityGroup` | `lxsoftware-siutindei-lambda-sg` | For Lambda functions (RETAIN policy) |
| Security Group | `MigrationSecurityGroup` | `lxsoftware-siutindei-migration-sg` | For migration Lambda (RETAIN policy) |
| Security Group | `DatabaseSecurityGroup` | `lxsoftware-siutindei-db-sg` | For Aurora cluster |
| Security Group | `ProxySecurityGroup` | `lxsoftware-siutindei-proxy-sg` | For RDS Proxy |

**Security Group Rules (managed automatically unless existing SGs are used):**

| Source SG | Target SG | Port | Description |
|-----------|-----------|------|-------------|
| `ProxySecurityGroup` | `DatabaseSecurityGroup` | 5432 | RDS Proxy → Aurora |
| `LambdaSecurityGroup` | `ProxySecurityGroup` | 5432 | Lambda → RDS Proxy |
| `MigrationSecurityGroup` | `DatabaseSecurityGroup` | 5432 | Migration Lambda → Aurora (direct) |

---

## Database Infrastructure

### Secrets Manager

**Created only if `EXISTING_DB_CREDENTIALS_SECRET_NAME` and `EXISTING_DB_CREDENTIALS_SECRET_ARN` are not provided.**

| Resource Type | Logical ID | Physical Name/ID | Notes |
|--------------|------------|------------------|-------|
| Secret | `DBCredentialsSecret` | `lxsoftware-siutindei-database-credentials` | Auto-generates password for `postgres` user |

### KMS

**Created only if a new secret is created (not using existing).**

| Resource Type | Logical ID | Physical Name/ID | Notes |
|--------------|------------|------------------|-------|
| KMS Key | `DatabaseSecretKey` | Auto-generated | Encrypts database secret (rotation enabled) |
| KMS Alias | `DatabaseSecretKeyAlias*` | Auto-generated | Alias for the key |

### RDS Aurora PostgreSQL Serverless v2

**Created only if `EXISTING_DB_CLUSTER_IDENTIFIER` is not provided.**

| Resource Type | Logical ID | Physical Name/ID | Notes |
|--------------|------------|------------------|-------|
| DB Subnet Group | `ClusterSubnets*` | Auto-generated | Private subnets for DB |
| DB Cluster | `Cluster*` | `lxsoftware-siutindei-db-cluster` | Aurora Serverless v2, PostgreSQL 16.4 |
| DB Instance | `Cluster*Instance*` | `lxsoftware-siutindei-db-writer` | Writer instance (serverless v2) |
| IAM Role | `DatabaseMonitoringRole` | Auto-generated | Enhanced monitoring role |
| DB Parameter Group | `ClusterParameterGroup*` | Auto-generated | PostgreSQL parameters |
| DB Cluster Parameter Group | `ClusterParameterGroup*` | Auto-generated | Cluster-level parameters |

**Cluster Configuration:**
- Engine: Aurora PostgreSQL 16.4
- Min Capacity: 0.5 ACU
- Max Capacity: 2 ACU
- Database Name: `siutindei`
- IAM Authentication: Enabled (if `applyImmutableSettings=true`)
- Storage Encryption: Enabled (if `applyImmutableSettings=true`)
- CloudWatch Logs: `postgresql` export enabled
- Monitoring: Enhanced monitoring (60s interval)

### RDS Proxy

**Created only if `EXISTING_DB_PROXY_NAME` is not provided.**

| Resource Type | Logical ID | Physical Name/ID | Notes |
|--------------|------------|------------------|-------|
| DB Proxy | `Proxy*` | `lxsoftware-siutindei-db-proxy` | IAM auth enabled, TLS required |
| DB Proxy Target Group | `ProxyTargetGroup*` | Auto-generated | Targets Aurora cluster |
| DB Proxy Target | `ProxyTarget*` | Auto-generated | Links proxy to cluster |

---

## Cognito Authentication

### User Pool

| Resource Type | Logical ID | Physical Name/ID | Notes |
|--------------|------------|------------------|-------|
| User Pool | `SiutindeiUserPool` | `lxsoftware-siutindei-user-pool` | Email sign-in, auto-verify enabled |
| User Pool Domain | `SiutindeiUserPoolDomain` | `{CognitoDomainPrefix}.auth.{region}.amazoncognito.com` | Domain prefix from parameter |
| User Pool Client | `SiutindeiUserPoolClient` | Auto-generated | OAuth client (no secret) |
| User Pool Group | `AdminGroup` | `admin` | Admin group |

### Identity Providers

| Resource Type | Logical ID | Provider Name | Notes |
|--------------|------------|---------------|-------|
| User Pool Identity Provider | `GoogleIdentityProvider` | `Google` | Google OAuth |
| User Pool Identity Provider | `AppleIdentityProvider` | `SignInWithApple` | Apple Sign In |
| User Pool Identity Provider | `MicrosoftIdentityProvider` | `Microsoft` | Microsoft OIDC |

**User Pool Client Configuration:**
- OAuth Flows: `code`
- OAuth Scopes: `openid`, `email`, `profile`
- Supported Providers: `COGNITO`, `Google`, `SignInWithApple`, `Microsoft`
- Explicit Auth Flows: `ALLOW_CUSTOM_AUTH`, `ALLOW_REFRESH_TOKEN_AUTH`

---

## Lambda Functions

Each Lambda function created by `PythonLambda` construct includes:
- Lambda function
- IAM execution role
- KMS key for environment variable encryption
- SQS dead-letter queue

### Application Functions

| Function Logical ID | Handler | Memory | Timeout | VPC | Extra Paths |
|---------------------|---------|--------|---------|-----|-------------|
| `SiutindeiSearchFunction` | `lambda/activity_search/handler.lambda_handler` | 512 MB | 30s | Yes | - |
| `SiutindeiAdminFunction` | `lambda/admin/handler.lambda_handler` | 512 MB | 30s | Yes | - |
| `SiutindeiMigrationFunction` | `lambda/migrations/handler.lambda_handler` | 512 MB | 5 min | Yes | `db` |
| `HealthCheckFunction` | `lambda/health/handler.lambda_handler` | 256 MB | 10s | Yes | - |

### Auth Functions

| Function Logical ID | Handler | Memory | Timeout | VPC | Notes |
|---------------------|---------|--------|---------|-----|-------|
| `AuthPreSignUpFunction` | `lambda/auth/pre_signup/handler.lambda_handler` | 256 MB | 10s | No | Cognito trigger |
| `AuthDefineChallengeFunction` | `lambda/auth/define_auth_challenge/handler.lambda_handler` | 256 MB | 10s | No | Cognito trigger |
| `AuthCreateChallengeFunction` | `lambda/auth/create_auth_challenge/handler.lambda_handler` | 256 MB | 10s | No | Cognito trigger, SES permissions |
| `AuthVerifyChallengeFunction` | `lambda/auth/verify_auth_challenge/handler.lambda_handler` | 256 MB | 10s | No | Cognito trigger |

### Other Functions

| Function Logical ID | Handler | Memory | Timeout | VPC | Notes |
|---------------------|---------|--------|---------|-----|-------|
| `DeviceAttestationAuthorizer` | `lambda/authorizers/device_attestation/handler.lambda_handler` | 256 MB | 5s | No | API Gateway authorizer |
| `AdminBootstrapFunction` | `lambda/admin_bootstrap/handler.lambda_handler` | 256 MB | 30s | No | Custom resource handler |

### Lambda Resources Per Function

For each function above, the following resources are created:

| Resource Type | Logical ID Pattern | Notes |
|--------------|-------------------|-------|
| Lambda Function | `{FunctionLogicalID}Function*` | Python 3.12 runtime |
| IAM Role | `{FunctionLogicalID}FunctionServiceRole*` | Execution role |
| IAM Policy | `{FunctionLogicalID}FunctionServiceRoleDefaultPolicy*` | Basic Lambda permissions |
| KMS Key | `{FunctionLogicalID}EnvironmentEncryptionKey*` | Encrypts environment variables (rotation enabled) |
| KMS Alias | `{FunctionLogicalID}EnvironmentEncryptionKeyAlias*` | Alias for the key |
| SQS Queue | `{FunctionLogicalID}DeadLetterQueue*` | DLQ for failed invocations (14-day retention) |
| SQS Queue Policy | `{FunctionLogicalID}DeadLetterQueuePolicy*` | Allows Lambda to send to DLQ |

**Lambda Configuration:**
- Runtime: Python 3.12
- Reserved Concurrency: 25 (default)
- Environment: `PYTHONPATH=/var/task/src`, `LOG_LEVEL=INFO`
- VPC Subnets: Private with egress (if VPC enabled)
- Dead Letter Queue: Enabled

**Additional IAM Permissions:**

| Function | Additional Permissions |
|----------|------------------------|
| `SiutindeiSearchFunction` | Read DB secret, connect to RDS Proxy as `siutindei_app` |
| `SiutindeiAdminFunction` | Read DB secret, connect to RDS Proxy as `siutindei_admin`, Cognito admin group management |
| `SiutindeiMigrationFunction` | Read DB secret, direct connect to Aurora as `postgres`, CloudFormation invoke permission |
| `HealthCheckFunction` | Read DB secret, connect to RDS Proxy as `siutindei_app` |
| `AuthCreateChallengeFunction` | SES `SendEmail`, `SendRawEmail` for the configured email address |
| `AdminBootstrapFunction` | Cognito `AdminCreateUser`, `AdminUpdateUserAttributes`, `AdminSetUserPassword`, `AdminAddUserToGroup`, CloudFormation invoke permission |

**Lambda Log Groups:**
- Created automatically by Lambda service on first invocation
- Naming: `/aws/lambda/{function-name}`
- Not explicitly created by CDK

---

## API Gateway

### REST API

| Resource Type | Logical ID | Physical Name/ID | Notes |
|--------------|------------|------------------|-------|
| REST API | `SiutindeiApi` | `lxsoftware-siutindei-api` | Regional REST API |
| Deployment | `SiutindeiApiDeployment*` | Auto-generated | Deployment for `prod` stage |
| Stage | `SiutindeiApiDeploymentStageprod*` | `prod` | Production stage |

**Stage Configuration:**
- Access Logging: Enabled (to `lxsoftware-siutindei-api-access-logs` - must exist)
- Access Log Format: JSON with standard fields
- Logging Level: INFO
- Data Trace: Disabled
- X-Ray Tracing: Enabled
- Caching: Enabled (0.5 GB cache cluster, encrypted)
- Cache TTL: 5 minutes for `/v1/activities/search/GET`

**CORS Configuration:**
- Allowed Origins: From `CORS_ALLOWED_ORIGINS` env var or context, defaults to `capacitor://localhost`, `ionic://localhost`, `http://localhost`
- Allowed Methods: `GET`, `OPTIONS`

### API Gateway Resources and Methods

| Resource Path | Method | Authorization | Integration | Notes |
|--------------|--------|---------------|-------------|-------|
| `/health` | GET | IAM | `HealthCheckFunction` | Health check endpoint |
| `/v1/activities/search` | GET | Custom (Device Attestation) + API Key | `SiutindeiSearchFunction` | Cached, query params in cache key |
| `/v1/admin/organizations` | GET, POST | Cognito | `SiutindeiAdminFunction` | Admin CRUD |
| `/v1/admin/organizations/{id}` | GET, PUT, DELETE | Cognito | `SiutindeiAdminFunction` | Admin CRUD |
| `/v1/admin/locations` | GET, POST | Cognito | `SiutindeiAdminFunction` | Admin CRUD |
| `/v1/admin/locations/{id}` | GET, PUT, DELETE | Cognito | `SiutindeiAdminFunction` | Admin CRUD |
| `/v1/admin/activities` | GET, POST | Cognito | `SiutindeiAdminFunction` | Admin CRUD |
| `/v1/admin/activities/{id}` | GET, PUT, DELETE | Cognito | `SiutindeiAdminFunction` | Admin CRUD |
| `/v1/admin/pricing` | GET, POST | Cognito | `SiutindeiAdminFunction` | Admin CRUD |
| `/v1/admin/pricing/{id}` | GET, PUT, DELETE | Cognito | `SiutindeiAdminFunction` | Admin CRUD |
| `/v1/admin/schedules` | GET, POST | Cognito | `SiutindeiAdminFunction` | Admin CRUD |
| `/v1/admin/schedules/{id}` | GET, PUT, DELETE | Cognito | `SiutindeiAdminFunction` | Admin CRUD |
| `/v1/admin/users/{username}/groups` | POST, DELETE | Cognito | `SiutindeiAdminFunction` | User group management |

### API Gateway Authorizers

| Resource Type | Logical ID | Type | Handler | Notes |
|--------------|------------|------|---------|-------|
| Request Authorizer | `DeviceAttestationRequestAuthorizer` | Lambda | `DeviceAttestationAuthorizer` | Validates `x-device-attestation` header, no caching |
| Cognito Authorizer | `SiutindeiAuthorizer` | Cognito User Pool | `SiutindeiUserPool` | For admin endpoints |

### API Gateway API Key and Usage Plan

| Resource Type | Logical ID | Physical Name/ID | Notes |
|--------------|------------|------------------|-------|
| API Key | `MobileSearchApiKey` | `lxsoftware-siutindei-mobile-search-key` | Value from `PublicApiKeyValue` parameter |
| Usage Plan | `MobileSearchUsagePlan` | `lxsoftware-siutindei-mobile-search-plan` | Linked to API key and `prod` stage |

### API Gateway IAM Roles

| Resource Type | Logical ID | Purpose | Notes |
|--------------|------------|---------|-------|
| IAM Role | `ApiGatewayLogRole` | CloudWatch Logs | Allows API Gateway to write access logs |

### API Gateway Account Settings

| Resource Type | Logical ID | Notes |
|--------------|------------|-------|
| Account | `ApiGatewayAccount` | Configures CloudWatch role for API Gateway |

**Note:** The access log group `lxsoftware-siutindei-api-access-logs` is **imported** (not created by CDK). It must exist before deployment.

---

## Custom Resources

### Database Migrations

| Resource Type | Logical ID | Handler | Notes |
|--------------|------------|---------|-------|
| Custom Resource | `RunMigrations` | `SiutindeiMigrationFunction` | Runs Alembic migrations on stack create/update (triggered by migration hash change) |

**Properties:**
- `MigrationsHash`: SHA256 hash of `backend/db/alembic/versions/` directory
- `SeedHash`: SHA256 hash of `backend/db/seed/seed_data.sql`
- `RunSeed`: `true`

### Admin Bootstrap

**Created only if `AdminBootstrapEmail` and `AdminBootstrapTempPassword` parameters are provided.**

| Resource Type | Logical ID | Handler | Notes |
|--------------|------------|---------|-------|
| Custom Resource | `AdminBootstrapResource` | `AdminBootstrapFunction` | Creates admin user in Cognito |

**Properties:**
- `UserPoolId`: Cognito User Pool ID
- `Email`: Admin email address
- `TempPassword`: Temporary password
- `GroupName`: `admin`

---

## CloudFormation Parameters

| Parameter Name | Type | Required | NoEcho | Description |
|----------------|------|----------|---------|-------------|
| `CognitoDomainPrefix` | String | Yes | No | Hosted UI domain prefix |
| `CognitoCallbackUrls` | CommaDelimitedList | Yes | No | OAuth callback URLs |
| `CognitoLogoutUrls` | CommaDelimitedList | Yes | No | OAuth logout URLs |
| `GoogleClientId` | String | Yes | No | Google OAuth client ID |
| `GoogleClientSecret` | String | Yes | Yes | Google OAuth client secret |
| `AppleClientId` | String | Yes | No | Apple Services ID |
| `AppleTeamId` | String | Yes | No | Apple developer team ID |
| `AppleKeyId` | String | Yes | No | Apple Sign In key ID |
| `ApplePrivateKey` | String | Yes | Yes | Apple Sign In private key |
| `MicrosoftTenantId` | String | Yes | No | Microsoft Entra tenant ID |
| `MicrosoftClientId` | String | Yes | No | Microsoft OAuth client ID |
| `MicrosoftClientSecret` | String | Yes | Yes | Microsoft OAuth client secret |
| `AuthEmailFromAddress` | String | Yes | No | SES-verified email for passwordless auth |
| `LoginLinkBaseUrl` | String | No | No | Base URL for magic links (default: empty) |
| `MaxChallengeAttempts` | Number | No | No | Max passwordless auth attempts (default: 3) |
| `PublicApiKeyValue` | String | Yes | Yes | API key for mobile search (min 20 chars) |
| `DeviceAttestationJwksUrl` | String | No | No | JWKS URL for device attestation (default: empty) |
| `DeviceAttestationIssuer` | String | No | No | Expected issuer (default: empty) |
| `DeviceAttestationAudience` | String | No | No | Expected audience (default: empty) |
| `DeviceAttestationFailClosed` | String | No | No | Fail-closed mode (default: `true`, allowed: `true`/`false`) |
| `AdminBootstrapEmail` | String | No | No | Admin email for bootstrap (default: empty) |
| `AdminBootstrapTempPassword` | String | No | Yes | Temporary password for bootstrap (default: empty) |

---

## CloudFormation Outputs

| Output Name | Value | Description |
|-------------|-------|-------------|
| `ApiUrl` | API Gateway REST API URL | Base URL for API endpoints |
| `DatabaseSecretArn` | Secrets Manager secret ARN | ARN of database credentials secret |
| `DatabaseProxyEndpoint` | RDS Proxy endpoint | Endpoint for database connections via proxy |
| `UserPoolId` | Cognito User Pool ID | User Pool identifier |
| `UserPoolClientId` | Cognito User Pool Client ID | OAuth client identifier |

---

## Resource Dependencies

### Key Dependencies

1. **VPC** → Security Groups → Database/Lambda
2. **Database Secret** → Aurora Cluster → RDS Proxy
3. **Aurora Cluster** → Migration Lambda (direct access)
4. **RDS Proxy** → Application Lambdas (via proxy)
5. **Cognito User Pool** → Identity Providers → User Pool Client
6. **Cognito User Pool** → Auth Lambda Triggers
7. **Lambda Functions** → API Gateway Integrations
8. **API Gateway** → Usage Plan → API Key
9. **Migration Lambda** → Custom Resource (RunMigrations)
10. **Admin Bootstrap Lambda** → Custom Resource (AdminBootstrapResource)

### Conditional Resources

- **VPC**: Created if `EXISTING_VPC_ID` is not set
- **Security Groups**: Created if corresponding `EXISTING_*_SECURITY_GROUP_ID` is not set
- **Database Secret**: Created if `EXISTING_DB_CREDENTIALS_SECRET_NAME` and `EXISTING_DB_CREDENTIALS_SECRET_ARN` are not set
- **Aurora Cluster**: Created if `EXISTING_DB_CLUSTER_IDENTIFIER` is not set
- **RDS Proxy**: Created if `EXISTING_DB_PROXY_NAME` is not set
- **Admin Bootstrap**: Created if `AdminBootstrapEmail` and `AdminBootstrapTempPassword` are provided

---

## Resource Naming Convention

All resources use the prefix: **`lxsoftware-siutindei-`**

Examples:
- VPC: `lxsoftware-siutindei-vpc`
- Security Group: `lxsoftware-siutindei-lambda-sg`
- Database Cluster: `lxsoftware-siutindei-db-cluster`
- User Pool: `lxsoftware-siutindei-user-pool`
- API: `lxsoftware-siutindei-api`

---

## Tagging Coverage

The stack applies two tags at the stack level:

- `Organization= LX Software`
- `Project= Siu Tin Dei`

These tags are inherited by **all taggable resources** created in this
stack, including implicit resources created by CDK (subnets, route
tables, etc.).

Tags are **not guaranteed** on the following:

- Resource types that do not support tagging.
- Imported or existing resources (for example, an existing VPC, DB
  cluster, security groups, or the API access log group).
- Resources created outside the stack lifecycle, such as Lambda log
  groups created on first invocation.
- CDK bootstrap stack resources (CDKToolkit), which are separate from
  this stack.

---

## Resource Retention Policies

The following resources have **RETAIN** deletion policy (survive stack deletion):

- `LambdaSecurityGroup`
- `MigrationSecurityGroup`

All other resources are deleted when the stack is deleted (unless they are imported/existing resources).

---

## Estimated Resource Count

**Minimum (all existing resources imported):**
- ~50-60 resources (Lambdas, IAM roles, API Gateway resources, etc.)

**Maximum (all resources created):**
- ~150-200 resources (includes VPC, subnets, NAT, Aurora, RDS Proxy, all Lambdas with DLQs/KMS, API Gateway, etc.)

---

## Notes

1. **Lambda Log Groups**: Created automatically by AWS Lambda service on first invocation, not by CDK.
2. **API Gateway Access Log Group**: Must exist before deployment (imported, not created).
3. **Existing Resources**: The workflow detects and imports existing VPC, database, and security group resources to avoid recreation.
4. **CDK Bootstrap**: Required once per account/region. The workflow runs `cdk bootstrap` if needed.
5. **Lambda Bundling**: Lambda code is bundled during `cdk synth` using Docker or local bundle from `.lambda-build/base`.
