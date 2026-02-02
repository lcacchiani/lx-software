export interface AppConfig {
  apiBaseUrl: string;
  cognitoDomain: string;
  cognitoClientId: string;
}

export const appConfig: AppConfig = {
  apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? '',
  cognitoDomain: process.env.NEXT_PUBLIC_COGNITO_DOMAIN ?? '',
  cognitoClientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID ?? '',
};

function trimTrailingSlashes(value: string) {
  return value.replace(/\/+$/, '');
}

export function getConfigErrors() {
  const errors: string[] = [];
  if (!appConfig.apiBaseUrl) {
    errors.push('NEXT_PUBLIC_API_BASE_URL is missing.');
  }
  if (!appConfig.cognitoDomain) {
    errors.push('NEXT_PUBLIC_COGNITO_DOMAIN is missing.');
  }
  if (!appConfig.cognitoClientId) {
    errors.push('NEXT_PUBLIC_COGNITO_CLIENT_ID is missing.');
  }
  return errors;
}

export function getCognitoDomain() {
  const trimmed = appConfig.cognitoDomain.trim();
  if (!trimmed) {
    throw new Error('Cognito domain is not configured.');
  }
  const withScheme = trimmed.startsWith('http')
    ? trimmed
    : `https://${trimmed}`;
  return trimTrailingSlashes(withScheme);
}

export function getApiBaseUrl() {
  const trimmed = appConfig.apiBaseUrl.trim();
  if (!trimmed) {
    throw new Error('API base URL is not configured.');
  }
  return trimTrailingSlashes(trimmed);
}
