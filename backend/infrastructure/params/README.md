# CDK parameter files

Use `production.json` as a template for CDK parameters consumed from
`CDK_PARAM_FILE` in GitHub Actions.

- **Public website** — keys without a stack prefix are applied to
  `lxsoftware-public-www` (for example `PublicWebsiteDomainName`).
- **Admin stacks** — use a `stack:ParameterName` key for `lxsoftware` or
  `lxsoftware-admin-web` (for example `lxsoftware:CognitoCustomDomainName`).
  Those entries are **not** passed to the public stack deploy.

## Prerequisites: CDK Bootstrap

Before deploying for the first time, you must bootstrap the AWS environment. CDK
bootstrap creates the necessary resources (S3 bucket, IAM roles, SSM parameter)
that CDK uses to deploy stacks.

### Bootstrap via GitHub Actions (recommended)

1. Go to **Actions** > **CDK Bootstrap** workflow
2. Click **Run workflow**
3. Select the branch and click **Run workflow**

The workflow uses the `AWS_ACCOUNT_ID` and `AWS_REGION` repository variables.

### Bootstrap locally

```bash
cd backend/infrastructure
npm ci
npx cdk bootstrap aws://ACCOUNT_ID/REGION
```

Replace `ACCOUNT_ID` and `REGION` with your target AWS account and region
(e.g., `aws://588024549699/ap-southeast-1`).

## Local deploy

```bash
cd backend/infrastructure
export CDK_PARAM_FILE=params/production.json
npx cdk deploy --require-approval never
```

## GitHub Actions

Set the repository variable `CDK_PARAM_FILE` to the path you want CI to use
(`params/production.json` by default).

Typical committed values include:

- `PublicWebsiteDomainName`, `PublicWebsiteCertificateArn` (public site)
- Optional Cognito custom Hosted UI on `lxsoftware`: `lxsoftware:CognitoCustomDomainName`
  and `lxsoftware:CognitoCustomDomainCertificateArn` (ACM in **us-east-1**)

Secrets and bootstrap passwords should not live in git; pass them via CI secrets
or a private parameter file stored outside of git.
