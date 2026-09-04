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
| `CurrencySelect` | Bootstrap `form-select` for admin-supported currency codes only (`src/lib/currencies.ts`). Props: `id`, `value`, `onChange`, optional `className`, `disabled`. |
| `DateTimeDisplay` | Formats an ISO instant for **Hong Kong** wall time, e.g. `May 26, 2026 at 10:12pm HKT`. Uses `formatDateTimeHKT` in `src/lib/formatDisplay.ts`. |
| `AdminEditorSection` | Card wrapper for editor blocks: optional title/description, body content, optional **footer** for Save/Update/Clear. |
| `AdminDataTable` | Card + single filter field + standard table (`table-sm`, `table-striped`). Pass columns and row `<tr>` children. Use `AdminDataTableEmptyRow` for empty/filter-empty states. |
| `AdminTabList` | Horizontally scrollable Bootstrap tab list for page sections. Use this instead of a wrapping `nav-tabs` row so every tab stays reachable on mobile. |
| `TableIconButton` | Icon-only button for the operations column. |

Import from the barrel: `import { MoneyAmount, … } from "../components/ui"` (adjust path).

## Formatting helpers (`src/lib/formatDisplay.ts`)

- `formatMoneyAmount(amount, currency)` — string for non-React contexts.
- `formatDateTimeHKT(iso)` — string for HKT display.

## Executive Board components (`src/components/board/`)

The Siu Tin Dei **Executive Board** tab (`ExecutiveBoardTab`) is the reference for conversational / long-running features:

| Component | Purpose |
|-----------|---------|
| `BoardOffcanvas` | Right-hand slide-over (React state + CSS, no Bootstrap JS). Use for chat threads and per-item editors that should not navigate away from the list. |
| `BoardMarkdown` | Renders LLM output with `react-markdown` + `remark-gfm` inside `.board-markdown`. Never `dangerouslySetInnerHTML`. |
| `BoardMemberEditor`, `BoardCharterEditor`, `BoardBriefEditor` | Editors keyed on the record they edit (`key={…}`) so local state re-initialises on data change instead of syncing props in effects. Show character counters against the contract limits and a **Use default** link for overridable fields. |
| `BoardChatOffcanvas` | Optimistic user bubble + "thinking…" placeholder while the async job runs; polling lives in `useBoardChat`, which also copies the job's in-flight `toolCalls` onto the pending bubble so lookups show live. |
| `BoardMeetingPanel`, `BoardTranscript`, `BoardMinutesView` | Progress bar driven by `meetingPhaseProgress`, minutes/transcript toggle, refetch-while-running in `useBoardMeeting`. `BoardTranscript` renders `kind: "tool"` turns as a `BoardToolCallList`, not markdown. |
| `BoardToolCallList` | One compact row per tool call (status icon, tool badge, summary, optional error, **review** link for `pending_approval`). Reused by chat bubbles, transcript tool turns and the audit log. |
| `BoardToolsCard` | Tools & permissions: kill switch, global mode, the tool × member level matrix (cells show `→ effective` when the global mode caps them), per-tool operation list, the **Email allow-list** textarea (one address or `@domain` per line), a Brave Search configured hint on the research row, and the collapsible call log. Keyed on the saved config like the other editors. |
| `BoardApprovalsList` | Pending / decided queue. Arguments render as a key/value table unless the approval carries a mail `preview`, in which case `MailPreviewCard` shows unmasked To / From / Subject / body and an **Open thread** link. **Edit…** switches to a JSON textarea whose parsed object is sent as `arguments` on approve. A `focusApprovalId` (from a review link) scrolls to the row and forces the decided list open. |
| `BoardMailView` | Company mail: mailbox chips with unread badges, search + unread toggle, thread list, and a detail pane. Opening an unread thread marks it read. **Board's view** swaps in the masked (`contact#N` / `phone#N`) bodies a persona sees. |

Async work (chat replies, meetings) always goes through a job row + polling hook, never a long HTTP request; keep poll deadlines aligned with `contracts/board-timeouts.json`. Tool ids, levels and defaults come from `contracts/board-tools.json`; `effectiveToolLevel()` in `boardModel.ts` mirrors the Lambda's capping rule so the matrix can preview the effect of the global mode before saving.

## Dependencies

- **Bootstrap Icons** — Imported globally in `src/main.tsx` (`bootstrap-icons/font/bootstrap-icons.css`). Use `bi` classes only for table/icon buttons per above.
- **react-markdown / remark-gfm** — Only via `BoardMarkdown`.

## Reference implementation

`HouseStatementPanel` (`src/components/HouseStatementPanel.tsx`) applies these patterns: float editor + line editor (`AdminEditorSection`), then `AdminDataTable` with filter and icon operations.
