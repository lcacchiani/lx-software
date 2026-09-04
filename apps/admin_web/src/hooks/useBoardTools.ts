import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminFetchJson } from "../lib/apiAdminClient";
import {
  BOARD_API_BASE,
  type BoardToolCallLogEntry,
  type BoardToolMatrix,
  type BoardToolsConfig,
  type BoardToolsPayload,
} from "../lib/boardModel";
import { BOARD_QUERY_KEY } from "./useBoard";

export const BOARD_TOOLS_KEY = [...BOARD_QUERY_KEY, "tools"] as const;
export const BOARD_TOOL_CALLS_KEY = [...BOARD_QUERY_KEY, "toolCalls"] as const;

export type ToolsConfigPatch = Partial<Pick<BoardToolsConfig, "enabled" | "globalMode" | "spendCaps">> & {
  readonly matrix?: BoardToolMatrix;
  readonly allowList?: readonly string[];
};

export function useBoardTools() {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: BOARD_TOOLS_KEY,
    queryFn: () => adminFetchJson<BoardToolsPayload>(`${BOARD_API_BASE}/tools`),
  });

  const save = useMutation({
    mutationFn: (patch: ToolsConfigPatch) =>
      adminFetchJson<BoardToolsPayload>(`${BOARD_API_BASE}/tools`, {
        method: "PUT",
        body: JSON.stringify(patch),
      }),
    onSuccess: (payload) => {
      qc.setQueryData(BOARD_TOOLS_KEY, payload);
      void qc.invalidateQueries({ queryKey: BOARD_QUERY_KEY, exact: true });
    },
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    save,
  };
}

export function useBoardToolCalls(enabled: boolean, limit = 50) {
  return useQuery({
    queryKey: [...BOARD_TOOL_CALLS_KEY, limit],
    enabled,
    queryFn: async () => {
      const res = await adminFetchJson<{ calls: BoardToolCallLogEntry[] }>(
        `${BOARD_API_BASE}/tools/calls?limit=${limit}`,
      );
      return res.calls;
    },
  });
}
