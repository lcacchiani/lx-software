import {
  formatMoneyAmount,
  formatMoneyAmountWithoutCurrency,
} from "../../lib/formatDisplay";

export type MoneyAmountProps = {
  readonly amount: number;
  readonly currency: string;
  readonly className?: string;
  /** When true, only the numeric part is shown (currency is omitted). */
  readonly amountOnly?: boolean;
};

/** Renders a currency amount using ISO currency codes and `Intl.NumberFormat`. */
export function MoneyAmount({
  amount,
  currency,
  className,
  amountOnly = false,
}: MoneyAmountProps) {
  const text = amountOnly
    ? formatMoneyAmountWithoutCurrency(amount, currency)
    : formatMoneyAmount(amount, currency);
  return <span className={className ?? undefined}>{text}</span>;
}
