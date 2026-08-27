import { useState } from "react";
import { FinanceDataLoadOrError, FinanceSaveStatus } from "../components/FinanceDataStatus";
import { FinanceInvestmentsPanel } from "../components/FinanceInvestmentsPanel";
import { FinancePensionPanel, FinanceSavingsPanel } from "../components/FinanceSavingsAndPensionPanels";
import { FinanceAccountsPanel } from "../components/FinanceAccountsPanel";
import { FinanceAllocationsPanel } from "../components/FinanceAllocationsPanel";
import { FinanceLiabilitiesPanel } from "../components/FinanceLiabilitiesPanel";
import { FinanceLedgerSheetPanel } from "../components/FinanceLedgerSheetPanel";
import { HouseStatementPanel } from "../components/HouseStatementPanel";
import { AdminTabList, type AdminTabItem } from "../components/ui";
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
  | "allocations"
  | "accounts"
  | "liabilities";

const FINANCE_TABS: readonly AdminTabItem<FinanceTab>[] = [
  { id: "hillmarton", label: HOUSE_DISPLAY_LABEL.hillmarton },
  { id: "morrison", label: HOUSE_DISPLAY_LABEL.morrison },
  { id: "investments", label: "Investments" },
  { id: "savings", label: "Savings" },
  { id: "pension", label: "Pension" },
  { id: "income", label: "Income" },
  { id: "expenses", label: "Expenses" },
  { id: "allocations", label: "Allocations" },
  { id: "accounts", label: "Accounts" },
  { id: "liabilities", label: "Liabilities" },
];

export function FinancePage() {
  const {
    data,
    patchHouse,
    patchLedgerRecords,
    patchInvestmentRecords,
    patchSavingsRecords,
    patchPensionRecords,
    patchAllocationRecords,
    patchAccountRecords,
    patchLiabilityRecords,
    patchExpenseIncomeAllocationPercents,
    isLoading,
    isError,
    isSaving,
    saveError,
    saveErrorDetail,
  } = useFinance();
  const [tab, setTab] = useState<FinanceTab>("accounts");

  return (
    <div>
      <h1 className="h3 mb-3">Finance</h1>
      <p className="text-muted mb-4">
        House statements, floats, investments, savings, pension, and income and expense ledgers are
        stored in the admin API (DynamoDB). The Allocations tab lists expenses tagged{" "}
        <strong>Allocate</strong>, derived allocation lines from tagged income (both labeled Allocate
        on Expenses), and <strong>custom</strong> allocation rows you add on Allocations. Any row can
        be tagged <strong>Income</strong> so it appears on the Income tab with a monthly amount, or{" "}
        <strong>Pension</strong> so it appears in the Pension tab table (with fund rows). The Accounts
        tab stores bank and card balances with billing cycle metadata. The Liabilities tab tracks
        outstanding balances (e.g. mortgages), optionally linked to a property for equity.
      </p>
      <FinanceDataLoadOrError isLoading={isLoading} isError={isError} />
      {!isLoading && !isError ? (
        <>
          <FinanceSaveStatus
            isSaving={isSaving}
            saveError={saveError}
            saveErrorDetail={saveErrorDetail}
          />

          <AdminTabList tabs={FINANCE_TABS} active={tab} onChange={setTab} />

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
              <FinancePensionPanel
                records={data.pensionRecords}
                onPatch={patchPensionRecords}
                allocationRecords={data.allocationRecords}
              />
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
                allocationRecordsForSyntheticIncome={data.allocationRecords}
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
            {tab === "accounts" ? (
              <FinanceAccountsPanel records={data.accountRecords} onPatch={patchAccountRecords} />
            ) : null}
            {tab === "liabilities" ? (
              <FinanceLiabilitiesPanel
                records={data.liabilityRecords}
                onPatch={patchLiabilityRecords}
                relatedHouseOptions={LEDGER_RELATED_HOUSE_OPTIONS}
              />
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
