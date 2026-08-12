#!/usr/bin/env python3
"""Export the Enable Banking KMS signing public key as PEM.

The lxsoftware stack creates an asymmetric RSA KMS key (alias
``lxsoftware-admin/enable-banking``) whose private half signs the RS256
JWTs used to authenticate against the Enable Banking API. Register the
public key printed by this script when creating the application at
https://enablebanking.com (the registration form accepts a plain public
key in place of a certificate), then deploy the stack with the returned
application id as the ``EnableBankingAppId`` parameter.

Requires AWS credentials with kms:GetPublicKey on the key.

Usage:
  python3 scripts/export-enable-banking-public-key.py \
      [--key-id alias/lxsoftware-admin/enable-banking] [--region ap-southeast-1]
"""

from __future__ import annotations

import argparse
import base64

import boto3

DEFAULT_KEY_ID = "alias/lxsoftware-admin/enable-banking"
DEFAULT_REGION = "ap-southeast-1"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--key-id", default=DEFAULT_KEY_ID)
    parser.add_argument("--region", default=DEFAULT_REGION)
    args = parser.parse_args()

    kms = boto3.client("kms", region_name=args.region)
    out = kms.get_public_key(KeyId=args.key_id)
    der: bytes = out["PublicKey"]
    b64 = base64.b64encode(der).decode("ascii")
    lines = [b64[i : i + 64] for i in range(0, len(b64), 64)]
    pem = "\n".join(["-----BEGIN PUBLIC KEY-----", *lines, "-----END PUBLIC KEY-----"])
    print(pem)


if __name__ == "__main__":
    main()
