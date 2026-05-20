# One-shot migration scripts (do not re-run)

These scripts targeted line ranges in the pre-refactor monolithic
`handler.py` and `financeModel.ts`. Re-running them would corrupt the
current module layout.

- `split_admin_handler.py` — split Lambda handler (completed)
- `split_finance_model.py` — attempted financeModel split (superseded by manual financeTypes.ts)`
