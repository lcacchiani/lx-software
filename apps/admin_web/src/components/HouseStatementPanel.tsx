import { type FormEvent, useMemo, useState } from "react";
import type {
  FinanceLineType,
  HouseFinanceData,
  HouseKey,
  HouseStatementLine,
} from "../lib/financeStorage";
import { newStatementLineId } from "../lib/financeStorage";

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

function formatUtcTable(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

function formatMoney(amount: number, currency: string): string {
  const code =
    currency.length === 3 ? currency.toUpperCase() : "GBP";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
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

export function HouseStatementPanel({
  houseKey,
  houseLabel,
  data,
  onPatch,
}: HouseStatementPanelProps) {
  const [floatAmount, setFloatAmount] = useState(String(data.float.amount));
  const [floatCurrency, setFloatCurrency] = useState(data.float.currency);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [lineForm, setLineForm] = useState<LineFormState>(emptyLineForm);

  const sortedLines = useMemo(() => {
    return [...data.lines].sort((a, b) => {
      const ta = new Date(a.dateUtc).getTime();
      const tb = new Date(b.dateUtc).getTime();
      return tb - ta;
    });
  }, [data.lines]);

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

  function openAdd() {
    setEditingId(null);
    setFormError(null);
    setLineForm(emptyLineForm());
    setModalOpen(true);
  }

  function openEdit(line: HouseStatementLine) {
    setEditingId(line.id);
    setFormError(null);
    setLineForm(lineToForm(line));
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditingId(null);
    setFormError(null);
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

    closeModal();
  }

  function deleteLine(id: string) {
    if (!window.confirm("Delete this statement line?")) return;
    onPatch((prev) => ({
      ...prev,
      lines: prev.lines.filter((l) => l.id !== id),
    }));
  }

  return (
    <div>
      <div className="card shadow-sm mb-4">
        <div className="card-body">
          <h2 className="h6 text-uppercase text-muted mb-3">Float</h2>
          <p className="small text-muted mb-3">
            Cash float held for {houseLabel}. Saved in this browser only.
          </p>
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
            <div className="col-auto">
              <button type="button" className="btn btn-primary btn-sm" onClick={applyFloat}>
                Save float
              </button>
            </div>
          </div>
          <p className="small text-muted mt-2 mb-0">
            Current:{" "}
            <strong>{formatMoney(data.float.amount, data.float.currency)}</strong>
          </p>
        </div>
      </div>

      <div className="d-flex justify-content-between align-items-center mb-2 flex-wrap gap-2">
        <h2 className="h6 text-uppercase text-muted mb-0">House statement</h2>
        <button type="button" className="btn btn-sm btn-outline-primary" onClick={openAdd}>
          Add line
        </button>
      </div>

      <div className="table-responsive card shadow-sm">
        <table className="table table-sm table-striped mb-0 align-middle">
          <thead>
            <tr>
              <th scope="col">Date (UTC)</th>
              <th scope="col">Type</th>
              <th scope="col">Description</th>
              <th scope="col" className="text-end">
                Net
              </th>
              <th scope="col" className="text-end">
                VAT
              </th>
              <th scope="col">Currency</th>
              <th scope="col" className="text-end">
                Gross
              </th>
              <th scope="col" className="text-end">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedLines.length ? (
              sortedLines.map((line) => (
                <tr key={line.id}>
                  <td className="small text-nowrap">{formatUtcTable(line.dateUtc)}</td>
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
                  <td className="small text-end">{line.netAmount.toFixed(2)}</td>
                  <td className="small text-end">{line.vat.toFixed(2)}</td>
                  <td className="small">{line.currency}</td>
                  <td className="small text-end">{line.grossAmount.toFixed(2)}</td>
                  <td className="small text-end text-nowrap">
                    <button
                      type="button"
                      className="btn btn-link btn-sm py-0 px-1"
                      onClick={() => openEdit(line)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn btn-link btn-sm text-danger py-0 px-1"
                      onClick={() => deleteLine(line.id)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={8} className="text-muted text-center py-4">
                  No statement lines yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {modalOpen ? (
        <div
          className="modal fade show d-block"
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          style={{ backgroundColor: "rgba(0,0,0,0.45)" }}
        >
          <div className="modal-dialog modal-lg modal-dialog-scrollable">
            <div className="modal-content">
              <div className="modal-header">
                <h2 className="modal-title h5">
                  {editingId ? "Edit line" : "Add line"}
                </h2>
                <button
                  type="button"
                  className="btn-close"
                  aria-label="Close"
                  onClick={closeModal}
                />
              </div>
              <form onSubmit={submitLine}>
                <div className="modal-body">
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
                </div>
                <div className="modal-footer">
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm"
                    onClick={closeModal}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary btn-sm">
                    {editingId ? "Save changes" : "Add line"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
