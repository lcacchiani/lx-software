import { Outlet } from "react-router-dom";
import { hasAdminSession } from "../lib/auth";
import { LoginPage } from "../pages/LoginPage";

/**
 * Blocks protected routes until a Cognito session exists with the `admin`
 * Cognito group on the ID token. Renders a Bootstrap login screen otherwise.
 */
export function RequireAuth() {
  if (!hasAdminSession()) {
    return <LoginPage />;
  }
  return <Outlet />;
}
