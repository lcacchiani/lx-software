import { useMemo, useState } from "react";
import {
  AdminDataTable,
  AdminDataTableEmptyRow,
  TableIconButton,
} from "../components/ui";
import {
  useAdminAssets,
  type AdminAssetMeta,
} from "../hooks/useAdminAssets";
import { adminFetchJson } from "../lib/apiAdminClient";

const HOUSE_LABEL: Record<string, string> = {
  hillmarton: "32 Hillmarton",
  morrison: "The Morrison",
};

function objectKeyFromAssetPk(pk: string): string {
  return pk.startsWith("ASSET#") ? pk.slice("ASSET#".length) : pk;
}

function displayFileName(row: AdminAssetMeta): string {
  const n = row.fileName?.trim();
  if (n) return n;
  const key = objectKeyFromAssetPk(row.pk);
  const parts = key.split("/");
  return parts[parts.length - 1] || key;
}

function formatUploadedInstant(iso?: string): string {
  if (!iso?.trim()) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function uploadedAtSortMs(iso?: string): number {
  if (!iso?.trim()) return Number.NEGATIVE_INFINITY;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

function rowMatchesFilter(
  row: AdminAssetMeta,
  filterText: string,
): boolean {
  const q = filterText.trim().toLowerCase();
  if (!q) return true;
  const file = displayFileName(row).toLowerCase();
  const houseKey = (row.house ?? "").toLowerCase();
  const houseDisplay = houseLabel(row.house).toLowerCase();
  return (
    file.includes(q) || houseKey.includes(q) || houseDisplay.includes(q)
  );
}

function houseLabel(house?: string): string {
  if (!house?.trim()) return "—";
  return HOUSE_LABEL[house] ?? house;
}

function AssetOpenLink({ objectKey }: { readonly objectKey: string }) {
  const [busy, setBusy] = useState(false);
  const open = async () => {
    setBusy(true);
    try {
      const qs = `?key=${encodeURIComponent(objectKey)}`;
      const { url } = await adminFetchJson<{ url: string }>(
        `/assets/download-url${qs}`,
      );
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      window.alert(
        "Could not open the file. Check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <TableIconButton
      iconClassName="bi bi-box-arrow-up-right"
      ariaLabel="Open file in new tab"
      onClick={() => void open()}
      disabled={busy}
    />
  );
}

const ASSET_TABLE_COLUMNS = [
  { key: "uploaded", header: "Uploaded" },
  { key: "file", header: "File" },
  { key: "house", header: "House" },
  { key: "open", header: "Open", className: "text-end" },
] as const;

export function AssetsPage() {
  const q = useAdminAssets();
  const [tableFilter, setTableFilter] = useState("");

  const rows = useMemo(
    () => q.data?.pages.flatMap((p) => p.items) ?? [],
    [q.data],
  );

  const displayRows = useMemo(() => {
    const sorted = [...rows].sort(
      (a, b) =>
        uploadedAtSortMs(b.uploadedAt) - uploadedAtSortMs(a.uploadedAt),
    );
    return sorted.filter((row) => rowMatchesFilter(row, tableFilter));
  }, [rows, tableFilter]);

  return (
    <div>
      <h1 className="h3 mb-3">Assets</h1>
      <p className="text-muted">
        Statement uploads and other files stored in the admin assets bucket;
        metadata is stored in DynamoDB (<code>ASSET#</code> keys).
      </p>
      {q.isLoading ? (
        <p className="text-muted">Loading…</p>
      ) : q.isError ? (
        <div className="alert alert-danger" role="alert">
          Failed to load assets.
        </div>
      ) : (
        <>
          <AdminDataTable
            columns={ASSET_TABLE_COLUMNS}
            filterValue={tableFilter}
            onFilterChange={setTableFilter}
            filterPlaceholder="Filter by file or house…"
          >
            {displayRows.length ? (
              displayRows.map((row) => {
                const objectKey = objectKeyFromAssetPk(row.pk);
                return (
                  <tr key={row.pk}>
                    <td className="text-nowrap small">
                      {formatUploadedInstant(row.uploadedAt)}
                    </td>
                    <td>
                      <div className="fw-medium">{displayFileName(row)}</div>
                      {typeof row.size === "number" ? (
                        <div className="text-muted small">
                          {formatFileSize(row.size)}
                        </div>
                      ) : null}
                    </td>
                    <td className="small">{houseLabel(row.house)}</td>
                    <td className="text-end">
                      <AssetOpenLink objectKey={objectKey} />
                    </td>
                  </tr>
                );
              })
            ) : (
              <AdminDataTableEmptyRow
                colSpan={4}
                message={
                  rows.length
                    ? "No assets match the filter."
                    : "No confirmed assets yet."
                }
              />
            )}
          </AdminDataTable>
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
