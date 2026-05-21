import { useState } from "react";
import type { ExpenseIncomeAllocationPercents } from "../lib/financeModel";
import { AdminEditorSection } from "./ui";

export type FinanceLedgerTaggedIncomeAllocationSectionProps = {
  readonly sheetId: string;
  readonly percents: ExpenseIncomeAllocationPercents;
  readonly onSave: (next: ExpenseIncomeAllocationPercents) => void;
};

export function FinanceLedgerTaggedIncomeAllocationSection({
  sheetId,
  percents,
  onSave,
}: FinanceLedgerTaggedIncomeAllocationSectionProps) {
  const [draft, setDraft] = useState<ExpenseIncomeAllocationPercents>(percents);
  return (
    <AdminEditorSection
      title="Allocation from tagged income"
      footer={
        <button type="button" className="btn btn-primary btn-sm" onClick={() => onSave(draft)}>
          Save allocation rates
        </button>
      }
    >
      <p className="small text-muted mb-3">
        Each rate applies to monthly income on the Income tab using rows marked{" "}
        <strong>Tax</strong>, <strong>Investment</strong>, or <strong>Saving</strong>. Rows with a
        related property use that property; rows without one are grouped as &quot;no related
        property&quot;. Derived expense lines appear in the table below and cannot be edited or
        deleted.
      </p>
      <div className="row g-3">
        <div className="col-md-4">
          <label className="form-label small" htmlFor={`${sheetId}-alloc-tax`}>
            % Tax on Income
          </label>
          <input
            id={`${sheetId}-alloc-tax`}
            type="number"
            min={0}
            max={100}
            step={0.1}
            className="form-control form-control-sm"
            value={draft.taxOnIncomePercent}
            onChange={(ev) => {
              const raw = ev.target.value;
              const n = raw === "" ? 0 : Number.parseFloat(raw);
              setDraft((d) => ({
                ...d,
                taxOnIncomePercent: Number.isFinite(n)
                  ? Math.min(100, Math.max(0, n))
                  : d.taxOnIncomePercent,
              }));
            }}
          />
        </div>
        <div className="col-md-4">
          <label className="form-label small" htmlFor={`${sheetId}-alloc-inv`}>
            % Investments on Income
          </label>
          <input
            id={`${sheetId}-alloc-inv`}
            type="number"
            min={0}
            max={100}
            step={0.1}
            className="form-control form-control-sm"
            value={draft.investmentOnIncomePercent}
            onChange={(ev) => {
              const raw = ev.target.value;
              const n = raw === "" ? 0 : Number.parseFloat(raw);
              setDraft((d) => ({
                ...d,
                investmentOnIncomePercent: Number.isFinite(n)
                  ? Math.min(100, Math.max(0, n))
                  : d.investmentOnIncomePercent,
              }));
            }}
          />
        </div>
        <div className="col-md-4">
          <label className="form-label small" htmlFor={`${sheetId}-alloc-save`}>
            % Savings on Income
          </label>
          <input
            id={`${sheetId}-alloc-save`}
            type="number"
            min={0}
            max={100}
            step={0.1}
            className="form-control form-control-sm"
            value={draft.savingOnIncomePercent}
            onChange={(ev) => {
              const raw = ev.target.value;
              const n = raw === "" ? 0 : Number.parseFloat(raw);
              setDraft((d) => ({
                ...d,
                savingOnIncomePercent: Number.isFinite(n)
                  ? Math.min(100, Math.max(0, n))
                  : d.savingOnIncomePercent,
              }));
            }}
          />
        </div>
      </div>
    </AdminEditorSection>
  );
}
