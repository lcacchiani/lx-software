import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { adminFetchJson } from "../lib/apiAdminClient";
import type { FinancePersistedState, HouseKey } from "../lib/financeModel";

const HOUSE_KEYS: readonly HouseKey[] = ["hillmarton", "morrison"];

function objectKeyFromAssetPk(pk: string): string {
  return pk.startsWith("ASSET#") ? pk.slice("ASSET#".length) : pk;
}

function inferHouseFromFinanceLines(
  objectKey: string,
  finance: FinancePersistedState | undefined,
): HouseKey | undefined {
  if (!finance) return undefined;
  for (const hk of HOUSE_KEYS) {
    for (const line of finance[hk].lines) {
      if ((line.sourceAssetKey ?? "").trim() === objectKey) return hk;
    }
  }
  return undefined;
}

export interface AdminAssetMeta {
  readonly pk: string;
  readonly sk: string;
  readonly sha256?: string;
  readonly clientSha256?: string;
  readonly size?: number;
  readonly ownerSub?: string;
  /** ISO 8601 UTC instant from S3 LastModified when the asset was confirmed. */
  readonly uploadedAt?: string;
  readonly fileName?: string;
  /** Finance house key when the upload was tied to a house statement import. */
  readonly house?: string;
}

export function useAdminAssets() {
  const qc = useQueryClient();
  const financeUpdatedAt = qc.getQueryState(["finance"])?.dataUpdatedAt ?? 0;
  return useInfiniteQuery({
    queryKey: ["admin", "asset-records", financeUpdatedAt],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const qs = pageParam
        ? `?cursor=${encodeURIComponent(pageParam)}`
        : "";
      const data = await adminFetchJson<{
        items: AdminAssetMeta[];
        nextCursor?: string | null;
      }>(`/records${qs}`);
      const finance = qc.getQueryData<FinancePersistedState>(["finance"]);
      const items = data.items
        .filter(
          (row) => row.pk.startsWith("ASSET#") && row.sk === "META",
        )
        .map((row) => {
          if (row.house?.trim()) return row;
          const objectKey = objectKeyFromAssetPk(row.pk);
          const inferred = inferHouseFromFinanceLines(objectKey, finance);
          return inferred ? { ...row, house: inferred } : row;
        });
      return { items, nextCursor: data.nextCursor ?? null };
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}
