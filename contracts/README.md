# Shared contracts

JSON files in this directory are the **source of truth** for values shared across
the admin SPA, admin Lambda, and CDK.

After editing, run:

```bash
python3 scripts/sync-contracts.py
python3 scripts/check-contracts.py
```

Generated artifacts:

- `backend/lambda/admin/contracts/` — copied JSON (bundled with the Lambda)
- `backend/lambda/admin/contract_constants.py` — Python constants
- `apps/admin_web/src/lib/contracts/generated.ts` — TypeScript constants
- `backend/infrastructure/lib/shared-contracts.ts` — CDK parse timeout + domain helpers
