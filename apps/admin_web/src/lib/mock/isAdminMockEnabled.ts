/** True when the SPA should serve fixture data instead of calling the admin API. */
export function isAdminMockEnabled(): boolean {
  return import.meta.env.VITE_ADMIN_MOCK === "1";
}
