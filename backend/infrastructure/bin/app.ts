import * as cdk from "aws-cdk-lib";
import { AdminApiStack } from "../lib/admin-api-stack";
import { AdminAssetsStack } from "../lib/admin-assets-stack";
import { AdminAuthStack } from "../lib/admin-auth-stack";
import { AdminDataStack } from "../lib/admin-data-stack";
import { AdminWebStack } from "../lib/admin-web-stack";
import { PublicWebsiteStack } from "../lib/public-website-stack";

const app = new cdk.App();

const bootstrapQualifier = process.env.CDK_BOOTSTRAP_QUALIFIER;
if (bootstrapQualifier) {
  app.node.setContext("@aws-cdk/core:bootstrapQualifier", bootstrapQualifier);
}

const synthesizer = bootstrapQualifier
  ? new cdk.DefaultStackSynthesizer({ qualifier: bootstrapQualifier })
  : undefined;

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

new PublicWebsiteStack(app, "lxsoftware-public-www", {
  description: "LX Software Public Website",
  env,
  synthesizer,
});

const adminAuth = new AdminAuthStack(app, "lx-admin-auth", {
  description: "LX Software admin Cognito auth",
  env,
  synthesizer,
});

const adminData = new AdminDataStack(app, "lx-admin-data", {
  description: "LX Software admin DynamoDB tables",
  env,
  synthesizer,
});

const adminAssets = new AdminAssetsStack(app, "lx-admin-assets", {
  description: "LX Software admin private S3 assets",
  env,
  synthesizer,
});

const adminApi = new AdminApiStack(app, "lx-admin-api", {
  description: "LX Software admin HTTP API",
  env,
  synthesizer,
  userPool: adminAuth.auth.userPool,
  userPoolClient: adminAuth.auth.userPoolClient,
  recordsTable: adminData.recordsTable,
  auditLogTable: adminData.auditLogTable,
  assetsBucket: adminAssets.bucket,
});

new AdminWebStack(app, "lx-admin-web", {
  description: "LX Software admin SPA on S3 and CloudFront",
  env,
  synthesizer,
  cspCognitoConnectOrigin: adminAuth.auth.userPoolDomain.baseUrl(),
  cspApiConnectOrigin: adminApi.httpApi.apiEndpoint,
});
