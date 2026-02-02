# CDK parameter files

Use `production.json` as a template for the public website parameters.

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

The only required values are:
- `PublicWebsiteDomainName`
- `PublicWebsiteCertificateArn`

Keep secrets out of the repo. For production, store parameter files securely
outside of git or generate them in CI.
