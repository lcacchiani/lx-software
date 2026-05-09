import { useInfiniteQuery } from "@tanstack/react-query";
import { adminFetchJson } from "../lib/apiAdminClient";

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
  return useInfiniteQuery({
    queryKey: ["admin", "asset-records"],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const qs = pageParam
        ? `?cursor=${encodeURIComponent(pageParam)}`
        : "";
      const data = await adminFetchJson<{
        items: AdminAssetMeta[];
        nextCursor?: string | null;
      }>(`/records${qs}`);
      const items = data.items.filter(
        (row) => row.pk.startsWith("ASSET#") && row.sk === "META"
      );
      return { items, nextCursor: data.nextCursor ?? null };
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}
