"""Device attestation verification helpers."""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, Mapping, Sequence

import jwt


@dataclass(frozen=True)
class AttestationConfig:
    jwks_url: str
    audience: Sequence[str]
    issuer: str


def load_attestation_config() -> AttestationConfig:
    return AttestationConfig(
        jwks_url=os.getenv("ATTESTATION_JWKS_URL", "").strip(),
        audience=[
            value
            for value in (
                part.strip()
                for part in os.getenv("ATTESTATION_AUDIENCE", "").split(",")
            )
            if value
        ],
        issuer=os.getenv("ATTESTATION_ISSUER", "").strip(),
    )


def is_attestation_enabled() -> bool:
    return bool(load_attestation_config().jwks_url)


def verify_attestation_token(token: str) -> Mapping[str, Any]:
    config = load_attestation_config()
    if not config.jwks_url:
        return {"bypass": True}

    if not config.audience or not config.issuer:
        raise ValueError("Attestation audience/issuer must be configured.")

    jwk_client = jwt.PyJWKClient(config.jwks_url)
    signing_key = jwk_client.get_signing_key_from_jwt(token)
    return jwt.decode(
        token,
        key=signing_key.key,
        algorithms=["RS256"],
        audience=list(config.audience),
        issuer=config.issuer,
    )
