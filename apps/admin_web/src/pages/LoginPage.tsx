import { useAuth } from "../components/AuthProvider";

export function LoginPage() {
  const { loginWithGoogle, loginWithHostedUi } = useAuth();

  return (
    <div className="min-vh-100 d-flex align-items-center justify-content-center p-3 bg-light">
      <div className="card shadow-sm" style={{ maxWidth: "420px", width: "100%" }}>
        <div className="card-body p-4">
          <h1 className="h4 mb-3 text-center">LX Software Admin</h1>
          <p className="text-muted small text-center mb-4">
            Google accounts must be listed in the Cognito Pre Token Generation
            allow-list. Use email/password for the break-glass bootstrap user.
          </p>
          <div className="d-grid gap-2">
            <button
              type="button"
              className="btn btn-primary btn-lg"
              onClick={() => void loginWithGoogle()}
            >
              Sign in with Google
            </button>
            <button
              type="button"
              className="btn btn-outline-secondary"
              onClick={() => void loginWithHostedUi()}
            >
              Sign in with email (Hosted UI)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
