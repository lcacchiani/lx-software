import { useState } from "react";
import { HouseStatementPanel } from "../components/HouseStatementPanel";
import { useFinance } from "../hooks/useFinance";

type FinanceTab = "hillmarton" | "morrison" | "family";

export function FinancePage() {
  const { data, patchHouse, isLoading, isError, isSaving, saveError } =
    useFinance();
  const [tab, setTab] = useState<FinanceTab>("hillmarton");

  return (
    <div>
      <h1 className="h3 mb-3">Finance</h1>
      <p className="text-muted mb-4">
        House statements and floats are stored in the admin API (DynamoDB).
      </p>
      {isLoading ? (
        <p className="text-muted small mb-3">Loading finance data…</p>
      ) : isError ? (
        <div className="alert alert-danger py-2 small mb-3" role="alert">
          Could not load finance data. Check API configuration and sign-in.
        </div>
      ) : (
        <>
          {saveError ? (
            <div className="alert alert-warning py-2 small mb-3" role="alert">
              Could not save changes. Try again or refresh the page.
            </div>
          ) : null}
          {isSaving ? (
            <p className="text-muted small mb-3">Saving…</p>
          ) : null}

          <ul className="nav nav-tabs mb-4" role="tablist">
            <li className="nav-item" role="presentation">
              <button
                type="button"
                className={`nav-link ${tab === "hillmarton" ? "active" : ""}`}
                role="tab"
                aria-selected={tab === "hillmarton"}
                onClick={() => setTab("hillmarton")}
              >
                32 Hillmarton
              </button>
            </li>
            <li className="nav-item" role="presentation">
              <button
                type="button"
                className={`nav-link ${tab === "morrison" ? "active" : ""}`}
                role="tab"
                aria-selected={tab === "morrison"}
                onClick={() => setTab("morrison")}
              >
                The Morrison
              </button>
            </li>
            <li className="nav-item" role="presentation">
              <button
                type="button"
                className={`nav-link ${tab === "family" ? "active" : ""}`}
                role="tab"
                aria-selected={tab === "family"}
                onClick={() => setTab("family")}
              >
                Family
              </button>
            </li>
          </ul>

          <div className="tab-content">
            {tab === "hillmarton" ? (
              <HouseStatementPanel
                houseKey="hillmarton"
                houseLabel="32 Hillmarton"
                data={data.hillmarton}
                onPatch={(patch) => patchHouse("hillmarton", patch)}
              />
            ) : null}
            {tab === "morrison" ? (
              <HouseStatementPanel
                houseKey="morrison"
                houseLabel="The Morrison"
                data={data.morrison}
                onPatch={(patch) => patchHouse("morrison", patch)}
              />
            ) : null}
            {tab === "family" ? (
              <div className="card shadow-sm">
                <div className="card-body">
                  <h2 className="h6 text-uppercase text-muted">Family</h2>
                  <p className="mb-0 text-muted">
                    No finance worksheet is configured for this tab yet. Use{" "}
                    <strong>32 Hillmarton</strong> and <strong>The Morrison</strong> for house
                    statements and floats.
                  </p>
                </div>
              </div>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
