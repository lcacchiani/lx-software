import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { adminFetchJson } from "../lib/apiAdminClient";
import {
  BANKING_CALLBACK_PATH,
  type BankOption,
  type BankSyncMapping,
  type BankSyncReport,
  type BankSyncSession,
  type BankSyncState,
} from "../lib/bankSyncModel";

const BANKING_QUERY_KEY = ["banking"] as const;

export function useBankSync() {
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: BANKING_QUERY_KEY,
    queryFn: () => adminFetchJson<BankSyncState>("/banking"),
  });

  const invalidateBanking = () =>
    qc.invalidateQueries({ queryKey: BANKING_QUERY_KEY });

  const startAuth = useMutation({
    mutationFn: (vars: { readonly bankName: string; readonly country: string }) =>
      adminFetchJson<{ url: string; state: string }>("/banking/auth", {
        method: "POST",
        body: JSON.stringify({
          ...vars,
          redirectUrl: `${window.location.origin}${BANKING_CALLBACK_PATH}`,
        }),
      }),
  });

  const completeAuth = useMutation({
    mutationFn: (vars: { readonly code: string; readonly state: string }) =>
      adminFetchJson<{ session: BankSyncSession }>("/banking/sessions", {
        method: "POST",
        body: JSON.stringify(vars),
      }),
    onSuccess: () => void invalidateBanking(),
  });

  const saveMappings = useMutation({
    mutationFn: (mappings: readonly BankSyncMapping[]) =>
      adminFetchJson<{ mappings: readonly BankSyncMapping[] }>(
        "/banking/mappings",
        {
          method: "PUT",
          body: JSON.stringify({ mappings }),
        },
      ),
    onSuccess: () => void invalidateBanking(),
  });

  const syncNow = useMutation({
    mutationFn: () =>
      adminFetchJson<BankSyncReport>("/banking/sync", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    onSuccess: () => {
      void invalidateBanking();
      // Balances land on the accounts sheet, so the finance cache is stale too.
      void qc.invalidateQueries({ queryKey: ["finance"] });
    },
  });

  const deleteSession = useMutation({
    mutationFn: (sessionId: string) =>
      adminFetchJson<{ sessions: readonly BankSyncSession[] }>(
        `/banking/sessions/${encodeURIComponent(sessionId)}`,
        { method: "DELETE" },
      ),
    onSuccess: () => void invalidateBanking(),
  });

  return {
    state: q.data,
    isLoading: q.isLoading,
    isError: q.isError,
    error: q.error,
    startAuth,
    completeAuth,
    saveMappings,
    syncNow,
    deleteSession,
  };
}

export function useBankOptions(country: string) {
  return useQuery({
    queryKey: ["banking", "banks", country],
    queryFn: () =>
      adminFetchJson<{ banks: readonly BankOption[] }>(
        `/banking/banks?country=${encodeURIComponent(country)}`,
      ),
    enabled: country.length === 2,
    staleTime: 10 * 60 * 1000,
  });
}
