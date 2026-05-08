# Stack consolidation runbook (six stacks → three)

## What changes

| Before                 | After                    | Notes                               |
|------------------------|--------------------------|-------------------------------------|
| `lxsoftware-public-www`| `lxsoftware-public-www`  | unchanged                           |
| `lx-admin-auth`        | merged into `lxsoftware` | Cognito, Pre Token Generation       |
| `lx-admin-data`        | merged into `lxsoftware` | DynamoDB tables                     |
| `lx-admin-assets`      | merged into `lxsoftware` | private uploads + S3 access logs    |
| `lx-admin-api`         | merged into `lxsoftware` | HTTP API + admin Lambda             |
| `lx-admin-web`         | renamed `lxsoftware-admin-web` | S3 + CloudFront for the SPA   |

After the migration:

- **`lxsoftware-public-www`** — the marketing site.
- **`lxsoftware`** — every admin-side resource that holds **state** (Cognito
  user pool, DynamoDB tables, private uploads bucket) plus the API Gateway
  HTTP API and the admin Lambda that consumes them.
- **`lxsoftware-admin-web`** — the admin SPA delivery (S3 web bucket +
  CloudFront distribution + access logs).

All physical resource names are **kept stable** (`lx-admin-records`,
`lx-admin-audit-log`, `lx-admin-user-pool`, `lx-admin-assets-…`,
`lx-admin-web-…`, `lx-admin-api`, etc.) so the existing data is preserved on
import.

> **Why two admin stacks instead of one?** The CloudFront response-headers CSP
> baked into `lxsoftware-admin-web` references the Cognito hosted UI domain
> and API endpoint exported from `lxsoftware`. Splitting the SPA delivery
> from the API/data plane keeps that CSP pinned to a stable downstream and
> avoids needless distribution churn when only Cognito or DynamoDB change.

## 0. Pre-flight checklist

Run these from the workstation that owns the **production** AWS profile.
Replace `ACCOUNT` and `REGION` with your values; `us-east-1` is required for
CloudFront-related operations even when stacks live in another region.

1. **Backup DynamoDB** (idempotent — on-demand backups stay until you delete
   them):

   ```bash
   for t in lx-admin-records lx-admin-audit-log; do
     aws dynamodb create-backup \
       --table-name "$t" \
       --backup-name "$t-pre-consolidation-$(date -u +%Y%m%dT%H%M%SZ)"
   done
   ```

2. **Snapshot Cognito users** so you can verify the count after import:

   ```bash
   aws cognito-idp list-users \
     --user-pool-id "$(aws cloudformation describe-stacks \
        --stack-name lx-admin-auth \
        --query 'Stacks[0].Outputs[?OutputKey==`UserPoolId`].OutputValue' \
        --output text)" \
     --output json > /tmp/cognito-users.json
   wc -l < /tmp/cognito-users.json
   ```

3. **Capture stack outputs** for rollback fallback:

   ```bash
   for s in lxsoftware-public-www lx-admin-auth lx-admin-data \
            lx-admin-assets lx-admin-api lx-admin-web; do
     aws cloudformation describe-stacks --stack-name "$s" \
       > "/tmp/$s.json" 2>/dev/null || echo "$s: not present"
   done
   ```

4. **Confirm RETAIN policies are live in the deployed templates** (this guards
   the destructive operations later):

   ```bash
   for s in lx-admin-auth lx-admin-data lx-admin-assets lx-admin-web; do
     aws cloudformation get-template --stack-name "$s" \
       --query 'TemplateBody' --output json \
       | jq -r '..|.DeletionPolicy? // empty' \
       | sort -u | sed "s/^/$s: /"
   done
   ```

   Every interesting resource (user pool, DDB tables, S3 buckets) must report
   `Retain`. If any reports `Delete`, **stop** and fix that first by deploying
   the updated CDK before continuing.

5. **Pick a maintenance window for `admin.lx-software.com`**. The admin SPA is
   unreachable from the moment the old `lx-admin-web` distribution is deleted
   until the new `lxsoftware-admin-web` distribution finishes deploying and DNS
   is repointed (10–25 min total because CloudFront updates are slow).

## 1. Roll the new code into the repo

This change is already on the branch `cursor/three-stack-consolidation-caaf`.
Merging it to `main` triggers `Deploy Backend`, which would attempt a fresh
create of `lxsoftware` and `lxsoftware-admin-web` while the legacy stacks still
exist. **Do not merge until step 2 has been performed.** Until merge, run the
new stacks from a workstation:

```bash
cd backend/infrastructure
npm ci
npm run build
```

Use the same `--parameters` / param-file values as the existing CI deploy.

## 2. Import existing resources into the new stacks

CloudFormation **resource import** moves each existing resource into a new
stack without deleting it. The new stack must define the resource (same type,
same properties) with `DeletionPolicy: Retain`, which CDK already does for
every stateful resource here. CDK ships `cdk import` to drive the underlying
import change set.

> **Order matters.** Import **before** deleting the legacy stacks. Once a
> resource is owned by `lxsoftware` / `lxsoftware-admin-web`, the legacy stack
> can be dropped with no resource impact.

### 2a. Drain legacy stacks of *non-stateful* children

Legacy stacks contain stateless children that the new stacks will recreate
(Lambdas, IAM roles, log groups, the API Gateway, the CloudFront
distribution). Importing every resource is unnecessary; instead let the new
stacks own freshly-created copies. Before deletion, **detach the Cognito
trigger** so the soon-to-be-deleted Pre Token Generation Lambda does not
break sign-ins:

```bash
USER_POOL_ID=$(aws cloudformation describe-stacks --stack-name lx-admin-auth \
  --query 'Stacks[0].Outputs[?OutputKey==`UserPoolId`].OutputValue' --output text)

aws cognito-idp update-user-pool \
  --user-pool-id "$USER_POOL_ID" \
  --lambda-config '{}'
```

This is reversed automatically when `lxsoftware` is deployed and CDK
re-attaches its own Pre Token Generation Lambda.

### 2b. Synthesize the new templates

```bash
cd backend/infrastructure
# Use the same parameters CI uses; export them as shell vars first.
npx cdk synth lxsoftware lxsoftware-admin-web \
  --parameters "lxsoftware:GoogleClientId=$P_GOOGLE_CLIENT_ID" \
  --parameters "lxsoftware:GoogleClientSecret=$P_GOOGLE_CLIENT_SECRET" \
  --parameters "lxsoftware:AdminFederatedEmailAllowlist=$P_EMAIL_ALLOWLIST" \
  --parameters "lxsoftware:AdminBootstrapEmail=$P_BOOTSTRAP_EMAIL" \
  --parameters "lxsoftware:AdminBootstrapTempPassword=$P_BOOTSTRAP_PASSWORD" \
  --parameters "lxsoftware-admin-web:AdminWebCertificateArn=$P_ACM_CERT_ARN"
```

### 2c. Import the stateful resources into `lxsoftware`

```bash
npx cdk import lxsoftware
```

When prompted, supply the **physical IDs** of the existing resources:

| CDK construct path                              | Type                    | Physical ID                                      |
|-------------------------------------------------|-------------------------|--------------------------------------------------|
| `lxsoftware/Auth/UserPool`                      | `AWS::Cognito::UserPool`| `<UserPoolId>` from `lx-admin-auth` outputs      |
| `lxsoftware/RecordsTable`                       | `AWS::DynamoDB::Table`  | `lx-admin-records`                               |
| `lxsoftware/AuditLogTable`                      | `AWS::DynamoDB::Table`  | `lx-admin-audit-log`                             |
| `lxsoftware/AssetsBucket`                       | `AWS::S3::Bucket`       | `lx-admin-assets-<account>-<region>`             |
| `lxsoftware/AssetsS3AccessLogsBucket`           | `AWS::S3::Bucket`       | `lx-admin-assets-s3-access-logs-<account>-<region>` |

CDK creates all the **non-stateful** children (Lambdas, IAM roles, hosted UI
domain, API Gateway, JWT authorizer) on the same change-set apply.

> Cognito **app clients**, the **Hosted UI domain**, the **identity provider**
> and the **PreTokenGeneration trigger** are recreated by CDK. The Hosted UI
> domain prefix (`lx-admin-auth`) is reused so the OAuth callback URLs stay
> identical. The new app client gets a **new client ID**; expect to update
> `ADMIN_COGNITO_CLIENT_ID` in GitHub Variables and the SPA build env after
> the deploy.

### 2d. Import the stateful resources into `lxsoftware-admin-web`

```bash
npx cdk import lxsoftware-admin-web
```

| CDK construct path                                       | Type              | Physical ID                                       |
|----------------------------------------------------------|-------------------|---------------------------------------------------|
| `lxsoftware-admin-web/AdminWebBucket`                    | `AWS::S3::Bucket` | `lx-admin-web-<account>-<region>`                 |
| `lxsoftware-admin-web/CloudFrontAccessLogsBucket`        | `AWS::S3::Bucket` | `lx-admin-web-logs-<account>-<region>`            |

The CloudFront distribution and response-headers policy are **recreated**.
The new distribution gets a new `dXXXXXXXX.cloudfront.net` hostname; the
admin DNS record must be repointed (step 4). Plan the maintenance window
around this.

## 3. Tear down the legacy stacks

By the time we delete the old stacks, every stateful resource they owned is
already in the new stacks (so deletion is a no-op for those) and every
stateless resource will be recreated by `lxsoftware` / `lxsoftware-admin-web`.

```bash
for s in lx-admin-web lx-admin-api lx-admin-assets lx-admin-data lx-admin-auth; do
  echo "Deleting $s …"
  aws cloudformation delete-stack --stack-name "$s"
  aws cloudformation wait stack-delete-complete --stack-name "$s"
done
```

If a delete stalls on a resource, run:

```bash
aws cloudformation describe-stack-events --stack-name <stack> \
  --query 'StackEvents[?ResourceStatus==`DELETE_FAILED`]'
```

Common stall causes:

- **S3 buckets that still hold objects** — the new stacks already own the
  data buckets; only the **old CloudFront access logs** bucket
  `lx-admin-web-logs-<account>-<region>` is double-managed during the import
  step. After import the legacy stack no longer references it, so deletion
  succeeds.
- **Cognito user pool delete protection** is intentional; legacy delete
  succeeds because import detached the resource from the legacy template.

## 4. Repoint DNS and update env vars

1. **Cloudflare** — change the `admin.lx-software.com` `CNAME` from the old
   distribution domain to the new distribution domain (output
   `AdminWebDistributionDomain` of `lxsoftware-admin-web`). Keep the **gray
   cloud** (DNS-only).
2. **GitHub Actions Variables (production environment)**:

   - `ADMIN_COGNITO_USER_POOL_ID` — unchanged.
   - `ADMIN_COGNITO_CLIENT_ID` — **new** value (from `lxsoftware`
     `UserPoolClientId` output).
   - `ADMIN_COGNITO_DOMAIN` — unchanged (`lx-admin-auth.auth.<region>.amazoncognito.com`).
   - `ADMIN_API_BASE_URL` — **new** value (from `lxsoftware`
     `AdminApiBaseUrl` output).
3. **Google OAuth client** — no change; the Cognito hosted UI domain prefix
   stays the same, so the existing
   `https://lx-admin-auth.auth.<region>.amazoncognito.com/oauth2/idpresponse`
   redirect URI continues to work.

Re-run the **Deploy Admin Web** workflow to push a build that points at the
new app client and API endpoint.

## 5. Orphan cleanup

The migration intentionally leaves a small set of legacy resources behind so
that **rollback** stays cheap (see §6). Once the new stacks have been live
for at least one full operations cycle (recommend keeping a copy of the
old DDB on-demand backup until the next monthly review), purge the
**stateless** legacy resources that were not imported:

> **Do not delete the DynamoDB tables, Cognito user pool, S3 buckets, or
> their access logs.** These are now owned by `lxsoftware` /
> `lxsoftware-admin-web`. The list below is what the legacy stacks created
> and abandoned, **not** the active production resources.

### 5a. Identify orphans by tag

Every resource provisioned by the new stacks carries
`Stack=lxsoftware*` and `ManagedBy=CDK`. Anything else with the legacy
`Project=Admin Console` tag is a candidate for cleanup.

```bash
aws resourcegroupstaggingapi get-resources \
  --tag-filters \
      Key=Project,Values="Admin Console" \
  --output json \
  | jq -r '.ResourceTagMappingList[]
            | select((.Tags // [])
                | map(select(.Key=="Stack")) | length == 0)
            | .ResourceARN'
```

Resources reported here have **no `Stack` tag**, meaning they were tagged by
one of the legacy stacks but never picked up by the new ones. Walk the list
and remove any of:

- **Lambda functions** with names starting `lx-admin-auth-`,
  `lx-admin-api-`, `lx-admin-AuthBootstrap*` — recreated under `lxsoftware`.
- **IAM roles** with names starting `lx-admin-auth-`, `lx-admin-api-`,
  `lx-admin-data-`, `lx-admin-assets-` — recreated under `lxsoftware`.
- **CloudWatch log groups** `/aws/lambda/lx-admin-auth-*`,
  `/aws/lambda/lx-admin-api-*`, and the API Gateway access log group
  imported by the legacy `lx-admin-api` stack.
- **API Gateway HTTP API** named `lx-admin-api` if a duplicate remains
  (CloudFormation usually deletes this on stack delete; double-check from
  `aws apigatewayv2 get-apis`).
- **CloudFront distribution** (the legacy `lx-admin-web` distribution).
  Disable it first (`Enabled: false`) and wait for `Status: Deployed`
  before issuing `delete-distribution`. CloudFormation deletes it for you
  if the legacy stack is in a normal state; only run this manually if the
  legacy stack delete left it behind.
- **CloudFront response headers policy** `lx-admin-security-headers` if it
  has been recreated under both stacks. The new stack reuses the same name,
  so a duplicate policy from the legacy stack will block the new stack
  deploy until removed (`aws cloudfront delete-response-headers-policy`).
- **Custom resource log retention** Lambdas / SDK helpers (`AWS679f53fac…`)
  left behind after the legacy stack delete.

### 5b. Re-tag any retained-but-unmanaged resources

After `cdk import`, CFN does **not** apply tags to imported resources from
the new template — you must re-apply them manually (one-time):

```bash
# DynamoDB
for t in lx-admin-records lx-admin-audit-log; do
  aws dynamodb tag-resource --resource-arn \
    "$(aws dynamodb describe-table --table-name "$t" --query 'Table.TableArn' --output text)" \
    --tags \
      Key=Organization,Value="LX Software" \
      Key=Project,Value="Admin Console" \
      Key=Component,Value=backend \
      Key=Stack,Value=lxsoftware \
      Key=Environment,Value=production \
      Key=Repository,Value=lx-software \
      Key=ManagedBy,Value=CDK
done

# S3 (data + assets-access-logs + web-origin + web-logs)
for b in lx-admin-assets-<account>-<region> \
         lx-admin-assets-s3-access-logs-<account>-<region> \
         lx-admin-web-<account>-<region> \
         lx-admin-web-logs-<account>-<region>; do
  STACK_TAG=$(case "$b" in lx-admin-web*) echo lxsoftware-admin-web;; *) echo lxsoftware;; esac)
  COMPONENT_TAG=$(case "$b" in lx-admin-web*) echo spa;; *) echo backend;; esac)
  aws s3api put-bucket-tagging --bucket "$b" \
    --tagging "TagSet=[
      {Key=Organization,Value=LX Software},
      {Key=Project,Value=Admin Console},
      {Key=Component,Value=$COMPONENT_TAG},
      {Key=Stack,Value=$STACK_TAG},
      {Key=Environment,Value=production},
      {Key=Repository,Value=lx-software},
      {Key=ManagedBy,Value=CDK}]"
done

# Cognito user pool
USER_POOL_ID=$(aws cloudformation describe-stacks --stack-name lxsoftware \
  --query 'Stacks[0].Outputs[?OutputKey==`UserPoolId`].OutputValue' --output text)
aws cognito-idp tag-resource \
  --resource-arn "arn:aws:cognito-idp:<region>:<account>:userpool/$USER_POOL_ID" \
  --tags \
      Organization="LX Software" \
      Project="Admin Console" \
      Component=backend \
      Stack=lxsoftware \
      Environment=production \
      Repository=lx-software \
      ManagedBy=CDK
```

After this one-shot retagging, all subsequent `cdk deploy` runs keep tags
consistent (CDK propagates the centrally-defined tag set on every change).

### 5c. Verify nothing is left

```bash
aws resourcegroupstaggingapi get-resources \
  --tag-filters \
    Key=Project,Values="Admin Console" \
  | jq -r '[.ResourceTagMappingList[] | .ResourceARN] | length'
# Expect: a steady count that matches the resources owned by lxsoftware +
# lxsoftware-admin-web. New deploys should not change this count unless a
# new resource type is added to the stack.
```

## 6. Rollback

The migration is reversible because every stateful resource has
`DeletionPolicy: Retain` and physical names are preserved.

### Roll back **before** deleting the legacy stacks (steps 1–2 done, step 3 not started)

1. Run `aws cloudformation delete-stack --stack-name lxsoftware-admin-web`
   then `--stack-name lxsoftware`. The shared physical resources are
   `Retain`, so this only deletes the Lambdas/API/distribution that the new
   stacks created.
2. The legacy stacks are still in place and still own the imported physical
   resources via their original templates (because import never modified
   the legacy template). Re-deploy the legacy stacks from `git revert`
   commit:

   ```bash
   git checkout main
   git revert <consolidation merge commit>
   bash scripts/deploy/deploy-public-website.sh   # public site untouched
   # Re-run "Deploy Backend" with the reverted commit, which re-creates
   # the lx-admin-auth/data/assets/api/web stacks.
   ```

3. Re-attach the Cognito Pre Token Generation Lambda (the legacy stack
   does this automatically on update).

### Roll back **after** the legacy stacks have been deleted (step 3 done)

1. Restore the legacy stacks **from a CDK revert** — the legacy code defined
   the same physical resource names, so a new deploy of the reverted code
   simply re-imports nothing and creates the stateless children again. The
   `RETAIN`-protected resources are still alive, so the new legacy stack
   deploy fails with **"resource already exists"** until you `cdk import`
   each resource back into the legacy stack.

   This is the slow path. To stay on the new stacks unless something is
   truly broken, prefer **forward-fix** instead.

2. If the import path is impractical (commonly because Cognito or the API
   are still healthy on the new stacks), keep the new stacks live and
   restore data only:

   ```bash
   # DynamoDB point-in-time-recovery (PITR) is enabled
   aws dynamodb restore-table-to-point-in-time \
     --source-table-name lx-admin-records \
     --target-table-name lx-admin-records-restore \
     --use-latest-restorable-time
   ```

   Swap traffic by updating Lambda env vars `RECORDS_TABLE_NAME` /
   `AUDIT_LOG_TABLE_NAME`.

## 7. Tagging contract

Centralized in `backend/infrastructure/bin/app.ts`. Every resource that
supports AWS tags receives the union of:

| Tag            | Source                | Example value           |
|----------------|-----------------------|-------------------------|
| `Organization` | App-level             | `LX Software`           |
| `Repository`   | App-level             | `lx-software`           |
| `Environment`  | App-level             | `production`            |
| `ManagedBy`    | App-level             | `CDK`                   |
| `Project`      | Per-stack             | `Public Website` / `Admin Console` |
| `Component`    | Per-stack             | `marketing-site` / `backend` / `spa` |
| `Stack`        | Per-stack (= `stackName`) | `lxsoftware`        |

**Do not** add per-resource tag overrides in stack code — keep the contract
in `bin/app.ts` so every resource is tagged identically. If a resource type
needs an extra tag (for example, AWS Backup selection tags), add it as
another app-level entry so it propagates everywhere consistently.
