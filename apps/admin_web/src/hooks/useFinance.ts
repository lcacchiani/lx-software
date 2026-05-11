import {
  type QueryClient,
  type UseMutationOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback } from "react";
import { adminFetchJson, getAdminApiErrorMessage } from "../lib/apiAdminClient";
import {
  type ExpenseIncomeAllocationPercents,
  type FinanceAllocationRecord,
  type FinanceInvestmentRecord,
  type FinanceLedgerRecord,
  type FinanceLedgerSheetKey,
  type FinancePensionRecord,
  type FinancePersistedState,
  type FinanceSavingsRecord,
  type HouseFinanceData,
  type HouseKey,
  DEFAULT_FINANCE_STATE,
  DEFAULT_EXPENSE_INCOME_ALLOCATION_PERCENTS,
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  allocationRecordsToApiPayload,
  normalizeAllocationRecords,
  normalizeExpenseIncomeAllocationPercents,
  normalizeHouseFinanceData,
  normalizeInvestmentRecords,
  normalizeLedgerRecords,
  normalizePensionRecords,
  normalizeSavingsRecords,
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
    expenseRecords: normalizeLedgerRecords(rawObj.expenseRecords, EXPENSE_CATEGORIES, {
      includeExpenseFlags: true,
    }),
    expenseIncomeAllocationPercents: normalizeExpenseIncomeAllocationPercents(
      rawObj.expenseIncomeAllocationPercents,
    ),
    investmentRecords: normalizeInvestmentRecords(rawObj.investmentRecords),
    savingsRecords: normalizeSavingsRecords(rawObj.savingsRecords),
    pensionRecords: normalizePensionRecords(rawObj.pensionRecords),
    allocationRecords: normalizeAllocationRecords(rawObj.allocationRecords),
  };
}

type PutFinanceResponse = {
  readonly data: HouseFinanceData;
};

type FinanceListStateKey =
  | "investmentRecords"
  | "savingsRecords"
  | "pensionRecords"
  | "allocationRecords";

function financeRecordsPutMutationOptions(
  qc: QueryClient,
  spec: {
    readonly path: string;
    readonly listKey: FinanceListStateKey;
    readonly normalize: (raw: unknown) => FinancePersistedState[FinanceListStateKey];
  },
): UseMutationOptions<
  { records: FinancePersistedState[FinanceListStateKey] },
  Error,
  FinancePersistedState[FinanceListStateKey]
> {
  return {
    mutationFn: async (records) => {
      const res = await adminFetchJson<Record<string, unknown>>(spec.path, {
        method: "PUT",
        body: JSON.stringify({ [spec.listKey]: records }),
      });
      const list = res[spec.listKey];
      return { records: spec.normalize(list) };
    },
    onSuccess: ({ records }) => {
      qc.setQueryData<FinancePersistedState>(["finance"], (old) => ({
        ...(old ?? DEFAULT_FINANCE_STATE),
        [spec.listKey]: records,
      }));
    },
  };
}

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

  const saveInvestmentRecords = useMutation(
    financeRecordsPutMutationOptions(qc, {
      path: "/finance/investments",
      listKey: "investmentRecords",
      normalize: normalizeInvestmentRecords,
    }),
  );

  const saveSavingsRecords = useMutation(
    financeRecordsPutMutationOptions(qc, {
      path: "/finance/savings",
      listKey: "savingsRecords",
      normalize: normalizeSavingsRecords,
    }),
  );

  const savePensionRecords = useMutation(
    financeRecordsPutMutationOptions(qc, {
      path: "/finance/pension",
      listKey: "pensionRecords",
      normalize: normalizePensionRecords,
    }),
  );

  const saveAllocationRecords = useMutation({
    mutationFn: async (records: readonly FinanceAllocationRecord[]) => {
      const res = await adminFetchJson<Record<string, unknown>>("/finance/allocations", {
        method: "PUT",
        body: JSON.stringify({
          allocationRecords: allocationRecordsToApiPayload(records),
        }),
      });
      const list = res.allocationRecords;
      return { records: normalizeAllocationRecords(list) };
    },
    onSuccess: ({ records }) => {
      qc.setQueryData<FinancePersistedState>(["finance"], (old) => ({
        ...(old ?? DEFAULT_FINANCE_STATE),
        allocationRecords: records,
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
        includeExpenseFlags: sheet === "expenses",
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
    onSuccess: async (payload) => {
      if (payload.sheet === "expenses") {
        const fresh = await fetchFinance();
        qc.setQueryData<FinancePersistedState>(["finance"], fresh);
        return;
      }
      qc.setQueryData<FinancePersistedState>(["finance"], (old) => ({
        ...(old ?? DEFAULT_FINANCE_STATE),
        [payload.bodyKey]: payload.records,
        ...(payload.expenseIncomeAllocationPercents !== undefined
          ? { expenseIncomeAllocationPercents: payload.expenseIncomeAllocationPercents }
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

  const patchSavingsRecords = useCallback(
    (patch: (prev: readonly FinanceSavingsRecord[]) => FinanceSavingsRecord[]) => {
      const state = qc.getQueryData<FinancePersistedState>(["finance"]);
      const prev = state?.savingsRecords ?? DEFAULT_FINANCE_STATE.savingsRecords;
      const next = patch(prev);
      saveSavingsRecords.mutate(next);
    },
    [qc, saveSavingsRecords],
  );

  const patchPensionRecords = useCallback(
    (patch: (prev: readonly FinancePensionRecord[]) => FinancePensionRecord[]) => {
      const state = qc.getQueryData<FinancePersistedState>(["finance"]);
      const prev = state?.pensionRecords ?? DEFAULT_FINANCE_STATE.pensionRecords;
      const next = patch(prev);
      savePensionRecords.mutate(next);
    },
    [qc, savePensionRecords],
  );

  const patchAllocationRecords = useCallback(
    (
      patch: (
        prev: readonly FinanceAllocationRecord[],
      ) => readonly FinanceAllocationRecord[],
    ) => {
      const state = qc.getQueryData<FinancePersistedState>(["finance"]);
      const prev = state?.allocationRecords ?? DEFAULT_FINANCE_STATE.allocationRecords;
      const next = patch(prev);
      saveAllocationRecords.mutate([...next]);
    },
    [qc, saveAllocationRecords],
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
      const toSave =
        sheet === "income"
          ? next.filter((r) => r.isDerivedFromAllocation !== true)
          : next;
      saveLedgerSheet.mutate({ sheet, records: toSave });
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
  const savingsSaveErr = saveSavingsRecords.error;
  const pensionSaveErr = savePensionRecords.error;
  const allocationSaveErr = saveAllocationRecords.error;
  const saveError =
    houseSaveErr ??
    ledgerSaveErr ??
    investmentSaveErr ??
    savingsSaveErr ??
    pensionSaveErr ??
    allocationSaveErr;

  return {
    data: q.data ?? DEFAULT_FINANCE_STATE,
    isLoading: q.isLoading,
    isError: q.isError,
    error: q.error,
    patchHouse,
    patchLedgerRecords,
    patchInvestmentRecords,
    patchSavingsRecords,
    patchPensionRecords,
    patchAllocationRecords,
    patchExpenseIncomeAllocationPercents,
    isSaving:
      saveHouse.isPending ||
      saveLedgerSheet.isPending ||
      saveInvestmentRecords.isPending ||
      saveSavingsRecords.isPending ||
      savePensionRecords.isPending ||
      saveAllocationRecords.isPending,
    saveError,
    saveErrorDetail: getAdminApiErrorMessage(saveError),
  };
}
