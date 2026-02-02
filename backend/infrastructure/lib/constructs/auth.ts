import * as cdk from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as customresources from "aws-cdk-lib/custom-resources";
import { Construct } from "constructs";

/**
 * Configuration for identity providers.
 */
export interface IdentityProviderConfig {
  google?: {
    clientId: string;
    clientSecret: string;
  };
  apple?: {
    clientId: string;
    teamId: string;
    keyId: string;
    privateKey: string;
  };
  microsoft?: {
    tenantId: string;
    clientId: string;
    clientSecret: string;
  };
}

/**
 * Configuration for admin bootstrap user.
 */
export interface AdminBootstrapConfig {
  email: string;
  tempPassword: string;
}

/**
 * Properties for the AuthConstruct.
 */
export interface AuthConstructProps {
  /** Resource name prefix for naming resources. */
  resourcePrefix: string;
  /** Cognito domain prefix for hosted UI. */
  domainPrefix: string;
  /** OAuth callback URLs. */
  callbackUrls: string[];
  /** OAuth logout URLs. */
  logoutUrls: string[];
  /** Identity provider configuration. */
  identityProviders: IdentityProviderConfig;
  /** Lambda triggers for custom auth flow. */
  triggers?: {
    preSignUp?: lambda.IFunction;
    defineAuthChallenge?: lambda.IFunction;
    createAuthChallenge?: lambda.IFunction;
    verifyAuthChallengeResponse?: lambda.IFunction;
  };
  /** Optional admin bootstrap configuration. */
  adminBootstrap?: AdminBootstrapConfig;
  /** Optional user groups to create in the user pool. */
  userGroups?: string[];
}

/**
 * Construct for Cognito User Pool with federated identity providers.
 *
 * Creates:
 * - Cognito User Pool with email sign-in
 * - Google, Apple, and Microsoft identity providers
 * - User Pool Client with OAuth configuration
 * - Admin group
 * - Optional bootstrap admin user
 */
export class AuthConstruct extends Construct {
  /** The Cognito User Pool. */
  public readonly userPool: cognito.UserPool;
  /** The User Pool Client (L1 construct for full control). */
  public readonly userPoolClient: cognito.CfnUserPoolClient;
  /** The admin group name. */
  public readonly adminGroupName = "admin";

  constructor(scope: Construct, id: string, props: AuthConstructProps) {
    super(scope, id);

    const name = (suffix: string) => `${props.resourcePrefix}-${suffix}`;

    // User Pool
    this.userPool = new cognito.UserPool(this, "UserPool", {
      userPoolName: name("user-pool"),
      signInAliases: { email: true },
      autoVerify: { email: true },
      selfSignUpEnabled: true,
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
    });

    // Add Lambda triggers if provided
    if (props.triggers?.preSignUp) {
      this.userPool.addTrigger(
        cognito.UserPoolOperation.PRE_SIGN_UP,
        props.triggers.preSignUp
      );
    }
    if (props.triggers?.defineAuthChallenge) {
      this.userPool.addTrigger(
        cognito.UserPoolOperation.DEFINE_AUTH_CHALLENGE,
        props.triggers.defineAuthChallenge
      );
    }
    if (props.triggers?.createAuthChallenge) {
      this.userPool.addTrigger(
        cognito.UserPoolOperation.CREATE_AUTH_CHALLENGE,
        props.triggers.createAuthChallenge
      );
    }
    if (props.triggers?.verifyAuthChallengeResponse) {
      this.userPool.addTrigger(
        cognito.UserPoolOperation.VERIFY_AUTH_CHALLENGE_RESPONSE,
        props.triggers.verifyAuthChallengeResponse
      );
    }

    // Identity providers
    const providers: cognito.CfnUserPoolIdentityProvider[] = [];
    const supportedProviders: string[] = [];

    if (props.identityProviders.google) {
      const googleProvider = new cognito.CfnUserPoolIdentityProvider(
        this,
        "GoogleProvider",
        {
          providerName: "Google",
          providerType: "Google",
          userPoolId: this.userPool.userPoolId,
          attributeMapping: {
            email: "email",
            given_name: "given_name",
            family_name: "family_name",
          },
          providerDetails: {
            client_id: props.identityProviders.google.clientId,
            client_secret: props.identityProviders.google.clientSecret,
            authorize_scopes: "openid email profile",
          },
        }
      );
      providers.push(googleProvider);
      supportedProviders.push("Google");
    }

    if (props.identityProviders.apple) {
      const appleProvider = new cognito.CfnUserPoolIdentityProvider(
        this,
        "AppleProvider",
        {
          providerName: "SignInWithApple",
          providerType: "SignInWithApple",
          userPoolId: this.userPool.userPoolId,
          attributeMapping: {
            email: "email",
          },
          providerDetails: {
            client_id: props.identityProviders.apple.clientId,
            team_id: props.identityProviders.apple.teamId,
            key_id: props.identityProviders.apple.keyId,
            private_key: props.identityProviders.apple.privateKey,
            authorize_scopes: "name email",
          },
        }
      );
      providers.push(appleProvider);
      supportedProviders.push("SignInWithApple");
    }

    if (props.identityProviders.microsoft) {
      const microsoftProvider = new cognito.CfnUserPoolIdentityProvider(
        this,
        "MicrosoftProvider",
        {
          providerName: "Microsoft",
          providerType: "OIDC",
          userPoolId: this.userPool.userPoolId,
          attributeMapping: {
            email: "email",
          },
          providerDetails: {
            client_id: props.identityProviders.microsoft.clientId,
            client_secret: props.identityProviders.microsoft.clientSecret,
            attributes_request_method: "GET",
            oidc_issuer: `https://login.microsoftonline.com/${props.identityProviders.microsoft.tenantId}/v2.0`,
            authorize_scopes: "openid email profile",
          },
        }
      );
      providers.push(microsoftProvider);
      supportedProviders.push("Microsoft");
    }

    // User Pool Domain
    new cognito.UserPoolDomain(this, "UserPoolDomain", {
      userPool: this.userPool,
      cognitoDomain: {
        domainPrefix: props.domainPrefix,
      },
    });

    // User Pool Client
    this.userPoolClient = new cognito.CfnUserPoolClient(this, "UserPoolClient", {
      clientName: name("user-pool-client"),
      userPoolId: this.userPool.userPoolId,
      generateSecret: false,
      allowedOAuthFlowsUserPoolClient: true,
      allowedOAuthFlows: ["code"],
      allowedOAuthScopes: ["openid", "email", "profile"],
      callbackUrLs: props.callbackUrls,
      logoutUrLs: props.logoutUrls,
      supportedIdentityProviders: supportedProviders,
      explicitAuthFlows: ["ALLOW_CUSTOM_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"],
    });

    // Add dependencies on identity providers
    for (const provider of providers) {
      this.userPoolClient.addDependency(provider);
    }

    const groupNames = props.userGroups ?? [this.adminGroupName];
    for (const [index, groupName] of groupNames.entries()) {
      new cognito.CfnUserPoolGroup(this, `UserGroup${index}`, {
        userPoolId: this.userPool.userPoolId,
        groupName,
        description: groupName === this.adminGroupName
          ? "Administrative users"
          : "Application users",
      });
    }

    // Bootstrap admin user if configured
    if (props.adminBootstrap) {
      this.createBootstrapAdminUser(props.adminBootstrap);
    }
  }

  /**
   * Create a Cognito User Pools authorizer for API Gateway.
   */
  public createApiAuthorizer(
    scope: Construct,
    id: string
  ): cdk.aws_apigateway.CognitoUserPoolsAuthorizer {
    return new cdk.aws_apigateway.CognitoUserPoolsAuthorizer(scope, id, {
      cognitoUserPools: [this.userPool],
    });
  }

  /**
   * Grant admin group management permissions to a Lambda function.
   */
  public grantAdminGroupManagement(fn: lambda.IFunction): void {
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "cognito-idp:AdminAddUserToGroup",
          "cognito-idp:AdminRemoveUserFromGroup",
          "cognito-idp:AdminListGroupsForUser",
        ],
        resources: [this.userPool.userPoolArn],
      })
    );
  }

  private createBootstrapAdminUser(config: AdminBootstrapConfig): void {
    // Create admin user
    const createAdminUser = new customresources.AwsCustomResource(
      this,
      "AdminBootstrapUser",
      {
        onCreate: {
          service: "CognitoIdentityServiceProvider",
          action: "adminCreateUser",
          parameters: {
            UserPoolId: this.userPool.userPoolId,
            Username: config.email,
            TemporaryPassword: config.tempPassword,
            MessageAction: "SUPPRESS",
            UserAttributes: [
              { Name: "email", Value: config.email },
              { Name: "email_verified", Value: "true" },
            ],
          },
          physicalResourceId: customresources.PhysicalResourceId.of(config.email),
        },
        onUpdate: {
          service: "CognitoIdentityServiceProvider",
          action: "adminUpdateUserAttributes",
          parameters: {
            UserPoolId: this.userPool.userPoolId,
            Username: config.email,
            UserAttributes: [
              { Name: "email", Value: config.email },
              { Name: "email_verified", Value: "true" },
            ],
          },
          physicalResourceId: customresources.PhysicalResourceId.of(config.email),
        },
        policy: customresources.AwsCustomResourcePolicy.fromStatements([
          new iam.PolicyStatement({
            actions: [
              "cognito-idp:AdminCreateUser",
              "cognito-idp:AdminUpdateUserAttributes",
            ],
            resources: [this.userPool.userPoolArn],
          }),
        ]),
        installLatestAwsSdk: false,
      }
    );

    // Set permanent password
    const setAdminPassword = new customresources.AwsCustomResource(
      this,
      "AdminBootstrapPassword",
      {
        onCreate: {
          service: "CognitoIdentityServiceProvider",
          action: "adminSetUserPassword",
          parameters: {
            UserPoolId: this.userPool.userPoolId,
            Username: config.email,
            Password: config.tempPassword,
            Permanent: true,
          },
          physicalResourceId: customresources.PhysicalResourceId.of(
            `admin-password-${config.email}`
          ),
        },
        onUpdate: {
          service: "CognitoIdentityServiceProvider",
          action: "adminSetUserPassword",
          parameters: {
            UserPoolId: this.userPool.userPoolId,
            Username: config.email,
            Password: config.tempPassword,
            Permanent: true,
          },
          physicalResourceId: customresources.PhysicalResourceId.of(
            `admin-password-${config.email}`
          ),
        },
        policy: customresources.AwsCustomResourcePolicy.fromStatements([
          new iam.PolicyStatement({
            actions: ["cognito-idp:AdminSetUserPassword"],
            resources: [this.userPool.userPoolArn],
          }),
        ]),
        installLatestAwsSdk: false,
      }
    );
    setAdminPassword.node.addDependency(createAdminUser);

    // Add to admin group
    const addAdminToGroup = new customresources.AwsCustomResource(
      this,
      "AdminBootstrapGroup",
      {
        onCreate: {
          service: "CognitoIdentityServiceProvider",
          action: "adminAddUserToGroup",
          parameters: {
            UserPoolId: this.userPool.userPoolId,
            Username: config.email,
            GroupName: this.adminGroupName,
          },
          physicalResourceId: customresources.PhysicalResourceId.of(
            `admin-group-${config.email}`
          ),
        },
        onUpdate: {
          service: "CognitoIdentityServiceProvider",
          action: "adminAddUserToGroup",
          parameters: {
            UserPoolId: this.userPool.userPoolId,
            Username: config.email,
            GroupName: this.adminGroupName,
          },
          physicalResourceId: customresources.PhysicalResourceId.of(
            `admin-group-${config.email}`
          ),
        },
        policy: customresources.AwsCustomResourcePolicy.fromStatements([
          new iam.PolicyStatement({
            actions: ["cognito-idp:AdminAddUserToGroup"],
            resources: [this.userPool.userPoolArn],
          }),
        ]),
        installLatestAwsSdk: false,
      }
    );
    addAdminToGroup.node.addDependency(setAdminPassword);
  }
}
