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
};

/** Bootstrap `form-select` listing only admin-supported currency codes. */
export function CurrencySelect({
  id,
  value,
  onChange,
  className,
  disabled,
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
