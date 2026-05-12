export function DashboardApiHealthCard({
  isLoading,
  isError,
  status,
}: {
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly status: string | undefined;
}) {
  return (
    <div className="card mt-4 shadow-sm">
      <div className="card-body">
        <h2 className="h6 text-uppercase text-muted">API health</h2>
        {isLoading ? (
          <p className="mb-0 small text-muted">Checking /health…</p>
        ) : isError ? (
          <p className="mb-0 small text-danger">Health check failed.</p>
        ) : (
          <p className="mb-0 small">
            <code>/health</code>:{" "}
            <span className="text-success">{status ?? "ok"}</span>
          </p>
        )}
      </div>
    </div>
  );
}
