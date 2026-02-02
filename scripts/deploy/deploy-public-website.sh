#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
APP_DIR="$ROOT_DIR/apps/public_www"
BUILD_DIR="$APP_DIR/dist"
STACK_NAME="${PUBLIC_WEBSITE_STACK_NAME:-lxsoftware-public-website}"

if [ ! -d "$BUILD_DIR" ]; then
  echo "Build output not found at $BUILD_DIR"
  echo "Run: (cd apps/public_www && npm run build)"
  exit 1
fi

BUCKET_QUERY="Stacks[0].Outputs[?OutputKey=='PublicWebsiteBucketName']."
BUCKET_QUERY+="OutputValue"
BUCKET_NAME="$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query "$BUCKET_QUERY" \
  --output text)"

if [ -z "$BUCKET_NAME" ] || [ "$BUCKET_NAME" = "None" ]; then
  echo "Public website bucket output not found for $STACK_NAME"
  exit 1
fi

echo "Syncing public website to s3://$BUCKET_NAME"
aws s3 sync "$BUILD_DIR" "s3://$BUCKET_NAME" --delete

DISTRIBUTION_QUERY="Stacks[0].Outputs[?OutputKey=='PublicWebsiteDistributionId']."
DISTRIBUTION_QUERY+="OutputValue"
DISTRIBUTION_ID="$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query "$DISTRIBUTION_QUERY" \
  --output text)"

if [ -n "$DISTRIBUTION_ID" ] && [ "$DISTRIBUTION_ID" != "None" ]; then
  echo "Invalidating CloudFront distribution $DISTRIBUTION_ID"
  aws cloudfront create-invalidation \
    --distribution-id "$DISTRIBUTION_ID" \
    --paths "/*"
fi
