import * as cdk from "aws-cdk-lib";
import { LxsoftwareAdminWebStack } from "../lib/lxsoftware-admin-web-stack";
import { LxsoftwareStack } from "../lib/lxsoftware-stack";
import { PublicWebsiteStack } from "../lib/public-website-stack";

const app = new cdk.App();

// Centralized tagging — applied to every resource in every stack that
// supports tagging. Keep tag *keys* stable; rotating keys forces a churn
// across every supported AWS resource.
const COMMON_TAGS: Record<string, string> = {
  Organization: "LX Software",
  Repository: "lx-software",
  Environment: "production",
  ManagedBy: "CDK",
};

for (const [k, v] of Object.entries(COMMON_TAGS)) {
  cdk.Tags.of(app).add(k, v);
}

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

/**
 * Tag a stack with its name + a logical Component / Project so cost reports
 * can group by stack or by product surface.
 */
function tagStack(stack: cdk.Stack, project: string, component: string) {
  cdk.Tags.of(stack).add("Project", project);
  cdk.Tags.of(stack).add("Component", component);
  cdk.Tags.of(stack).add("Stack", stack.stackName);
}

// 1) Public marketing website (S3 + CloudFront).
const publicWeb = new PublicWebsiteStack(app, "lxsoftware-public-www", {
  description: "LX Software public marketing website (S3 + CloudFront).",
  env,
  synthesizer,
});
tagStack(publicWeb, "Public Website", "marketing-site");

// 2) Consolidated admin backend (Cognito + DynamoDB + S3 assets + HTTP API).
const lxsoftware = new LxsoftwareStack(app, "lxsoftware", {
  description:
    "LX Software admin backend: Cognito user pool, DynamoDB tables, private uploads bucket, and HTTP API.",
  env,
  synthesizer,
});
tagStack(lxsoftware, "Admin Console", "backend");

// 3) Admin SPA delivery (S3 + CloudFront + WAF/CSP). Renamed from lx-admin-web.
const adminWeb = new LxsoftwareAdminWebStack(app, "lxsoftware-admin-web", {
  description: "LX Software admin SPA delivery (S3 + CloudFront).",
  env,
  synthesizer,
  cspCognitoConnectOrigin: lxsoftware.auth.userPoolDomain.baseUrl(),
  cspApiConnectOrigin: lxsoftware.httpApi.apiEndpoint,
});
tagStack(adminWeb, "Admin Console", "spa");
