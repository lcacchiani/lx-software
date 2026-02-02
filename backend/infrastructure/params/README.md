# CDK parameter files

Use `production.json` as a template for the public website parameters.

## Local deploy

```bash
cd backend/infrastructure
export CDK_PARAM_FILE=params/production.json
npx cdk deploy --require-approval never
```

## GitHub Actions

Set the repository variable `CDK_PARAM_FILE` to the path you want CI to use
(`params/production.json` by default).

The only required values are:
- `PublicWebsiteDomainName`
- `PublicWebsiteCertificateArn`

Keep secrets out of the repo. For production, store parameter files securely
outside of git or generate them in CI.
