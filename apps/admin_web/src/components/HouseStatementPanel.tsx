import { type FormEvent, useMemo, useState } from "react";
import {
  newStatementLineId,
  type FinanceLineType,
  type HouseFinanceData,
  type HouseKey,
  type HouseStatementLine,
} from "../lib/financeModel";
import { formatDateTimeHKT } from "../lib/formatDisplay";
import {
  AdminDataTable,
  AdminDataTableEmptyRow,
  type AdminDataTableColumn,
  AdminEditorSection,
  DateTimeDisplay,
  MoneyAmount,
  TableIconButton,
} from "./ui";

function utcPartsFromIso(iso: string): { datePart: string; timePart: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    const now = new Date();
    return {
      datePart: now.toISOString().slice(0, 10),
      timePart: now.toISOString().slice(11, 16),
    };
  }
  return {
    datePart: d.toISOString().slice(0, 10),
    timePart: d.toISOString().slice(11, 16),
  };
}

function isoFromUtcParts(datePart: string, timePart: string): string {
  const t = timePart.length >= 5 ? timePart.slice(0, 5) : "00:00";
  return `${datePart}T${t}:00.000Z`;
}

function emptyLineForm(): LineFormState {
  const { datePart, timePart } = utcPartsFromIso(new Date().toISOString());
  return {
    datePart,
    timePart,
    type: "expenditure",
    description: "",
    netAmount: "",
    vat: "",
    grossAmount: "",
    currency: "GBP",
  };
}

type LineFormState = {
  datePart: string;
  timePart: string;
  type: FinanceLineType;
  description: string;
  netAmount: string;
  vat: string;
  grossAmount: string;
  currency: string;
};

function lineToForm(line: HouseStatementLine): LineFormState {
  const { datePart, timePart } = utcPartsFromIso(line.dateUtc);
  return {
    datePart,
    timePart,
    type: line.type,
    description: line.description,
    netAmount: String(line.netAmount),
    vat: String(line.vat),
    grossAmount: String(line.grossAmount),
    currency: line.currency,
  };
}

function parseAmount(raw: string): number | null {
  const n = Number.parseFloat(raw.trim());
  return Number.isFinite(n) ? n : null;
}

export type HouseStatementPanelProps = {
  readonly houseKey: HouseKey;
  readonly houseLabel: string;
  readonly data: HouseFinanceData;
  readonly onPatch: (patch: (prev: HouseFinanceData) => HouseFinanceData) => void;
};

const TABLE_COLUMNS: AdminDataTableColumn[] = [
  { key: "when", header: "Date & time (HKT)", className: "small" },
  { key: "type", header: "Type", className: "small" },
  { key: "desc", header: "Description", className: "small" },
  {
    key: "net",
    header: "Net",
    className: "small text-end",
    headerClassName: "small text-end",
  },
  {
    key: "vat",
    header: "VAT",
    className: "small text-end",
    headerClassName: "small text-end",
  },
  { key: "ccy", header: "Currency", className: "small" },
  {
    key: "gross",
    header: "Gross",
    className: "small text-end",
    headerClassName: "small text-end",
  },
  {
    key: "ops",
    header: <span className="visually-hidden">Operations</span>,
    className: "text-end text-nowrap",
    headerClassName: "text-end",
  },
];

const COL_SPAN = TABLE_COLUMNS.length;

export function HouseStatementPanel({
  houseKey,
  houseLabel,
  data,
  onPatch,
}: HouseStatementPanelProps) {
  const lineFormId = `${houseKey}-line-form`;
  const [floatAmount, setFloatAmount] = useState(String(data.float.amount));
  const [floatCurrency, setFloatCurrency] = useState(data.float.currency);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [lineForm, setLineForm] = useState<LineFormState>(emptyLineForm);
  const [tableFilter, setTableFilter] = useState("");

  const sortedLines = useMemo(() => {
    return [...data.lines].sort((a, b) => {
      const ta = new Date(a.dateUtc).getTime();
      const tb = new Date(b.dateUtc).getTime();
      return tb - ta;
    });
  }, [data.lines]);

  const filteredLines = useMemo(() => {
    const q = tableFilter.trim().toLowerCase();
    if (!q) return sortedLines;
    return sortedLines.filter((line) => {
      const hay = [
        line.description,
        line.type,
        line.currency,
        String(line.netAmount),
        String(line.vat),
        String(line.grossAmount),
        formatDateTimeHKT(line.dateUtc),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [sortedLines, tableFilter]);

  function applyFloat() {
    const amt = parseAmount(floatAmount);
    const cur = floatCurrency.trim().toUpperCase().slice(0, 3) || "GBP";
    if (amt === null) {
      return;
    }
    onPatch((prev) => ({
      ...prev,
      float: { amount: amt, currency: cur },
    }));
    setFloatAmount(String(amt));
    setFloatCurrency(cur);
  }

  function resetLineForm() {
    setEditingId(null);
    setFormError(null);
    setLineForm(emptyLineForm());
  }

  function openEdit(line: HouseStatementLine) {
    setEditingId(line.id);
    setFormError(null);
    setLineForm(lineToForm(line));
  }

  function submitLine(e: FormEvent) {
    e.preventDefault();
    const net = parseAmount(lineForm.netAmount);
    const vat = parseAmount(lineForm.vat);
    const gross = parseAmount(lineForm.grossAmount);
    if (!lineForm.description.trim()) {
      setFormError("Description is required.");
      return;
    }
    if (net === null || vat === null || gross === null) {
      setFormError("Net, VAT, and gross must be valid numbers.");
      return;
    }
    const currency =
      lineForm.currency.trim().toUpperCase().slice(0, 3) || "GBP";
    const dateUtc = isoFromUtcParts(lineForm.datePart, lineForm.timePart);

    const row: HouseStatementLine = {
      id: editingId ?? newStatementLineId(),
      dateUtc,
      type: lineForm.type,
      description: lineForm.description.trim(),
      netAmount: net,
      vat,
      currency,
      grossAmount: gross,
    };

    onPatch((prev) => {
      if (editingId) {
        return {
          ...prev,
          lines: prev.lines.map((l) => (l.id === editingId ? row : l)),
        };
      }
      return {
        ...prev,
        lines: [...prev.lines, row],
      };
    });

    resetLineForm();
  }

  function deleteLine(id: string) {
    if (!window.confirm("Delete this statement line?")) return;
    onPatch((prev) => ({
      ...prev,
      lines: prev.lines.filter((l) => l.id !== id),
    }));
    if (editingId === id) {
      resetLineForm();
    }
  }

  return (
    <div>
      <AdminEditorSection
        title="Float"
        description={`Cash float held for ${houseLabel}. Stored via the admin API.`}
        footer={
          <button type="button" className="btn btn-primary btn-sm" onClick={applyFloat}>
            Save float
          </button>
        }
      >
        <div className="row g-2 align-items-end flex-wrap">
          <div className="col-auto">
            <label className="form-label small mb-0" htmlFor={`float-amt-${houseKey}`}>
              Amount
            </label>
            <input
              id={`float-amt-${houseKey}`}
              type="number"
              className="form-control form-control-sm"
              step="0.01"
              value={floatAmount}
              onChange={(ev) => setFloatAmount(ev.target.value)}
            />
          </div>
          <div className="col-auto">
            <label className="form-label small mb-0" htmlFor={`float-cur-${houseKey}`}>
              Currency
            </label>
            <input
              id={`float-cur-${houseKey}`}
              type="text"
              className="form-control form-control-sm text-uppercase"
              maxLength={3}
              style={{ width: "5rem" }}
              value={floatCurrency}
              onChange={(ev) => setFloatCurrency(ev.target.value)}
            />
          </div>
        </div>
        <p className="small text-muted mt-3 mb-0">
          Current:{" "}
          <strong>
            <MoneyAmount amount={data.float.amount} currency={data.float.currency} />
          </strong>
        </p>
      </AdminEditorSection>

      <AdminEditorSection
        title="Statement line"
        description='Enter or edit UTC date and time below (stored as ISO UTC). Use “Clear” to discard and start a new line.'
        footer={
          <>
            <button type="submit" form={lineFormId} className="btn btn-primary btn-sm">
              {editingId ? "Update line" : "Add line"}
            </button>
            <button type="button" className="btn btn-outline-secondary btn-sm" onClick={resetLineForm}>
              Clear
            </button>
          </>
        }
      >
        <form id={lineFormId} onSubmit={submitLine}>
          {formError ? (
            <div className="alert alert-danger py-2 small" role="alert">
              {formError}
            </div>
          ) : null}
          <div className="row g-3">
            <div className="col-md-6">
              <label className="form-label small" htmlFor={`${houseKey}-fin-date-utc`}>
                Date (UTC)
              </label>
              <input
                id={`${houseKey}-fin-date-utc`}
                type="date"
                className="form-control form-control-sm"
                required
                value={lineForm.datePart}
                onChange={(ev) =>
                  setLineForm((f) => ({ ...f, datePart: ev.target.value }))
                }
              />
            </div>
            <div className="col-md-6">
              <label className="form-label small" htmlFor={`${houseKey}-fin-time-utc`}>
                Time (UTC)
              </label>
              <input
                id={`${houseKey}-fin-time-utc`}
                type="time"
                step={60}
                className="form-control form-control-sm"
                required
                value={lineForm.timePart}
                onChange={(ev) =>
                  setLineForm((f) => ({ ...f, timePart: ev.target.value }))
                }
              />
            </div>
            <div className="col-12">
              <label className="form-label small" htmlFor={`${houseKey}-fin-type`}>
                Type
              </label>
              <select
                id={`${houseKey}-fin-type`}
                className="form-select form-select-sm"
                value={lineForm.type}
                onChange={(ev) =>
                  setLineForm((f) => ({
                    ...f,
                    type: ev.target.value as FinanceLineType,
                  }))
                }
              >
                <option value="income">Income</option>
                <option value="expenditure">Expenditure</option>
              </select>
            </div>
            <div className="col-12">
              <label className="form-label small" htmlFor={`${houseKey}-fin-desc`}>
                Description
              </label>
              <input
                id={`${houseKey}-fin-desc`}
                type="text"
                className="form-control form-control-sm"
                required
                value={lineForm.description}
                onChange={(ev) =>
                  setLineForm((f) => ({ ...f, description: ev.target.value }))
                }
              />
            </div>
            <div className="col-md-4">
              <label className="form-label small" htmlFor={`${houseKey}-fin-net`}>
                Net amount
              </label>
              <input
                id={`${houseKey}-fin-net`}
                type="number"
                step="0.01"
                className="form-control form-control-sm"
                required
                value={lineForm.netAmount}
                onChange={(ev) =>
                  setLineForm((f) => ({ ...f, netAmount: ev.target.value }))
                }
              />
            </div>
            <div className="col-md-4">
              <label className="form-label small" htmlFor={`${houseKey}-fin-vat`}>
                VAT
              </label>
              <input
                id={`${houseKey}-fin-vat`}
                type="number"
                step="0.01"
                className="form-control form-control-sm"
                required
                value={lineForm.vat}
                onChange={(ev) =>
                  setLineForm((f) => ({ ...f, vat: ev.target.value }))
                }
              />
            </div>
            <div className="col-md-4">
              <label className="form-label small" htmlFor={`${houseKey}-fin-gross`}>
                Gross amount
              </label>
              <input
                id={`${houseKey}-fin-gross`}
                type="number"
                step="0.01"
                className="form-control form-control-sm"
                required
                value={lineForm.grossAmount}
                onChange={(ev) =>
                  setLineForm((f) => ({ ...f, grossAmount: ev.target.value }))
                }
              />
            </div>
            <div className="col-md-4">
              <label className="form-label small" htmlFor={`${houseKey}-fin-cur`}>
                Currency (ISO)
              </label>
              <input
                id={`${houseKey}-fin-cur`}
                type="text"
                className="form-control form-control-sm text-uppercase"
                maxLength={3}
                required
                value={lineForm.currency}
                onChange={(ev) =>
                  setLineForm((f) => ({ ...f, currency: ev.target.value }))
                }
              />
            </div>
          </div>
        </form>
      </AdminEditorSection>

      <h2 className="h6 text-uppercase text-muted mb-2">House statement</h2>
      <AdminDataTable
        columns={TABLE_COLUMNS}
        filterValue={tableFilter}
        onFilterChange={setTableFilter}
        filterPlaceholder="Filter lines…"
      >
        {filteredLines.length ? (
          filteredLines.map((line) => (
            <tr key={line.id}>
              <td className="small">
                <DateTimeDisplay iso={line.dateUtc} />
              </td>
              <td className="small">
                <span
                  className={
                    line.type === "income" ? "text-success" : "text-danger"
                  }
                >
                  {line.type === "income" ? "Income" : "Expenditure"}
                </span>
              </td>
              <td className="small">{line.description}</td>
              <td className="small text-end">
                <MoneyAmount amount={line.netAmount} currency={line.currency} />
              </td>
              <td className="small text-end">
                <MoneyAmount amount={line.vat} currency={line.currency} />
              </td>
              <td className="small">{line.currency}</td>
              <td className="small text-end">
                <MoneyAmount amount={line.grossAmount} currency={line.currency} />
              </td>
              <td className="small text-end">
                <TableIconButton
                  iconClassName="bi bi-pencil"
                  ariaLabel="Edit line"
                  onClick={() => openEdit(line)}
                />
                <TableIconButton
                  iconClassName="bi bi-trash"
                  ariaLabel="Delete line"
                  variant="danger"
                  onClick={() => deleteLine(line.id)}
                />
              </td>
            </tr>
          ))
        ) : (
          <AdminDataTableEmptyRow
            colSpan={COL_SPAN}
            message={
              sortedLines.length ? "No lines match the filter." : "No statement lines yet."
            }
          />
        )}
      </AdminDataTable>
    </div>
  );
}
