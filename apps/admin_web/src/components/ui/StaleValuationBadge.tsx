import { isValuationStale, VALUATION_STALE_DAYS } from "../../lib/valuationStaleness";

export type StaleValuationBadgeProps = {
  /** UTC calendar date `YYYY-MM-DD`; renders nothing when absent or recent. */
  readonly lastUpdated: string | undefined;
};

/** Warning badge shown next to a Last Update date older than the staleness threshold. */
export function StaleValuationBadge({ lastUpdated }: StaleValuationBadgeProps) {
  if (!isValuationStale(lastUpdated)) {
    return null;
  }
  return (
    <span
      className="badge text-bg-warning ms-2"
      title={`Valuation last updated over ${VALUATION_STALE_DAYS} days ago`}
    >
      Stale
    </span>
  );
}
