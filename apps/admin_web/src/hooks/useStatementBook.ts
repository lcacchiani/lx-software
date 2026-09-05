import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminFetchJson, getAdminApiErrorMessage } from "../lib/apiAdminClient";
import { GLOBAL_DEFAULT_CURRENCY } from "../lib/currencies";
import type { StatementBookKey } from "../lib/financeTypes";
import {
  normalizeHouseFinanceData,
  type HouseFinanceData,
} from "../lib/financeModel";
import { statementBookApiPath } from "../lib/statementOwners";

const EMPTY_BOOK: HouseFinanceData = {
  defaultCurrency: GLOBAL_DEFAULT_CURRENCY,
  float: { amount: 0, currency: GLOBAL_DEFAULT_CURRENCY },
  lines: [],
};

type PutBookResponse = {
  readonly data: HouseFinanceData;
};

export function useStatementBook(bookKey: StatementBookKey) {
  const qc = useQueryClient();
  const apiPath = statementBookApiPath(bookKey);

  const q = useQuery({
    queryKey: [bookKey],
    queryFn: async (): Promise<HouseFinanceData> => {
      const raw = await adminFetchJson<PutBookResponse>(apiPath);
      return normalizeHouseFinanceData(raw.data);
    },
  });

  const saveBook = useMutation({
    mutationFn: async (data: HouseFinanceData) => {
      const res = await adminFetchJson<PutBookResponse>(apiPath, {
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
      qc.setQueryData<HouseFinanceData>([bookKey], data);
    },
  });

  const patchBook = useCallback(
    (patch: (prev: HouseFinanceData) => HouseFinanceData) => {
      const prev = qc.getQueryData<HouseFinanceData>([bookKey]) ?? EMPTY_BOOK;
      saveBook.mutate(patch(prev));
    },
    [bookKey, qc, saveBook],
  );

  return {
    data: q.data ?? EMPTY_BOOK,
    isLoading: q.isLoading,
    isError: q.isError,
    isRefetching: q.isRefetching,
    error: q.error,
    refetch: q.refetch,
    patchBook,
    isSaving: saveBook.isPending,
    saveError: saveBook.error,
    saveErrorDetail: getAdminApiErrorMessage(saveBook.error),
  };
}
