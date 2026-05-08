# Security Guidelines

This document outlines security practices for the LX Software public website
and its infrastructure.

## Secrets management

- Never hardcode secrets, API keys, or tokens in source code.
- Use GitHub Secrets for CI/CD sensitive values.
- Use CDK parameters with `noEcho: true` for any secret inputs.

## Infrastructure security

- Use least-privilege IAM roles.
- Use GitHub OIDC for AWS access (no long-lived keys).
- Keep S3 buckets private and serve content only via CloudFront.

## GitHubActionsRole IAM requirements

The `GitHubActionsRole` used by GitHub Actions workflows requires these
permissions for CDK deployments:

### CDK Bootstrap role assumption

CDK deployments use roles created when you run `cdk bootstrap` (CDK Bootstrap). The GitHubActionsRole must
be able to assume these roles:

```json
{
  "Effect": "Allow",
  "Action": "sts:AssumeRole",
  "Resource": [
    "arn:aws:iam::ACCOUNT_ID:role/cdk-hnb659fds-deploy-role-*",
    "arn:aws:iam::ACCOUNT_ID:role/cdk-hnb659fds-lookup-role-*",
    "arn:aws:iam::ACCOUNT_ID:role/cdk-hnb659fds-file-publishing-role-*",
    "arn:aws:iam::ACCOUNT_ID:role/cdk-hnb659fds-image-publishing-role-*"
  ]
}
```

Replace `ACCOUNT_ID` with your AWS account ID. If using a custom bootstrap
qualifier, replace `hnb659fds` with your qualifier.

### Admin console stacks (lxsoftware + lxsoftware-admin-web)

`GitHubActionsRole` must be allowed to manage the admin stacks alongside the
public site. Typical additions include:

- **CloudFormation**: `cloudformation:*` (or narrower
  create/update/describe/delete) on stack ARNs
  `arn:aws:cloudformation:REGION:ACCOUNT_ID:stack/lxsoftware/*` and
  `arn:aws:cloudformation:REGION:ACCOUNT_ID:stack/lxsoftware-admin-web/*`. If
  you are migrating from the legacy `lx-admin-*` stacks (auth/data/assets/api/
  web), keep delete permissions on
  `arn:aws:cloudformation:REGION:ACCOUNT_ID:stack/lx-admin-*/*` until those
  stacks have been drained — see `docs/deployment/stack-consolidation.md`.
- **S3**: `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`, `s3:ListBucket` on
  the `lx-admin-web-*` website bucket and, for the deploy script, the same for
  objects synced by GitHub Actions. Prefer scoping to explicit bucket ARNs.
- **CloudFront**: `cloudfront:CreateInvalidation` on the admin distribution ARN
  (output `AdminWebDistributionId` / distribution ARN).
- **Cognito**: `cognito-idp:DescribeUserPool`, `cognito-idp:DescribeUserPoolClient`,
  and related read-only calls if you add verification jobs (optional).

The **Deploy Backend** workflow runs `cdk deploy` for `lxsoftware-public-www`,
`lxsoftware`, and `lxsoftware-admin-web`; the role must still be able to assume
CDK Bootstrap deployment roles and publish assets, as described above.

### SSM parameter read access

For CDK Bootstrap status checks:

```json
{
  "Effect": "Allow",
  "Action": "ssm:GetParameter",
  "Resource": "arn:aws:ssm:*:ACCOUNT_ID:parameter/cdk-bootstrap/*"
}
```

### Cross-repository bootstrap

If CDK Bootstrap was run from a different repository, verify that:

1. The bootstrap roles' trust policy allows the GitHubActionsRole to assume them
2. The GitHubActionsRole has the permissions listed above

## Content safety

- Keep public website content free of PII.
- Avoid embedding user data or internal-only details.

## Code review checklist

- [ ] No secrets or credentials in code or config.
- [ ] CDK parameters for sensitive values use `noEcho: true`.
- [ ] S3 remains private with CloudFront as the only public edge.
