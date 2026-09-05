import { useEffect, useId, useRef, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { formatDateTimeHKT } from "../lib/formatDisplay";
import { useAuth, type AuthUser } from "./AuthProvider";

type AdminNavItem = {
  readonly to: string;
  readonly label: string;
  readonly end?: boolean;
};

const ADMIN_NAV_GROUPS: readonly (readonly AdminNavItem[])[] = [
  [{ to: "/", label: "Dashboard", end: true }],
  [
    { to: "/finance", label: "House Finance" },
    { to: "/lx-software", label: "LX Software" },
    { to: "/siu-tin-dei", label: "Siu Tin Dei" },
  ],
  [
    { to: "/banking", label: "Banking" },
    { to: "/assets", label: "Assets" },
  ],
];

function SessionIdentity({ user }: { readonly user: AuthUser | null }) {
  if (!user?.email && !user?.lastLoginAt) {
    return null;
  }
  return (
    <div
      className="admin-mobile-session rounded border bg-body-secondary p-2 mb-3"
      aria-label="Signed-in account"
    >
      {user.email ? (
        <div className="fw-semibold text-break">{user.email}</div>
      ) : null}
      {user.lastLoginAt ? (
        <p className="small text-muted mb-0 mt-1">
          Last login {formatDateTimeHKT(user.lastLoginAt)}
        </p>
      ) : null}
    </div>
  );
}

function AdminNavLinks({ onNavigate }: { readonly onNavigate?: () => void }) {
  return (
    <nav className="nav flex-column gap-1" aria-label="Admin pages">
      {ADMIN_NAV_GROUPS.map((group, groupIndex) => (
        <div key={group[0].to} className="w-100">
          {groupIndex > 0 ? (
            <hr className="admin-nav-separator my-2" />
          ) : null}
          {group.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `nav-link rounded ${isActive ? "active fw-semibold" : ""}`
              }
              onClick={onNavigate}
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );
}

export function AuthenticatedShell() {
  const { logout, user } = useAuth();
  const [isNavOpen, setIsNavOpen] = useState(false);
  const navId = useId();
  const togglerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const closeNav = () => {
    setIsNavOpen(false);
    togglerRef.current?.focus();
  };

  useEffect(() => {
    if (!isNavOpen) {
      return;
    }
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsNavOpen(false);
        togglerRef.current?.focus();
      }
    };
    const media = window.matchMedia("(min-width: 768px)");
    const onViewportChange = () => {
      if (media.matches) {
        setIsNavOpen(false);
      }
    };
    // iOS Safari ignores `overflow: hidden` on body, so the lock pins the body
    // in place and restores the scroll offset when the drawer closes.
    const scrollY = window.scrollY;
    document.body.classList.add("admin-nav-open");
    document.body.style.top = `-${scrollY}px`;
    document.addEventListener("keydown", onKeyDown);
    media.addEventListener("change", onViewportChange);
    return () => {
      document.body.classList.remove("admin-nav-open");
      document.body.style.top = "";
      window.scrollTo(0, scrollY);
      document.removeEventListener("keydown", onKeyDown);
      media.removeEventListener("change", onViewportChange);
    };
  }, [isNavOpen]);

  return (
    <div className="d-flex flex-column admin-full-height">
      <nav className="navbar navbar-expand-md navbar-dark bg-dark">
        <div className="container-fluid">
          <button
            ref={togglerRef}
            type="button"
            className="navbar-toggler d-md-none"
            aria-label="Open navigation menu"
            aria-controls={navId}
            aria-expanded={isNavOpen}
            onClick={() => setIsNavOpen(true)}
          >
            <span className="navbar-toggler-icon" />
          </button>
          <span className="navbar-brand mb-0 h1 ms-2 ms-md-0">LX Admin</span>
          <div className="navbar-nav ms-auto align-items-center gap-2 flex-row">
            {user?.email ? (
              <span
                className="navbar-text text-white-50 small me-2 d-none d-sm-inline text-truncate admin-navbar-user"
                title={user.email}
              >
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
      {isNavOpen ? (
        <button
          type="button"
          className="admin-nav-backdrop d-md-none"
          aria-label="Close navigation menu"
          onClick={closeNav}
        />
      ) : null}
      <aside
        id={navId}
        className={`admin-mobile-nav d-md-none ${isNavOpen ? "is-open" : ""}`}
        role="dialog"
        aria-modal={isNavOpen}
        aria-label="Admin navigation"
        aria-hidden={!isNavOpen}
        inert={!isNavOpen}
      >
        <div className="d-flex align-items-center justify-content-between mb-3">
          <span className="fw-semibold">Menu</span>
          <button
            ref={closeRef}
            type="button"
            className="btn-close"
            aria-label="Close navigation menu"
            onClick={closeNav}
          />
        </div>
        <SessionIdentity user={user} />
        <AdminNavLinks onNavigate={closeNav} />
      </aside>
      <div className="d-flex flex-grow-1 min-w-0">
        <aside className="admin-sidebar border-end bg-white p-3 d-none d-md-block">
          <AdminNavLinks />
        </aside>
        <main className="admin-main flex-grow-1 p-3 p-md-4">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
