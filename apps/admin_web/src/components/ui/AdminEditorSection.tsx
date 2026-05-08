import type { ReactNode } from "react";

export type AdminEditorSectionProps = {
  readonly title?: string;
  readonly description?: string;
  readonly children: ReactNode;
  /** Primary actions (Save / Update). Placed at the **bottom-left** of the section. */
  readonly footer?: ReactNode;
};

/**
 * Editor chrome: content first, then a footer row with actions aligned to the start.
 * Use for forms that sit **above** data tables.
 */
export function AdminEditorSection({
  title,
  description,
  children,
  footer,
}: AdminEditorSectionProps) {
  return (
    <div className="card shadow-sm mb-4">
      <div className="card-body">
        {title ? (
          <h2 className="h6 text-uppercase text-muted mb-2">{title}</h2>
        ) : null}
        {description ? (
          <p className="small text-muted mb-3">{description}</p>
        ) : null}
        {children}
      </div>
      {footer ? (
        <div className="card-footer bg-transparent border-top pt-3 pb-3 d-flex justify-content-start align-items-center gap-2 flex-wrap">
          {footer}
        </div>
      ) : null}
    </div>
  );
}
