# GitHub Rulesets Configuration

This document describes the recommended GitHub rulesets for repository protection.

## Overview

GitHub rulesets protect critical branches and tags from accidental or malicious
changes. These rules enforce code review, CI checks, and prevent destructive
operations.

---

## Branch Protection: `main`

The `main` branch requires protection as it triggers production deployments.

### Required Rules

| Rule | Setting | Purpose |
|------|---------|---------|
| Require pull request before merging | ✅ Enabled | Prevents direct pushes |
| Required approvals | 1+ | Ensures code review |
| Dismiss stale reviews | ✅ Enabled | Re-review after changes |
| Require status checks to pass | ✅ Enabled | CI must pass |
| Require branches to be up to date | ✅ Enabled | Prevents stale merges |
| Block force pushes | ✅ Enabled | Protects history |
| Block deletions | ✅ Enabled | Prevents accidental deletion |

### Required Status Checks

These workflows must pass before merging to `main`:

| Check | Workflow | Purpose |
|-------|----------|---------|
| `lint` | `.github/workflows/lint.yml` | Code style and linting |
| `test` | `.github/workflows/test.yml` | Unit and integration tests |

---

## Tag Protection: `v*`

Release tags should be protected from modification or deletion.

| Rule | Setting | Purpose |
|------|---------|---------|
| Protect tags matching `v*` | ✅ Enabled | Protects release versions |
| Restrict who can create | Maintainers only | Controlled releases |

---

## Setup Instructions

### Option 1: GitHub Web UI

#### Branch Protection

1. Go to repository **Settings** → **Rules** → **Rulesets**
2. Click **New ruleset** → **New branch ruleset**
3. Configure:
   - **Ruleset name:** `main-protection`
   - **Enforcement status:** Active
   - **Target branches:** Add target → Include by pattern → `main`
4. Enable rules:
   - ✅ Restrict deletions
   - ✅ Require a pull request before merging
     - Required approvals: `1`
     - ✅ Dismiss stale pull request approvals when new commits are pushed
   - ✅ Require status checks to pass
     - ✅ Require branches to be up to date before merging
     - Add checks: `lint`, `test`
   - ✅ Block force pushes
5. Click **Create**

#### Tag Protection

1. Go to repository **Settings** → **Rules** → **Rulesets**
2. Click **New ruleset** → **New tag ruleset**
3. Configure:
   - **Ruleset name:** `release-tags`
   - **Enforcement status:** Active
   - **Target tags:** Add target → Include by pattern → `v*`
4. Enable rules:
   - ✅ Restrict deletions
   - ✅ Restrict updates
   - ✅ Restrict creations (optional, maintainers only)
5. Click **Create**

### Option 2: GitHub CLI

```bash
# Branch protection for main
gh api repos/{owner}/{repo}/rulesets \
  --method POST \
  --field name='main-protection' \
  --field target='branch' \
  --field enforcement='active' \
  --field 'conditions[ref_name][include][]=refs/heads/main' \
  --field 'rules[][type]=deletion' \
  --field 'rules[][type]=non_fast_forward' \
  --field 'rules[][type]=pull_request' \
  --field 'rules[2][parameters][required_approving_review_count]=1' \
  --field 'rules[2][parameters][dismiss_stale_reviews_on_push]=true' \
  --field 'rules[][type]=required_status_checks' \
  --field 'rules[3][parameters][strict_required_status_checks_policy]=true' \
  --field 'rules[3][parameters][required_status_checks][][context]=lint' \
  --field 'rules[3][parameters][required_status_checks][][context]=test'

# Tag protection for releases
gh api repos/{owner}/{repo}/rulesets \
  --method POST \
  --field name='release-tags' \
  --field target='tag' \
  --field enforcement='active' \
  --field 'conditions[ref_name][include][]=refs/tags/v*' \
  --field 'rules[][type]=deletion' \
  --field 'rules[][type]=update'
```

---

## Verification

A CI workflow (`.github/workflows/verify-rulesets.yml`) runs weekly and on
demand to verify that branch protection rules are correctly configured.

The verification checks:
- Branch protection exists for `main`
- Required status checks are configured
- Force push protection is enabled
- Deletion protection is enabled

---

## Exceptions

### Dependabot

Dependabot PRs are automatically created and can be merged after CI passes.
No special exceptions needed as Dependabot respects branch protection.

### Emergency Fixes

In emergencies, repository admins can bypass branch protection. This should
be documented in the PR and followed by a post-mortem if used.

---

## Related Documentation

- [GitHub Rulesets Documentation](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets)
- [Branch Protection Rules](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
