import {
  DEFAULT_EXPENSE_INCOME_ALLOCATION_PERCENTS,
  EXPENSE_CATEGORIES,
  type ExpenseIncomeAllocationPercents,
  type FinanceAllocationRecord,
  type FinanceLedgerAmountBuckets,
  type FinanceLedgerRecord,
  type HouseKey,
} from "./financeTypes";
import {
  allocationRecordIncomeMonthlyValue,
  buildDerivedExpenseLedgerRowsFromTaggedIncome,
  isLedgerRelatedHouse,
  ledgerMonthlyAmount,
} from "./financeLedger";

export function sumMonthlyFinanceLedgerAmountsByHouse(
  incomeRecords: readonly FinanceLedgerRecord[],
  expenseRecords: readonly FinanceLedgerRecord[],
  houseKey: HouseKey,
  expenseAllocationPercents?: ExpenseIncomeAllocationPercents,
  allocationRecords?: readonly FinanceAllocationRecord[],
): FinanceLedgerAmountBuckets {
  const alloc = expenseAllocationPercents ?? DEFAULT_EXPENSE_INCOME_ALLOCATION_PERCENTS;
  const income: Record<string, number> = {};
  const expenses: Record<string, number> = {};

  for (const r of incomeRecords) {
    if (r.amountPeriod !== "month" || r.relatedHouse !== houseKey) continue;
    const c = r.currency;
    income[c] = (income[c] ?? 0) + r.amount;
  }
  if (allocationRecords?.length) {
    for (const a of allocationRecords) {
      if (a.relatedHouse !== houseKey) continue;
      const m = allocationRecordIncomeMonthlyValue(a);
      if (!Number.isFinite(m) || m <= 0) continue;
      const c = a.currency;
      income[c] = (income[c] ?? 0) + m;
    }
  }
  for (const r of expenseRecords) {
    if (r.amountPeriod !== "month" || r.relatedHouse !== houseKey) continue;
    const c = r.currency;
    expenses[c] = (expenses[c] ?? 0) + r.amount;
  }

  const addDerivedForFlag = (
    flag: "isTax" | "isSaving" | "isInvestment",
    pct: number,
  ): void => {
    if (pct <= 0) {
      return;
    }
    for (const r of incomeRecords) {
      if (r.amountPeriod !== "month" || r.relatedHouse !== houseKey) {
        continue;
      }
      if (!r[flag]) {
        continue;
      }
      const c = r.currency;
      const base = ledgerMonthlyAmount(r);
      expenses[c] = (expenses[c] ?? 0) + base * (pct / 100);
    }
  };

  addDerivedForFlag("isTax", alloc.taxOnIncomePercent);
  addDerivedForFlag("isInvestment", alloc.investmentOnIncomePercent);
  addDerivedForFlag("isSaving", alloc.savingOnIncomePercent);

  return { incomeByCurrency: income, expensesByCurrency: expenses };
}

/**
 * Monthly ledger totals for income and expenses not linked to a property
 * (`relatedHouse` unset), plus synthetic derived expense rows from tagged
 * monthly income with no related property (same rules as the expenses sheet).
 * Yearly (`amountPeriod: year`) rows are excluded, matching
 * {@link sumMonthlyFinanceLedgerAmountsByHouse}.
 *
 * When `allocationRecords` is set, allocations tagged as income with no related
 * property add to the general income side.
 */
export function sumMonthlyFinanceLedgerAmountsGeneral(
  incomeRecords: readonly FinanceLedgerRecord[],
  expenseRecords: readonly FinanceLedgerRecord[],
  expenseAllocationPercents: ExpenseIncomeAllocationPercents,
  relatedHouseOptions: ReadonlyArray<{ readonly value: HouseKey; readonly label: string }>,
  allocationRecords?: readonly FinanceAllocationRecord[],
): FinanceLedgerAmountBuckets {
  const alloc = expenseAllocationPercents ?? DEFAULT_EXPENSE_INCOME_ALLOCATION_PERCENTS;
  const income: Record<string, number> = {};
  const expenses: Record<string, number> = {};

  for (const r of incomeRecords) {
    if (r.amountPeriod !== "month" || isLedgerRelatedHouse(r.relatedHouse)) {
      continue;
    }
    const c = r.currency;
    income[c] = (income[c] ?? 0) + r.amount;
  }
  if (allocationRecords?.length) {
    for (const a of allocationRecords) {
      if (isLedgerRelatedHouse(a.relatedHouse)) continue;
      const m = allocationRecordIncomeMonthlyValue(a);
      if (!Number.isFinite(m) || m <= 0) continue;
      const c = a.currency;
      income[c] = (income[c] ?? 0) + m;
    }
  }
  for (const r of expenseRecords) {
    if (r.amountPeriod !== "month" || isLedgerRelatedHouse(r.relatedHouse)) {
      continue;
    }
    const c = r.currency;
    expenses[c] = (expenses[c] ?? 0) + r.amount;
  }

  const derived = buildDerivedExpenseLedgerRowsFromTaggedIncome(
    incomeRecords,
    alloc,
    relatedHouseOptions,
  );
  for (const r of derived) {
    if (isLedgerRelatedHouse(r.relatedHouse)) {
      continue;
    }
    const c = r.currency;
    expenses[c] = (expenses[c] ?? 0) + r.amount;
  }

  return { incomeByCurrency: income, expensesByCurrency: expenses };
}

/**
 * Per-currency monthly expense totals for the **general** ledger slice (no related
 * property), matching {@link sumMonthlyFinanceLedgerAmountsGeneral}: persisted
 * expense rows with `amountPeriod: month` and no `relatedHouse`, plus derived
 * tax / saving / investment rows from tagged income with no related property.
 * Every {@link EXPENSE_CATEGORIES} key is present; currencies with zero net are omitted.
 */
export function sumMonthlyGeneralExpenseAmountsByCategory(
  incomeRecords: readonly FinanceLedgerRecord[],
  expenseRecords: readonly FinanceLedgerRecord[],
  expenseAllocationPercents: ExpenseIncomeAllocationPercents,
  relatedHouseOptions: ReadonlyArray<{ readonly value: HouseKey; readonly label: string }>,
): Readonly<Record<string, Readonly<Record<string, number>>>> {
  const alloc = expenseAllocationPercents ?? DEFAULT_EXPENSE_INCOME_ALLOCATION_PERCENTS;
  const byCat: Record<string, Record<string, number>> = {};
  for (const cat of EXPENSE_CATEGORIES) {
    byCat[cat] = {};
  }

  for (const r of expenseRecords) {
    if (r.amountPeriod !== "month" || isLedgerRelatedHouse(r.relatedHouse)) {
      continue;
    }
    const bucket = byCat[r.category];
    if (!bucket) {
      continue;
    }
    const c = r.currency;
    bucket[c] = (bucket[c] ?? 0) + r.amount;
  }

  const derived = buildDerivedExpenseLedgerRowsFromTaggedIncome(
    incomeRecords,
    alloc,
    relatedHouseOptions,
  );
  for (const r of derived) {
    if (isLedgerRelatedHouse(r.relatedHouse)) {
      continue;
    }
    const bucket = byCat[r.category];
    if (!bucket) {
      continue;
    }
    const c = r.currency;
    bucket[c] = (bucket[c] ?? 0) + r.amount;
  }

  return byCat;
}

/** Per-currency income minus expenses for {@link FinanceLedgerAmountBuckets}. */
export function monthlyLedgerNetByCurrency(
  buckets: FinanceLedgerAmountBuckets,
): Record<string, number> {
  const { incomeByCurrency: inc, expensesByCurrency: exp } = buckets;
  const keys = [...new Set([...Object.keys(inc), ...Object.keys(exp)])];
  const out: Record<string, number> = {};
  for (const c of keys) {
    out[c] = (inc[c] ?? 0) - (exp[c] ?? 0);
  }
  return out;
}
