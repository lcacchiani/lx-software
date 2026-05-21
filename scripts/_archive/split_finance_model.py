#!/usr/bin/env python3
"""Split financeModel.ts into types, aggregations, and a thin barrel."""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "apps" / "admin_web" / "src" / "lib" / "financeModel.ts"
OUT = ROOT / "apps" / "admin_web" / "src" / "lib"

TYPES_HEADER = '''import {
  ASSET_TYPES,
  EXPENSE_CATEGORIES,
  FINANCE_ACCOUNT_TYPES,
  GLOBAL_DEFAULT_CURRENCY,
  INCOME_CATEGORIES,
  INVESTMENT_CATEGORIES,
  type CurrencyCode,
  type HouseKey,
} from "./contracts/generated";
import { coerceSupportedCurrency } from "./currencies";

'''

AGG_HEADER = '''import {
  DEFAULT_EXPENSE_INCOME_ALLOCATION_PERCENTS,
  type ExpenseIncomeAllocationPercents,
  type FinanceLedgerAmountBuckets,
  type FinanceLedgerRecord,
  type HouseKey,
} from "./financeTypes";
import { ledgerMonthlyAmount } from "./financeLedger";

'''


def extract(start: int, end: int) -> str:
    lines = SRC.read_text(encoding="utf-8").splitlines(keepends=True)
    return "".join(lines[start - 1 : end])


def main() -> None:
    backup = OUT / "financeModel.monolith.ts"
    if not backup.exists():
        backup.write_text(SRC.read_text(encoding="utf-8"), encoding="utf-8")

    # Types + sheet types + allocation types + ledger types + persisted state (1-849)
    types_body = extract(1, 849)
    types_body = types_body.replace(
        'import {\n  GLOBAL_DEFAULT_CURRENCY,\n  coerceSupportedCurrency,\n  type CurrencyCode,\n} from "./currencies";\n\n',
        "",
    )
    types_body = types_body.replace(
        'export const INCOME_CATEGORIES = ["Salary", "Rent"] as const;\n\n',
        "",
    )
    types_body = types_body.replace(
        'export const EXPENSE_CATEGORIES = [\n  "Utility",\n  "Saving",\n  "Investment",\n  "Rent",\n  "Mortgage",\n  "Insurance",\n  "Retirement",\n  "Tax",\n  "Amenities",\n  "Helper",\n  "Education",\n] as const;\n\n',
        "",
    )
    types_body = types_body.replace(
        'export const INVESTMENT_CATEGORIES = [\n  "Real Estate",\n  "Fixed Term Deposit",\n  "ETF",\n  "Crypto",\n] as const;\n\n',
        "",
    )
    types_body = types_body.replace(
        'export const ASSET_TYPES = ["Fixed", "Liquid"] as const;\n\n',
        "",
    )
    types_body = types_body.replace(
        'export type HouseKey = "hillmarton" | "morrison";\n\n',
        "",
    )
    types_body = types_body.replace(
        'export const FINANCE_ACCOUNT_TYPES = ["Bank Account", "Credit Card", "Debit Card"] as const;\n\n',
        "",
    )
    types_body = types_body.replace(
        "export type InvestmentCategory = (typeof INVESTMENT_CATEGORIES)[number];\n\n",
        "export type InvestmentCategory = (typeof INVESTMENT_CATEGORIES)[number];\n\n",
    )
    types_body = types_body.replace(
        "export type AssetType = (typeof ASSET_TYPES)[number];\n\n",
        "export type AssetType = (typeof ASSET_TYPES)[number];\n\n",
    )
    types_body = types_body.replace(
        "export type FinanceAccountType = (typeof FINANCE_ACCOUNT_TYPES)[number];\n\n",
        "export type FinanceAccountType = (typeof FINANCE_ACCOUNT_TYPES)[number];\n\n",
    )
    # Re-export categories from generated at top of types file
    types_body = (
        "export {\n"
        "  ASSET_TYPES,\n"
        "  EXPENSE_CATEGORIES,\n"
        "  FINANCE_ACCOUNT_TYPES,\n"
        "  INCOME_CATEGORIES,\n"
        "  INVESTMENT_CATEGORIES,\n"
        "  type HouseKey,\n"
        "} from \"./contracts/generated\";\n\n"
        + types_body
    )

    (OUT / "financeTypes.ts").write_text(TYPES_HEADER + types_body, encoding="utf-8")

    agg_body = extract(573, 771)
    (OUT / "financeAggregations.ts").write_text(AGG_HEADER + agg_body, encoding="utf-8")

    # Normalization + house (850-end + parts from 500-572, 393-572, 1256-1405, 7-57, 1406-end)
    norm_parts = [
        extract(7, 57),
        extract(393, 572),
        extract(851, 1242),
        extract(1256, 1498),
    ]
    norm_header = '''import { GLOBAL_DEFAULT_CURRENCY, type CurrencyCode } from "./contracts/generated";
import { coerceSupportedCurrency } from "./currencies";
import {
  DEFAULT_EXPENSE_INCOME_ALLOCATION_PERCENTS,
  DEFAULT_FINANCE_STATE,
  DEFAULT_FLOAT,
  type ExpenseIncomeAllocationPercents,
  type FinanceAccountRecord,
  type FinanceAccountType,
  type FinanceAllocationRecord,
  type FinanceInvestmentRecord,
  type FinanceLedgerAmountPeriod,
  type FinanceLedgerRecord,
  type FinancePensionRecord,
  type FinancePersistedState,
  type FinanceSavingsRecord,
  type HouseFinanceData,
  type HouseKey,
  type HouseStatementLine,
  type InvestmentCategory,
  INCOME_CATEGORIES,
  EXPENSE_CATEGORIES,
  INVESTMENT_CATEGORIES,
  ASSET_TYPES,
  FINANCE_ACCOUNT_TYPES,
  INVESTMENT_TICKER_MAX_LEN,
  INVESTMENT_CRYPTO_CURRENCY_MAX_LEN,
  MAX_PENSION_DESCRIPTION_LEN,
  MAX_ACCOUNT_DESCRIPTION_LEN,
  CUSTOM_ALLOCATION_EXPENSE_ID_PREFIX,
} from "./financeTypes";
import {
  buildDerivedExpenseLedgerRowsFromTaggedIncome,
  normalizeExpenseIncomeAllocationPercents,
} from "./financeLedger";

'''
    (OUT / "financeNormalize.ts").write_text(
        norm_header + "".join(norm_parts), encoding="utf-8"
    )

    ledger_body = extract(341, 572)
    ledger_header = '''import {
  DEFAULT_EXPENSE_INCOME_ALLOCATION_PERCENTS,
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  type ExpenseIncomeAllocationPercents,
  type FinanceAllocationRecord,
  type FinanceLedgerAmountPeriod,
  type FinanceLedgerRecord,
  type FinanceLedgerSheetKey,
  type HouseKey,
} from "./financeTypes";

'''
    (OUT / "financeLedger.ts").write_text(ledger_header + ledger_body, encoding="utf-8")

    barrel = '''/** Finance domain model — re-exports from focused modules. */

export * from "./financeTypes";
export * from "./financeLedger";
export * from "./financeAggregations";
export * from "./financeNormalize";
'''
    SRC.write_text(barrel, encoding="utf-8")
    print("Split financeModel.ts into financeTypes, financeLedger, financeAggregations, financeNormalize")


if __name__ == "__main__":
    main()
