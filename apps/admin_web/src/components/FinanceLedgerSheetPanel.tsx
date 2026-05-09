import { type FormEvent, useMemo, useState } from "react";
import {
  coerceSupportedCurrency,
  GLOBAL_DEFAULT_CURRENCY,
} from "../lib/currencies";
import {
  newStatementLineId,
  type FinanceLedgerRecord,
} from "../lib/financeModel";
import {
  AdminDataTable,
  AdminDataTableEmptyRow,
  type AdminDataTableColumn,
  AdminEditorSection,
  CurrencySelect,
  MoneyAmount,
  TableIconButton,
} from "./ui";

function parseAmount(raw: string): number | null {
  const n = Number.parseFloat(raw.trim());
  return Number.isFinite(n) ? n : null;
}

type LineFormState = {
  category: string;
  description: string;
  amount: string;
  currency: string;
};

const TABLE_COLUMNS: AdminDataTableColumn[] = [
  { key: "cat", header: "Category", className: "small" },
  { key: "desc", header: "Description", className: "small" },
  {
    key: "amt",
    header: "Amount",
    className: "small text-end",
    headerClassName: "small text-end",
  },
  { key: "ccy", header: "Currency", className: "small" },
  {
    key: "ops",
    header: <span className="visually-hidden">Operations</span>,
    className: "text-end text-nowrap",
    headerClassName: "text-end",
  },
];

const COL_SPAN = TABLE_COLUMNS.length;

export type FinanceLedgerSheetPanelProps = {
  readonly sheetId: string;
  readonly categories: readonly string[];
  readonly records: readonly FinanceLedgerRecord[];
  readonly onPatch: (
    patch: (prev: readonly FinanceLedgerRecord[]) => FinanceLedgerRecord[],
  ) => void;
  readonly formSectionTitle: string;
  readonly tableSectionTitle: string;
  readonly deleteConfirmMessage: string;
  readonly emptyMessage: string;
  readonly filterPlaceholder?: string;
};

export function FinanceLedgerSheetPanel({
  sheetId,
  categories,
  records,
  onPatch,
  formSectionTitle,
  tableSectionTitle,
  deleteConfirmMessage,
  emptyMessage,
  filterPlaceholder = "Filter records…",
}: FinanceLedgerSheetPanelProps) {
  const formId = `${sheetId}-ledger-form`;
  const defaultCategory = categories[0] ?? "";
  const emptyForm = (): LineFormState => ({
    category: defaultCategory,
    description: "",
    amount: "",
    currency: GLOBAL_DEFAULT_CURRENCY,
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [lineForm, setLineForm] = useState<LineFormState>(() => emptyForm());
  const [tableFilter, setTableFilter] = useState("");

  const filtered = useMemo(() => {
    const q = tableFilter.trim().toLowerCase();
    if (!q) return [...records];
    return records.filter((r) => {
      const hay = [r.category, r.description, r.currency, String(r.amount)]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [records, tableFilter]);

  function resetForm() {
    setEditingId(null);
    setFormError(null);
    setLineForm(emptyForm());
  }

  function openEdit(row: FinanceLedgerRecord) {
    setEditingId(row.id);
    setFormError(null);
    setLineForm({
      category: row.category,
      description: row.description,
      amount: String(row.amount),
      currency: row.currency,
    });
  }

  function submitLine(e: FormEvent) {
    e.preventDefault();
    const amount = parseAmount(lineForm.amount);
    if (!lineForm.description.trim()) {
      setFormError("Description is required.");
      return;
    }
    if (amount === null) {
      setFormError("Amount must be a valid number.");
      return;
    }
    if (!categories.includes(lineForm.category)) {
      setFormError("Pick a valid category.");
      return;
    }
    const currency = coerceSupportedCurrency(lineForm.currency, GLOBAL_DEFAULT_CURRENCY);
    const row: FinanceLedgerRecord = {
      id: editingId ?? newStatementLineId(),
      category: lineForm.category,
      description: lineForm.description.trim(),
      amount,
      currency,
    };

    onPatch((prev) => {
      if (editingId) {
        return prev.map((r) => (r.id === editingId ? row : r));
      }
      return [...prev, row];
    });

    resetForm();
  }

  function deleteRow(id: string) {
    if (!window.confirm(deleteConfirmMessage)) return;
    onPatch((prev) => prev.filter((r) => r.id !== id));
    if (editingId === id) {
      resetForm();
    }
  }

  return (
    <div>
      <AdminEditorSection
        title={formSectionTitle}
        footer={
          <>
            <button type="submit" form={formId} className="btn btn-primary btn-sm">
              {editingId ? "Update record" : "Add record"}
            </button>
            <button type="button" className="btn btn-outline-secondary btn-sm" onClick={resetForm}>
              Clear
            </button>
          </>
        }
      >
        <form id={formId} onSubmit={submitLine}>
          {formError ? (
            <div className="alert alert-danger py-2 small" role="alert">
              {formError}
            </div>
          ) : null}
          <div className="row g-3">
            <div className="col-md-3">
              <label className="form-label small" htmlFor={`${sheetId}-ledger-cat`}>
                Category
              </label>
              <select
                id={`${sheetId}-ledger-cat`}
                className="form-select form-select-sm"
                value={lineForm.category}
                onChange={(ev) =>
                  setLineForm((f) => ({ ...f, category: ev.target.value }))
                }
              >
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-md-5">
              <label className="form-label small" htmlFor={`${sheetId}-ledger-desc`}>
                Description
              </label>
              <input
                id={`${sheetId}-ledger-desc`}
                type="text"
                className="form-control form-control-sm"
                required
                value={lineForm.description}
                onChange={(ev) =>
                  setLineForm((f) => ({ ...f, description: ev.target.value }))
                }
              />
            </div>
            <div className="col-md-2">
              <label className="form-label small" htmlFor={`${sheetId}-ledger-amt`}>
                Amount
              </label>
              <input
                id={`${sheetId}-ledger-amt`}
                type="number"
                step="0.01"
                className="form-control form-control-sm"
                required
                value={lineForm.amount}
                onChange={(ev) =>
                  setLineForm((f) => ({ ...f, amount: ev.target.value }))
                }
              />
            </div>
            <div className="col-md-2">
              <label className="form-label small" htmlFor={`${sheetId}-ledger-ccy`}>
                Currency
              </label>
              <CurrencySelect
                id={`${sheetId}-ledger-ccy`}
                value={lineForm.currency}
                onChange={(code) =>
                  setLineForm((f) => ({ ...f, currency: code }))
                }
              />
            </div>
          </div>
        </form>
      </AdminEditorSection>

      <AdminEditorSection title={tableSectionTitle}>
        <AdminDataTable
          embedded
          columns={TABLE_COLUMNS}
          filterValue={tableFilter}
          onFilterChange={setTableFilter}
          filterPlaceholder={filterPlaceholder}
        >
          {filtered.length ? (
            filtered.map((r) => (
              <tr key={r.id}>
                <td className="small">{r.category}</td>
                <td className="small">{r.description}</td>
                <td className="small text-end">
                  <MoneyAmount amount={r.amount} currency={r.currency} amountOnly />
                </td>
                <td className="small">{r.currency}</td>
                <td className="small text-end">
                  <TableIconButton
                    iconClassName="bi bi-pencil"
                    ariaLabel="Edit record"
                    onClick={() => openEdit(r)}
                  />
                  <TableIconButton
                    iconClassName="bi bi-trash"
                    ariaLabel="Delete record"
                    variant="danger"
                    onClick={() => deleteRow(r.id)}
                  />
                </td>
              </tr>
            ))
          ) : (
            <AdminDataTableEmptyRow
              colSpan={COL_SPAN}
              message={
                records.length ? "No records match the filter." : emptyMessage
              }
            />
          )}
        </AdminDataTable>
      </AdminEditorSection>
    </div>
  );
}
