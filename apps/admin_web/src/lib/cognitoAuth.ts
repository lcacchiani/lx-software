import { CognitoUserPool } from "amazon-cognito-identity-js";
import { getAdminConfig } from "./config";

let cachedPool: CognitoUserPool | undefined;

export function getCognitoUserPool(): CognitoUserPool {
  if (!cachedPool) {
    const cfg = getAdminConfig();
    cachedPool = new CognitoUserPool({
      UserPoolId: cfg.userPoolId,
      ClientId: cfg.clientId,
    });
  }
  return cachedPool;
}
