/* eslint-disable react-refresh/only-export-components -- useAuth is intentionally co-located with its provider */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { clearStoredSession, getStoredIdToken } from "../lib/auth";
import { createPkcePair } from "../lib/pkce";
import { getAdminConfig } from "../lib/config";
import { getCognitoUserPool } from "../lib/cognitoAuth";
import { decodeJwtPayload } from "../lib/jwt";

export interface AuthUser {
  readonly sub: string;
  readonly email?: string;
}

function decodeUserFromIdToken(idToken: string): AuthUser | null {
  try {
    const json = decodeJwtPayload<{ sub?: string; email?: string }>(idToken);
    if (!json.sub) {
      return null;
    }
    return { sub: json.sub, email: json.email };
  } catch {
    return null;
  }
}

interface AuthContextValue {
  readonly user: AuthUser | null;
  readonly idToken: string | null;
  readonly isLoading: boolean;
  readonly loginWithGoogle: () => Promise<void>;
  readonly loginWithHostedUi: () => Promise<void>;
  readonly logout: () => void;
  readonly refreshUser: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function randomState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function beginOAuthRedirect(identityProvider?: "Google"): Promise<void> {
  const cfg = getAdminConfig();
  const { verifier, challenge } = await createPkcePair();
  const state = randomState();
  sessionStorage.setItem("lx_admin_pkce_verifier", verifier);
  sessionStorage.setItem("lx_admin_oauth_state", state);
  const params = new URLSearchParams({
    response_type: "code",
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    scope: "openid email profile",
    code_challenge_method: "S256",
    code_challenge: challenge,
    state,
  });
  if (identityProvider) {
    params.set("identity_provider", identityProvider);
  }
  window.location.href = `${cfg.cognitoDomain}/oauth2/authorize?${params.toString()}`;
}

export function AuthProvider({ children }: { readonly children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => {
    const t = getStoredIdToken();
    return t ? decodeUserFromIdToken(t) : null;
  });
  const [isLoading] = useState(false);

  useEffect(() => {
    getCognitoUserPool();
  }, []);

  const idToken = getStoredIdToken();

  const refreshUser = useCallback(() => {
    const t = getStoredIdToken();
    setUser(t ? decodeUserFromIdToken(t) : null);
  }, []);

  const loginWithGoogle = useCallback(async () => {
    await beginOAuthRedirect("Google");
  }, []);

  const loginWithHostedUi = useCallback(async () => {
    await beginOAuthRedirect(undefined);
  }, []);

  const logout = useCallback(() => {
    void (async () => {
      const cfg = getAdminConfig();
      const refreshToken = sessionStorage.getItem("lx_admin_refresh_token");
      if (refreshToken) {
        try {
          await fetch(`${cfg.cognitoDomain}/oauth2/revoke`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              token: refreshToken,
              client_id: cfg.clientId,
            }),
          });
        } catch {
          /* fire-and-forget */
        }
      }
      clearStoredSession();
      setUser(null);
      const logoutUri =
        import.meta.env.VITE_COGNITO_LOGOUT_URI ?? `${window.location.origin}/`;
      const logoutUrl = new URL(`${cfg.cognitoDomain}/logout`);
      logoutUrl.searchParams.set("client_id", cfg.clientId);
      logoutUrl.searchParams.set("logout_uri", logoutUri);
      /**
       * Cognito /logout ends the Cognito session only. Google may still have an
       * active browser session, so the next “Sign in with Google” can be silent.
       * See docs/architecture/admin-security.md.
       */
      window.location.href = logoutUrl.toString();
    })();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      idToken,
      isLoading,
      loginWithGoogle,
      loginWithHostedUi,
      logout,
      refreshUser,
    }),
    [user, idToken, isLoading, loginWithGoogle, loginWithHostedUi, logout, refreshUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
