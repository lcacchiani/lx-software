import {
  FINANCE_HOUSE_KEYS,
  FINANCE_STATEMENT_BOOK_KEYS,
  type HouseKey,
  type StatementBookKey,
  type StatementOwnerKey,
} from "./financeTypes";

export const SIU_TIN_DEI_BOOK_KEY: StatementBookKey = "siuTinDei";

export function isHouseKey(value: string): value is HouseKey {
  return (FINANCE_HOUSE_KEYS as readonly string[]).includes(value);
}

export function isStatementBookKey(value: string): value is StatementBookKey {
  return (FINANCE_STATEMENT_BOOK_KEYS as readonly string[]).includes(value);
}

export function statementOwnerQueryKey(
  owner: StatementOwnerKey,
): readonly string[] {
  return isHouseKey(owner) ? ["finance"] : [owner];
}

export function parseStatementStartPath(owner: StatementOwnerKey): string {
  return isHouseKey(owner)
    ? `/finance/${owner}/parse-statement`
    : `/${kebabBookKey(owner)}/parse-statement`;
}

export function parseStatementJobPath(
  owner: StatementOwnerKey,
  jobId: string,
): string {
  return isHouseKey(owner)
    ? `/finance/${owner}/parse-statement/jobs/${encodeURIComponent(jobId)}`
    : `/${kebabBookKey(owner)}/parse-statement/jobs/${encodeURIComponent(jobId)}`;
}

function kebabBookKey(owner: StatementBookKey): string {
  if (owner === "siuTinDei") return "siu-tin-dei";
  return owner;
}

export function financeOwnerDisplayLabel(owner?: string): string {
  if (!owner?.trim()) return "—";
  if (owner === SIU_TIN_DEI_BOOK_KEY) return "Siu Tin Dei";
  return owner;
}
