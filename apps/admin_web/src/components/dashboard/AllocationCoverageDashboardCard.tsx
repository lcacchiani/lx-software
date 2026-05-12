import { type ReactNode } from "react";
import { FrankfurterRatesFooterNote, MoneyAmount } from "../ui";
import { useAllocationCoverageDashboardSheet } from "../../hooks/useAllocationCoverageDashboardSheet";
import { GLOBAL_DEFAULT_CURRENCY } from "../../lib/currencies";

export function AllocationCoverageDashboardCard() {
  const base = GLOBAL_DEFAULT_CURRENCY;
  const {
    sortedAllocations,
    sheet,
    needsFx,
    fxLoading,
    fxError,
    ratesQuery,
  } = useAllocationCoverageDashboardSheet();

  function loadingOrErrorMessage(s: typeof sheet): ReactNode {
    if (s.status === "loading") {
      return s.stage === "quotes" ? (
        <span className="text-muted">Loading investment quotes…</span>
      ) : (
        <span className="text-muted">Loading exchange rates…</span>
      );
    }
    if (s.status === "error") {
      return s.stage === "quotes" ? (
        <span className="text-danger">Could not load investment quotes.</span>
      ) : (
        <span className="text-danger">Could not load exchange rates.</span>
      );
    }
    if (s.status === "fx-missing") {
      return <span className="text-danger">Missing FX rate for a currency.</span>;
    }
    return null;
  }

  return (
    <div className="card h-100 shadow-sm">
      <div className="card-body d-flex flex-column">
        <h2 className="h6 mb-3">
          <strong>Allocation Coverage</strong>
        </h2>
        <p className="text-muted small mb-3">
          Allocation rows (same as the Finance Allocations tab) compared to liquid investments, all
          savings deposits, and bank account current balances.
        </p>

        {sheet.status === "empty" ? (
          <p className="text-muted small mb-0">No allocation or coverage data yet.</p>
        ) : (
          <>
            <div className="table-responsive mb-3" style={{ maxHeight: "calc(14rem * 1.3)" }}>
              <table className="table table-sm table-striped mb-0">
                <thead>
                  <tr>
                    <th className="small">Description</th>
                    <th className="small text-end">Accumulated</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedAllocations.length === 0 ? (
                    <tr>
                      <td colSpan={2} className="small text-muted">
                        No allocation rows.
                      </td>
                    </tr>
                  ) : sheet.status === "ok" ? (
                    sheet.allocationRows.map((row) => (
                      <tr key={row.key}>
                        <td className="small">{row.description}</td>
                        <td className="small text-end text-nowrap">
                          <MoneyAmount amount={row.hkd} currency={base} />
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={2} className="small">
                        {loadingOrErrorMessage(sheet)}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <dl className="row small mb-2">
              <dt className="col-sm-5 text-muted">Coverage</dt>
              <dd className="col-sm-7 text-end mb-0">
                {sheet.status === "ok" ? (
                  <MoneyAmount amount={sheet.coverage} currency={base} />
                ) : (
                  loadingOrErrorMessage(sheet)
                )}
              </dd>
              <dt className="col-sm-5 text-muted pt-2">Allocations</dt>
              <dd className="col-sm-7 text-end pt-2 mb-0">
                {sheet.status === "ok" ? (
                  <MoneyAmount amount={sheet.allocationsSum} currency={base} />
                ) : (
                  loadingOrErrorMessage(sheet)
                )}
              </dd>
              <dt className="col-sm-5 text-muted pt-2">Net</dt>
              <dd className="col-sm-7 text-end pt-2 mb-0">
                {sheet.status === "ok" ? (
                  <span className={sheet.diff >= 0 ? "text-success" : "text-danger"}>
                    <MoneyAmount amount={sheet.diff} currency={base} />
                  </span>
                ) : (
                  loadingOrErrorMessage(sheet)
                )}
              </dd>
            </dl>
            {needsFx ? (
              <p className="small text-muted mb-0">
                <FrankfurterRatesFooterNote
                  needsFx={needsFx}
                  fxError={fxError}
                  fxLoading={fxLoading}
                  ratesQuery={ratesQuery}
                />
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
