export type AdminTabItem<T extends string> = {
  readonly id: T;
  readonly label: string;
};

export type AdminTabListProps<T extends string> = {
  readonly tabs: readonly AdminTabItem<T>[];
  readonly active: T;
  readonly onChange: (id: T) => void;
  readonly className?: string;
};

/**
 * Horizontally scrollable Bootstrap tab list so every tab stays reachable on
 * narrow viewports instead of wrapping off-screen or becoming untappable.
 */
export function AdminTabList<T extends string>({
  tabs,
  active,
  onChange,
  className = "mb-4",
}: AdminTabListProps<T>) {
  return (
    <ul className={`nav nav-tabs admin-tab-list ${className}`.trim()} role="tablist">
      {tabs.map((item) => {
        const isActive = item.id === active;
        return (
          <li key={item.id} className="nav-item flex-shrink-0" role="presentation">
            <button
              type="button"
              className={`nav-link ${isActive ? "active" : ""}`}
              role="tab"
              aria-selected={isActive}
              onClick={() => onChange(item.id)}
            >
              {item.label}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
