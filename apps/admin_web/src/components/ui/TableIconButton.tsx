export type TableIconButtonProps = {
  readonly iconClassName: string;
  /** Accessible name (required because there is no visible label). */
  readonly ariaLabel: string;
  readonly onClick?: () => void;
  readonly variant?: "default" | "danger";
  readonly type?: "button" | "submit";
  readonly disabled?: boolean;
};

/** Icon-only control for the operations column (must pair with `aria-label`). */
export function TableIconButton({
  iconClassName,
  ariaLabel,
  onClick,
  variant = "default",
  type = "button",
  disabled,
}: TableIconButtonProps) {
  return (
    <button
      type={type}
      className={`btn btn-sm btn-link p-1 lh-1 ${variant === "danger" ? "text-danger" : ""}`}
      aria-label={ariaLabel}
      title={ariaLabel}
      onClick={onClick}
      disabled={disabled}
    >
      <i className={iconClassName} aria-hidden="true" />
    </button>
  );
}
