import type { HouseKey } from "./financeModel";

/** Canonical display names for each finance house key. */
export const HOUSE_DISPLAY_LABEL: Readonly<Record<HouseKey, string>> = {
  hillmarton: "32 Hillmarton",
  morrison: "The Morrison",
};

/** Options for ledger / investment “related property” controls (same order as API houses). */
export const LEDGER_RELATED_HOUSE_OPTIONS: ReadonlyArray<{
  readonly value: HouseKey;
  readonly label: string;
}> = [
  { value: "hillmarton", label: HOUSE_DISPLAY_LABEL.hillmarton },
  { value: "morrison", label: HOUSE_DISPLAY_LABEL.morrison },
];

/** Resolves a stored house or statement-book key to a label. */
export function houseDisplayLabel(house?: string): string {
  if (!house?.trim()) return "—";
  if (house === "siuTinDei") return "Siu Tin Dei";
  const label = HOUSE_DISPLAY_LABEL[house as HouseKey];
  return label ?? house;
}
