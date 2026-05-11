import { useState } from "react";
import { FinanceInvestmentsPanel } from "../components/FinanceInvestmentsPanel";
import { FinancePensionPanel, FinanceSavingsPanel } from "../components/FinanceSavingsAndPensionPanels";
import { FinanceLedgerSheetPanel } from "../components/FinanceLedgerSheetPanel";
import { HouseStatementPanel } from "../components/HouseStatementPanel";
import { useFinance } from "../hooks/useFinance";
import {
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  INCOME_LEDGER_FLAG_FIELDS,
  type HouseKey,
} from "../lib/financeModel";

type FinanceTab =
  | "hillmarton"
  | "morrison"
  | "investments"
  | "savings"
  | "pension"
  | "income"
  | "expenses";

const LEDGER_RELATED_HOUSE_OPTIONS: ReadonlyArray<{
  readonly value: HouseKey;
  readonly label: string;
}> = [
  { value: "hillmarton", label: "32 Hillmarton" },
  { value: "morrison", label: "The Morrison" },
];

export function FinancePage() {
  const {
    data,
    patchHouse,
    patchLedgerRecords,
    patchInvestmentRecords,
    patchSavingsRecords,
    patchPensionRecords,
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
        stored in the admin API (DynamoDB).
      </p>
      {isLoading ? (
        <p className="text-muted small mb-3">Loading finance data…</p>
      ) : isError ? (
        <div className="alert alert-danger py-2 small mb-3" role="alert">
          Could not load finance data. Check API configuration and sign-in.
        </div>
      ) : (
        <>
          {saveError ? (
            <div className="alert alert-warning py-2 small mb-3" role="alert">
              <span className="fw-semibold">Could not save changes.</span>{" "}
              {saveErrorDetail ?? "Try again or refresh the page."}
            </div>
          ) : null}
          {isSaving ? (
            <p className="text-muted small mb-3">Saving…</p>
          ) : null}

          <ul className="nav nav-tabs mb-4" role="tablist">
            <li className="nav-item" role="presentation">
              <button
                type="button"
                className={`nav-link ${tab === "hillmarton" ? "active" : ""}`}
                role="tab"
                aria-selected={tab === "hillmarton"}
                onClick={() => setTab("hillmarton")}
              >
                32 Hillmarton
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
                The Morrison
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
              />
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
