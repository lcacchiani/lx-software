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

## Content safety

- Keep public website content free of PII.
- Avoid embedding user data or internal-only details.

## Code review checklist

- [ ] No secrets or credentials in code or config.
- [ ] CDK parameters for sensitive values use `noEcho: true`.
- [ ] S3 remains private with CloudFront as the only public edge.
