/** Public Frankfurter API (ECB-oriented FX); no API key. See https://www.frankfurter.dev/docs/ */

export const FRANKFURTER_API_BASE = "https://api.frankfurter.dev";

export type FrankfurterV2RateRow = {
  readonly date?: string;
  readonly base: string;
  readonly quote: string;
  readonly rate: number;
};

/**
 * Fetches cross-rates with a chosen base. Each returned row means: `1 base` = `rate` units of `quote`.
 * To express an amount held in `quote` in terms of `base`, divide by `rate`: `amountBase = amountQuote / rate`.
 */
export async function fetchFrankfurterRatesToBase(
  base: string,
  quotes: readonly string[],
): Promise<{ readonly date: string | undefined; readonly rateByQuote: ReadonlyMap<string, number> }> {
  const upperBase = base.trim().toUpperCase();
  const need = [...new Set(quotes.map((q) => q.trim().toUpperCase()))].filter((q) => q !== upperBase);
  if (need.length === 0) {
    return { date: undefined, rateByQuote: new Map() };
  }

  const url = `${FRANKFURTER_API_BASE}/v2/rates?base=${encodeURIComponent(upperBase)}&quotes=${need.map(encodeURIComponent).join(",")}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Frankfurter request failed (${res.status}) ${text}`.slice(0, 240));
  }

  const rows = (await res.json()) as unknown;
  if (!Array.isArray(rows)) {
    throw new Error("Frankfurter: unexpected response shape");
  }

  const rateByQuote = new Map<string, number>();
  let date: string | undefined;
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const quote = typeof o.quote === "string" ? o.quote.toUpperCase() : "";
    const rate = typeof o.rate === "number" ? o.rate : Number.NaN;
    if (!quote || !Number.isFinite(rate) || rate <= 0) continue;
    rateByQuote.set(quote, rate);
    if (typeof o.date === "string") date = o.date;
  }

  for (const q of need) {
    if (!rateByQuote.has(q)) {
      throw new Error(`Frankfurter: missing rate for ${q} (base ${upperBase})`);
    }
  }

  return { date, rateByQuote };
}

/** Converts `amount` from `fromCurrency` into `toCurrency` using `rateByQuote` from {@link fetchFrankfurterRatesToBase} with `base === toCurrency`. */
export function convertAmountToBase(
  amount: number,
  fromCurrency: string,
  toCurrency: string,
  rateByQuote: ReadonlyMap<string, number>,
): number {
  const from = fromCurrency.trim().toUpperCase();
  const to = toCurrency.trim().toUpperCase();
  if (from === to) return amount;
  const r = rateByQuote.get(from);
  if (r === undefined || r <= 0) {
    throw new Error(`No conversion rate for ${from} → ${to}`);
  }
  return amount / r;
}
