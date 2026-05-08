export type FinanceLineType = "income" | "expenditure";

export type HouseFloat = {
  readonly amount: number;
  readonly currency: string;
};

export type HouseStatementLine = {
  readonly id: string;
  /** ISO 8601 instant (UTC), e.g. 2026-05-08T14:30:00.000Z */
  readonly dateUtc: string;
  readonly type: FinanceLineType;
  readonly description: string;
  readonly netAmount: number;
  readonly vat: number;
  readonly currency: string;
  readonly grossAmount: number;
};

export type HouseFinanceData = {
  readonly float: HouseFloat;
  readonly lines: readonly HouseStatementLine[];
};

export type FinancePersistedState = {
  readonly hillmarton: HouseFinanceData;
  readonly morrison: HouseFinanceData;
};

export type HouseKey = "hillmarton" | "morrison";

export const DEFAULT_FLOAT: HouseFloat = {
  amount: 0,
  currency: "GBP",
};

function emptyHouse(): HouseFinanceData {
  return {
    float: { ...DEFAULT_FLOAT },
    lines: [],
  };
}

export const DEFAULT_FINANCE_STATE: FinancePersistedState = {
  hillmarton: emptyHouse(),
  morrison: emptyHouse(),
};

export function newStatementLineId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `line-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
