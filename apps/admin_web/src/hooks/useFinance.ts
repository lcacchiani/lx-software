import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { adminFetchJson } from "../lib/apiAdminClient";
import {
  type FinancePersistedState,
  type HouseFinanceData,
  type HouseKey,
  DEFAULT_FINANCE_STATE,
  normalizeHouseFinanceData,
} from "../lib/financeModel";

async function fetchFinance(): Promise<FinancePersistedState> {
  const raw = await adminFetchJson<FinancePersistedState>("/finance");
  return {
    hillmarton: normalizeHouseFinanceData(raw.hillmarton),
    morrison: normalizeHouseFinanceData(raw.morrison),
  };
}

type PutFinanceResponse = {
  readonly data: HouseFinanceData;
};

export function useFinance() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["finance"],
    queryFn: fetchFinance,
  });

  const saveHouse = useMutation({
    mutationFn: async ({
      house,
      data,
    }: {
      house: HouseKey;
      data: HouseFinanceData;
    }) => {
      const res = await adminFetchJson<PutFinanceResponse>(`/finance/${house}`, {
        method: "PUT",
        body: JSON.stringify(data),
      });
      return { house, data: res.data };
    },
    onSuccess: ({ house, data }) => {
      qc.setQueryData<FinancePersistedState>(["finance"], (old) => ({
        ...(old ?? DEFAULT_FINANCE_STATE),
        [house]: data,
      }));
    },
  });

  const patchHouse = useCallback(
    (house: HouseKey, patch: (prev: HouseFinanceData) => HouseFinanceData) => {
      const state = qc.getQueryData<FinancePersistedState>(["finance"]);
      const prev = state?.[house] ?? DEFAULT_FINANCE_STATE[house];
      const next = patch(prev);
      saveHouse.mutate({ house, data: next });
    },
    [qc, saveHouse],
  );

  return {
    data: q.data ?? DEFAULT_FINANCE_STATE,
    isLoading: q.isLoading,
    isError: q.isError,
    error: q.error,
    patchHouse,
    isSaving: saveHouse.isPending,
    saveError: saveHouse.error,
  };
}
