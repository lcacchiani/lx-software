import { formatDateTimeHKT } from "../../lib/formatDisplay";

export type DateTimeDisplayProps = {
  /** ISO 8601 instant (any offset); shown in Asia/Hong_Kong. */
  readonly iso: string;
  readonly className?: string;
};

/** Renders a wall-clock time in HKT, e.g. “May 26, 2026 at 10:12pm HKT”. */
export function DateTimeDisplay({ iso, className }: DateTimeDisplayProps) {
  return (
    <span className={`small text-nowrap ${className ?? ""}`.trim()}>
      {formatDateTimeHKT(iso)}
    </span>
  );
}
