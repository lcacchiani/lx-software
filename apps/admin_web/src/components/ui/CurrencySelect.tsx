import {
  GLOBAL_DEFAULT_CURRENCY,
  SUPPORTED_CURRENCIES,
  type CurrencyCode,
} from "../../lib/currencies";

export type CurrencySelectProps = {
  readonly id: string;
  readonly value: string;
  readonly onChange: (code: CurrencyCode) => void;
  readonly className?: string;
  readonly disabled?: boolean;
  /** Accessible name when there is no visible `<label>` (e.g. inside a table total row). */
  readonly ariaLabel?: string;
};

/** Bootstrap `form-select` listing only admin-supported currency codes. */
export function CurrencySelect({
  id,
  value,
  onChange,
  className,
  disabled,
  ariaLabel,
}: CurrencySelectProps) {
  const normalized = SUPPORTED_CURRENCIES.includes(value as CurrencyCode)
    ? value
    : GLOBAL_DEFAULT_CURRENCY;
  return (
    <select
      id={id}
      className={className ?? "form-select form-select-sm"}
      value={normalized}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(ev) => onChange(ev.target.value as CurrencyCode)}
    >
      {SUPPORTED_CURRENCIES.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
  );
}
