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

### CDK bootstrap role assumption

CDK deployments use roles created by `cdk bootstrap`. The GitHubActionsRole must
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

### SSM parameter read access

For bootstrap status checks:

```json
{
  "Effect": "Allow",
  "Action": "ssm:GetParameter",
  "Resource": "arn:aws:ssm:*:ACCOUNT_ID:parameter/cdk-bootstrap/*"
}
```

### Cross-repository bootstrap

If CDK bootstrap was run from a different repository, verify that:

1. The bootstrap roles' trust policy allows the GitHubActionsRole to assume them
2. The GitHubActionsRole has the permissions listed above

## Content safety

- Keep public website content free of PII.
- Avoid embedding user data or internal-only details.

## Code review checklist

- [ ] No secrets or credentials in code or config.
- [ ] CDK parameters for sensitive values use `noEcho: true`.
- [ ] S3 remains private with CloudFront as the only public edge.
