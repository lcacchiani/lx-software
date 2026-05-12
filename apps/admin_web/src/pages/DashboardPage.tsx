import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FinanceDataLoadOrError } from "../components/FinanceDataStatus";
import { AllocationCoverageDashboardCard } from "../components/dashboard/AllocationCoverageDashboardCard";
import { DashboardApiHealthCard } from "../components/dashboard/DashboardApiHealthCard";
import { DashboardSessionCard } from "../components/dashboard/DashboardSessionCard";
import { HouseSummaryCard } from "../components/dashboard/HouseSummaryCard";
import { MonthlyViewExpenseAllocationsSection } from "../components/dashboard/MonthlyViewExpenseAllocationsSection";
import { AvailableBalanceDashboardCard } from "../components/dashboard/AvailableBalanceDashboardCard";
import { PensionDashboardCard } from "../components/dashboard/PensionDashboardCard";
import { adminFetchJson } from "../lib/apiAdminClient";
import { useFinance } from "../hooks/useFinance";
import { defaultFiscalYearIdForNowUtc, type FiscalYearId } from "../lib/fiscalYearFinance";
import { HOUSE_DISPLAY_LABEL } from "../lib/houses";

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

      <FinanceDataLoadOrError
        isLoading={financeQuery.isLoading}
        isError={financeQuery.isError}
        loadErrorMessage="Could not load finance data for summaries. Check API configuration and sign-in."
      />
      {!financeQuery.isLoading && !financeQuery.isError ? (
        <>
          <div className="row g-3 mb-3">
            <div className="col-md-6">
              <HouseSummaryCard
                houseName={HOUSE_DISPLAY_LABEL.hillmarton}
                houseKey="hillmarton"
                fiscalYear={hillmartonFy}
                onFiscalYearChange={setHillmartonFy}
              />
            </div>
            <div className="col-md-6">
              <HouseSummaryCard
                houseName={HOUSE_DISPLAY_LABEL.morrison}
                houseKey="morrison"
                fiscalYear={morrisonFy}
                onFiscalYearChange={setMorrisonFy}
              />
            </div>
          </div>
          <MonthlyViewExpenseAllocationsSection />
          <div className="row g-3 mb-4">
            <div className="col-12 col-lg-6 d-flex flex-column gap-3">
              <PensionDashboardCard />
              <AvailableBalanceDashboardCard />
            </div>
            <div className="col-12 col-lg-6">
              <AllocationCoverageDashboardCard />
            </div>
          </div>
        </>
      ) : null}

      <DashboardApiHealthCard
        isLoading={healthQuery.isLoading}
        isError={healthQuery.isError}
        status={healthQuery.data?.status}
      />
      <DashboardSessionCard
        isLoading={meQuery.isLoading}
        isError={meQuery.isError}
        sub={meQuery.data?.sub}
        email={meQuery.data?.email}
      />
    </div>
  );
}
