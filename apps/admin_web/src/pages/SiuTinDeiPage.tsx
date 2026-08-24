import { useState } from "react";
import { FinanceDataLoadOrError, FinanceSaveStatus } from "../components/FinanceDataStatus";
import { HouseStatementPanel } from "../components/HouseStatementPanel";
import { SiuTinDeiDashboardCard } from "../components/SiuTinDeiDashboardCard";
import { useSiuTinDei } from "../hooks/useSiuTinDei";
import { defaultFiscalYearIdForNowUtc, type FiscalYearId } from "../lib/fiscalYearFinance";
import { SIU_TIN_DEI_BOOK_KEY } from "../lib/statementOwners";

type SiuTinDeiTab = "dashboard" | "expenses" | "gains";

export function SiuTinDeiPage() {
  const {
    data,
    patchBook,
    isLoading,
    isError,
    isSaving,
    saveError,
    saveErrorDetail,
  } = useSiuTinDei();
  const [tab, setTab] = useState<SiuTinDeiTab>("dashboard");
  const [fiscalYear, setFiscalYear] = useState<FiscalYearId>(() =>
    defaultFiscalYearIdForNowUtc(),
  );

  return (
    <div>
      <h1 className="h3 mb-3">Siu Tin Dei</h1>
      <p className="text-muted mb-4">
        Record invoices and receipts for Siu Tin Dei. Upload a PDF or image to
        extract lines, or add a row by hand. Expenses and gains are stored
        separately; imports on each tab keep only that tab&apos;s line type.
        Default currency is HKD.
      </p>
      <FinanceDataLoadOrError
        isLoading={isLoading}
        isError={isError}
        loadErrorMessage="Could not load Siu Tin Dei records. Check API configuration and sign-in."
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
              <SiuTinDeiDashboardCard
                data={data}
                fiscalYear={fiscalYear}
                onFiscalYearChange={setFiscalYear}
              />
            ) : null}
            {tab === "expenses" ? (
              <HouseStatementPanel
                houseKey={SIU_TIN_DEI_BOOK_KEY}
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
                houseKey={SIU_TIN_DEI_BOOK_KEY}
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
