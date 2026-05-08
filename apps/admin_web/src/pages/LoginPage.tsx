import { useState } from "react";
import { useAuth } from "../components/AuthProvider";
import { LOGIN_DENIED_FLASH_KEY } from "../lib/auth";

function consumeLoginDeniedFlash(): string | null {
  const msg = sessionStorage.getItem(LOGIN_DENIED_FLASH_KEY);
  if (msg) {
    sessionStorage.removeItem(LOGIN_DENIED_FLASH_KEY);
  }
  return msg;
}

export function LoginPage() {
  const { loginWithGoogle } = useAuth();
  const [deniedMessage] = useState<string | null>(() =>
    consumeLoginDeniedFlash()
  );

  return (
    <div className="min-vh-100 d-flex align-items-center justify-content-center p-3 bg-light">
      <div className="card shadow-sm" style={{ maxWidth: "420px", width: "100%" }}>
        <div className="card-body p-4">
          <h1 className="h4 mb-3 text-center">LX Software Admin</h1>
          {deniedMessage ? (
            <div className="alert alert-danger small" role="alert">
              {deniedMessage}
            </div>
          ) : null}
          <div className="d-grid gap-2">
            <button
              type="button"
              className="btn btn-primary btn-lg"
              onClick={() => void loginWithGoogle()}
            >
              Sign in with Google
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
