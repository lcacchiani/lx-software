import type { UseQueryResult } from "@tanstack/react-query";

export type FrankfurterRatesFooterNoteProps = {
  readonly needsFx: boolean;
  readonly fxError: boolean;
  readonly fxLoading: boolean;
  readonly ratesQuery: Pick<
    UseQueryResult<{ readonly date?: string }, Error>,
    "isSuccess" | "data" | "error"
  >;
};

/** Standard “Frankfurter · date” / loading / error text for finance table total rows. */
export function FrankfurterRatesFooterNote({
  needsFx,
  fxError,
  fxLoading,
  ratesQuery,
}: FrankfurterRatesFooterNoteProps) {
  if (fxError) {
    return (
      <span className="text-danger">
        {(ratesQuery.error as Error | undefined)?.message ?? "Could not load exchange rates."}
      </span>
    );
  }
  if (fxLoading) {
    return "Loading rates…";
  }
  if (needsFx && ratesQuery.isSuccess && ratesQuery.data?.date) {
    return <>Frankfurter · {ratesQuery.data.date}</>;
  }
  return "\u2014";
}
