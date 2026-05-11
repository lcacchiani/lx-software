import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { adminFetchJson, getAdminApiErrorMessage } from "../lib/apiAdminClient";
import {
  type ExpenseIncomeAllocationPercents,
  type FinanceInvestmentRecord,
  type FinanceLedgerRecord,
  type FinanceLedgerSheetKey,
  type FinancePersistedState,
  type HouseFinanceData,
  type HouseKey,
  DEFAULT_FINANCE_STATE,
  DEFAULT_EXPENSE_INCOME_ALLOCATION_PERCENTS,
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  normalizeExpenseIncomeAllocationPercents,
  normalizeHouseFinanceData,
  normalizeInvestmentRecords,
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
    incomeRecords: normalizeLedgerRecords(rawObj.incomeRecords, INCOME_CATEGORIES, {
      includeIncomeFlags: true,
    }),
    expenseRecords: normalizeLedgerRecords(rawObj.expenseRecords, EXPENSE_CATEGORIES),
    expenseIncomeAllocationPercents: normalizeExpenseIncomeAllocationPercents(
      rawObj.expenseIncomeAllocationPercents,
    ),
    investmentRecords: normalizeInvestmentRecords(rawObj.investmentRecords),
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

  const saveInvestmentRecords = useMutation({
    mutationFn: async (records: readonly FinanceInvestmentRecord[]) => {
      const res = await adminFetchJson<{ investmentRecords: FinanceInvestmentRecord[] }>(
        "/finance/investments",
        {
          method: "PUT",
          body: JSON.stringify({ investmentRecords: records }),
        },
      );
      const list = res.investmentRecords;
      return {
        records: normalizeInvestmentRecords(list),
      };
    },
    onSuccess: ({ records }) => {
      qc.setQueryData<FinancePersistedState>(["finance"], (old) => ({
        ...(old ?? DEFAULT_FINANCE_STATE),
        investmentRecords: records,
      }));
    },
  });

  const saveLedgerSheet = useMutation({
    mutationFn: async ({
      sheet,
      records,
      expenseAllocationPercents,
    }: {
      sheet: FinanceLedgerSheetKey;
      records: readonly FinanceLedgerRecord[];
      expenseAllocationPercents?: ExpenseIncomeAllocationPercents;
    }) => {
      const { path, bodyKey } = LEDGER_CONFIG[sheet];
      const state = qc.getQueryData<FinancePersistedState>(["finance"]);
      const bodyPayload: Record<string, unknown> = { [bodyKey]: records };
      if (sheet === "expenses") {
        bodyPayload.expenseIncomeAllocationPercents =
          expenseAllocationPercents ??
          state?.expenseIncomeAllocationPercents ??
          DEFAULT_EXPENSE_INCOME_ALLOCATION_PERCENTS;
      }
      const res = await adminFetchJson<
        Record<string, unknown> & { expenseIncomeAllocationPercents?: unknown }
      >(path, {
        method: "PUT",
        body: JSON.stringify(bodyPayload),
      });
      const list = res[bodyKey];
      const categories = sheet === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
      const normalizedRecords = normalizeLedgerRecords(list as unknown, categories, {
        includeIncomeFlags: sheet === "income",
      });
      const nextPercents =
        sheet === "expenses" && res.expenseIncomeAllocationPercents !== undefined
          ? normalizeExpenseIncomeAllocationPercents(res.expenseIncomeAllocationPercents)
          : undefined;
      return {
        sheet,
        bodyKey,
        records: normalizedRecords,
        expenseIncomeAllocationPercents: nextPercents,
      };
    },
    onSuccess: ({ bodyKey, records, expenseIncomeAllocationPercents: respPercents }) => {
      qc.setQueryData<FinancePersistedState>(["finance"], (old) => ({
        ...(old ?? DEFAULT_FINANCE_STATE),
        [bodyKey]: records,
        ...(respPercents !== undefined
          ? { expenseIncomeAllocationPercents: respPercents }
          : {}),
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

  const patchInvestmentRecords = useCallback(
    (
      patch: (
        prev: readonly FinanceInvestmentRecord[],
      ) => readonly FinanceInvestmentRecord[],
    ) => {
      const state = qc.getQueryData<FinancePersistedState>(["finance"]);
      const prev = state?.investmentRecords ?? DEFAULT_FINANCE_STATE.investmentRecords;
      const next = patch(prev);
      saveInvestmentRecords.mutate(next);
    },
    [qc, saveInvestmentRecords],
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

  const patchExpenseIncomeAllocationPercents = useCallback(
    (next: ExpenseIncomeAllocationPercents) => {
      const state = qc.getQueryData<FinancePersistedState>(["finance"]);
      const records = state?.expenseRecords ?? DEFAULT_FINANCE_STATE.expenseRecords;
      saveLedgerSheet.mutate({
        sheet: "expenses",
        records,
        expenseAllocationPercents: next,
      });
    },
    [qc, saveLedgerSheet],
  );

  const ledgerSaveErr = saveLedgerSheet.error;
  const houseSaveErr = saveHouse.error;
  const investmentSaveErr = saveInvestmentRecords.error;
  const saveError = houseSaveErr ?? ledgerSaveErr ?? investmentSaveErr;

  return {
    data: q.data ?? DEFAULT_FINANCE_STATE,
    isLoading: q.isLoading,
    isError: q.isError,
    error: q.error,
    patchHouse,
    patchLedgerRecords,
    patchInvestmentRecords,
    patchExpenseIncomeAllocationPercents,
    isSaving:
      saveHouse.isPending ||
      saveLedgerSheet.isPending ||
      saveInvestmentRecords.isPending,
    saveError,
    saveErrorDetail: getAdminApiErrorMessage(saveError),
  };
}
