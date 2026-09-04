import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminFetchJson } from "../lib/apiAdminClient";
import {
  boardChatJobPath,
  boardChatPath,
  type BoardChatMessage,
  type BoardToolCallRef,
} from "../lib/boardModel";
import {
  BOARD_CHAT_POLL_BACKOFF_CAP_MS,
  BOARD_CHAT_POLL_DEADLINE_MS,
  BOARD_CHAT_POLL_INITIAL_WAIT_MS,
} from "../lib/contracts/generated";
import { BOARD_QUERY_KEY } from "./useBoard";

type ThreadResponse = { readonly personaId: string; readonly messages: BoardChatMessage[] };
type PostResponse = { readonly jobId: string; readonly status: string; readonly userMessage: BoardChatMessage };
type JobResponse =
  | { readonly status: "pending" | "processing"; readonly toolCalls?: readonly BoardToolCallRef[] }
  | { readonly status: "succeeded"; readonly message: BoardChatMessage }
  | { readonly status: "failed"; readonly message: string };

export function boardChatQueryKey(personaId: string) {
  return [...BOARD_QUERY_KEY, "chat", personaId] as const;
}

async function pollChatJob(
  personaId: string,
  jobId: string,
  onProgress: (calls: readonly BoardToolCallRef[]) => void,
): Promise<BoardChatMessage> {
  const deadline = Date.now() + BOARD_CHAT_POLL_DEADLINE_MS;
  let waitMs = BOARD_CHAT_POLL_INITIAL_WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, waitMs));
    waitMs = Math.min(BOARD_CHAT_POLL_BACKOFF_CAP_MS, waitMs * 2);
    const job = await adminFetchJson<JobResponse>(boardChatJobPath(personaId, jobId));
    if (job.status === "succeeded") return job.message;
    if (job.status === "failed") throw new Error(job.message || "The reply failed.");
    if (job.toolCalls && job.toolCalls.length > 0) onProgress(job.toolCalls);
  }
  throw new Error("The reply is taking longer than expected. Reload the thread in a moment.");
}

export function useBoardChat(personaId: string | null) {
  const qc = useQueryClient();
  const key = boardChatQueryKey(personaId ?? "");

  const thread = useQuery({
    queryKey: key,
    enabled: Boolean(personaId),
    queryFn: async () => {
      const res = await adminFetchJson<ThreadResponse>(boardChatPath(personaId!));
      return res.messages;
    },
  });

  const send = useMutation<BoardChatMessage, Error, string>({
    mutationFn: async (text) => {
      if (!personaId) throw new Error("No board member selected");
      const posted = await adminFetchJson<PostResponse>(boardChatPath(personaId), {
        method: "POST",
        body: JSON.stringify({ text }),
      });
      qc.setQueryData<BoardChatMessage[]>(key, (prev) => [
        ...(prev ?? []),
        posted.userMessage,
        {
          messageId: `pending-${posted.jobId}`,
          role: "assistant",
          text: "",
          createdAt: posted.userMessage.createdAt,
          isPending: true,
        },
      ]);
      return pollChatJob(personaId, posted.jobId, (toolCalls) => {
        qc.setQueryData<BoardChatMessage[]>(key, (prev) =>
          (prev ?? []).map((m) => (m.isPending ? { ...m, toolCalls } : m)),
        );
      });
    },
    onSuccess: (reply) => {
      qc.setQueryData<BoardChatMessage[]>(key, (prev) => [
        ...(prev ?? []).filter((m) => !m.isPending),
        reply,
      ]);
      void qc.invalidateQueries({ queryKey: BOARD_QUERY_KEY, exact: true });
      if (reply.toolCalls?.some((c) => c.status === "pending_approval")) {
        void qc.invalidateQueries({ queryKey: [...BOARD_QUERY_KEY, "approvals"] });
      }
      if (reply.toolCalls?.some((c) => c.kind === "write" && c.status === "ok")) {
        void qc.invalidateQueries({ queryKey: [...BOARD_QUERY_KEY, "actions"] });
      }
    },
    onError: () => {
      qc.setQueryData<BoardChatMessage[]>(key, (prev) => (prev ?? []).filter((m) => !m.isPending));
    },
  });

  const clear = useMutation({
    mutationFn: async () => {
      if (!personaId) return;
      await adminFetchJson<{ ok: boolean }>(boardChatPath(personaId), { method: "DELETE" });
    },
    onSuccess: () => {
      qc.setQueryData<BoardChatMessage[]>(key, []);
    },
  });

  return {
    messages: thread.data ?? [],
    isLoading: thread.isLoading,
    isError: thread.isError,
    error: thread.error,
    send,
    clear,
  };
}
