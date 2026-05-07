import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../components/AuthProvider";
import { saveTokensFromOAuthResponse } from "../lib/auth";
import { getAdminConfig } from "../lib/config";

const OAUTH_CALLBACK_GUARD = "__lxAdminOauthCallbackStarted";

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const { refreshUser } = useAuth();

  useEffect(() => {
    const win = window as unknown as Record<string, boolean>;
    if (win[OAUTH_CALLBACK_GUARD]) {
      return;
    }
    win[OAUTH_CALLBACK_GUARD] = true;

    let cancelled = false;
    const run = async () => {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      const state = params.get("state");
      const expectedState = sessionStorage.getItem("lx_admin_oauth_state");
      if (
        !code ||
        !state ||
        !expectedState ||
        state !== expectedState
      ) {
        sessionStorage.removeItem("lx_admin_pkce_verifier");
        sessionStorage.removeItem("lx_admin_oauth_state");
        navigate("/", { replace: true });
        return;
      }
      const verifier = sessionStorage.getItem("lx_admin_pkce_verifier");
      if (!verifier) {
        navigate("/", { replace: true });
        return;
      }
      const cfg = getAdminConfig();
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        client_id: cfg.clientId,
        code,
        redirect_uri: cfg.redirectUri,
        code_verifier: verifier,
      });
      const res = await fetch(`${cfg.cognitoDomain}/oauth2/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      if (!res.ok || cancelled) {
        sessionStorage.removeItem("lx_admin_pkce_verifier");
        sessionStorage.removeItem("lx_admin_oauth_state");
        navigate("/", { replace: true });
        return;
      }
      const json = (await res.json()) as {
        id_token: string;
        access_token: string;
        refresh_token?: string;
        expires_in: number;
      };
      saveTokensFromOAuthResponse({
        id_token: json.id_token,
        access_token: json.access_token,
        refresh_token: json.refresh_token,
        expires_in: json.expires_in,
      });
      sessionStorage.removeItem("lx_admin_pkce_verifier");
      sessionStorage.removeItem("lx_admin_oauth_state");
      refreshUser();
      navigate("/", { replace: true });
    };
    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run OAuth exchange once per full page load (see guard above)
  }, []);

  return (
    <div className="container py-5 text-center">
      <p className="text-muted">Completing sign-in…</p>
    </div>
  );
}
