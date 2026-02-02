# Deploying the public website

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
PUBLIC_WEBSITE_STACK_NAME=lxsoftware-public-website \
  bash scripts/deploy/deploy-public-website.sh
```

## CDK requirements

The script expects the CloudFormation stack to expose:

- `PublicWebsiteBucketName`
- `PublicWebsiteDistributionId`
