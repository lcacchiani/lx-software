const STORAGE_KEY = "lx-admin-finance-v1";

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

function parseStored(raw: string | null): FinancePersistedState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const o = parsed as Record<string, unknown>;
    const hill = o.hillmarton as HouseFinanceData | undefined;
    const mor = o.morrison as HouseFinanceData | undefined;
    if (!hill || !mor || !Array.isArray(hill.lines) || !Array.isArray(mor.lines)) {
      return null;
    }
    return {
      hillmarton: normalizeHouse(hill),
      morrison: normalizeHouse(mor),
    };
  } catch {
    return null;
  }
}

function normalizeHouse(h: HouseFinanceData): HouseFinanceData {
  const fl = h.float ?? DEFAULT_FLOAT;
  return {
    float: {
      amount: typeof fl.amount === "number" && Number.isFinite(fl.amount) ? fl.amount : 0,
      currency:
        typeof fl.currency === "string" && fl.currency.trim()
          ? fl.currency.trim().toUpperCase().slice(0, 3)
          : DEFAULT_FLOAT.currency,
    },
    lines: Array.isArray(h.lines)
      ? h.lines.filter((l): l is HouseStatementLine => Boolean(l && typeof l === "object" && "id" in l))
      : [],
  };
}

export function loadFinanceState(): FinancePersistedState {
  if (typeof window === "undefined") {
    return DEFAULT_FINANCE_STATE;
  }
  const parsed = parseStored(window.localStorage.getItem(STORAGE_KEY));
  return parsed ?? DEFAULT_FINANCE_STATE;
}

export function saveFinanceState(state: FinancePersistedState): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function newStatementLineId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `line-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
