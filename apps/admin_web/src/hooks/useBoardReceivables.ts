import { useQuery } from "@tanstack/react-query";
import { adminFetchJson } from "../lib/apiAdminClient";
import { BOARD_API_BASE, type BoardReceivablesPayload } from "../lib/boardModel";
import { BOARD_QUERY_KEY } from "./useBoard";

export const BOARD_RECEIVABLES_KEY = [...BOARD_QUERY_KEY, "receivables"] as const;

export function useBoardReceivables(enabled = true) {
  return useQuery({
    queryKey: BOARD_RECEIVABLES_KEY,
    enabled,
    queryFn: () => adminFetchJson<BoardReceivablesPayload>(`${BOARD_API_BASE}/receivables`),
    refetchInterval: 60_000,
  });
}
