#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

python3 "$SCRIPT_DIR/build_lambda_bundle.py"
cd "$SCRIPT_DIR/../infrastructure"
npx ts-node --prefer-ts-exts bin/app.ts
