import * as cdk from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as cr from "aws-cdk-lib/custom-resources";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

export interface AuthConstructProps {
  readonly adminWebDomainParameter: cdk.CfnParameter;
  readonly googleClientIdParameter: cdk.CfnParameter;
  readonly googleClientSecretParameter: cdk.CfnParameter;
  readonly cognitoDomainPrefixParameter: cdk.CfnParameter;
  readonly adminBootstrapEmailParameter: cdk.CfnParameter;
  readonly adminBootstrapTempPasswordParameter: cdk.CfnParameter;
}

/**
 * Cognito user pool with Google federation, TOTP-only MFA, hosted UI OAuth,
 * admin group, and chained custom resources that bootstrap the first admin user.
 */
export class AuthConstruct extends Construct {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly userPoolDomain: cognito.UserPoolDomain;
  public readonly adminGroup: cognito.CfnUserPoolGroup;
  public readonly adminGroupName = "admin";

  constructor(scope: Construct, id: string, props: AuthConstructProps) {
    super(scope, id);

    const callbackUrl = cdk.Fn.join("", [
      "https://",
      props.adminWebDomainParameter.valueAsString,
      "/auth/callback",
    ]);
    const logoutUrl = cdk.Fn.join("", [
      "https://",
      props.adminWebDomainParameter.valueAsString,
      "/",
    ]);

    this.userPool = new cognito.UserPool(this, "UserPool", {
      userPoolName: "lx-admin-user-pool",
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: { email: { required: true, mutable: true } },
      mfa: cognito.Mfa.REQUIRED,
      mfaSecondFactor: { sms: false, otp: true },
      passwordPolicy: {
        minLength: 14,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      advancedSecurityMode: cognito.AdvancedSecurityMode.AUDIT,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const googleProvider = new cognito.UserPoolIdentityProviderGoogle(
      this,
      "GoogleProvider",
      {
        userPool: this.userPool,
        clientId: props.googleClientIdParameter.valueAsString,
        clientSecretValue: cdk.SecretValue.cfnParameter(
          props.googleClientSecretParameter
        ),
        scopes: ["profile", "email", "openid"],
        attributeMapping: {
          email: cognito.ProviderAttribute.GOOGLE_EMAIL,
          givenName: cognito.ProviderAttribute.GOOGLE_GIVEN_NAME,
          familyName: cognito.ProviderAttribute.GOOGLE_FAMILY_NAME,
          profilePicture: cognito.ProviderAttribute.GOOGLE_PICTURE,
        },
      }
    );

    this.userPoolClient = this.userPool.addClient("UserPoolClient", {
      userPoolClientName: "lx-admin-spa-client",
      generateSecret: false,
      authFlows: {
        userSrp: true,
        userPassword: true,
        adminUserPassword: true,
        custom: false,
      },
      oAuth: {
        flows: { authorizationCodeGrant: true, implicitCodeGrant: false },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.PROFILE,
        ],
        callbackUrls: [callbackUrl],
        logoutUrls: [logoutUrl],
      },
      supportedIdentityProviders: [
        cognito.UserPoolClientIdentityProvider.COGNITO,
        cognito.UserPoolClientIdentityProvider.custom(
          googleProvider.providerName
        ),
      ],
      preventUserExistenceErrors: true,
      enableTokenRevocation: true,
    });

    this.userPoolClient.node.addDependency(googleProvider);

    this.userPoolDomain = this.userPool.addDomain("HostedUIDomain", {
      cognitoDomain: {
        domainPrefix: props.cognitoDomainPrefixParameter.valueAsString,
      },
    });

    this.adminGroup = new cognito.CfnUserPoolGroup(this, "AdminGroup", {
      userPoolId: this.userPool.userPoolId,
      groupName: this.adminGroupName,
      description: "Administrators for the LX admin console",
      precedence: 1,
    });

    const bootstrapEmail = props.adminBootstrapEmailParameter.valueAsString;
    const bootstrapPassword =
      props.adminBootstrapTempPasswordParameter.valueAsString;

    const cognitoAdminPolicy = cr.AwsCustomResourcePolicy.fromStatements([
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "cognito-idp:AdminCreateUser",
          "cognito-idp:AdminSetUserPassword",
          "cognito-idp:AdminAddUserToGroup",
          "cognito-idp:AdminGetUser",
        ],
        resources: [this.userPool.userPoolArn],
      }),
    ]);

    const createBootstrapUser = new cr.AwsCustomResource(
      this,
      "BootstrapAdminCreateUser",
      {
        onCreate: {
          service: "CognitoIdentityServiceProvider",
          action: "adminCreateUser",
          parameters: {
            UserPoolId: this.userPool.userPoolId,
            Username: bootstrapEmail,
            MessageAction: "SUPPRESS",
            TemporaryPassword: bootstrapPassword,
            UserAttributes: [
              { Name: "email", Value: bootstrapEmail },
              { Name: "email_verified", Value: "true" },
            ],
          },
          physicalResourceId: cr.PhysicalResourceId.of("lx-admin-bootstrap-user"),
          ignoreErrorCodesMatching: "UsernameExistsException",
        },
        onUpdate: {
          service: "CognitoIdentityServiceProvider",
          action: "adminGetUser",
          parameters: {
            UserPoolId: this.userPool.userPoolId,
            Username: bootstrapEmail,
          },
          physicalResourceId: cr.PhysicalResourceId.of("lx-admin-bootstrap-user"),
        },
        policy: cognitoAdminPolicy,
        installLatestAwsSdk: false,
      }
    );

    const setBootstrapPassword = new cr.AwsCustomResource(
      this,
      "BootstrapAdminSetPassword",
      {
        onCreate: {
          service: "CognitoIdentityServiceProvider",
          action: "adminSetUserPassword",
          parameters: {
            UserPoolId: this.userPool.userPoolId,
            Username: bootstrapEmail,
            Password: bootstrapPassword,
            Permanent: true,
          },
          physicalResourceId: cr.PhysicalResourceId.of("lx-admin-bootstrap-pw"),
        },
        onUpdate: {
          service: "CognitoIdentityServiceProvider",
          action: "adminSetUserPassword",
          parameters: {
            UserPoolId: this.userPool.userPoolId,
            Username: bootstrapEmail,
            Password: bootstrapPassword,
            Permanent: true,
          },
          physicalResourceId: cr.PhysicalResourceId.of("lx-admin-bootstrap-pw"),
        },
        policy: cognitoAdminPolicy,
        installLatestAwsSdk: false,
      }
    );
    setBootstrapPassword.node.addDependency(createBootstrapUser);

    const addBootstrapToGroup = new cr.AwsCustomResource(
      this,
      "BootstrapAdminAddToGroup",
      {
        onCreate: {
          service: "CognitoIdentityServiceProvider",
          action: "adminAddUserToGroup",
          parameters: {
            UserPoolId: this.userPool.userPoolId,
            Username: bootstrapEmail,
            GroupName: this.adminGroupName,
          },
          physicalResourceId: cr.PhysicalResourceId.of("lx-admin-bootstrap-group"),
        },
        onUpdate: {
          service: "CognitoIdentityServiceProvider",
          action: "adminAddUserToGroup",
          parameters: {
            UserPoolId: this.userPool.userPoolId,
            Username: bootstrapEmail,
            GroupName: this.adminGroupName,
          },
          physicalResourceId: cr.PhysicalResourceId.of("lx-admin-bootstrap-group"),
        },
        policy: cognitoAdminPolicy,
        installLatestAwsSdk: false,
      }
    );
    addBootstrapToGroup.node.addDependency(setBootstrapPassword);
    addBootstrapToGroup.node.addDependency(this.adminGroup);
  }

  /**
   * REST API Gateway Cognito authorizer (optional). The HTTP API uses an
   * HttpJwtAuthorizer instead; see AdminApiStack.
   */
  createApiAuthorizer(scope: Construct, id: string): apigateway.CognitoUserPoolsAuthorizer {
    return new apigateway.CognitoUserPoolsAuthorizer(scope, id, {
      cognitoUserPools: [this.userPool],
      identitySource: "method.request.header.Authorization",
      authorizerName: "lx-admin-cognito",
    });
  }
}
