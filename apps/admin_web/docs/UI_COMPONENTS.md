# Admin web UI components

This document defines **reusable patterns** for the LX Software admin SPA (`apps/admin_web`). Future features should follow these conventions so screens stay visually and behaviorally consistent.

## Layout rules

1. **Editors above tables** — Any form that creates or updates rows belongs in a dedicated block **above** the related table, never inline-only inside table rows (except icon actions).
2. **Save actions bottom-left** — Within each editor card, primary actions (`Save`, `Update`, etc.) sit in the footer, **left-aligned** (`justify-content-start`). Secondary actions (e.g. `Clear`) sit beside them to the right in the same footer row.
3. **Tables** — Use `AdminDataTable` for list views: one **search/filter** input at the top of the card, then a striped Bootstrap table. The **last column is always “operations”**: row actions only, no heading text (use a visually hidden label for screen readers).
4. **Operations use icons only** — Row actions use `TableIconButton` with Bootstrap Icons classes (`bi bi-pencil`, `bi bi-trash`, …). Every control **must** have a meaningful `aria-label` (and `title` mirrors it). No visible text on these buttons.

## Shared components (`src/components/ui/`)

| Component | Purpose |
|-----------|---------|
| `MoneyAmount` | Displays a numeric amount with ISO currency via `Intl.NumberFormat`. Props: `amount`, `currency`. |
| `DateTimeDisplay` | Formats an ISO instant for **Hong Kong** wall time, e.g. `May 26, 2026 at 10:12pm HKT`. Uses `formatDateTimeHKT` in `src/lib/formatDisplay.ts`. |
| `AdminEditorSection` | Card wrapper for editor blocks: optional title/description, body content, optional **footer** for Save/Update/Clear. |
| `AdminDataTable` | Card + single filter field + standard table (`table-sm`, `table-striped`). Pass columns and row `<tr>` children. Use `AdminDataTableEmptyRow` for empty/filter-empty states. |
| `TableIconButton` | Icon-only button for the operations column. |

Import from the barrel: `import { MoneyAmount, … } from "../components/ui"` (adjust path).

## Formatting helpers (`src/lib/formatDisplay.ts`)

- `formatMoneyAmount(amount, currency)` — string for non-React contexts.
- `formatDateTimeHKT(iso)` — string for HKT display.

## Dependencies

- **Bootstrap Icons** — Imported globally in `src/main.tsx` (`bootstrap-icons/font/bootstrap-icons.css`). Use `bi` classes only for table/icon buttons per above.

## Reference implementation

`HouseStatementPanel` (`src/components/HouseStatementPanel.tsx`) applies these patterns: float editor + line editor (`AdminEditorSection`), then `AdminDataTable` with filter and icon operations.
