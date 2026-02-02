# Deploying the public website

## Prerequisites

### 1. CDK Bootstrap (first-time setup)

Before deploying CDK stacks for the first time, the AWS environment must be
bootstrapped. This creates the resources CDK needs to deploy (S3 bucket for
assets, IAM roles, SSM parameter for version tracking).

**Via GitHub Actions (recommended):**

1. Go to **Actions** > **CDK Bootstrap** workflow
2. Click **Run workflow** and select your branch
3. Wait for the workflow to complete

**Locally:**

```bash
cd backend/infrastructure
npm ci
npx cdk bootstrap aws://ACCOUNT_ID/REGION
```

Replace `ACCOUNT_ID` and `REGION` with your AWS account ID and region
(e.g., `aws://588024549699/ap-southeast-1`).

You only need to bootstrap once per account/region combination.

### 2. GitHub repository variables

Ensure these repository variables are set in **Settings** > **Variables**:

| Variable | Description | Example |
|----------|-------------|---------|
| `AWS_ACCOUNT_ID` | Target AWS account ID | `588024549699` |
| `AWS_REGION` | Target AWS region | `ap-southeast-1` |
| `CDK_PARAM_FILE` | Path to parameter file | `params/production.json` |

## Build locally

```bash
cd apps/public_www
npm install
npm run build
```

The output is written to `apps/public_www/dist`.

## Deploy to S3 + CloudFront

Use the deployment script, which syncs the build directory to the S3 bucket and
invalidates the CloudFront distribution:

```bash
PUBLIC_WEBSITE_STACK_NAME=lxsoftware-public-www \
  bash scripts/deploy/deploy-public-website.sh
```

## CDK requirements

The script expects the CloudFormation stack to expose:

- `PublicWebsiteBucketName`
- `PublicWebsiteDistributionId`

## Troubleshooting

### "SSM parameter /cdk-bootstrap/hnb659fds/version not found"

This error means the CDK bootstrap has not been run for the target
account/region. Run the **CDK Bootstrap** workflow or bootstrap manually as
described in the prerequisites section above.
