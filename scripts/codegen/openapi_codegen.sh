#!/usr/bin/env bash
set -euo pipefail

SPEC=""
GENERATOR=""
OUTPUT=""
PACKAGE_NAME=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --spec)
      SPEC="$2"
      shift 2
      ;;
    --generator)
      GENERATOR="$2"
      shift 2
      ;;
    --output)
      OUTPUT="$2"
      shift 2
      ;;
    --package-name)
      PACKAGE_NAME="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1"
      exit 1
      ;;
  esac
done

if [[ -z "$SPEC" || -z "$GENERATOR" || -z "$OUTPUT" ]]; then
  echo "Usage: $0 --spec <spec> --generator <generator> --output <output> [--package-name <name>]"
  exit 1
fi

ARGS=()
if [[ -n "$PACKAGE_NAME" ]]; then
  ARGS+=(--additional-properties "packageName=${PACKAGE_NAME}")
fi

npx @openapitools/openapi-generator-cli generate \
  -i "$SPEC" \
  -g "$GENERATOR" \
  -o "$OUTPUT" \
  "${ARGS[@]}"
