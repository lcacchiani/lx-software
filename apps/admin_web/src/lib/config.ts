export interface AdminConfig {
  readonly userPoolId: string;
  readonly clientId: string;
  readonly cognitoDomain: string;
  readonly redirectUri: string;
  readonly apiBaseUrl: string;
}

export function getAdminConfig(): AdminConfig {
  const userPoolId = import.meta.env.VITE_COGNITO_USER_POOL_ID ?? "";
  const clientId = import.meta.env.VITE_COGNITO_CLIENT_ID ?? "";
  const cognitoDomain = (import.meta.env.VITE_COGNITO_DOMAIN ?? "").replace(
    /\/$/,
    ""
  );
  const redirectUri = import.meta.env.VITE_COGNITO_REDIRECT_URI ?? "";
  const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "").replace(
    /\/$/,
    ""
  );

  if (!userPoolId || !clientId || !cognitoDomain || !redirectUri) {
    throw new Error(
      "Missing Cognito VITE_ configuration. Copy .env.example to .env and set values."
    );
  }

  return {
    userPoolId,
    clientId,
    cognitoDomain,
    redirectUri,
    apiBaseUrl,
  };
}
