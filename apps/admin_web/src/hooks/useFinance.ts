import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { adminFetchJson } from "../lib/apiAdminClient";
import {
  type FinancePersistedState,
  type HouseFinanceData,
  type HouseKey,
  type IncomeRecord,
  DEFAULT_FINANCE_STATE,
  normalizeHouseFinanceData,
  normalizeIncomeRecords,
} from "../lib/financeModel";

async function fetchFinance(): Promise<FinancePersistedState> {
  const raw = await adminFetchJson<FinancePersistedState>("/finance");
  const rawObj = raw as Record<string, unknown>;
  return {
    hillmarton: normalizeHouseFinanceData(raw.hillmarton),
    morrison: normalizeHouseFinanceData(raw.morrison),
    incomeRecords: normalizeIncomeRecords(rawObj.incomeRecords),
  };
}

type PutFinanceResponse = {
  readonly data: HouseFinanceData;
};

type PutIncomeResponse = {
  readonly incomeRecords: IncomeRecord[];
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

  const saveIncome = useMutation({
    mutationFn: async (records: readonly IncomeRecord[]) => {
      const res = await adminFetchJson<PutIncomeResponse>("/finance/income", {
        method: "PUT",
        body: JSON.stringify({ incomeRecords: records }),
      });
      return normalizeIncomeRecords(res.incomeRecords);
    },
    onSuccess: (incomeRecords) => {
      qc.setQueryData<FinancePersistedState>(["finance"], (old) => ({
        ...(old ?? DEFAULT_FINANCE_STATE),
        incomeRecords,
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

  const patchIncomeRecords = useCallback(
    (patch: (prev: readonly IncomeRecord[]) => IncomeRecord[]) => {
      const state = qc.getQueryData<FinancePersistedState>(["finance"]);
      const prev = state?.incomeRecords ?? DEFAULT_FINANCE_STATE.incomeRecords;
      const next = patch(prev);
      saveIncome.mutate(next);
    },
    [qc, saveIncome],
  );

  return {
    data: q.data ?? DEFAULT_FINANCE_STATE,
    isLoading: q.isLoading,
    isError: q.isError,
    error: q.error,
    patchHouse,
    patchIncomeRecords,
    isSaving: saveHouse.isPending || saveIncome.isPending,
    saveError: saveHouse.error ?? saveIncome.error,
  };
}
