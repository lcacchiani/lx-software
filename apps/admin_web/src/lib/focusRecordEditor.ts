const FORM_FIELD_SELECTOR =
  'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])';

/**
 * Scrolls a record editor card into view and focuses the first editable field in
 * its body (matches `AdminEditorSection`: `.card` > `.card-body`).
 */
export function focusRecordEditor(cardRoot: HTMLElement | null): void {
  if (!cardRoot) return;
  cardRoot.scrollIntoView({ block: "nearest", behavior: "smooth" });
  const body = cardRoot.querySelector<HTMLElement>(".card-body") ?? cardRoot;
  const field = body.querySelector<HTMLElement>(FORM_FIELD_SELECTOR);
  field?.focus({ preventScroll: true });
}

/** Defer until after React has committed DOM updates (e.g. conditional editors). */
export function scheduleFocusRecordEditor(getCardRoot: () => HTMLElement | null): void {
  window.setTimeout(() => {
    focusRecordEditor(getCardRoot());
  }, 0);
}
