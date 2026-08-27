import { useState } from "react";
import { FinanceDataLoadOrError, FinanceSaveStatus } from "../components/FinanceDataStatus";
import { HouseStatementPanel } from "../components/HouseStatementPanel";
import { StatementBookDashboardCard } from "../components/StatementBookDashboardCard";
import { useStatementBook } from "../hooks/useStatementBook";
import { defaultFiscalYearIdForNowUtc, type FiscalYearId } from "../lib/fiscalYearFinance";
import { STATEMENT_BOOK_DISPLAY_LABEL } from "../lib/statementOwners";
import type { StatementBookKey } from "../lib/financeTypes";

type StatementBookTab = "dashboard" | "expenses" | "gains";

export function StatementBookPage({
  bookKey,
}: {
  readonly bookKey: StatementBookKey;
}) {
  const title = STATEMENT_BOOK_DISPLAY_LABEL[bookKey];
  const {
    data,
    patchBook,
    isLoading,
    isError,
    isSaving,
    saveError,
    saveErrorDetail,
  } = useStatementBook(bookKey);
  const [tab, setTab] = useState<StatementBookTab>("dashboard");
  const [fiscalYear, setFiscalYear] = useState<FiscalYearId>(() =>
    defaultFiscalYearIdForNowUtc(),
  );

  return (
    <div>
      <h1 className="h3 mb-3">{title}</h1>
      <p className="text-muted mb-4">
        Record invoices and receipts for {title}. Upload a PDF or image to
        extract lines, or add a row by hand. Expenses and gains are stored
        separately; imports on each tab keep only that tab&apos;s line type.
        Default currency is HKD.
      </p>
      <FinanceDataLoadOrError
        isLoading={isLoading}
        isError={isError}
        loadErrorMessage={`Could not load ${title} records. Check API configuration and sign-in.`}
      />
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
                className={`nav-link ${tab === "dashboard" ? "active" : ""}`}
                role="tab"
                aria-selected={tab === "dashboard"}
                onClick={() => setTab("dashboard")}
              >
                Dashboard
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
                className={`nav-link ${tab === "gains" ? "active" : ""}`}
                role="tab"
                aria-selected={tab === "gains"}
                onClick={() => setTab("gains")}
              >
                Gains
              </button>
            </li>
          </ul>

          <div className="tab-content">
            {tab === "dashboard" ? (
              <StatementBookDashboardCard
                title={title}
                data={data}
                fiscalYear={fiscalYear}
                onFiscalYearChange={setFiscalYear}
              />
            ) : null}
            {tab === "expenses" ? (
              <HouseStatementPanel
                houseKey={bookKey}
                data={data}
                onPatch={patchBook}
                lockedLineType="expenditure"
                showHouseDetails={false}
                showMortgageImport={false}
                importTitle="Import invoice (PDF)"
                importDescription="Upload an invoice PDF or image. The file is stored under Assets and OpenRouter extracts expense lines only."
                importFileLabel="Invoice file"
                lineSectionTitle="Expense"
                tableSectionTitle="Expenses"
                emptyMessage="No expenses yet."
              />
            ) : null}
            {tab === "gains" ? (
              <HouseStatementPanel
                houseKey={bookKey}
                data={data}
                onPatch={patchBook}
                lockedLineType="income"
                showHouseDetails={false}
                showMortgageImport={false}
                importTitle="Import invoice (PDF)"
                importDescription="Upload a receipt or invoice PDF or image. The file is stored under Assets and OpenRouter extracts gain lines only."
                importFileLabel="Invoice file"
                lineSectionTitle="Gain"
                tableSectionTitle="Gains"
                emptyMessage="No gains yet."
              />
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
