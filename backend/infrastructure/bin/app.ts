import * as cdk from "aws-cdk-lib";
import { ApiStack } from "../lib/api-stack";
import { AdminWebStack } from "../lib/admin-web-stack";

const app = new cdk.App();

const bootstrapQualifier = process.env.CDK_BOOTSTRAP_QUALIFIER;
if (bootstrapQualifier) {
  app.node.setContext("@aws-cdk/core:bootstrapQualifier", bootstrapQualifier);
}

new ApiStack(app, "lxsoftware-siutindei", {
  description: "LX Software Siu Tin Dei",
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  synthesizer: bootstrapQualifier
    ? new cdk.DefaultStackSynthesizer({ qualifier: bootstrapQualifier })
    : undefined,
});

new AdminWebStack(app, "lxsoftware-siutindei-admin-web", {
  description: "LX Software Siu Tin Dei Admin Web",
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  synthesizer: bootstrapQualifier
    ? new cdk.DefaultStackSynthesizer({ qualifier: bootstrapQualifier })
    : undefined,
});
