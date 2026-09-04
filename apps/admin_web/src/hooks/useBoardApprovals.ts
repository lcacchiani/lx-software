import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminFetchJson } from "../lib/apiAdminClient";
import { BOARD_API_BASE, boardApprovalDecisionPath, type BoardApproval } from "../lib/boardModel";
import { BOARD_QUERY_KEY } from "./useBoard";
import { BOARD_ACTIONS_KEY } from "./useBoardActions";
import { BOARD_TOOL_CALLS_KEY } from "./useBoardTools";

export const BOARD_APPROVALS_KEY = [...BOARD_QUERY_KEY, "approvals"] as const;

export type ApprovalDecisionVariables = {
  readonly approvalId: string;
  readonly decision: "approve" | "reject";
  readonly note?: string;
  /** Owner-edited arguments; only honoured on approve. */
  readonly arguments?: Readonly<Record<string, unknown>>;
};

export function useBoardApprovals() {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: BOARD_APPROVALS_KEY,
    queryFn: async () => {
      const res = await adminFetchJson<{ approvals: BoardApproval[] }>(`${BOARD_API_BASE}/approvals`);
      return res.approvals;
    },
  });

  const decide = useMutation<BoardApproval, Error, ApprovalDecisionVariables>({
    mutationFn: async ({ approvalId, decision, note, arguments: args }) => {
      const res = await adminFetchJson<{ approval: BoardApproval }>(boardApprovalDecisionPath(approvalId, decision), {
        method: "POST",
        body: JSON.stringify({ note: note ?? "", ...(args && decision === "approve" ? { arguments: args } : {}) }),
      });
      return res.approval;
    },
    onSuccess: (approval) => {
      qc.setQueryData<BoardApproval[]>(BOARD_APPROVALS_KEY, (prev) =>
        (prev ?? []).map((a) => (a.approvalId === approval.approvalId ? approval : a)),
      );
      void qc.invalidateQueries({ queryKey: BOARD_APPROVALS_KEY });
      void qc.invalidateQueries({ queryKey: BOARD_QUERY_KEY, exact: true });
      void qc.invalidateQueries({ queryKey: BOARD_TOOL_CALLS_KEY });
      // Approved board_add_action / board_update_action calls change the actions list.
      void qc.invalidateQueries({ queryKey: BOARD_ACTIONS_KEY });
    },
  });

  return {
    approvals: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    decide,
  };
}
