import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import {
  type FinancePersistedState,
  type HouseFinanceData,
  type HouseKey,
  DEFAULT_FINANCE_STATE,
  loadFinanceState,
  saveFinanceState,
} from "../lib/financeStorage";

export function useFinance() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["finance"],
    queryFn: loadFinanceState,
    staleTime: Infinity,
    initialData: DEFAULT_FINANCE_STATE,
  });

  const persist = useCallback(
    (updater: (prev: FinancePersistedState) => FinancePersistedState) => {
      const prev = loadFinanceState();
      const next = updater(prev);
      saveFinanceState(next);
      void qc.invalidateQueries({ queryKey: ["finance"] });
    },
    [qc],
  );

  const patchHouse = useCallback(
    (house: HouseKey, patch: (prev: HouseFinanceData) => HouseFinanceData) => {
      persist((state) => ({
        ...state,
        [house]: patch(state[house]),
      }));
    },
    [persist],
  );

  return {
    data: q.data ?? DEFAULT_FINANCE_STATE,
    isLoading: q.isLoading,
    patchHouse,
    persist,
  };
}
