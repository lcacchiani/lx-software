import { Outlet } from "react-router-dom";
import { hasStoredSession } from "../lib/auth";
import { LoginPage } from "../pages/LoginPage";

/**
 * Blocks protected routes until a Cognito session exists in sessionStorage.
 * Renders a Bootstrap login screen when unauthenticated.
 */
export function RequireAuth() {
  if (!hasStoredSession()) {
    return <LoginPage />;
  }
  return <Outlet />;
}
