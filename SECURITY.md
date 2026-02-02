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

- Never commit secrets, API keys, or credentials to the repository
- Use environment variables for sensitive configuration
- Follow the principle of least privilege in IAM policies
- Validate and sanitize all user inputs
- Use parameterized queries to prevent SQL injection

### Dependency Management

- Keep dependencies up to date (Dependabot is configured for this)
- Review dependency updates before merging
- Monitor for security advisories in dependencies

### Infrastructure Security

- Use IAM roles with minimum required permissions
- Enable encryption at rest and in transit
- Configure security groups with least privilege
- Use VPC endpoints for AWS service access
- Enable audit logging where applicable

## Security Features

This project implements the following security measures:

### Authentication & Authorization
- AWS Cognito for user authentication (passwordless OTP/magic link)
- JWT-based authorization with API Gateway
- Admin group membership verification for protected routes
- API key validation for public endpoints

### Database Security
- Aurora PostgreSQL with encryption at rest
- RDS Proxy with IAM authentication
- TLS-enforced database connections
- Database in private subnets (no public access)
- Secrets Manager for credential storage

### Network Security
- VPC with public/private subnet separation
- Security groups restricting traffic to required ports
- VPC endpoints for AWS service access (no internet traversal)
- Lambda functions in private subnets

### API Security
- Input validation and sanitization
- Proper error handling (no sensitive data in errors)
- CORS configuration (review for production use)
- Rate limiting via API Gateway (configurable)

## Known Limitations

Please review the following when deploying to production:

1. **CORS Configuration**: Default configuration uses wildcard (`*`) for allowed origins. Restrict this for production deployments.

2. **MFA**: Cognito MFA is currently set to OFF. Consider enabling for sensitive applications.

3. **API Rate Limiting**: Configure API Gateway throttling based on your requirements.

4. **WAF**: Consider adding AWS WAF for additional API protection.

5. **CloudTrail**: Ensure CloudTrail is enabled for audit logging.

## Automated Security Scanning

This repository uses the following automated security tools:

- **Dependabot**: Automated dependency updates and security alerts
- **CodeQL**: Static code analysis for security vulnerabilities (see workflows)
- **pip-audit**: Python dependency vulnerability scanning
- **Bandit**: Python security linter
- **Checkov**: Infrastructure as Code security scanning

## License

This security policy is part of the project and is subject to the same license terms.
