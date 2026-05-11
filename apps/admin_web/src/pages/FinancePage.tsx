import { useState } from "react";
import { FinanceDataLoadOrError, FinanceSaveStatus } from "../components/FinanceDataStatus";
import { FinanceInvestmentsPanel } from "../components/FinanceInvestmentsPanel";
import { FinancePensionPanel, FinanceSavingsPanel } from "../components/FinanceSavingsAndPensionPanels";
import { FinanceAllocationsPanel } from "../components/FinanceAllocationsPanel";
import { FinanceLedgerSheetPanel } from "../components/FinanceLedgerSheetPanel";
import { HouseStatementPanel } from "../components/HouseStatementPanel";
import { useFinance } from "../hooks/useFinance";
import { HOUSE_DISPLAY_LABEL, LEDGER_RELATED_HOUSE_OPTIONS } from "../lib/houses";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_LEDGER_FLAG_FIELDS,
  INCOME_CATEGORIES,
  INCOME_LEDGER_FLAG_FIELDS,
} from "../lib/financeModel";

type FinanceTab =
  | "hillmarton"
  | "morrison"
  | "investments"
  | "savings"
  | "pension"
  | "income"
  | "expenses"
  | "allocations";

export function FinancePage() {
  const {
    data,
    patchHouse,
    patchLedgerRecords,
    patchInvestmentRecords,
    patchSavingsRecords,
    patchPensionRecords,
    patchAllocationRecords,
    patchExpenseIncomeAllocationPercents,
    isLoading,
    isError,
    isSaving,
    saveError,
    saveErrorDetail,
  } = useFinance();
  const [tab, setTab] = useState<FinanceTab>("hillmarton");

  return (
    <div>
      <h1 className="h3 mb-3">Finance</h1>
      <p className="text-muted mb-4">
        House statements, floats, investments, savings, pension, and income and expense ledgers are
        stored in the admin API (DynamoDB). The Allocations tab lists expenses tagged{" "}
        <strong>Allocate</strong>, derived allocation lines from tagged income (both labeled Allocate
        on Expenses), and <strong>custom</strong> allocation rows you add on Allocations (no monthly
        budget for those).
      </p>
      <FinanceDataLoadOrError isLoading={isLoading} isError={isError} />
      {!isLoading && !isError ? (
        <>
          <FinanceSaveStatus
            isSaving={isSaving}
            saveError={saveError}
            saveErrorDetail={saveErrorDetail}
          />

          <ul className="nav nav-tabs mb-4" role="tablist">
            <li className="nav-item" role="presentation">
              <button
                type="button"
                className={`nav-link ${tab === "hillmarton" ? "active" : ""}`}
                role="tab"
                aria-selected={tab === "hillmarton"}
                onClick={() => setTab("hillmarton")}
              >
                {HOUSE_DISPLAY_LABEL.hillmarton}
              </button>
            </li>
            <li className="nav-item" role="presentation">
              <button
                type="button"
                className={`nav-link ${tab === "morrison" ? "active" : ""}`}
                role="tab"
                aria-selected={tab === "morrison"}
                onClick={() => setTab("morrison")}
              >
                {HOUSE_DISPLAY_LABEL.morrison}
              </button>
            </li>
            <li className="nav-item" role="presentation">
              <button
                type="button"
                className={`nav-link ${tab === "investments" ? "active" : ""}`}
                role="tab"
                aria-selected={tab === "investments"}
                onClick={() => setTab("investments")}
              >
                Investments
              </button>
            </li>
            <li className="nav-item" role="presentation">
              <button
                type="button"
                className={`nav-link ${tab === "savings" ? "active" : ""}`}
                role="tab"
                aria-selected={tab === "savings"}
                onClick={() => setTab("savings")}
              >
                Savings
              </button>
            </li>
            <li className="nav-item" role="presentation">
              <button
                type="button"
                className={`nav-link ${tab === "pension" ? "active" : ""}`}
                role="tab"
                aria-selected={tab === "pension"}
                onClick={() => setTab("pension")}
              >
                Pension
              </button>
            </li>
            <li className="nav-item" role="presentation">
              <button
                type="button"
                className={`nav-link ${tab === "income" ? "active" : ""}`}
                role="tab"
                aria-selected={tab === "income"}
                onClick={() => setTab("income")}
              >
                Income
              </button>
            </li>
            <li className="nav-item" role="presentation">
              <button
                type="button"
                className={`nav-link ${tab === "expenses" ? "active" : ""}`}
                role="tab"
                aria-selected={tab === "expenses"}
                onClick={() => setTab("expenses")}
              >
                Expenses
              </button>
            </li>
            <li className="nav-item" role="presentation">
              <button
                type="button"
                className={`nav-link ${tab === "allocations" ? "active" : ""}`}
                role="tab"
                aria-selected={tab === "allocations"}
                onClick={() => setTab("allocations")}
              >
                Allocations
              </button>
            </li>
          </ul>

          <div className="tab-content">
            {tab === "hillmarton" ? (
              <HouseStatementPanel
                houseKey="hillmarton"
                data={data.hillmarton}
                onPatch={(patch) => patchHouse("hillmarton", patch)}
              />
            ) : null}
            {tab === "morrison" ? (
              <HouseStatementPanel
                houseKey="morrison"
                data={data.morrison}
                onPatch={(patch) => patchHouse("morrison", patch)}
              />
            ) : null}
            {tab === "investments" ? (
              <FinanceInvestmentsPanel
                records={data.investmentRecords}
                onPatch={patchInvestmentRecords}
                relatedHouseOptions={LEDGER_RELATED_HOUSE_OPTIONS}
              />
            ) : null}
            {tab === "savings" ? (
              <FinanceSavingsPanel records={data.savingsRecords} onPatch={patchSavingsRecords} />
            ) : null}
            {tab === "pension" ? (
              <FinancePensionPanel records={data.pensionRecords} onPatch={patchPensionRecords} />
            ) : null}
            {tab === "income" ? (
              <FinanceLedgerSheetPanel
                sheetId="income"
                categories={INCOME_CATEGORIES}
                records={data.incomeRecords}
                onPatch={(patch) => patchLedgerRecords("income", patch)}
                formSectionTitle="Income record"
                tableSectionTitle="Monthly Income"
                deleteConfirmMessage="Delete this income record?"
                emptyMessage="No income records yet."
                relatedHouseOptions={LEDGER_RELATED_HOUSE_OPTIONS}
                incomeFlagFields={INCOME_LEDGER_FLAG_FIELDS}
              />
            ) : null}
            {tab === "expenses" ? (
              <FinanceLedgerSheetPanel
                sheetId="expenses"
                categories={EXPENSE_CATEGORIES}
                records={data.expenseRecords}
                onPatch={(patch) => patchLedgerRecords("expenses", patch)}
                formSectionTitle="Expense record"
                tableSectionTitle="Monthly Expenses"
                deleteConfirmMessage="Delete this expense record?"
                emptyMessage="No expense records yet."
                alphabetizeCategoryDropdown
                relatedHouseOptions={LEDGER_RELATED_HOUSE_OPTIONS}
                expenseIncomeAllocationPercents={data.expenseIncomeAllocationPercents}
                onPatchExpenseIncomeAllocationPercents={patchExpenseIncomeAllocationPercents}
                incomeRecordsForDerivedExpenses={data.incomeRecords}
                expenseFlagFields={EXPENSE_LEDGER_FLAG_FIELDS}
              />
            ) : null}
            {tab === "allocations" ? (
              <FinanceAllocationsPanel
                records={data.allocationRecords}
                onPatch={patchAllocationRecords}
              />
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
