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

Apply the following trust policy to the `GitHubActionsRole` (replace
`<AWS_ACCOUNT_ID>` and `<ORG>/<REPO>`):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<AWS_ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:<ORG>/<REPO>:*"
        }
      }
    }
  ]
}
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
- `PUBLIC_WEBSITE_STACK_NAME` (optional, defaults to `lxsoftware-public-website`)

### Secrets

None required unless you place secrets in your CDK parameter file.
