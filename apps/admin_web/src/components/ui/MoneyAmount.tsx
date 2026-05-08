import { formatMoneyAmount } from "../../lib/formatDisplay";

export type MoneyAmountProps = {
  readonly amount: number;
  readonly currency: string;
  readonly className?: string;
};

/** Renders a currency amount using ISO currency codes and `Intl.NumberFormat`. */
export function MoneyAmount({ amount, currency, className }: MoneyAmountProps) {
  return (
    <span className={className ?? undefined}>{formatMoneyAmount(amount, currency)}</span>
  );
}
