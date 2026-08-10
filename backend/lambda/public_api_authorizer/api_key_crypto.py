"""Shared crypto helpers for public read-only API keys.

Plaintext keys look like ``lxpk_<keyId>_<secret>``. The DynamoDB primary key
is ``APIKEY#<keyId>`` (so lookups stay O(1)); only a scrypt digest of the
secret is stored, never the plaintext. Scrypt is used rather than a fast
hash (SHA-256 etc.) because CodeQL / OWASP treat API keys like passwords.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from base64 import b64decode, b64encode
from typing import Any

KEY_PLAINTEXT_PREFIX = "lxpk_"
API_KEY_PK_PREFIX = "APIKEY#"
KEY_ID_LEN = 12
# scrypt parameters: ~50–100 ms on Lambda ARM64, well within the 5s
# authorizer timeout, and expensive enough to deter offline guessing.
SCRYPT_N = 2**14
SCRYPT_R = 8
SCRYPT_P = 1
SCRYPT_DKLEN = 32
SCRYPT_SALT_BYTES = 16
MAX_API_KEY_LEN = 256


def mint_key_id() -> str:
    return secrets.token_hex(KEY_ID_LEN // 2)


def mint_plaintext(key_id: str) -> str:
    """Return a new plaintext key embedding ``key_id`` for O(1) lookup."""
    if len(key_id) != KEY_ID_LEN or any(c not in "0123456789abcdef" for c in key_id):
        raise ValueError("key_id must be 12 lowercase hex characters")
    secret = secrets.token_urlsafe(32)
    return f"{KEY_PLAINTEXT_PREFIX}{key_id}_{secret}"


def parse_api_key(raw: str) -> tuple[str, str] | None:
    """Split ``lxpk_<keyId>_<secret>`` into ``(keyId, secret)``, or None."""
    if not isinstance(raw, str):
        return None
    key = raw.strip()
    if not key or len(key) > MAX_API_KEY_LEN:
        return None
    if not key.startswith(KEY_PLAINTEXT_PREFIX):
        return None
    rest = key[len(KEY_PLAINTEXT_PREFIX) :]
    key_id, sep, secret = rest.partition("_")
    if not sep or len(key_id) != KEY_ID_LEN:
        return None
    if any(c not in "0123456789abcdef" for c in key_id):
        return None
    if not secret or len(secret) < 16:
        return None
    return key_id, secret


def hash_secret(secret: str) -> str:
    """Return a self-describing scrypt digest string for storage."""
    salt = secrets.token_bytes(SCRYPT_SALT_BYTES)
    digest = hashlib.scrypt(
        secret.encode("utf-8"),
        salt=salt,
        n=SCRYPT_N,
        r=SCRYPT_R,
        p=SCRYPT_P,
        dklen=SCRYPT_DKLEN,
    )
    return (
        f"scrypt${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}$"
        f"{b64encode(salt).decode('ascii')}$"
        f"{b64encode(digest).decode('ascii')}"
    )


def verify_secret(secret: str, stored: Any) -> bool:
    """Constant-time verify of ``secret`` against a ``hash_secret`` digest."""
    if not isinstance(stored, str) or not isinstance(secret, str):
        return False
    parts = stored.split("$")
    if len(parts) != 6 or parts[0] != "scrypt":
        return False
    try:
        n = int(parts[1])
        r = int(parts[2])
        p = int(parts[3])
        salt = b64decode(parts[4], validate=True)
        expected = b64decode(parts[5], validate=True)
    except (ValueError, TypeError):
        return False
    if n < 2 or r < 1 or p < 1 or not salt or not expected:
        return False
    try:
        actual = hashlib.scrypt(
            secret.encode("utf-8"),
            salt=salt,
            n=n,
            r=r,
            p=p,
            dklen=len(expected),
        )
    except (ValueError, TypeError, MemoryError, OverflowError):
        return False
    return hmac.compare_digest(actual, expected)


def ddb_key(key_id: str) -> dict[str, str]:
    return {"pk": f"{API_KEY_PK_PREFIX}{key_id}", "sk": "META"}
