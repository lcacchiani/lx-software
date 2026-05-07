import * as cdk from "aws-cdk-lib";
import type { Construct } from "constructs";
import { AuthConstruct } from "./constructs/auth";

export class AdminAuthStack extends cdk.Stack {
  public readonly auth: AuthConstruct;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    cdk.Tags.of(this).add("Organization", "LX Software");
    cdk.Tags.of(this).add("Project", "Admin Console");

    const adminWebDomainName = new cdk.CfnParameter(this, "AdminWebDomainName", {
      type: "String",
      description: "Public hostname for the admin SPA (e.g. admin.lx-software.com).",
      default: "admin.lx-software.com",
    });

    const googleClientId = new cdk.CfnParameter(this, "GoogleClientId", {
      type: "String",
      description: "Google OAuth client ID for Cognito federation.",
    });

    const googleClientSecret = new cdk.CfnParameter(this, "GoogleClientSecret", {
      type: "String",
      description: "Google OAuth client secret for Cognito federation.",
      noEcho: true,
    });

    const adminBootstrapEmail = new cdk.CfnParameter(this, "AdminBootstrapEmail", {
      type: "String",
      description: "Email for the initial native admin user (bootstrap).",
    });

    const adminBootstrapTempPassword = new cdk.CfnParameter(
      this,
      "AdminBootstrapTempPassword",
      {
        type: "String",
        description:
          "Temporary password for bootstrap admin (must meet pool policy; rotate after first login).",
        noEcho: true,
      }
    );

    const cognitoDomainPrefix = new cdk.CfnParameter(this, "CognitoDomainPrefix", {
      type: "String",
      description: "Globally unique Cognito hosted UI domain prefix.",
      default: "lx-admin-auth",
    });

    this.auth = new AuthConstruct(this, "Auth", {
      adminWebDomainParameter: adminWebDomainName,
      googleClientIdParameter: googleClientId,
      googleClientSecretParameter: googleClientSecret,
      cognitoDomainPrefixParameter: cognitoDomainPrefix,
      adminBootstrapEmailParameter: adminBootstrapEmail,
      adminBootstrapTempPasswordParameter: adminBootstrapTempPassword,
    });

    const cognitoDomainUrl = this.auth.userPoolDomain.baseUrl();

    new cdk.CfnOutput(this, "UserPoolId", {
      value: this.auth.userPool.userPoolId,
      exportName: "lx-admin-UserPoolId",
    });

    new cdk.CfnOutput(this, "UserPoolClientId", {
      value: this.auth.userPoolClient.userPoolClientId,
      exportName: "lx-admin-UserPoolClientId",
    });

    new cdk.CfnOutput(this, "UserPoolArn", {
      value: this.auth.userPool.userPoolArn,
      exportName: "lx-admin-UserPoolArn",
    });

    new cdk.CfnOutput(this, "CognitoDomain", {
      value: cognitoDomainUrl,
      description: "Full https URL for Cognito hosted UI / OAuth.",
      exportName: "lx-admin-CognitoDomain",
    });
  }
}
