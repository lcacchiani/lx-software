import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  coerceSupportedCurrency,
  type CurrencyCode,
} from "../lib/currencies";
import { AdminApiError, fetchAssetDownloadUrl } from "../lib/apiAdminClient";
import {
  newStatementLineId,
  type FinanceLineType,
  type HouseFinanceData,
  type HouseKey,
  type HouseStatementLine,
} from "../lib/financeModel";
import { formatDateUtc } from "../lib/formatDisplay";
import {
  existingImportedStatementBasenames,
  useParseStatement,
} from "../hooks/useParseStatement";
import { uploadFinanceAsset } from "../lib/uploadFinanceAsset";
import {
  AdminDataTable,
  AdminDataTableEmptyRow,
  type AdminDataTableColumn,
  AdminEditorSection,
  CurrencySelect,
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

function basenameFromAssetKey(key: string): string {
  const parts = key.trim().split("/");
  return parts[parts.length - 1] || key.trim();
}

/** Opens PDFs using the shared download-url helper (popup + loading state from Finance main). */
function StatementPdfLaunchButton({
  assetKey,
  openingPdfKey,
  onOpen,
}: {
  readonly assetKey: string;
  readonly openingPdfKey: string | null;
  readonly onOpen: (key: string) => void;
}) {
  const busy = openingPdfKey === assetKey;
  return (
    <button
      type="button"
      className="badge text-bg-light border align-middle btn btn-sm lh-base"
      title={`Open statement PDF (${basenameFromAssetKey(assetKey)})`}
      aria-label="Open statement PDF for this line"
      disabled={busy}
      onClick={() => onOpen(assetKey)}
    >
      {busy ? (
        <span
          className="spinner-border spinner-border-sm"
          role="status"
          aria-hidden="true"
        />
      ) : (
        <>
          <i className="bi bi-file-earmark-pdf me-1" aria-hidden="true" />
          PDF
        </>
      )}
    </button>
  );
}

function emptyLineForm(defaultCurrency: CurrencyCode): LineFormState {
  const datePart = new Date().toISOString().slice(0, 10);
  return {
    datePart,
    timePart: "00:00",
    type: "expenditure",
    description: "",
    netAmount: "",
    vat: "",
    grossAmount: "",
    currency: defaultCurrency,
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
  readonly data: HouseFinanceData;
  readonly onPatch: (patch: (prev: HouseFinanceData) => HouseFinanceData) => void;
};

const TABLE_COLUMNS: AdminDataTableColumn[] = [
  { key: "when", header: "Date (UTC)", className: "small" },
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
  data,
  onPatch,
}: HouseStatementPanelProps) {
  const lineFormId = `${houseKey}-line-form`;
  const [floatAmount, setFloatAmount] = useState(String(data.float.amount));
  const [floatCurrency, setFloatCurrency] = useState(() =>
    coerceSupportedCurrency(data.float.currency, data.defaultCurrency),
  );
  const [houseDefaultDraft, setHouseDefaultDraft] = useState(data.defaultCurrency);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [lineForm, setLineForm] = useState<LineFormState>(() =>
    emptyLineForm(data.defaultCurrency),
  );
  const [tableFilter, setTableFilter] = useState("");

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const linePdfInputRef = useRef<HTMLInputElement | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [parseSuccess, setParseSuccess] = useState<string | null>(null);
  const [openingPdfKey, setOpeningPdfKey] = useState<string | null>(null);
  const parseStatement = useParseStatement(houseKey);
  const queryClient = useQueryClient();

  const [linePdfFile, setLinePdfFile] = useState<File | null>(null);
  const [stripLinePdf, setStripLinePdf] = useState(false);
  const [lineSubmitBusy, setLineSubmitBusy] = useState(false);

  useEffect(() => {
    queueMicrotask(() => {
      setFloatAmount(String(data.float.amount));
      setFloatCurrency(
        coerceSupportedCurrency(data.float.currency, data.defaultCurrency),
      );
      setHouseDefaultDraft(data.defaultCurrency);
    });
  }, [data.float.amount, data.float.currency, data.defaultCurrency]);

  useEffect(() => {
    if (editingId !== null) return;
    queueMicrotask(() => {
      setLineForm((f) => ({ ...f, currency: data.defaultCurrency }));
    });
  }, [data.defaultCurrency, editingId]);

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
        line.dateUtc.slice(0, 10),
        formatDateUtc(line.dateUtc),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [sortedLines, tableFilter]);

  const editingLine =
    editingId === null ? undefined : data.lines.find((l) => l.id === editingId);
  const showExistingAttachment =
    Boolean(editingLine?.sourceAssetKey) && !stripLinePdf;

  function applyHouseDetails() {
    const amt = parseAmount(floatAmount);
    if (amt === null) {
      return;
    }
    const nextDefault = coerceSupportedCurrency(
      houseDefaultDraft,
      data.defaultCurrency,
    );
    const floatCur = coerceSupportedCurrency(floatCurrency, nextDefault);
    onPatch((prev) => ({
      ...prev,
      defaultCurrency: nextDefault,
      float: { amount: amt, currency: floatCur },
    }));
    setHouseDefaultDraft(nextDefault);
    setFloatAmount(String(amt));
    setFloatCurrency(floatCur);
  }

  function resetLineForm() {
    setEditingId(null);
    setFormError(null);
    setLineForm(emptyLineForm(data.defaultCurrency));
    setLinePdfFile(null);
    setStripLinePdf(false);
    if (linePdfInputRef.current) {
      linePdfInputRef.current.value = "";
    }
  }

  function openEdit(line: HouseStatementLine) {
    setEditingId(line.id);
    setFormError(null);
    setLineForm(lineToForm(line));
    setLinePdfFile(null);
    setStripLinePdf(false);
    if (linePdfInputRef.current) {
      linePdfInputRef.current.value = "";
    }
  }

  async function submitLine(e: FormEvent) {
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
    const currency = coerceSupportedCurrency(lineForm.currency, data.defaultCurrency);
    const dateUtc = isoFromUtcParts(lineForm.datePart, lineForm.timePart);

    let sourceAssetKey: string | undefined;
    if (stripLinePdf) {
      sourceAssetKey = undefined;
    } else if (linePdfFile) {
      const basenames = existingImportedStatementBasenames(
        data,
        editingId ?? undefined,
      );
      if (basenames.has(linePdfFile.name)) {
        setFormError(
          `A statement file named "${linePdfFile.name}" is already linked to another line for this house. Remove it from that line or rename the file.`,
        );
        return;
      }
      setLineSubmitBusy(true);
      setFormError(null);
      try {
        sourceAssetKey = await uploadFinanceAsset(
          linePdfFile,
          houseKey,
          queryClient,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setFormError(msg || "Could not upload the PDF.");
        return;
      } finally {
        setLineSubmitBusy(false);
      }
    } else if (editingId) {
      const existing = data.lines.find((l) => l.id === editingId);
      sourceAssetKey = existing?.sourceAssetKey;
    }

    const row: HouseStatementLine = {
      id: editingId ?? newStatementLineId(),
      dateUtc,
      type: lineForm.type,
      description: lineForm.description.trim(),
      netAmount: net,
      vat,
      currency,
      grossAmount: gross,
      ...(sourceAssetKey ? { sourceAssetKey } : {}),
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

  function openStatementPdf(assetKey: string) {
    const tab = window.open("", "_blank", "noopener,noreferrer");
    if (!tab) {
      window.alert(
        "Your browser blocked the new tab. Allow popups for this site to open PDFs.",
      );
      return;
    }
    setOpeningPdfKey(assetKey);
    void fetchAssetDownloadUrl(assetKey)
      .then((url) => {
        tab.location.href = url;
      })
      .catch((err) => {
        tab.close();
        const msg =
          err instanceof AdminApiError
            ? err.responseBody || err.message
            : err instanceof Error
              ? err.message
              : "Could not open the PDF.";
        window.alert(msg);
      })
      .finally(() => {
        setOpeningPdfKey(null);
      });
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
        title="House details"
        footer={
          <button type="button" className="btn btn-primary btn-sm" onClick={applyHouseDetails}>
            Save
          </button>
        }
      >
        <div className="row g-2 align-items-end flex-wrap">
          <div className="col-auto" style={{ minWidth: "6.5rem" }}>
            <label className="form-label small mb-0" htmlFor={`${houseKey}-house-default-ccy`}>
              Default currency
            </label>
            <CurrencySelect
              id={`${houseKey}-house-default-ccy`}
              value={houseDefaultDraft}
              onChange={(code) => {
                const next = coerceSupportedCurrency(code, data.defaultCurrency);
                setHouseDefaultDraft((prevDraft) => {
                  setFloatCurrency((fc) => (fc === prevDraft ? next : fc));
                  return next;
                });
              }}
              className="form-select form-select-sm"
            />
          </div>
        </div>
        <div className="row g-2 align-items-end flex-wrap mt-2">
          <div className="col-auto">
            <label className="form-label small mb-0" htmlFor={`float-amt-${houseKey}`}>
              Float amount
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
          <div className="col-auto" style={{ minWidth: "6.5rem" }}>
            <label className="form-label small mb-0" htmlFor={`float-cur-${houseKey}`}>
              Float currency
            </label>
            <CurrencySelect
              id={`float-cur-${houseKey}`}
              value={floatCurrency}
              onChange={(code) => setFloatCurrency(code)}
              className="form-select form-select-sm"
            />
          </div>
        </div>
      </AdminEditorSection>

      <AdminEditorSection
        title="Import statement (PDF)"
        description="Upload a statement PDF (or image). The file is stored under Assets and the contents are sent to OpenRouter to extract each transaction as a new statement line."
        footer={
          <>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!pdfFile || parseStatement.isPending}
              onClick={() => {
                if (!pdfFile) return;
                setParseSuccess(null);
                parseStatement.mutate(pdfFile, {
                  onSuccess: (res) => {
                    setParseSuccess(
                      res.addedLines === 0
                        ? "No transactions were extracted from this document."
                        : `Imported ${res.addedLines} statement line${res.addedLines === 1 ? "" : "s"}.`,
                    );
                    setPdfFile(null);
                    if (fileInputRef.current) {
                      fileInputRef.current.value = "";
                    }
                  },
                });
              }}
            >
              {parseStatement.isPending ? "Parsing…" : "Upload & parse"}
            </button>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              disabled={parseStatement.isPending}
              onClick={() => {
                setPdfFile(null);
                setParseSuccess(null);
                if (fileInputRef.current) {
                  fileInputRef.current.value = "";
                }
              }}
            >
              Clear
            </button>
          </>
        }
      >
        <div className="row g-2 align-items-end">
          <div className="col-md-8">
            <label
              className="form-label small mb-0"
              htmlFor={`${houseKey}-statement-pdf`}
            >
              Statement file
            </label>
            <input
              id={`${houseKey}-statement-pdf`}
              ref={fileInputRef}
              type="file"
              accept="application/pdf,image/*"
              className="form-control form-control-sm"
              disabled={parseStatement.isPending}
              onChange={(ev) => {
                const next = ev.target.files?.[0] ?? null;
                setPdfFile(next);
                setParseSuccess(null);
              }}
            />
          </div>
        </div>
        {parseStatement.isPending ? (
          <p className="small text-muted mt-2 mb-0">
            Uploading and parsing — this can take 20–40 seconds for multi-page PDFs.
          </p>
        ) : null}
        {parseStatement.isError ? (
          <div
            className="alert alert-danger py-2 small mt-3 mb-0"
            role="alert"
          >
            {parseStatement.error?.message ?? "Statement import failed."}
          </div>
        ) : null}
        {parseSuccess && !parseStatement.isPending ? (
          <div
            className="alert alert-success py-2 small mt-3 mb-0"
            role="status"
          >
            {parseSuccess}
          </div>
        ) : null}
      </AdminEditorSection>

      <AdminEditorSection
        title="Statement line"
        footer={
          <>
            <button
              type="submit"
              form={lineFormId}
              className="btn btn-primary btn-sm"
              disabled={lineSubmitBusy}
            >
              {lineSubmitBusy ? "Uploading…" : editingId ? "Update line" : "Add line"}
            </button>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              disabled={lineSubmitBusy}
              onClick={resetLineForm}
            >
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
            <div className="col-3">
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
            <div className="col-3">
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
            <div className="col-6">
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
            <div className="col-3">
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
            <div className="col-3">
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
            <div className="col-3">
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
            <div className="col-3">
              <label className="form-label small" htmlFor={`${houseKey}-fin-cur`}>
                Currency
              </label>
              <CurrencySelect
                id={`${houseKey}-fin-cur`}
                value={lineForm.currency}
                onChange={(code) =>
                  setLineForm((f) => ({ ...f, currency: code }))
                }
              />
            </div>
            <div className="col-12">
              <label className="form-label small mb-1" htmlFor={`${houseKey}-line-pdf`}>
                Statement PDF{" "}
                <span className="text-muted fw-normal">(optional)</span>
              </label>
              <input
                id={`${houseKey}-line-pdf`}
                ref={linePdfInputRef}
                type="file"
                accept="application/pdf"
                className="form-control form-control-sm"
                disabled={lineSubmitBusy}
                onChange={(ev) => {
                  const next = ev.target.files?.[0] ?? null;
                  setLinePdfFile(next);
                  setStripLinePdf(false);
                  setFormError(null);
                }}
              />
              {showExistingAttachment && editingLine?.sourceAssetKey ? (
                <div className="small mt-2 d-flex flex-wrap align-items-center gap-2">
                  <span className="text-muted">Attached:</span>
                  <span className="fw-medium text-break">
                    {basenameFromAssetKey(editingLine.sourceAssetKey)}
                  </span>
                  <StatementPdfLaunchButton
                    assetKey={editingLine.sourceAssetKey}
                    openingPdfKey={openingPdfKey}
                    onOpen={openStatementPdf}
                  />
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm py-0"
                    disabled={lineSubmitBusy}
                    onClick={() => {
                      setStripLinePdf(true);
                      setLinePdfFile(null);
                      if (linePdfInputRef.current) {
                        linePdfInputRef.current.value = "";
                      }
                    }}
                  >
                    Remove attachment
                  </button>
                </div>
              ) : null}
              {stripLinePdf && editingId ? (
                <p className="small text-muted mb-0 mt-2">
                  The PDF attachment will be removed when you save this line.
                </p>
              ) : null}
            </div>
          </div>
        </form>
      </AdminEditorSection>

      <AdminEditorSection title="House statement">
        <AdminDataTable
          embedded
          columns={TABLE_COLUMNS}
          filterValue={tableFilter}
          onFilterChange={setTableFilter}
          filterPlaceholder="Filter lines…"
        >
          {filteredLines.length ? (
            filteredLines.map((line) => (
              <tr key={line.id}>
                <td className="small text-nowrap">
                  {formatDateUtc(line.dateUtc)}
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
                <td className="small">
                  <div className="d-flex flex-wrap align-items-center gap-2">
                    <span>{line.description}</span>
                    {line.sourceAssetKey ? (
                      <>
                        <StatementPdfLaunchButton
                          assetKey={line.sourceAssetKey}
                          openingPdfKey={openingPdfKey}
                          onOpen={openStatementPdf}
                        />
                        <span
                          className="text-muted small text-truncate"
                          style={{ maxWidth: "12rem" }}
                          title={basenameFromAssetKey(line.sourceAssetKey)}
                        >
                          {basenameFromAssetKey(line.sourceAssetKey)}
                        </span>
                      </>
                    ) : null}
                  </div>
                </td>
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
      </AdminEditorSection>
    </div>
  );
}
