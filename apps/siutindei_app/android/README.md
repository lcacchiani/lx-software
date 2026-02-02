# Android signing setup

This directory contains signing configuration templates for CI and local
builds.

## Local setup

1. Copy `key.properties.example` to `key.properties`.
2. Place your `keystore.p12` in this directory.
3. Ensure your `android/app/build.gradle` includes:

```
apply from: "signing.gradle"
```

Do not commit `key.properties` or `keystore.p12`.

## CI setup

Provide environment variables in CI:

- `KEYSTORE_PATH` (recommended: `app/keystore.p12`)
- `KEYSTORE_PASSWORD`
- `KEY_ALIAS`
- `KEY_PASSWORD`

Then decode the keystore to `apps/siutindei_app/android/app/keystore.p12`.
