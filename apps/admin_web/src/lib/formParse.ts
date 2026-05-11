/** Parses a form text/number field into a finite float, or null if invalid. */
export function parseAmount(raw: string): number | null {
  const n = Number.parseFloat(raw.trim());
  return Number.isFinite(n) ? n : null;
}
