import { useQuery } from "@tanstack/react-query";
import { adminFetchJson } from "../lib/apiAdminClient";

export interface AdminAssetMeta {
  readonly pk: string;
  readonly sk: string;
  readonly sha256?: string;
  readonly size?: number;
  readonly ownerSub?: string;
}

export function useAdminAssets() {
  return useQuery({
    queryKey: ["admin", "asset-records"],
    queryFn: async () => {
      const data = await adminFetchJson<{ items: AdminAssetMeta[] }>("/records");
      return data.items.filter(
        (row) => row.pk.startsWith("ASSET#") && row.sk === "META"
      );
    },
  });
}
