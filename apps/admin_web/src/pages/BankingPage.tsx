import { useMemo, useState } from "react";
import {
  AdminDataTable,
  AdminDataTableCellMeta,
  AdminDataTableEmptyRow,
  adminColumnPriorityClass,
  AdminEditorSection,
  DateTimeDisplay,
  MoneyAmount,
  TableIconButton,
} from "../components/ui";
import { useBankOptions, useBankSync } from "../hooks/useBankSync";
import { useFinance } from "../hooks/useFinance";
import { getAdminApiErrorMessage } from "../lib/apiAdminClient";
import {
  BANK_CONNECT_COUNTRIES,
  bankAccountLabel,
  type BankSyncAccount,
  type BankSyncMapping,
  type BankSyncSession,
} from "../lib/bankSyncModel";

function errorText(err: unknown, fallback: string): string {
  return getAdminApiErrorMessage(err) ?? fallback;
}

type LinkedAccountRow = {
  readonly session: BankSyncSession;
  readonly account: BankSyncAccount;
};

export function BankingPage() {
  const {
    state,
    isLoading,
    isError,
    error,
    startAuth,
    saveMappings,
    syncNow,
    deleteSession,
  } = useBankSync();
  const { data: financeData } = useFinance();

  const [country, setCountry] = useState("GB");
  const [bankName, setBankName] = useState("");
  const banksQuery = useBankOptions(country);

  const [sessionFilter, setSessionFilter] = useState("");
  // null = no local edits; otherwise uid -> accounts-sheet record id ("" = unmapped).
  const [mappingDraft, setMappingDraft] = useState<Record<string, string> | null>(
    null,
  );

  const sessions = useMemo(() => state?.sessions ?? [], [state]);
  const mappings = useMemo(() => state?.mappings ?? [], [state]);
  const lastSync = state?.lastSync ?? null;

  const linkedAccounts: readonly LinkedAccountRow[] = useMemo(
    () =>
      sessions.flatMap((session) =>
        session.accounts.map((account) => ({ session, account })),
      ),
    [sessions],
  );

  const savedMappingByUid = useMemo(() => {
    const out: Record<string, string> = {};
    for (const m of mappings) out[m.accountUid] = m.accountRecordId;
    return out;
  }, [mappings]);

  const draftValue = (uid: string): string =>
    mappingDraft?.[uid] ?? savedMappingByUid[uid] ?? "";

  const hasMappingChanges = useMemo(() => {
    if (mappingDraft === null) return false;
    return linkedAccounts.some(
      ({ account }) =>
        (mappingDraft[account.uid] ?? savedMappingByUid[account.uid] ?? "") !==
        (savedMappingByUid[account.uid] ?? ""),
    );
  }, [mappingDraft, linkedAccounts, savedMappingByUid]);

  const filteredSessions = useMemo(() => {
    const needle = sessionFilter.trim().toLowerCase();
    if (!needle) return sessions;
    return sessions.filter((s) =>
      `${s.bankName} ${s.bankCountry}`.toLowerCase().includes(needle),
    );
  }, [sessions, sessionFilter]);

  const recordLabelById = useMemo(() => {
    const out: Record<string, string> = {};
    for (const rec of financeData.accountRecords) {
      out[rec.id] = `${rec.description} (${rec.currency})`;
    }
    return out;
  }, [financeData.accountRecords]);

  const onConnect = () => {
    if (!bankName) return;
    startAuth.mutate(
      { bankName, country },
      {
        onSuccess: ({ url }) => {
          window.location.assign(url);
        },
      },
    );
  };

  const onSaveMappings = () => {
    const next: BankSyncMapping[] = [];
    for (const { account } of linkedAccounts) {
      const recordId = draftValue(account.uid);
      if (recordId) {
        next.push({ accountUid: account.uid, accountRecordId: recordId });
      }
    }
    saveMappings.mutate(next, { onSuccess: () => setMappingDraft(null) });
  };

  const onDeleteSession = (session: BankSyncSession) => {
    const ok = window.confirm(
      `Disconnect ${session.bankName}? Its account mappings are removed and the bank consent is closed.`,
    );
    if (ok) deleteSession.mutate(session.sessionId);
  };

  if (isLoading) {
    return <p className="text-muted">Loading bank connections…</p>;
  }

  if (isError) {
    return (
      <div className="alert alert-danger" role="alert">
        Could not load bank connections: {errorText(error, "request failed")}
      </div>
    );
  }

  return (
    <div>
      <div className="d-flex align-items-center justify-content-between mb-3 flex-wrap gap-2">
        <h1 className="h4 mb-0">Banking</h1>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => syncNow.mutate()}
          disabled={!state?.enabled || syncNow.isPending || mappings.length === 0}
        >
          {syncNow.isPending ? "Syncing…" : "Sync now"}
        </button>
      </div>
      <p className="text-muted small">
        Link bank accounts through Enable Banking (open banking / PSD2) and
        refresh the Finance → Accounts sheet from live balances. A scheduled
        sync also runs daily.
      </p>

      {state && !state.enabled ? (
        <div className="alert alert-warning" role="alert">
          Bank sync is not configured on the backend. Register an Enable
          Banking application with the stack's signing key and deploy with the
          <code className="mx-1">EnableBankingAppId</code>parameter set (see
          docs/deployment/admin-website.md).
        </div>
      ) : null}

      {syncNow.isError ? (
        <div className="alert alert-danger" role="alert">
          Sync failed: {errorText(syncNow.error, "request failed")}
        </div>
      ) : null}
      {deleteSession.isError ? (
        <div className="alert alert-danger" role="alert">
          Disconnect failed: {errorText(deleteSession.error, "request failed")}
        </div>
      ) : null}

      <AdminEditorSection
        title="Connect a bank"
        description="You are redirected to the bank's own consent screen and back here afterwards."
        footer={
          <>
            <button
              type="button"
              className="btn btn-primary"
              onClick={onConnect}
              disabled={!state?.enabled || !bankName || startAuth.isPending}
            >
              {startAuth.isPending ? "Starting…" : "Connect"}
            </button>
            {startAuth.isError ? (
              <span className="text-danger small">
                {errorText(startAuth.error, "Could not start authorization")}
              </span>
            ) : null}
          </>
        }
      >
        <div className="row g-3">
          <div className="col-sm-4 col-lg-3">
            <label className="form-label" htmlFor="bank-country">
              Country
            </label>
            <select
              id="bank-country"
              className="form-select"
              value={country}
              onChange={(ev) => {
                setCountry(ev.target.value);
                setBankName("");
              }}
            >
              {BANK_CONNECT_COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div className="col-sm-8 col-lg-5">
            <label className="form-label" htmlFor="bank-name">
              Bank
            </label>
            <select
              id="bank-name"
              className="form-select"
              value={bankName}
              onChange={(ev) => setBankName(ev.target.value)}
              disabled={!state?.enabled || banksQuery.isLoading}
            >
              <option value="">
                {banksQuery.isLoading ? "Loading banks…" : "Select a bank…"}
              </option>
              {(banksQuery.data?.banks ?? []).map((bank) => (
                <option key={bank.name} value={bank.name}>
                  {bank.name}
                  {bank.beta ? " (beta)" : ""}
                </option>
              ))}
            </select>
            {banksQuery.isError ? (
              <div className="form-text text-danger">
                {errorText(banksQuery.error, "Could not load banks")}
              </div>
            ) : null}
          </div>
        </div>
      </AdminEditorSection>

      <h2 className="h6 text-uppercase text-muted">Connected banks</h2>
      <div className="mb-4">
        <AdminDataTable
          columns={[
            { key: "bank", header: "Bank" },
            { key: "country", header: "Country", priority: "secondary" },
            { key: "accounts", header: "Accounts", priority: "secondary" },
            { key: "validUntil", header: "Consent valid until", priority: "tertiary" },
            {
              key: "ops",
              header: <span className="visually-hidden">Operations</span>,
              className: "text-end",
            },
          ]}
          filterValue={sessionFilter}
          onFilterChange={setSessionFilter}
          filterPlaceholder="Filter banks…"
        >
          {filteredSessions.length === 0 ? (
            <AdminDataTableEmptyRow
              colSpan={5}
              message={
                sessions.length === 0
                  ? "No banks connected yet."
                  : "No banks match the filter."
              }
            />
          ) : (
            filteredSessions.map((session) => (
              <tr key={session.sessionId}>
                <td>
                  {session.bankName}
                  <AdminDataTableCellMeta>
                    {session.bankCountry}
                    {session.accounts.length
                      ? ` · ${session.accounts.length} account${session.accounts.length === 1 ? "" : "s"}`
                      : ""}
                  </AdminDataTableCellMeta>
                </td>
                <td className={adminColumnPriorityClass("secondary")}>{session.bankCountry}</td>
                <td className={adminColumnPriorityClass("secondary")}>
                  {session.accounts.length === 0 ? (
                    <span className="text-muted">none</span>
                  ) : (
                    <ul className="list-unstyled mb-0">
                      {session.accounts.map((account) => (
                        <li key={account.uid} className="small">
                          {bankAccountLabel(account)}
                          {account.currency ? (
                            <span className="text-muted"> · {account.currency}</span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td className={adminColumnPriorityClass("tertiary")}>
                  {session.validUntil ? (
                    <DateTimeDisplay iso={session.validUntil} />
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td className="text-end">
                  <TableIconButton
                    iconClassName="bi bi-trash"
                    ariaLabel={`Disconnect ${session.bankName}`}
                    variant="danger"
                    onClick={() => onDeleteSession(session)}
                    disabled={deleteSession.isPending}
                  />
                </td>
              </tr>
            ))
          )}
        </AdminDataTable>
      </div>

      <AdminEditorSection
        title="Account mappings"
        description="Map each linked bank account to a Finance → Accounts record. Sync writes the live balance into the record's value."
        footer={
          <>
            <button
              type="button"
              className="btn btn-primary"
              onClick={onSaveMappings}
              disabled={!hasMappingChanges || saveMappings.isPending}
            >
              {saveMappings.isPending ? "Saving…" : "Save mappings"}
            </button>
            {saveMappings.isError ? (
              <span className="text-danger small">
                {errorText(saveMappings.error, "Could not save mappings")}
              </span>
            ) : null}
          </>
        }
      >
        {linkedAccounts.length === 0 ? (
          <p className="text-muted small mb-0">
            Connect a bank first; its accounts appear here for mapping.
          </p>
        ) : (
          <div className="table-responsive">
            <table className="table table-sm align-middle mb-0">
              <thead>
                <tr>
                  <th scope="col">Bank account</th>
                  <th scope="col">Accounts-sheet record</th>
                </tr>
              </thead>
              <tbody>
                {linkedAccounts.map(({ session, account }) => (
                  <tr key={account.uid}>
                    <td>
                      <span className="fw-semibold">{session.bankName}</span>{" "}
                      <span className="text-muted small">
                        {bankAccountLabel(account)}
                        {account.currency ? ` · ${account.currency}` : ""}
                      </span>
                    </td>
                    <td className="admin-mapping-select">
                      <label
                        className="visually-hidden"
                        htmlFor={`mapping-${account.uid}`}
                      >
                        Record for {bankAccountLabel(account)}
                      </label>
                      <select
                        id={`mapping-${account.uid}`}
                        className="form-select form-select-sm"
                        value={draftValue(account.uid)}
                        onChange={(ev) =>
                          setMappingDraft((prev) => ({
                            ...(prev ?? {}),
                            [account.uid]: ev.target.value,
                          }))
                        }
                      >
                        <option value="">Not synced</option>
                        {financeData.accountRecords.map((rec) => (
                          <option key={rec.id} value={rec.id}>
                            {recordLabelById[rec.id]}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminEditorSection>

      <AdminEditorSection
        title="Last sync"
        description={
          lastSync
            ? undefined
            : "No sync has run yet. Map at least one account, then use Sync now."
        }
      >
        {lastSync ? (
          <>
            <p className="small text-muted">
              Ran <DateTimeDisplay iso={lastSync.at} />
            </p>
            <div className="table-responsive">
              <table className="table table-sm align-middle mb-0 admin-data-table">
                <thead>
                  <tr>
                    <th scope="col">Record</th>
                    <th scope="col">Status</th>
                    <th scope="col" className="text-end">
                      Balance
                    </th>
                    <th scope="col" className="admin-col-secondary">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {lastSync.results.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="text-muted text-center py-3">
                        Nothing was mapped when the sync ran.
                      </td>
                    </tr>
                  ) : (
                    lastSync.results.map((result) => (
                      <tr key={`${result.accountUid}-${result.accountRecordId}`}>
                        <td>
                          {recordLabelById[result.accountRecordId] ??
                            result.accountRecordId}
                        </td>
                        <td>
                          {result.status === "ok" ? (
                            <span className="badge text-bg-success">OK</span>
                          ) : (
                            <span className="badge text-bg-danger">Error</span>
                          )}
                        </td>
                        <td className="text-end">
                          {result.status === "ok" &&
                          result.balance !== undefined &&
                          result.currency ? (
                            <MoneyAmount
                              amount={result.balance}
                              currency={result.currency}
                            />
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td className="small text-muted admin-col-secondary">
                          {result.status === "ok"
                            ? result.balanceType
                            : result.message}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </AdminEditorSection>
    </div>
  );
}
