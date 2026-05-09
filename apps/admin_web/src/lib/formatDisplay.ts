import { GLOBAL_DEFAULT_CURRENCY } from "./currencies";

/** Shared formatting for admin UI (money + Hong Kong local time display). */

export function formatMoneyAmount(amount: number, currency: string): string {
  const code =
    currency.length === 3 ? currency.toUpperCase() : GLOBAL_DEFAULT_CURRENCY;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

/** Same digit grouping as {@link formatMoneyAmount}, but omits currency symbol/code (for tables that show currency in another column). */
export function formatMoneyAmountWithoutCurrency(
  amount: number,
  currency: string,
): string {
  const code =
    currency.length === 3 ? currency.toUpperCase() : GLOBAL_DEFAULT_CURRENCY;
  try {
    const parts = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
    }).formatToParts(amount);
    const s = parts
      .filter((p) => p.type !== "currency")
      .map((p) => p.value)
      .join("")
      .trim();
    return s.length > 0 ? s : amount.toFixed(2);
  } catch {
    return amount.toFixed(2);
  }
}

/**
 * Formats an ISO 8601 instant for display in Hong Kong time, e.g.
 * `May 26, 2026 at 10:12pm HKT`.
 */
export function formatDateTimeHKT(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return "—";
  }

  const dateFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Hong_Kong",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const dateParts = dateFmt.formatToParts(d);
  const month = dateParts.find((p) => p.type === "month")?.value ?? "";
  const day = dateParts.find((p) => p.type === "day")?.value ?? "";
  const year = dateParts.find((p) => p.type === "year")?.value ?? "";

  const timeFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Hong_Kong",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const timeParts = timeFmt.formatToParts(d);
  const hour = timeParts.find((p) => p.type === "hour")?.value ?? "";
  const minute = timeParts.find((p) => p.type === "minute")?.value ?? "";
  const dayPeriod =
    timeParts.find((p) => p.type === "dayPeriod")?.value?.toLowerCase() ?? "";

  return `${month} ${day}, ${year} at ${hour}:${minute}${dayPeriod} HKT`;
}
