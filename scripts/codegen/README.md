# OpenAPI code generation (generalized)

This folder contains generic scripts for generating API clients from any
OpenAPI spec.

## Usage

1. Install Node.js (18+ recommended).
2. Run the codegen script with the desired generator.

Example:

```
./scripts/codegen/openapi_codegen.sh \
  --spec docs/api/activities-search.yaml \
  --generator typescript-fetch \
  --output packages/api_client_ts
```

You can use any generator supported by OpenAPI Generator.
