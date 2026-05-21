import {
  CUSTOM_ALLOCATION_EXPENSE_ID_PREFIX,
  DEFAULT_EXPENSE_INCOME_ALLOCATION_PERCENTS,
  INCOME_CATEGORIES,
  type ExpenseIncomeAllocationPercents,
  type FinanceAllocationRecord,
  type FinanceLedgerRecord,
  type HouseKey,
} from "./financeTypes";

/** Monthly income implied by an allocation tagged {@link FinanceAllocationRecord.isIncome}. */
export function allocationRecordIncomeMonthlyValue(record: FinanceAllocationRecord): number {
  if (record.isIncome !== true) {
    return 0;
  }
  const isCustom =
    record.isCustomAllocation === true ||
    record.expenseId.startsWith(CUSTOM_ALLOCATION_EXPENSE_ID_PREFIX);
  if (isCustom) {
    const v = record.allocationIncomeMonthly;
    return typeof v === "number" && Number.isFinite(v) ? v : 0;
  }
  const v = record.monthlyAmount;
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * Synthetic income ledger rows for the Income tab (not persisted on the income sheet;
 * edit tags and amounts on the Allocations tab).
 */
export function syntheticIncomeLedgerRowsFromAllocations(
  allocationRecords: readonly FinanceAllocationRecord[],
): FinanceLedgerRecord[] {
  const category = INCOME_CATEGORIES[0];
  const out: FinanceLedgerRecord[] = [];
  for (const a of allocationRecords) {
    const monthly = allocationRecordIncomeMonthlyValue(a);
    if (!Number.isFinite(monthly) || monthly <= 0) {
      continue;
    }
    out.push({
      id: `__alloc_income__${a.expenseId}`,
      category,
      description: `${a.description} (allocation income)`,
      amount: monthly,
      currency: a.currency,
      amountPeriod: "month",
      ...(a.relatedHouse ? { relatedHouse: a.relatedHouse } : {}),
      isDerivedFromAllocation: true,
    });
  }
  return out;
}
/** Monthly equivalent for ledger tables that show a per-month column. */
export function ledgerMonthlyAmount(record: FinanceLedgerRecord): number {
  return record.amountPeriod === "year" ? record.amount / 12 : record.amount;
}

export function normalizeExpenseIncomeAllocationPercents(
  input: unknown,
): ExpenseIncomeAllocationPercents {
  const d = DEFAULT_EXPENSE_INCOME_ALLOCATION_PERCENTS;
  if (!input || typeof input !== "object") {
    return d;
  }
  const o = input as Record<string, unknown>;
  const clamp = (v: unknown): number => {
    const n =
      typeof v === "number"
        ? v
        : typeof v === "string"
          ? Number.parseFloat(v)
          : Number.NaN;
    if (!Number.isFinite(n)) {
      return 0;
    }
    return Math.min(100, Math.max(0, n));
  };
  return {
    taxOnIncomePercent: clamp(o.taxOnIncomePercent),
    investmentOnIncomePercent: clamp(o.investmentOnIncomePercent),
    savingOnIncomePercent: clamp(o.savingOnIncomePercent),
  };
}

type DerivedExpenseFromTaggedIncomeSpec = {
  readonly idSegment: string;
  readonly category: "Tax" | "Investment" | "Saving";
  readonly title: string;
  readonly incomeFlag: "isTax" | "isInvestment" | "isSaving";
  readonly percentKey: keyof ExpenseIncomeAllocationPercents;
};

const DERIVED_EXPENSE_FROM_TAGGED_INCOME_SPECS: readonly DerivedExpenseFromTaggedIncomeSpec[] = [
  {
    idSegment: "tax-on-income",
    category: "Tax",
    title: "Tax on Income",
    incomeFlag: "isTax",
    percentKey: "taxOnIncomePercent",
  },
  {
    idSegment: "investment-on-income",
    category: "Investment",
    title: "Investments on Income",
    incomeFlag: "isInvestment",
    percentKey: "investmentOnIncomePercent",
  },
  {
    idSegment: "saving-on-income",
    category: "Saving",
    title: "Savings on Income",
    incomeFlag: "isSaving",
    percentKey: "savingOnIncomePercent",
  },
];

export function isLedgerRelatedHouse(relatedHouse: HouseKey | undefined): relatedHouse is HouseKey {
  return relatedHouse === "hillmarton" || relatedHouse === "morrison";
}

function sumMonthlyTaggedIncomeByHouseAndCurrency(
  incomeRecords: readonly FinanceLedgerRecord[],
  houseKey: HouseKey,
  flag: "isTax" | "isSaving" | "isInvestment",
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of incomeRecords) {
    if (r.amountPeriod !== "month" || r.relatedHouse !== houseKey) {
      continue;
    }
    if (!r[flag]) {
      continue;
    }
    const c = r.currency;
    out[c] = (out[c] ?? 0) + ledgerMonthlyAmount(r);
  }
  return out;
}

/** Tagged monthly income rows with no (or invalid) related property — still counts toward derived rows. */
function sumMonthlyTaggedIncomeWithoutRelatedHouseByCurrency(
  incomeRecords: readonly FinanceLedgerRecord[],
  flag: "isTax" | "isSaving" | "isInvestment",
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of incomeRecords) {
    if (r.amountPeriod !== "month" || !r[flag]) {
      continue;
    }
    if (isLedgerRelatedHouse(r.relatedHouse)) {
      continue;
    }
    const c = r.currency;
    out[c] = (out[c] ?? 0) + ledgerMonthlyAmount(r);
  }
  return out;
}

/**
 * Synthetic expense rows from allocation rates × monthly income flagged on the income sheet
 * (Tax / Investment / Saving), one row per property and currency where the tagged base is
 * positive and the rate is greater than zero, plus rows for tagged income with no related
 * property.
 */
export function buildDerivedExpenseLedgerRowsFromTaggedIncome(
  incomeRecords: readonly FinanceLedgerRecord[],
  percents: ExpenseIncomeAllocationPercents,
  relatedHouseOptions: ReadonlyArray<{ readonly value: HouseKey; readonly label: string }>,
): FinanceLedgerRecord[] {
  const houses: readonly HouseKey[] = ["hillmarton", "morrison"];
  const out: FinanceLedgerRecord[] = [];
  for (const houseKey of houses) {
    const houseLabel =
      relatedHouseOptions.find((o) => o.value === houseKey)?.label ?? houseKey;
    for (const spec of DERIVED_EXPENSE_FROM_TAGGED_INCOME_SPECS) {
      const pct = percents[spec.percentKey];
      if (pct <= 0) {
        continue;
      }
      const byCcy = sumMonthlyTaggedIncomeByHouseAndCurrency(
        incomeRecords,
        houseKey,
        spec.incomeFlag,
      );
      for (const [currency, base] of Object.entries(byCcy)) {
        if (base <= 0) {
          continue;
        }
        const amount = base * (pct / 100);
        if (!Number.isFinite(amount) || amount === 0) {
          continue;
        }
        out.push({
          id: `__derived__${spec.idSegment}__${houseKey}__${currency}`,
          category: spec.category,
          description: `${spec.title} (${houseLabel})`,
          amount,
          currency,
          amountPeriod: "month",
          relatedHouse: houseKey,
          isDerivedFromTaggedIncome: true,
        });
      }
    }
  }
  for (const spec of DERIVED_EXPENSE_FROM_TAGGED_INCOME_SPECS) {
    const pct = percents[spec.percentKey];
    if (pct <= 0) {
      continue;
    }
    const byCcy = sumMonthlyTaggedIncomeWithoutRelatedHouseByCurrency(
      incomeRecords,
      spec.incomeFlag,
    );
    for (const [currency, base] of Object.entries(byCcy)) {
      if (base <= 0) {
        continue;
      }
      const amount = base * (pct / 100);
      if (!Number.isFinite(amount) || amount === 0) {
        continue;
      }
      out.push({
        id: `__derived__${spec.idSegment}__unallocated__${currency}`,
        category: spec.category,
        description: `${spec.title} (no related property)`,
        amount,
        currency,
        amountPeriod: "month",
        isDerivedFromTaggedIncome: true,
      });
    }
  }
  return out;
}
