import { Fragment, type ReactNode, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { adminFetchJson } from "../lib/apiAdminClient";
import { useFrankfurterRatesToBase } from "../hooks/useFrankfurterRatesToBase";
import { useFinance } from "../hooks/useFinance";
import { GLOBAL_DEFAULT_CURRENCY } from "../lib/currencies";
import { convertAmountToBase } from "../lib/frankfurterRates";
import {
  defaultFiscalYearIdForNowUtc,
  FISCAL_YEAR_OPTIONS,
  formatFiscalYearIdLabel,
  type FiscalYearId,
  fiscalYearIdToStartCalendarYear,
  sumHouseStatementLinesForFiscalYear,
} from "../lib/fiscalYearFinance";
import {
  EXPENSE_CATEGORIES,
  monthlyLedgerNetByCurrency,
  sumMonthlyFinanceLedgerAmountsByHouse,
  sumMonthlyFinanceLedgerAmountsGeneral,
  sumMonthlyGeneralExpenseAmountsByCategory,
  type HouseKey,
} from "../lib/financeModel";
import { MoneyAmount } from "../components/ui";

const LEDGER_RELATED_HOUSE_OPTIONS: ReadonlyArray<{
  readonly value: HouseKey;
  readonly label: string;
}> = [
  { value: "hillmarton", label: "32 Hillmarton" },
  { value: "morrison", label: "The Morrison" },
];

function formatExpensePercentOfIncome(percent: number): string {
  const rounded = Math.round(percent * 10) / 10;
  if (Number.isInteger(rounded)) {
    return `${rounded}%`;
  }
  return `${rounded.toFixed(1)}%`;
}

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

function MonthlyNetByCurrencyList({
  netByCurrency,
  emptyLabel,
}: {
  readonly netByCurrency: Readonly<Record<string, number>>;
  readonly emptyLabel: string;
}) {
  const currencies = Object.keys(netByCurrency).sort((a, b) => a.localeCompare(b));
  const currency = currencies[0];
  if (!currency) {
    return <span className="text-muted">{emptyLabel}</span>;
  }
  const amount = netByCurrency[currency] ?? 0;
  return (
    <ul className="list-unstyled mb-0 small">
      <li className={amount >= 0 ? "text-success" : "text-danger"}>
        <MoneyAmount amount={amount} currency={currency} />
      </li>
    </ul>
  );
}

function HouseSummaryCard({
  houseName,
  houseKey,
  fiscalYear,
  onFiscalYearChange,
}: {
  readonly houseName: string;
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

  const monthlySums = useMemo(
    () =>
      sumMonthlyFinanceLedgerAmountsByHouse(
        data.incomeRecords,
        data.expenseRecords,
        houseKey,
        data.expenseIncomeAllocationPercents,
      ),
    [
      data.expenseIncomeAllocationPercents,
      data.expenseRecords,
      data.incomeRecords,
      houseKey,
    ],
  );

  const monthlyNetByCurrency = useMemo(
    () => monthlyLedgerNetByCurrency(monthlySums),
    [monthlySums],
  );

  const fyLabel = formatFiscalYearIdLabel(fiscalYear);

  return (
    <div className="card h-100 shadow-sm">
      <div className="card-body d-flex flex-column">
        <h2 className="h6 mb-3">
          <strong>{houseName}</strong>
        </h2>
        <div className="mb-3">
          <select
            className="form-select form-select-sm"
            value={fiscalYear}
            onChange={(e) => onFiscalYearChange(e.target.value as FiscalYearId)}
            aria-label={`${houseName}: ${fyLabel}`}
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
        <hr className="my-3" />
        <p className="small text-muted mb-2">Monthly income and expenses</p>
        <dl className="row small mb-0">
          <dt className="col-sm-4 text-muted">Income</dt>
          <dd className="col-sm-8">
            <FiscalBucketList buckets={monthlySums.incomeByCurrency} emptyLabel="—" />
          </dd>
          <dt className="col-sm-4 text-muted pt-2">Expenses</dt>
          <dd className="col-sm-8 pt-2">
            <FiscalBucketList buckets={monthlySums.expensesByCurrency} emptyLabel="—" />
          </dd>
          <dt className="col-sm-4 text-muted pt-2">Net</dt>
          <dd className="col-sm-8 pt-2">
            <MonthlyNetByCurrencyList netByCurrency={monthlyNetByCurrency} emptyLabel="—" />
          </dd>
        </dl>
      </div>
    </div>
  );
}

function GeneralSummaryCard() {
  const { data } = useFinance();
  const generalBuckets = useMemo(
    () =>
      sumMonthlyFinanceLedgerAmountsGeneral(
        data.incomeRecords,
        data.expenseRecords,
        data.expenseIncomeAllocationPercents,
        LEDGER_RELATED_HOUSE_OPTIONS,
      ),
    [
      data.expenseIncomeAllocationPercents,
      data.expenseRecords,
      data.incomeRecords,
    ],
  );

  const hasActivity = useMemo(() => {
    for (const v of Object.values(generalBuckets.incomeByCurrency)) {
      if (v !== 0) return true;
    }
    for (const v of Object.values(generalBuckets.expensesByCurrency)) {
      if (v !== 0) return true;
    }
    return false;
  }, [generalBuckets]);

  const quoteCurrencies = useMemo(() => {
    const s = new Set<string>();
    for (const [ccy, amt] of Object.entries(generalBuckets.incomeByCurrency)) {
      if (amt !== 0) s.add(ccy);
    }
    for (const [ccy, amt] of Object.entries(generalBuckets.expensesByCurrency)) {
      if (amt !== 0) s.add(ccy);
    }
    return [...s];
  }, [generalBuckets]);

  const needsFx = useMemo(
    () =>
      quoteCurrencies.some(
        (c) => c.trim().toUpperCase() !== GLOBAL_DEFAULT_CURRENCY,
      ),
    [quoteCurrencies],
  );

  const ratesQuery = useFrankfurterRatesToBase(GLOBAL_DEFAULT_CURRENCY, quoteCurrencies);

  const convertedHkd = useMemo(() => {
    if (!hasActivity) {
      return { status: "empty" as const };
    }
    let rateByQuote: ReadonlyMap<string, number> = new Map();
    if (needsFx) {
      if (ratesQuery.isPending) {
        return { status: "loading" as const };
      }
      if (ratesQuery.isError) {
        return { status: "error" as const };
      }
      if (!ratesQuery.isSuccess || !ratesQuery.data) {
        return { status: "loading" as const };
      }
      rateByQuote = ratesQuery.data.rateByQuote;
    }
    try {
      const sumBucket = (rec: Readonly<Record<string, number>>): number =>
        Object.entries(rec).reduce(
          (sum, [ccy, amt]) =>
            amt === 0
              ? sum
              : sum +
                convertAmountToBase(amt, ccy, GLOBAL_DEFAULT_CURRENCY, rateByQuote),
          0,
        );
      const income = sumBucket(generalBuckets.incomeByCurrency);
      const expenses = sumBucket(generalBuckets.expensesByCurrency);
      const expenseByCategory = sumMonthlyGeneralExpenseAmountsByCategory(
        data.incomeRecords,
        data.expenseRecords,
        data.expenseIncomeAllocationPercents,
        LEDGER_RELATED_HOUSE_OPTIONS,
      );
      const categoryPercentsSorted = EXPENSE_CATEGORIES.map((category) => {
        const buckets: Readonly<Record<string, number>> = expenseByCategory[category] ?? {};
        const amountHkd = sumBucket(buckets);
        const percent = income > 0 ? (amountHkd / income) * 100 : 0;
        return { category, amountHkd, percent };
      }).sort((a, b) => {
        if (b.percent !== a.percent) {
          return b.percent - a.percent;
        }
        return a.category.localeCompare(b.category, undefined, { sensitivity: "base" });
      });
      return {
        status: "ok" as const,
        income,
        expenses,
        net: income - expenses,
        categoryPercentsSorted,
      };
    } catch {
      return { status: "fx-missing" as const };
    }
  }, [
    data.expenseIncomeAllocationPercents,
    data.expenseRecords,
    data.incomeRecords,
    generalBuckets.expensesByCurrency,
    generalBuckets.incomeByCurrency,
    hasActivity,
    needsFx,
    ratesQuery.data,
    ratesQuery.isError,
    ratesQuery.isPending,
    ratesQuery.isSuccess,
  ]);

  function generalHkdValue(
    c: typeof convertedHkd,
    kind: "income" | "expenses" | "net",
  ): ReactNode {
    if (c.status === "empty") {
      return <span className="text-muted">—</span>;
    }
    if (c.status === "loading") {
      return <span className="text-muted">Loading rates…</span>;
    }
    if (c.status === "error") {
      return <span className="text-danger">Could not load exchange rates.</span>;
    }
    if (c.status === "fx-missing") {
      return <span className="text-danger">Missing FX rate for a currency.</span>;
    }
    const amt = kind === "income" ? c.income : kind === "expenses" ? c.expenses : c.net;
    if (kind === "net") {
      return (
        <span className={amt >= 0 ? "text-success" : "text-danger"}>
          <MoneyAmount amount={amt} currency={GLOBAL_DEFAULT_CURRENCY} />
        </span>
      );
    }
    return <MoneyAmount amount={amt} currency={GLOBAL_DEFAULT_CURRENCY} />;
  }

  function generalCategoryPercentPanel(c: typeof convertedHkd): ReactNode {
    if (c.status === "empty") {
      return <span className="text-muted">—</span>;
    }
    if (c.status === "loading") {
      return <span className="text-muted">Loading rates…</span>;
    }
    if (c.status === "error") {
      return <span className="text-danger">Could not load exchange rates.</span>;
    }
    if (c.status === "fx-missing") {
      return <span className="text-danger">Missing FX rate for a currency.</span>;
    }
    if (c.income <= 0) {
      return (
        <p className="text-muted small mb-0">
          General income is zero in {GLOBAL_DEFAULT_CURRENCY}, so category shares of income
          are not shown.
        </p>
      );
    }
    return (
      <dl className="row small mb-0">
        {c.categoryPercentsSorted.map(({ category, percent }, idx) => (
          <Fragment key={category}>
            <dt
              className={
                idx > 0 ? "col-sm-4 text-muted pt-2" : "col-sm-4 text-muted"
              }
            >
              {category}
            </dt>
            <dd className={idx > 0 ? "col-sm-8 pt-2" : "col-sm-8"}>
              {formatExpensePercentOfIncome(percent)}
            </dd>
          </Fragment>
        ))}
      </dl>
    );
  }

  return (
    <div className="card h-100 shadow-sm">
      <div className="card-body d-flex flex-column">
        <h2 className="h6 mb-3">
          <strong>General</strong>
        </h2>
        <div className="d-flex flex-column flex-lg-row gap-3 flex-grow-1">
          <div className="flex-grow-1 flex-lg-shrink-0" style={{ flexBasis: "min(100%, 20rem)" }}>
            <p className="text-muted small mb-3">
              Monthly income and expenses not linked to any property (including
              derived tax, saving, and investment amounts from tagged income with no
              related property), summed in {GLOBAL_DEFAULT_CURRENCY}.
            </p>
            <dl className="row small mb-0">
              <dt className="col-sm-4 text-muted">Income</dt>
              <dd className="col-sm-8">{generalHkdValue(convertedHkd, "income")}</dd>
              <dt className="col-sm-4 text-muted pt-2">Expenses</dt>
              <dd className="col-sm-8 pt-2">{generalHkdValue(convertedHkd, "expenses")}</dd>
              <dt className="col-sm-4 text-muted pt-2">Net</dt>
              <dd className="col-sm-8 pt-2">{generalHkdValue(convertedHkd, "net")}</dd>
            </dl>
          </div>
          <div className="vr text-muted opacity-50 d-none d-lg-block align-self-stretch flex-shrink-0" />
          <div className="flex-grow-1">
            <p className="small text-muted mb-2">
              Expense categories as a share of general income (highest first).
            </p>
            {generalCategoryPercentPanel(convertedHkd)}
          </div>
        </div>
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

      {financeQuery.isLoading ? (
        <p className="text-muted small mb-3">Loading finance data…</p>
      ) : financeQuery.isError ? (
        <div className="alert alert-danger py-2 small mb-3" role="alert">
          Could not load finance data for summaries. Check API configuration and sign-in.
        </div>
      ) : (
        <>
          <div className="row g-3 mb-3">
            <div className="col-md-6">
              <HouseSummaryCard
                houseName="32 Hillmarton"
                houseKey="hillmarton"
                fiscalYear={hillmartonFy}
                onFiscalYearChange={setHillmartonFy}
              />
            </div>
            <div className="col-md-6">
              <HouseSummaryCard
                houseName="The Morrison"
                houseKey="morrison"
                fiscalYear={morrisonFy}
                onFiscalYearChange={setMorrisonFy}
              />
            </div>
          </div>
          <div className="row g-3 mb-4">
            <div className="col-12">
              <GeneralSummaryCard />
            </div>
          </div>
        </>
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
