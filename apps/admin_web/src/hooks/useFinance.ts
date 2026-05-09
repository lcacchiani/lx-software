import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { adminFetchJson } from "../lib/apiAdminClient";
import {
  type FinanceLedgerRecord,
  type FinanceLedgerSheetKey,
  type FinancePersistedState,
  type HouseFinanceData,
  type HouseKey,
  DEFAULT_FINANCE_STATE,
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  normalizeHouseFinanceData,
  normalizeLedgerRecords,
} from "../lib/financeModel";

const LEDGER_CONFIG: Record<
  FinanceLedgerSheetKey,
  { readonly path: string; readonly bodyKey: keyof FinancePersistedState }
> = {
  income: { path: "/finance/income", bodyKey: "incomeRecords" },
  expenses: { path: "/finance/expenses", bodyKey: "expenseRecords" },
};

async function fetchFinance(): Promise<FinancePersistedState> {
  const raw = await adminFetchJson<FinancePersistedState>("/finance");
  const rawObj = raw as Record<string, unknown>;
  return {
    hillmarton: normalizeHouseFinanceData(raw.hillmarton),
    morrison: normalizeHouseFinanceData(raw.morrison),
    incomeRecords: normalizeLedgerRecords(rawObj.incomeRecords, INCOME_CATEGORIES),
    expenseRecords: normalizeLedgerRecords(rawObj.expenseRecords, EXPENSE_CATEGORIES),
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

  const saveLedgerSheet = useMutation({
    mutationFn: async ({
      sheet,
      records,
    }: {
      sheet: FinanceLedgerSheetKey;
      records: readonly FinanceLedgerRecord[];
    }) => {
      const { path, bodyKey } = LEDGER_CONFIG[sheet];
      const res = await adminFetchJson<Record<string, FinanceLedgerRecord[]>>(
        path,
        {
          method: "PUT",
          body: JSON.stringify({ [bodyKey]: records }),
        },
      );
      const list = res[bodyKey];
      const categories = sheet === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
      return { sheet, bodyKey, records: normalizeLedgerRecords(list, categories) };
    },
    onSuccess: ({ bodyKey, records }) => {
      qc.setQueryData<FinancePersistedState>(["finance"], (old) => ({
        ...(old ?? DEFAULT_FINANCE_STATE),
        [bodyKey]: records,
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

  const patchLedgerRecords = useCallback(
    (
      sheet: FinanceLedgerSheetKey,
      patch: (prev: readonly FinanceLedgerRecord[]) => FinanceLedgerRecord[],
    ) => {
      const state = qc.getQueryData<FinancePersistedState>(["finance"]);
      const prev =
        sheet === "income"
          ? (state?.incomeRecords ?? DEFAULT_FINANCE_STATE.incomeRecords)
          : (state?.expenseRecords ?? DEFAULT_FINANCE_STATE.expenseRecords);
      const next = patch(prev);
      saveLedgerSheet.mutate({ sheet, records: next });
    },
    [qc, saveLedgerSheet],
  );

  return {
    data: q.data ?? DEFAULT_FINANCE_STATE,
    isLoading: q.isLoading,
    isError: q.isError,
    error: q.error,
    patchHouse,
    patchLedgerRecords,
    isSaving: saveHouse.isPending || saveLedgerSheet.isPending,
    saveError: saveHouse.error ?? saveLedgerSheet.error,
  };
}
