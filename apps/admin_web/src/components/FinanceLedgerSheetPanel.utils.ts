import { ledgerMonthlyAmount, type FinanceLedgerRecord, type HouseKey } from "../lib/financeModel";
import type { FinanceLedgerSheetPanelProps } from "./FinanceLedgerSheetPanel";

export type LedgerSortColumnKey = "cat" | "desc" | "house" | "amt" | "ccy";

export function relatedHouseSortLabel(
  record: FinanceLedgerRecord,
  relatedHouseLabelByValue: ReadonlyMap<HouseKey, string>,
): string {
  if (!record.relatedHouse) return "";
  return relatedHouseLabelByValue.get(record.relatedHouse) ?? record.relatedHouse;
}

export function compareLedgerRecords(
  a: FinanceLedgerRecord,
  b: FinanceLedgerRecord,
  sortKey: LedgerSortColumnKey,
  sortDir: "asc" | "desc",
  relatedHouseLabelByValue: ReadonlyMap<HouseKey, string>,
): number {
  const dir = sortDir === "asc" ? 1 : -1;
  let cmp = 0;
  switch (sortKey) {
    case "cat":
      cmp = a.category.localeCompare(b.category, undefined, { sensitivity: "base" });
      break;
    case "desc":
      cmp = a.description.localeCompare(b.description, undefined, { sensitivity: "base" });
      break;
    case "house":
      cmp = relatedHouseSortLabel(a, relatedHouseLabelByValue).localeCompare(
        relatedHouseSortLabel(b, relatedHouseLabelByValue),
        undefined,
        { sensitivity: "base" },
      );
      break;
    case "amt": {
      const ma = ledgerMonthlyAmount(a);
      const mb = ledgerMonthlyAmount(b);
      cmp = ma === mb ? 0 : ma < mb ? -1 : 1;
      break;
    }
    case "ccy":
      cmp = a.currency.localeCompare(b.currency, undefined, { sensitivity: "base" });
      break;
    default:
      break;
  }
  if (cmp !== 0) return dir * cmp;
  return a.id.localeCompare(b.id);
}

export function incomeLedgerFlagLabels(
  record: FinanceLedgerRecord,
  defs: FinanceLedgerSheetPanelProps["incomeFlagFields"],
): string {
  if (!defs?.length) return "";
  const parts: string[] = [];
  for (const { field, label } of defs) {
    if (record[field]) parts.push(label);
  }
  return parts.join(", ");
}

export function expenseLedgerFlagLabels(
  record: FinanceLedgerRecord,
  defs: FinanceLedgerSheetPanelProps["expenseFlagFields"],
): string {
  if (!defs?.length) return "";
  const parts: string[] = [];
  for (const { field, label } of defs) {
    if (record[field]) parts.push(label);
  }
  return parts.join(", ");
}
