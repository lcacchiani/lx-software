import type { ReactNode } from "react";

export type AdminPageIntroProps = {
  readonly children: ReactNode;
  readonly summary?: string;
};

/**
 * Explanatory copy under a page title. Shown inline from `md`; on phones it is
 * collapsed behind a disclosure so the page's controls stay above the fold.
 */
export function AdminPageIntro({ children, summary = "About this page" }: AdminPageIntroProps) {
  return (
    <>
      <details className="admin-page-intro d-md-none mb-3">
        <summary className="small text-muted">{summary}</summary>
        <p className="text-muted small mt-2 mb-0">{children}</p>
      </details>
      <p className="text-muted d-none d-md-block mb-4">{children}</p>
    </>
  );
}
