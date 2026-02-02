# Security Guidelines

This document outlines security best practices and requirements for the Siu Tin Dei project. All contributors must follow these guidelines.

## Table of Contents

- [Secrets Management](#secrets-management)
- [Logging Security](#logging-security)
- [Authentication Security](#authentication-security)
- [API Security](#api-security)
- [Infrastructure Security](#infrastructure-security)
- [Code Review Checklist](#code-review-checklist)

---

## Secrets Management

### DO NOT

- **Never** hardcode secrets, API keys, passwords, or tokens in source code
- **Never** commit `.env` files, keystores, or credential files
- **Never** log secrets or tokens (even partially)
- **Never** include secrets in error messages returned to clients

### DO

- Use AWS Secrets Manager for database credentials
- Use GitHub Secrets for CI/CD sensitive values
- Use CDK parameters with `noEcho: true` for secrets
- Use environment variables at runtime

### Example - CDK Parameter for Secrets

```typescript
const secretParam = new cdk.CfnParameter(this, "MySecret", {
  type: "String",
  noEcho: true,  // REQUIRED for secrets
  description: "Description without revealing the secret type",
});
```

---

## Logging Security

### PII Protection

Email addresses and other personally identifiable information (PII) must be masked in logs to comply with privacy regulations (GDPR, etc.).

### DO NOT

```python
# BAD - exposes email in logs
logger.info(f"User signed up: {email}")
logger.warning(f"Failed login for {user_email}")
```

### DO

```python
from app.utils.logging import mask_email, mask_pii, hash_for_correlation

# GOOD - masks PII
logger.info(f"User signed up: {mask_email(email)}")  # Output: jo***@***.com

# GOOD - use hash for correlation
correlation_id = hash_for_correlation(email)
logger.info(f"Processing request", extra={"correlation_id": correlation_id})

# GOOD - mask other PII
logger.info(f"User ID: {mask_pii(user_id)}")  # Output: abc1***
```

### Available Utilities

| Function | Purpose | Example Output |
|----------|---------|----------------|
| `mask_email(email)` | Mask email addresses | `jo***@***.com` |
| `mask_pii(value)` | Mask any PII | `abc1***` |
| `hash_for_correlation(value)` | Hash for log correlation | `a1b2c3d4e5f6` |

### Print Statements

**Never use `print()` in production code.** Always use structured logging:

```python
# BAD
print(f"Processing user {user_id}")

# GOOD
from app.utils.logging import configure_logging, get_logger
configure_logging()
logger = get_logger(__name__)
logger.info("Processing user", extra={"user_id_masked": mask_pii(user_id)})
```

---

## Authentication Security

### OTP/Code Generation

**Always use cryptographically secure random for security tokens.**

```python
# BAD - predictable, not secure
import random
code = "".join(random.choice(string.digits) for _ in range(6))

# GOOD - cryptographically secure
import secrets
code = "".join(secrets.choice(string.digits) for _ in range(6))
```

### Device Attestation

The device attestation authorizer has two modes:

| Mode | `ATTESTATION_FAIL_CLOSED` | Behavior |
|------|---------------------------|----------|
| **Production** | `true` (default) | Denies requests when attestation is not configured |
| **Development** | `false` | Allows requests without attestation |

**WARNING:** Always use `ATTESTATION_FAIL_CLOSED=true` in production environments.

### CDK Configuration

```typescript
const deviceAttestationFailClosed = new cdk.CfnParameter(
  this,
  "DeviceAttestationFailClosed",
  {
    type: "String",
    default: "true",  // Secure default
    allowedValues: ["true", "false"],
    description: "SECURITY: Must be 'true' in production.",
  }
);
```

---

## API Security

### CORS Configuration

**Never use `Cors.ALL_ORIGINS` in production.** Always restrict to specific allowed origins.

```typescript
// BAD - allows any website to make requests
defaultCorsPreflightOptions: {
  allowOrigins: apigateway.Cors.ALL_ORIGINS,
}

// GOOD - restrict to specific origins
const corsAllowedOrigins = new cdk.CfnParameter(this, "CorsAllowedOrigins", {
  type: "CommaDelimitedList",
  description: "SECURITY: Never use '*' in production.",
});

defaultCorsPreflightOptions: {
  allowOrigins: corsAllowedOrigins.valueAsList,
}
```

### Default Allowed Origins

If no origins are configured, defaults to mobile app schemes only:
- `capacitor://localhost`
- `ionic://localhost`
- `http://localhost` (for development)

### Input Validation

Always validate and sanitize user input:

```python
from app.utils.validators import validate_uuid, validate_email, sanitize_string

# Validate UUIDs
entity_id = validate_uuid(request_id, field_name="id")

# Validate emails
email = validate_email(user_email)

# Sanitize strings with length limits
description = sanitize_string(user_input, max_length=1000)
```

### Error Responses

**Never expose internal error details to clients.**

```python
# BAD - exposes internal details
return {"error": str(exception), "traceback": traceback.format_exc()}

# GOOD - generic error message
logger.exception("Internal error")  # Log details internally
return {"error": "Internal server error"}  # Generic response to client
```

---

## Infrastructure Security

### IAM Permissions

- Use least-privilege IAM roles
- Use OIDC for GitHub Actions (no long-lived AWS keys)
- Scope permissions to specific resources

### Database Security

- Always use SSL: `sslmode=require`
- Prefer IAM authentication for RDS Proxy
- Use separate database users for different access levels:
  - `siutindei_app` - read-only for search
  - `siutindei_admin` - read-write for admin
- If importing an existing Secrets Manager credential secret encrypted
  with a customer-managed KMS key, ensure Lambda roles can decrypt it
  (set `EXISTING_DB_CREDENTIALS_SECRET_KMS_KEY_ARN` or use auto-detect).

### GitHub Workflow Permissions

Always use minimal permissions:

```yaml
permissions:
  contents: read  # Minimum required
  id-token: write  # Only if using OIDC
```

---

## Code Review Checklist

Before approving any PR, verify:

### Secrets
- [ ] No hardcoded secrets, API keys, or passwords
- [ ] New secrets use appropriate storage (Secrets Manager, GitHub Secrets)
- [ ] CDK parameters for secrets have `noEcho: true`

### Logging
- [ ] No PII (emails, names, etc.) logged without masking
- [ ] No `print()` statements in production code
- [ ] Error messages don't expose internal details

### Authentication
- [ ] Security tokens use `secrets` module, not `random`
- [ ] Device attestation uses fail-closed mode in production

### API
- [ ] CORS restricted to specific origins (not `ALL_ORIGINS`)
- [ ] Input is validated before processing
- [ ] Error responses don't leak internal details

### Infrastructure
- [ ] IAM permissions follow least-privilege
- [ ] Database connections use SSL
- [ ] Workflow permissions are minimal

---

## Reporting Security Issues

If you discover a security vulnerability, please:

1. **Do not** create a public GitHub issue
2. Contact the maintainers privately
3. Provide details about the vulnerability and steps to reproduce

---

## References

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [AWS Security Best Practices](https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/welcome.html)
- [GDPR Logging Requirements](https://gdpr.eu/article-32-security-of-processing/)
