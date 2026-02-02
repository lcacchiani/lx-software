# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| main    | :white_check_mark: |

## Reporting a Vulnerability

We take security seriously. If you discover a security vulnerability in this project, please report it responsibly.

### How to Report

1. **Do NOT create a public GitHub issue** for security vulnerabilities
2. Instead, please report security vulnerabilities via GitHub's private vulnerability reporting:
   - Go to the repository's **Security** tab
   - Click **Report a vulnerability**
   - Fill out the vulnerability report form

Alternatively, you can email the maintainers directly (add email if applicable).

### What to Include

When reporting a vulnerability, please include:

- A clear description of the vulnerability
- Steps to reproduce the issue
- Potential impact of the vulnerability
- Any suggested fixes or mitigations (optional)

### Response Timeline

- **Initial Response**: Within 48 hours
- **Status Update**: Within 7 days
- **Resolution Target**: Depends on severity
  - Critical: Within 24-48 hours
  - High: Within 7 days
  - Medium: Within 30 days
  - Low: Within 90 days

### What to Expect

1. Acknowledgment of your report within 48 hours
2. Regular updates on the progress of addressing the vulnerability
3. Credit in the security advisory (unless you prefer to remain anonymous)
4. Notification when the fix is released

## Security Best Practices for Contributors

### Code Security

- Never commit secrets, API keys, or credentials to the repository.
- Use environment variables or GitHub Secrets for sensitive configuration.
- Keep public site content free of PII or internal-only details.

### Dependency Management

- Keep dependencies up to date (Dependabot is configured for this).
- Review dependency updates before merging.
- Monitor for security advisories in dependencies.

### Infrastructure Security

- Use IAM roles with minimum required permissions.
- Keep the S3 bucket private and serve content via CloudFront.
- Enable encryption at rest and in transit.
- Enable audit logging where applicable.

## Security Features

This project implements the following security measures:

- GitHub OIDC for CI/CD AWS access (no long-lived keys).
- Private S3 bucket with CloudFront as the public edge.
- HTTPS enforcement via CloudFront.

## Known Limitations

Please review the following when deploying to production:

1. **WAF**: Consider adding AWS WAF for additional protection.
2. **CloudTrail**: Ensure CloudTrail is enabled for audit logging.

## Automated Security Scanning

This repository uses the following automated security tools:

- **Dependabot**: Automated dependency updates and security alerts
- **CodeQL**: Static code analysis for security vulnerabilities
- **Checkov**: Infrastructure as Code security scanning
- **Semgrep**: SAST scanning
- **Gitleaks**: Secret scanning

## License

This security policy is part of the project and is subject to the same license terms.
