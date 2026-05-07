import { useAdminAssets } from "../hooks/useAdminAssets";

export function AssetsPage() {
  const q = useAdminAssets();

  const rows =
    q.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div>
      <h1 className="h3 mb-3">Assets</h1>
      <p className="text-muted">
        Asset metadata rows stored in DynamoDB (prefix <code>ASSET#</code>).
      </p>
      {q.isLoading ? (
        <p className="text-muted">Loading…</p>
      ) : q.isError ? (
        <div className="alert alert-danger" role="alert">
          Failed to load assets.
        </div>
      ) : (
        <>
          <div className="table-responsive card shadow-sm">
            <table className="table table-sm table-striped mb-0">
              <thead>
                <tr>
                  <th>Key (pk)</th>
                  <th>SHA-256 (client)</th>
                  <th>Size (S3)</th>
                </tr>
              </thead>
              <tbody>
                {rows.length ? (
                  rows.map((row) => (
                    <tr key={row.pk}>
                      <td>
                        <code className="small">
                          {row.pk.replace(/^ASSET#/, "")}
                        </code>
                      </td>
                      <td className="small text-break">
                        {(row.clientSha256 ?? row.sha256 ?? "—")}
                      </td>
                      <td>{row.size ?? "—"}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3} className="text-muted text-center py-4">
                      No confirmed assets yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {q.hasNextPage ? (
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm mt-2"
              disabled={q.isFetchingNextPage}
              onClick={() => void q.fetchNextPage()}
            >
              {q.isFetchingNextPage ? "Loading…" : "Load more"}
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}
