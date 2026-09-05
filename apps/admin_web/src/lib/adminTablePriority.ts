export type AdminTableColumnPriority = "primary" | "secondary" | "tertiary";

export const ADMIN_COL_PRIORITY_CLASS: Record<AdminTableColumnPriority, string> = {
  primary: "",
  secondary: "admin-col-secondary",
  tertiary: "admin-col-tertiary",
};

/** CSS class that hides a table column below `md` (`secondary`) or `lg` (`tertiary`). */
export function adminColumnPriorityClass(
  priority: AdminTableColumnPriority = "primary",
): string {
  return ADMIN_COL_PRIORITY_CLASS[priority];
}
