import { useState } from "react";
import { HouseStatementPanel } from "../components/HouseStatementPanel";
import { useFinance } from "../hooks/useFinance";

type FinanceTab = "hillmarton" | "morrison" | "family";

export function FinancePage() {
  const { data, patchHouse } = useFinance();
  const [tab, setTab] = useState<FinanceTab>("hillmarton");

  return (
    <div>
      <h1 className="h3 mb-3">Finance</h1>
      <p className="text-muted mb-4">
        Local house statements and floats for this browser. Data is stored in{" "}
        <code>localStorage</code> on this device (not synced to the LX API).
      </p>

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
    </div>
  );
}
