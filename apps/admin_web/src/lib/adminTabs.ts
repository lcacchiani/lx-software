/** DOM id of one tab button, used for `aria-labelledby` on the matching tabpanel. */
export function adminTabButtonId(prefix: string, tabId: string): string {
  return `${prefix}-tab-${tabId}`;
}

/** Phones switch from the two-column grid to a native `<select>` above this many tabs. */
export const ADMIN_TAB_SELECT_THRESHOLD = 6;

/**
 * Next tab id for a WAI-ARIA tablist key press (automatic activation model).
 * Returns null for keys that are not tablist navigation.
 */
export function nextTabIdForKey<T extends string>(
  key: string,
  ids: readonly T[],
  current: T,
): T | null {
  if (ids.length === 0) return null;
  const index = Math.max(0, ids.indexOf(current));
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return ids[(index + 1) % ids.length];
    case "ArrowLeft":
    case "ArrowUp":
      return ids[(index - 1 + ids.length) % ids.length];
    case "Home":
      return ids[0];
    case "End":
      return ids[ids.length - 1];
    default:
      return null;
  }
}
