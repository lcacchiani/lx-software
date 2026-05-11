import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { adminFetchJson } from "../lib/apiAdminClient";
import { useFinance } from "../hooks/useFinance";
import {
  defaultFiscalYearIdForNowUtc,
  FISCAL_YEAR_OPTIONS,
  formatFiscalYearIdLabel,
  type FiscalYearId,
  fiscalYearIdToStartCalendarYear,
  sumHouseStatementLinesForFiscalYear,
} from "../lib/fiscalYearFinance";
import type { HouseKey } from "../lib/financeModel";
import { MoneyAmount } from "../components/ui";

function sortedCurrencyEntries(record: Readonly<Record<string, number>>): [string, number][] {
  return Object.entries(record)
    .filter(([, amount]) => amount !== 0)
    .sort(([a], [b]) => a.localeCompare(b));
}

function FiscalBucketList({
  buckets,
  emptyLabel,
}: {
  readonly buckets: Readonly<Record<string, number>>;
  readonly emptyLabel: string;
}) {
  const entries = sortedCurrencyEntries(buckets);
  if (entries.length === 0) {
    return <span className="text-muted">{emptyLabel}</span>;
  }
  return (
    <ul className="list-unstyled mb-0 small">
      {entries.map(([currency, amount]) => (
        <li key={currency}>
          <MoneyAmount amount={amount} currency={currency} />
        </li>
      ))}
    </ul>
  );
}

function HouseFiscalSummaryCard({
  title,
  houseKey,
  fiscalYear,
  onFiscalYearChange,
}: {
  readonly title: string;
  readonly houseKey: HouseKey;
  readonly fiscalYear: FiscalYearId;
  readonly onFiscalYearChange: (id: FiscalYearId) => void;
}) {
  const { data } = useFinance();
  const house = data[houseKey];
  const sums = useMemo(
    () =>
      sumHouseStatementLinesForFiscalYear(
        house.lines,
        fiscalYearIdToStartCalendarYear(fiscalYear),
      ),
    [house.lines, fiscalYear],
  );

  const fyLabel = formatFiscalYearIdLabel(fiscalYear);

  return (
    <div className="card h-100 shadow-sm">
      <div className="card-body d-flex flex-column">
        <h2 className="h6 mb-3">{title}</h2>
        <div className="mb-3">
          <select
            className="form-select form-select-sm"
            value={fiscalYear}
            onChange={(e) => onFiscalYearChange(e.target.value as FiscalYearId)}
            aria-label={`${title}: ${fyLabel}`}
          >
            {FISCAL_YEAR_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <dl className="row small mb-0 flex-grow-1">
          <dt className="col-sm-4 text-muted">Income</dt>
          <dd className="col-sm-8">
            <FiscalBucketList buckets={sums.incomeByCurrency} emptyLabel="—" />
          </dd>
          <dt className="col-sm-4 text-muted pt-2">Expenses</dt>
          <dd className="col-sm-8 pt-2">
            <FiscalBucketList buckets={sums.expensesByCurrency} emptyLabel="—" />
          </dd>
        </dl>
        <p className="text-muted small mb-0 mt-3">
          Totals use net amounts from house statement lines in this period.
        </p>
      </div>
    </div>
  );
}

export function DashboardPage() {
  const healthQuery = useQuery({
    queryKey: ["admin", "health"],
    queryFn: () =>
      adminFetchJson<{ status?: string }>("/health", { requireAuth: false }),
  });

  const meQuery = useQuery({
    queryKey: ["admin", "me"],
    queryFn: () =>
      adminFetchJson<{ sub?: string; email?: string }>("/me"),
  });

  const [hillmartonFy, setHillmartonFy] = useState<FiscalYearId>(() =>
    defaultFiscalYearIdForNowUtc(),
  );
  const [morrisonFy, setMorrisonFy] = useState<FiscalYearId>(() =>
    defaultFiscalYearIdForNowUtc(),
  );

  const financeQuery = useFinance();

  return (
    <div>
      <h1 className="h3 mb-3">Dashboard</h1>
      <p className="text-muted">
        Welcome to the LX Software admin console. Use the sidebar to manage assets
        and records.
      </p>

      <h2 className="h6 text-uppercase text-muted mt-4 mb-3">House fiscal summaries</h2>
      {financeQuery.isLoading ? (
        <p className="text-muted small mb-3">Loading finance data…</p>
      ) : financeQuery.isError ? (
        <div className="alert alert-danger py-2 small mb-3" role="alert">
          Could not load finance data for summaries. Check API configuration and sign-in.
        </div>
      ) : (
        <div className="row g-3 mb-4">
          <div className="col-md-6">
            <HouseFiscalSummaryCard
              title="32 Hillmarton"
              houseKey="hillmarton"
              fiscalYear={hillmartonFy}
              onFiscalYearChange={setHillmartonFy}
            />
          </div>
          <div className="col-md-6">
            <HouseFiscalSummaryCard
              title="The Morrison"
              houseKey="morrison"
              fiscalYear={morrisonFy}
              onFiscalYearChange={setMorrisonFy}
            />
          </div>
        </div>
      )}

      <div className="card mt-4 shadow-sm">
        <div className="card-body">
          <h2 className="h6 text-uppercase text-muted">API health</h2>
          {healthQuery.isLoading ? (
            <p className="mb-0 small text-muted">Checking /health…</p>
          ) : healthQuery.isError ? (
            <p className="mb-0 small text-danger">Health check failed.</p>
          ) : (
            <p className="mb-0 small">
              <code>/health</code>:{" "}
              <span className="text-success">{healthQuery.data?.status ?? "ok"}</span>
            </p>
          )}
        </div>
      </div>
      <div className="card mt-3 shadow-sm">
        <div className="card-body">
          <h2 className="h6 text-uppercase text-muted">Session</h2>
          {meQuery.isLoading ? (
            <p className="mb-0 small text-muted">Loading profile…</p>
          ) : meQuery.isError ? (
            <p className="mb-0 small text-danger">
              Could not load profile. Check API configuration and sign-in.
            </p>
          ) : (
            <dl className="row small mb-0">
              <dt className="col-sm-3">Subject</dt>
              <dd className="col-sm-9">{meQuery.data?.sub ?? "—"}</dd>
              <dt className="col-sm-3">Email</dt>
              <dd className="col-sm-9">{meQuery.data?.email ?? "—"}</dd>
            </dl>
          )}
        </div>
      </div>
    </div>
  );
}
