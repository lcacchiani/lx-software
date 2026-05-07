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

export interface AuthUser {
  readonly sub: string;
  readonly email?: string;
}

function decodeUserFromIdToken(idToken: string): AuthUser | null {
  try {
    const [, payload] = idToken.split(".");
    if (!payload) {
      return null;
    }
    const padded = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = JSON.parse(atob(padded)) as {
      sub?: string;
      email?: string;
    };
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
  readonly login: () => Promise<void>;
  readonly logout: () => void;
  readonly refreshUser: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

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

  const login = useCallback(async () => {
    const cfg = getAdminConfig();
    const { verifier, challenge } = await createPkcePair();
    sessionStorage.setItem("lx_admin_pkce_verifier", verifier);
    const params = new URLSearchParams({
      identity_provider: "Google",
      response_type: "code",
      client_id: cfg.clientId,
      redirect_uri: cfg.redirectUri,
      scope: "openid email profile",
      code_challenge_method: "S256",
      code_challenge: challenge,
    });
    window.location.href = `${cfg.cognitoDomain}/oauth2/authorize?${params.toString()}`;
  }, []);

  const logout = useCallback(() => {
    clearStoredSession();
    setUser(null);
    const cfg = getAdminConfig();
    const logoutUri =
      import.meta.env.VITE_COGNITO_LOGOUT_URI ?? `${window.location.origin}/`;
    const logoutUrl = new URL(`${cfg.cognitoDomain}/logout`);
    logoutUrl.searchParams.set("client_id", cfg.clientId);
    logoutUrl.searchParams.set("logout_uri", logoutUri);
    window.location.href = logoutUrl.toString();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      idToken,
      isLoading,
      login,
      logout,
      refreshUser,
    }),
    [user, idToken, isLoading, login, logout, refreshUser]
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
