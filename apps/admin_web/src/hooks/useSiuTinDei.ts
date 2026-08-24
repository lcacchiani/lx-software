import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminFetchJson, getAdminApiErrorMessage } from "../lib/apiAdminClient";
import { GLOBAL_DEFAULT_CURRENCY } from "../lib/currencies";
import {
  normalizeHouseFinanceData,
  type HouseFinanceData,
} from "../lib/financeModel";
import { SIU_TIN_DEI_BOOK_KEY } from "../lib/statementOwners";

const QUERY_KEY = [SIU_TIN_DEI_BOOK_KEY] as const;

const EMPTY_BOOK: HouseFinanceData = {
  defaultCurrency: GLOBAL_DEFAULT_CURRENCY,
  float: { amount: 0, currency: GLOBAL_DEFAULT_CURRENCY },
  lines: [],
};

type PutBookResponse = {
  readonly data: HouseFinanceData;
};

async function fetchSiuTinDei(): Promise<HouseFinanceData> {
  const raw = await adminFetchJson<PutBookResponse>("/siu-tin-dei");
  return normalizeHouseFinanceData(raw.data);
}

export function useSiuTinDei() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchSiuTinDei,
  });

  const saveBook = useMutation({
    mutationFn: async (data: HouseFinanceData) => {
      const res = await adminFetchJson<PutBookResponse>("/siu-tin-dei", {
        method: "PUT",
        body: JSON.stringify({
          ...data,
          defaultCurrency: GLOBAL_DEFAULT_CURRENCY,
          float: data.float ?? { amount: 0, currency: GLOBAL_DEFAULT_CURRENCY },
        }),
      });
      return normalizeHouseFinanceData(res.data);
    },
    onSuccess: (data) => {
      qc.setQueryData<HouseFinanceData>(QUERY_KEY, data);
    },
  });

  const patchBook = useCallback(
    (patch: (prev: HouseFinanceData) => HouseFinanceData) => {
      const prev = qc.getQueryData<HouseFinanceData>(QUERY_KEY) ?? EMPTY_BOOK;
      saveBook.mutate(patch(prev));
    },
    [qc, saveBook],
  );

  return {
    data: q.data ?? EMPTY_BOOK,
    isLoading: q.isLoading,
    isError: q.isError,
    error: q.error,
    patchBook,
    isSaving: saveBook.isPending,
    saveError: saveBook.error,
    saveErrorDetail: getAdminApiErrorMessage(saveBook.error),
  };
}
