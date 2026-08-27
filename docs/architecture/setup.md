# Deployment setup

This guide covers AWS prerequisites and GitHub Actions configuration for the LX
Software public website.

## AWS + GitHub OIDC prerequisites

The workflows assume an IAM role named `GitHubActionsRole` in your AWS account.

### 1) Create the GitHub OIDC provider

In AWS Console: **IAM → Identity providers → Add provider**

- Provider type: **OpenID Connect**
- Provider URL: `https://token.actions.githubusercontent.com`
- Audience: `sts.amazonaws.com`

### 2) Update the IAM role trust policy

Apply the trust policy in
[`github-actions-trust-policy.json`](github-actions-trust-policy.json) to the
`GitHubActionsRole`. It trusts every repository in the `lx-software-ltd`
organization:

```bash
aws iam update-assume-role-policy \
  --role-name GitHubActionsRole \
  --policy-document file://docs/architecture/github-actions-trust-policy.json
```

The `sub` condition matches two subject formats:

- `repo:lx-software-ltd/*` — the classic name-only format, issued to
  repositories created before July 15, 2026 that have not been renamed or
  transferred since.
- `repo:lx-software-ltd@321652495/*` — the immutable-ID format
  (`repo:OWNER@OWNER-ID/REPO@REPO-ID:...`), issued to repositories created,
  renamed, or transferred after July 15, 2026. `321652495` is the
  `lx-software-ltd` organization ID and never changes.

Both patterns end in `*` after the repo segment, which covers branch
(`:ref:refs/heads/...`), environment (`:environment:production`), and
pull-request subjects. To check which format a repository currently issues:

```bash
gh api repos/lx-software-ltd/<REPO>/actions/oidc/customization/sub
```

### 3) Create the GitHubActionsRole (if missing)

If you do not see `GitHubActionsRole`, create it:

1. **IAM → Roles → Create role** (tag it with `Organization: LX Software`
   and `Project: Public Website`)
2. **Trusted entity**: Web identity
3. **Provider**: `token.actions.githubusercontent.com`
4. **Audience**: `sts.amazonaws.com`
5. **Permissions**: `AdministratorAccess` (tighten later)
6. **Role name**: `GitHubActionsRole`

## GitHub Actions configuration

### Variables (non-secret)

- `AWS_ACCOUNT_ID`
- `AWS_REGION`
- `CDK_BOOTSTRAP_QUALIFIER` (optional)
- `CDK_PARAM_FILE` (e.g. `backend/infrastructure/params/production.json`)
- `PUBLIC_WEBSITE_STACK_NAME` (optional, defaults to `lxsoftware-public-www`)

### Secrets

None required unless you place secrets in your CDK parameter file.
