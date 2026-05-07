import { useQuery } from "@tanstack/react-query";
import { adminFetchJson } from "../lib/apiAdminClient";

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

  return (
    <div>
      <h1 className="h3 mb-3">Dashboard</h1>
      <p className="text-muted">
        Welcome to the LX Software admin console. Use the sidebar to manage assets
        and records.
      </p>
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
