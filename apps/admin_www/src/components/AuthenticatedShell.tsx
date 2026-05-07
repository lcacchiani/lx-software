import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "./AuthProvider";

export function AuthenticatedShell() {
  const { logout, user } = useAuth();

  return (
    <div className="d-flex flex-column min-vh-100">
      <nav className="navbar navbar-expand-lg navbar-dark bg-dark">
        <div className="container-fluid">
          <span className="navbar-brand mb-0 h1">LX Admin</span>
          <div className="navbar-nav ms-auto align-items-lg-center gap-2 flex-row">
            {user?.email ? (
              <span className="navbar-text text-white-50 small me-2">
                {user.email}
              </span>
            ) : null}
            <button
              type="button"
              className="btn btn-outline-light btn-sm"
              onClick={() => logout()}
            >
              Sign out
            </button>
          </div>
        </div>
      </nav>
      <div className="d-flex flex-grow-1">
        <aside className="admin-sidebar border-end bg-white p-3 d-none d-md-block">
          <nav className="nav flex-column gap-1">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                `nav-link rounded ${isActive ? "active fw-semibold" : ""}`
              }
            >
              Dashboard
            </NavLink>
            <NavLink
              to="/assets"
              className={({ isActive }) =>
                `nav-link rounded ${isActive ? "active fw-semibold" : ""}`
              }
            >
              Assets
            </NavLink>
          </nav>
        </aside>
        <main className="admin-main flex-grow-1 p-4">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
