import { useAuth } from "../components/AuthProvider";

export function LoginPage() {
  const { login } = useAuth();

  return (
    <div className="min-vh-100 d-flex align-items-center justify-content-center p-3 bg-light">
      <div className="card shadow-sm" style={{ maxWidth: "420px", width: "100%" }}>
        <div className="card-body p-4">
          <h1 className="h4 mb-3 text-center">LX Software Admin</h1>
          <p className="text-muted small text-center mb-4">
            Sign in with your Google Workspace account. MFA may be required after
            first access.
          </p>
          <div className="d-grid">
            <button
              type="button"
              className="btn btn-primary btn-lg"
              onClick={() => void login()}
            >
              Sign in with Google
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
