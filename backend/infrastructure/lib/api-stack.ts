import * as cdk from "aws-cdk-lib";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as customresources from "aws-cdk-lib/custom-resources";
import * as logs from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { DatabaseConstruct, PythonLambdaFactory } from "./constructs";

export class ApiStack extends cdk.Stack {
  public constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    cdk.Tags.of(this).add("Organization", "LX Software");
    cdk.Tags.of(this).add("Project", "Siu Tin Dei");

    const resourcePrefix = "lxsoftware-siutindei";
    const name = (suffix: string) => `${resourcePrefix}-${suffix}`;
    const existingDbCredentialsSecretName =
      process.env.EXISTING_DB_CREDENTIALS_SECRET_NAME;
    const existingDbCredentialsSecretArn =
      process.env.EXISTING_DB_CREDENTIALS_SECRET_ARN;
    const existingDbCredentialsSecretKmsKeyArn =
      process.env.EXISTING_DB_CREDENTIALS_SECRET_KMS_KEY_ARN;
    const existingDbSecurityGroupId = process.env.EXISTING_DB_SECURITY_GROUP_ID;
    const existingProxySecurityGroupId =
      process.env.EXISTING_PROXY_SECURITY_GROUP_ID;
    const existingDbClusterIdentifier =
      process.env.EXISTING_DB_CLUSTER_IDENTIFIER;
    const existingDbClusterEndpoint = process.env.EXISTING_DB_CLUSTER_ENDPOINT;
    const existingDbClusterReaderEndpoint =
      process.env.EXISTING_DB_CLUSTER_READER_ENDPOINT;
    const existingDbClusterPort = parseOptionalPort(
      process.env.EXISTING_DB_CLUSTER_PORT
    );
    const existingDbProxyName = process.env.EXISTING_DB_PROXY_NAME;
    const existingDbProxyArn = process.env.EXISTING_DB_PROXY_ARN;
    const existingDbProxyEndpoint = process.env.EXISTING_DB_PROXY_ENDPOINT;
    const existingVpcId = process.env.EXISTING_VPC_ID?.trim();
    const existingLambdaSecurityGroupId =
      process.env.EXISTING_LAMBDA_SECURITY_GROUP_ID;
    const existingMigrationSecurityGroupId =
      process.env.EXISTING_MIGRATION_SECURITY_GROUP_ID;
    const manageDbSecurityGroupRules =
      !existingDbSecurityGroupId && !existingProxySecurityGroupId;
    const skipImmutableDbUpdates =
      parseOptionalBoolean(
        process.env.SKIP_DB_CLUSTER_IMMUTABLE_UPDATES
      ) ?? false;

    // ---------------------------------------------------------------------
    // VPC and Security Groups
    // ---------------------------------------------------------------------
    const vpc = existingVpcId
      ? ec2.Vpc.fromLookup(this, "ExistingVpc", { vpcId: existingVpcId })
      : new ec2.Vpc(this, "SiutindeiVpc", {
          vpcName: name("vpc"),
          maxAzs: 2,
          natGateways: 1,
        });

    const lambdaSecurityGroup = existingLambdaSecurityGroupId
      ? ec2.SecurityGroup.fromSecurityGroupId(
          this,
          "LambdaSecurityGroup",
          existingLambdaSecurityGroupId,
          { mutable: false }
        )
      : new ec2.SecurityGroup(this, "LambdaSecurityGroup", {
          vpc,
          allowAllOutbound: true,
          securityGroupName: name("lambda-sg"),
        });

    const migrationSecurityGroup = existingMigrationSecurityGroupId
      ? ec2.SecurityGroup.fromSecurityGroupId(
          this,
          "MigrationSecurityGroup",
          existingMigrationSecurityGroupId,
          { mutable: false }
        )
      : new ec2.SecurityGroup(this, "MigrationSecurityGroup", {
          vpc,
          allowAllOutbound: true,
          securityGroupName: name("migration-sg"),
        });

    const lambdaSecurityGroupResource =
      lambdaSecurityGroup.node.defaultChild as ec2.CfnSecurityGroup | undefined;
    if (lambdaSecurityGroupResource) {
      lambdaSecurityGroupResource.cfnOptions.updateReplacePolicy =
        cdk.CfnDeletionPolicy.RETAIN;
    }
    const migrationSecurityGroupResource =
      migrationSecurityGroup.node
        .defaultChild as ec2.CfnSecurityGroup | undefined;
    if (migrationSecurityGroupResource) {
      migrationSecurityGroupResource.cfnOptions.updateReplacePolicy =
        cdk.CfnDeletionPolicy.RETAIN;
    }

    // ---------------------------------------------------------------------
    // Database (Aurora PostgreSQL Serverless v2 + RDS Proxy)
    // ---------------------------------------------------------------------
    const database = new DatabaseConstruct(this, "Database", {
      resourcePrefix,
      vpc,
      minCapacity: 0.5,
      maxCapacity: 2,
      databaseName: "siutindei",
      dbCredentialsSecretName: existingDbCredentialsSecretName,
      dbCredentialsSecretArn: existingDbCredentialsSecretArn,
      dbCredentialsSecretKmsKeyArn: existingDbCredentialsSecretKmsKeyArn,
      dbSecurityGroupId: existingDbSecurityGroupId,
      proxySecurityGroupId: existingProxySecurityGroupId,
      dbClusterIdentifier: existingDbClusterIdentifier,
      dbClusterEndpoint: existingDbClusterEndpoint,
      dbClusterReaderEndpoint: existingDbClusterReaderEndpoint,
      dbClusterPort: existingDbClusterPort,
      dbProxyName: existingDbProxyName,
      dbProxyArn: existingDbProxyArn,
      dbProxyEndpoint: existingDbProxyEndpoint,
      manageSecurityGroupRules: manageDbSecurityGroupRules,
      applyImmutableSettings: !skipImmutableDbUpdates,
    });

    // Allow Lambda access to database via proxy
    database.allowFrom(lambdaSecurityGroup, "Lambda access to RDS Proxy");

    // Allow migration Lambda direct access to database
    database.allowDirectAccessFrom(
      migrationSecurityGroup,
      "Migration Lambda direct access to Aurora"
    );

    // ---------------------------------------------------------------------
    // CloudFormation Parameters
    // ---------------------------------------------------------------------
    const authDomainPrefix = new cdk.CfnParameter(this, "CognitoDomainPrefix", {
      type: "String",
      description: "Hosted UI domain prefix for the Cognito user pool",
    });
    const authCustomDomainName = new cdk.CfnParameter(
      this,
      "CognitoCustomDomainName",
      {
        type: "String",
        default: "",
        description: "Optional custom Hosted UI domain (e.g. auth.example.com)",
      }
    );
    const authCustomDomainCertificateArn = new cdk.CfnParameter(
      this,
      "CognitoCustomDomainCertificateArn",
      {
        type: "String",
        default: "",
        description:
          "ACM certificate ARN for the custom Hosted UI domain (must be in us-east-1)",
      }
    );
    const oauthCallbackUrls = new cdk.CfnParameter(this, "CognitoCallbackUrls", {
      type: "CommaDelimitedList",
      description: "Comma-separated list of OAuth callback URLs",
    });
    const oauthLogoutUrls = new cdk.CfnParameter(this, "CognitoLogoutUrls", {
      type: "CommaDelimitedList",
      description: "Comma-separated list of OAuth logout URLs",
    });
    const googleClientId = new cdk.CfnParameter(this, "GoogleClientId", {
      type: "String",
      description: "Google OAuth client ID",
    });
    const googleClientSecret = new cdk.CfnParameter(this, "GoogleClientSecret", {
      type: "String",
      noEcho: true,
      description: "Google OAuth client secret",
    });
    const appleClientId = new cdk.CfnParameter(this, "AppleClientId", {
      type: "String",
      description: "Apple Services ID (Client ID)",
    });
    const appleTeamId = new cdk.CfnParameter(this, "AppleTeamId", {
      type: "String",
      description: "Apple developer team ID",
    });
    const appleKeyId = new cdk.CfnParameter(this, "AppleKeyId", {
      type: "String",
      description: "Apple Sign In key ID",
    });
    const applePrivateKey = new cdk.CfnParameter(this, "ApplePrivateKey", {
      type: "String",
      noEcho: true,
      description: "Apple Sign In private key",
    });
    const applePrivateKeyValue = cdk.Fn.join(
      "\n",
      cdk.Fn.split("\\n", applePrivateKey.valueAsString)
    );
    const microsoftTenantId = new cdk.CfnParameter(this, "MicrosoftTenantId", {
      type: "String",
      description: "Microsoft Entra tenant ID",
    });
    const microsoftClientId = new cdk.CfnParameter(this, "MicrosoftClientId", {
      type: "String",
      description: "Microsoft OAuth client ID",
    });
    const microsoftClientSecret = new cdk.CfnParameter(
      this,
      "MicrosoftClientSecret",
      {
        type: "String",
        noEcho: true,
        description: "Microsoft OAuth client secret",
      }
    );
    const authEmailFromAddress = new cdk.CfnParameter(
      this,
      "AuthEmailFromAddress",
      {
        type: "String",
        description: "SES-verified from address for passwordless emails",
      }
    );
    const loginLinkBaseUrl = new cdk.CfnParameter(this, "LoginLinkBaseUrl", {
      type: "String",
      default: "",
      description:
        "Optional base URL for magic links (adds email+code query params)",
    });
    const maxChallengeAttempts = new cdk.CfnParameter(
      this,
      "MaxChallengeAttempts",
      {
        type: "Number",
        default: 3,
        description: "Maximum passwordless auth attempts before failing",
      }
    );
    const publicApiKeyValue = new cdk.CfnParameter(this, "PublicApiKeyValue", {
      type: "String",
      noEcho: true,
      minLength: 20,
      constraintDescription:
        "Must be at least 20 characters to satisfy API Gateway API key requirements.",
      description: "API key value required for mobile activity search",
    });
    const deviceAttestationJwksUrl = new cdk.CfnParameter(
      this,
      "DeviceAttestationJwksUrl",
      {
        type: "String",
        default: "",
        description: "JWKS URL for device attestation token verification",
      }
    );
    const deviceAttestationIssuer = new cdk.CfnParameter(
      this,
      "DeviceAttestationIssuer",
      {
        type: "String",
        default: "",
        description: "Expected issuer for device attestation tokens",
      }
    );
    const deviceAttestationAudience = new cdk.CfnParameter(
      this,
      "DeviceAttestationAudience",
      {
        type: "String",
        default: "",
        description: "Expected audience for device attestation tokens",
      }
    );
    const deviceAttestationFailClosed = new cdk.CfnParameter(
      this,
      "DeviceAttestationFailClosed",
      {
        type: "String",
        default: "true",
        allowedValues: ["true", "false"],
        description:
          "If true, deny requests when attestation is not configured (production mode). " +
          "If false, allow requests without attestation (development mode). " +
          "SECURITY: Must be 'true' in production.",
      }
    );

    // ---------------------------------------------------------------------
    // Cognito User Pool and Identity Providers
    // ---------------------------------------------------------------------
    const userPool = new cognito.UserPool(this, "SiutindeiUserPool", {
      userPoolName: name("user-pool"),
      signInAliases: { email: true },
      autoVerify: { email: true },
      selfSignUpEnabled: true,
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
    });
    const adminGroupName = "admin";
    const userPoolGroups = [
      { name: adminGroupName, description: "Administrative users" },
      { name: "customer", description: "Customer users" },
      { name: "owner", description: "Owner users" },
    ];

    const googleProvider = new cognito.CfnUserPoolIdentityProvider(
      this,
      "GoogleIdentityProvider",
      {
        providerName: "Google",
        providerType: "Google",
        userPoolId: userPool.userPoolId,
        attributeMapping: {
          email: "email",
          given_name: "given_name",
          family_name: "family_name",
        },
        providerDetails: {
          client_id: googleClientId.valueAsString,
          client_secret: googleClientSecret.valueAsString,
          authorize_scopes: "openid email profile",
        },
      }
    );

    const appleProvider = new cognito.CfnUserPoolIdentityProvider(
      this,
      "AppleIdentityProvider",
      {
        providerName: "SignInWithApple",
        providerType: "SignInWithApple",
        userPoolId: userPool.userPoolId,
        attributeMapping: {
          email: "email",
        },
        providerDetails: {
          client_id: appleClientId.valueAsString,
          team_id: appleTeamId.valueAsString,
          key_id: appleKeyId.valueAsString,
          private_key: applePrivateKeyValue,
          authorize_scopes: "name email",
        },
      }
    );

    const microsoftProvider = new cognito.CfnUserPoolIdentityProvider(
      this,
      "MicrosoftIdentityProvider",
      {
        providerName: "Microsoft",
        providerType: "OIDC",
        userPoolId: userPool.userPoolId,
        attributeMapping: {
          email: "email",
        },
        providerDetails: {
          client_id: microsoftClientId.valueAsString,
          client_secret: microsoftClientSecret.valueAsString,
          attributes_request_method: "GET",
          oidc_issuer: `https://login.microsoftonline.com/${microsoftTenantId.valueAsString}/v2.0`,
          authorize_scopes: "openid email profile",
        },
      }
    );

    const useCustomDomain = new cdk.CfnCondition(this, "UseCustomAuthDomain", {
      expression: cdk.Fn.conditionAnd(
        cdk.Fn.conditionNot(
          cdk.Fn.conditionEquals(authCustomDomainName.valueAsString, "")
        ),
        cdk.Fn.conditionNot(
          cdk.Fn.conditionEquals(
            authCustomDomainCertificateArn.valueAsString,
            ""
          )
        )
      ),
    });
    const useCognitoDomain = new cdk.CfnCondition(
      this,
      "UseCognitoAuthDomain",
      {
        expression: cdk.Fn.conditionOr(
          cdk.Fn.conditionEquals(authCustomDomainName.valueAsString, ""),
          cdk.Fn.conditionEquals(
            authCustomDomainCertificateArn.valueAsString,
            ""
          )
        ),
      }
    );

    const cognitoHostedDomain = new cognito.CfnUserPoolDomain(
      this,
      "SiutindeiCognitoPrefixDomain",
      {
        userPoolId: userPool.userPoolId,
        domain: authDomainPrefix.valueAsString,
      }
    );
    cognitoHostedDomain.cfnOptions.condition = useCognitoDomain;

    const removeCognitoDomain = new customresources.AwsCustomResource(
      this,
      "RemoveCognitoAuthDomain",
      {
        onCreate: {
          service: "CognitoIdentityServiceProvider",
          action: "deleteUserPoolDomain",
          parameters: {
            UserPoolId: userPool.userPoolId,
            Domain: authDomainPrefix.valueAsString,
          },
          physicalResourceId: customresources.PhysicalResourceId.of(
            `remove-cognito-domain-${userPool.userPoolId}`
          ),
          ignoreErrorCodesMatching: "ResourceNotFoundException|InvalidParameterException",
        },
        onUpdate: {
          service: "CognitoIdentityServiceProvider",
          action: "deleteUserPoolDomain",
          parameters: {
            UserPoolId: userPool.userPoolId,
            Domain: authDomainPrefix.valueAsString,
          },
          physicalResourceId: customresources.PhysicalResourceId.of(
            `remove-cognito-domain-${userPool.userPoolId}`
          ),
          ignoreErrorCodesMatching: "ResourceNotFoundException|InvalidParameterException",
        },
        policy: customresources.AwsCustomResourcePolicy.fromSdkCalls({
          resources: customresources.AwsCustomResourcePolicy.ANY_RESOURCE,
        }),
        installLatestAwsSdk: false,
      }
    );
    const removeCognitoDomainCustomResource = (
      removeCognitoDomain as unknown as { customResource: cdk.CustomResource }
    ).customResource;
    const removeCognitoDomainResource =
      removeCognitoDomainCustomResource.node.defaultChild as cdk.CfnResource;
    removeCognitoDomainResource.cfnOptions.condition = useCustomDomain;

    const customHostedDomain = new cognito.CfnUserPoolDomain(
      this,
      "SiutindeiUserPoolCustomDomain",
      {
        userPoolId: userPool.userPoolId,
        domain: authCustomDomainName.valueAsString,
        customDomainConfig: {
          certificateArn: authCustomDomainCertificateArn.valueAsString,
        },
      }
    );
    customHostedDomain.cfnOptions.condition = useCustomDomain;
    customHostedDomain.node.addDependency(removeCognitoDomain);

    const userPoolClient = new cognito.CfnUserPoolClient(
      this,
      "SiutindeiUserPoolClient",
      {
        clientName: name("user-pool-client"),
        userPoolId: userPool.userPoolId,
        generateSecret: false,
        allowedOAuthFlowsUserPoolClient: true,
        allowedOAuthFlows: ["code"],
        allowedOAuthScopes: ["openid", "email", "profile"],
        callbackUrLs: oauthCallbackUrls.valueAsList,
        logoutUrLs: oauthLogoutUrls.valueAsList,
        supportedIdentityProviders: [
          "Google",
          "SignInWithApple",
          "Microsoft",
        ],
        explicitAuthFlows: ["ALLOW_CUSTOM_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"],
      }
    );

    userPoolClient.addDependency(googleProvider);
    userPoolClient.addDependency(appleProvider);
    userPoolClient.addDependency(microsoftProvider);

    const groupPolicy = customresources.AwsCustomResourcePolicy.fromStatements([
      new iam.PolicyStatement({
        actions: [
          "cognito-idp:CreateGroup",
          "cognito-idp:UpdateGroup",
          "cognito-idp:DeleteGroup",
        ],
        resources: [userPool.userPoolArn],
      }),
    ]);

    for (const [index, group] of userPoolGroups.entries()) {
      new customresources.AwsCustomResource(
        this,
        `UserGroup${index}`,
        {
          onCreate: {
            service: "CognitoIdentityServiceProvider",
            action: "createGroup",
            parameters: {
              UserPoolId: userPool.userPoolId,
              GroupName: group.name,
              Description: group.description,
            },
            physicalResourceId: customresources.PhysicalResourceId.of(
              `${userPool.userPoolId}-${group.name}`
            ),
            ignoreErrorCodesMatching: "GroupExistsException",
          },
          onUpdate: {
            service: "CognitoIdentityServiceProvider",
            action: "updateGroup",
            parameters: {
              UserPoolId: userPool.userPoolId,
              GroupName: group.name,
              Description: group.description,
            },
            physicalResourceId: customresources.PhysicalResourceId.of(
              `${userPool.userPoolId}-${group.name}`
            ),
          },
          onDelete: {
            service: "CognitoIdentityServiceProvider",
            action: "deleteGroup",
            parameters: {
              UserPoolId: userPool.userPoolId,
              GroupName: group.name,
            },
            ignoreErrorCodesMatching: "ResourceNotFoundException",
          },
          policy: groupPolicy,
          installLatestAwsSdk: false,
        }
      );
    }

    // ---------------------------------------------------------------------
    // Lambda Functions
    // ---------------------------------------------------------------------
    const lambdaFactory = new PythonLambdaFactory(this, {
      vpc,
      securityGroups: [lambdaSecurityGroup],
    });

    // Helper to create Lambda functions using the factory
    // Note: functionName is omitted to let CloudFormation generate unique names
    // and avoid conflicts with existing Lambda functions.
    const createPythonFunction = (
      id: string,
      props: {
        handler: string;
        environment?: Record<string, string>;
        timeout?: cdk.Duration;
        extraCopyPaths?: string[];
        securityGroups?: ec2.ISecurityGroup[];
        memorySize?: number;
      }
    ) => {
      const pythonLambda = lambdaFactory.create(id, {
        handler: props.handler,
        environment: props.environment,
        timeout: props.timeout,
        extraCopyPaths: props.extraCopyPaths,
        securityGroups: props.securityGroups ?? [lambdaSecurityGroup],
        memorySize: props.memorySize,
      });
      return pythonLambda.function;
    };

    // Search function
    const searchFunction = createPythonFunction("SiutindeiSearchFunction", {
      handler: "lambda/activity_search/handler.lambda_handler",
      environment: {
        DATABASE_SECRET_ARN: database.secret?.secretArn ?? "",
        DATABASE_NAME: "siutindei",
        DATABASE_USERNAME: "siutindei_app",
        DATABASE_PROXY_ENDPOINT: database.proxy.endpoint,
        DATABASE_IAM_AUTH: "true",
      },
    });
    database.grantSecretRead(searchFunction);
    database.grantConnect(searchFunction, "siutindei_app");

    // Admin function
    const adminFunction = createPythonFunction("SiutindeiAdminFunction", {
      handler: "lambda/admin/handler.lambda_handler",
      environment: {
        DATABASE_SECRET_ARN: database.secret?.secretArn ?? "",
        DATABASE_NAME: "siutindei",
        DATABASE_USERNAME: "siutindei_admin",
        DATABASE_PROXY_ENDPOINT: database.proxy.endpoint,
        DATABASE_IAM_AUTH: "true",
        ADMIN_GROUP: adminGroupName,
        COGNITO_USER_POOL_ID: userPool.userPoolId,
      },
    });
    database.grantSecretRead(adminFunction);
    database.grantConnect(adminFunction, "siutindei_admin");

    adminFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "cognito-idp:AdminAddUserToGroup",
          "cognito-idp:AdminRemoveUserFromGroup",
          "cognito-idp:AdminListGroupsForUser",
        ],
        resources: [userPool.userPoolArn],
      })
    );

    // Migration function
    const migrationFunction = createPythonFunction("SiutindeiMigrationFunction", {
      handler: "lambda/migrations/handler.lambda_handler",
      timeout: cdk.Duration.minutes(5),
      securityGroups: [migrationSecurityGroup],
      extraCopyPaths: ["db"],
      environment: {
        DATABASE_SECRET_ARN: database.secret?.secretArn ?? "",
        DATABASE_NAME: "siutindei",
        DATABASE_USERNAME: "postgres",
        DATABASE_IAM_AUTH: "false",
        DATABASE_HOST: database.cluster.clusterEndpoint.hostname,
        DATABASE_PORT: database.cluster.clusterEndpoint.port.toString(),
        SEED_FILE_PATH: "/var/task/db/seed/seed_data.sql",
      },
    });
    database.grantSecretRead(migrationFunction);
    database.grantConnect(migrationFunction, "postgres");
    migrationFunction.node.addDependency(database.cluster);
    migrationFunction.addPermission("MigrationInvokePermission", {
      principal: new iam.ServicePrincipal("cloudformation.amazonaws.com"),
      sourceArn: cdk.Stack.of(this).stackId,
      sourceAccount: cdk.Stack.of(this).account,
    });

    // Auth Lambda triggers
    const preSignUpFunction = createPythonFunction("AuthPreSignUpFunction", {
      handler: "lambda/auth/pre_signup/handler.lambda_handler",
      memorySize: 256,
      timeout: cdk.Duration.seconds(10),
    });

    const defineAuthChallengeFunction = createPythonFunction(
      "AuthDefineChallengeFunction",
      {
        handler: "lambda/auth/define_auth_challenge/handler.lambda_handler",
        memorySize: 256,
        timeout: cdk.Duration.seconds(10),
        environment: {
          MAX_CHALLENGE_ATTEMPTS: maxChallengeAttempts.valueAsString,
        },
      }
    );

    const createAuthChallengeFunction = createPythonFunction(
      "AuthCreateChallengeFunction",
      {
        handler: "lambda/auth/create_auth_challenge/handler.lambda_handler",
        memorySize: 256,
        timeout: cdk.Duration.seconds(10),
        environment: {
          SES_FROM_ADDRESS: authEmailFromAddress.valueAsString,
          LOGIN_LINK_BASE_URL: loginLinkBaseUrl.valueAsString,
        },
      }
    );

    const sesIdentityArn = cdk.Stack.of(this).formatArn({
      service: "ses",
      resource: "identity",
      resourceName: authEmailFromAddress.valueAsString,
    });
    createAuthChallengeFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ses:SendEmail", "ses:SendRawEmail"],
        resources: [sesIdentityArn],
      })
    );

    const verifyAuthChallengeFunction = createPythonFunction(
      "AuthVerifyChallengeFunction",
      {
        handler: "lambda/auth/verify_auth_challenge/handler.lambda_handler",
        memorySize: 256,
        timeout: cdk.Duration.seconds(10),
      }
    );

    // Register Cognito triggers
    userPool.addTrigger(
      cognito.UserPoolOperation.PRE_SIGN_UP,
      preSignUpFunction
    );
    userPool.addTrigger(
      cognito.UserPoolOperation.DEFINE_AUTH_CHALLENGE,
      defineAuthChallengeFunction
    );
    userPool.addTrigger(
      cognito.UserPoolOperation.CREATE_AUTH_CHALLENGE,
      createAuthChallengeFunction
    );
    userPool.addTrigger(
      cognito.UserPoolOperation.VERIFY_AUTH_CHALLENGE_RESPONSE,
      verifyAuthChallengeFunction
    );

    // Device attestation authorizer
    const deviceAttestationFunction = createPythonFunction(
      "DeviceAttestationAuthorizer",
      {
        handler: "lambda/authorizers/device_attestation/handler.lambda_handler",
        memorySize: 256,
        timeout: cdk.Duration.seconds(5),
        environment: {
          ATTESTATION_JWKS_URL: deviceAttestationJwksUrl.valueAsString,
          ATTESTATION_ISSUER: deviceAttestationIssuer.valueAsString,
          ATTESTATION_AUDIENCE: deviceAttestationAudience.valueAsString,
          // SECURITY: Fail-closed mode denies requests when attestation is not configured
          ATTESTATION_FAIL_CLOSED: deviceAttestationFailClosed.valueAsString,
        },
      }
    );

    const deviceAttestationAuthorizer = new apigateway.RequestAuthorizer(
      this,
      "DeviceAttestationRequestAuthorizer",
      {
        handler: deviceAttestationFunction,
        identitySources: [
          apigateway.IdentitySource.header("x-device-attestation"),
        ],
        resultsCacheTtl: cdk.Duration.seconds(0),
      }
    );

    // Health check function
    const healthFunction = createPythonFunction("HealthCheckFunction", {
      handler: "lambda/health/handler.lambda_handler",
      memorySize: 256,
      timeout: cdk.Duration.seconds(10),
      environment: {
        DATABASE_SECRET_ARN: database.secret?.secretArn ?? "",
        DATABASE_NAME: "siutindei",
        DATABASE_PROXY_ENDPOINT: database.proxy.endpoint,
        DATABASE_IAM_AUTH: "true",
        DATABASE_USERNAME: "siutindei_app",
        ENVIRONMENT: "production",
        APP_VERSION: "1.0.0",
      },
    });
    database.grantSecretRead(healthFunction);
    database.grantConnect(healthFunction, "siutindei_app");

    // ---------------------------------------------------------------------
    // API Gateway
    // ---------------------------------------------------------------------
    const apiGatewayLogRole = new iam.Role(this, "ApiGatewayLogRole", {
      assumedBy: new iam.ServicePrincipal("apigateway.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AmazonAPIGatewayPushToCloudWatchLogs"
        ),
      ],
    });
    new apigateway.CfnAccount(this, "ApiGatewayAccount", {
      cloudWatchRoleArn: apiGatewayLogRole.roleArn,
    });

    const apiAccessLogGroupName = name("api-access-logs");
    const apiAccessLogGroup = logs.LogGroup.fromLogGroupName(
      this,
      "ApiAccessLogs",
      apiAccessLogGroupName
    );

    // SECURITY: Restrict CORS to specific allowed origins
    // Never use Cors.ALL_ORIGINS in production - it allows any website to make requests
    const resolvedCorsOrigins = resolveCorsAllowedOrigins(this);

    const api = new apigateway.RestApi(this, "SiutindeiApi", {
      restApiName: name("api"),
      defaultCorsPreflightOptions: {
        allowOrigins: resolvedCorsOrigins,
        allowMethods: ["GET", "OPTIONS", "POST", "PUT", "DELETE"],
      },
      deployOptions: {
        stageName: "prod",
        accessLogDestination: new apigateway.LogGroupLogDestination(
          apiAccessLogGroup
        ),
        accessLogFormat: apigateway.AccessLogFormat.jsonWithStandardFields({
          caller: false,
          httpMethod: true,
          ip: true,
          protocol: true,
          requestTime: true,
          resourcePath: true,
          responseLength: true,
          status: true,
          user: false,
        }),
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: false,
        tracingEnabled: true,
        cacheClusterEnabled: true,
        cacheClusterSize: "0.5",
        cacheDataEncrypted: true,
        methodOptions: {
          "/v1/activities/search/GET": {
            cachingEnabled: true,
            cacheTtl: cdk.Duration.minutes(5),
          },
        },
      },
    });
    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(
      this,
      "SiutindeiAuthorizer",
      {
        cognitoUserPools: [userPool],
      }
    );

    const mobileApiKey = new apigateway.ApiKey(this, "MobileSearchApiKey", {
      apiKeyName: name("mobile-search-key"),
      value: publicApiKeyValue.valueAsString,
    });
    const mobileUsagePlan = api.addUsagePlan("MobileSearchUsagePlan", {
      name: name("mobile-search-plan"),
    });
    mobileUsagePlan.addApiKey(mobileApiKey);
    mobileUsagePlan.addApiStage({ stage: api.deploymentStage });

    // ---------------------------------------------------------------------
    // API Routes
    // ---------------------------------------------------------------------

    // Health check endpoint (IAM auth)
    const health = api.root.addResource("health");
    health.addMethod("GET", new apigateway.LambdaIntegration(healthFunction), {
      authorizationType: apigateway.AuthorizationType.IAM,
    });

    // v1 API
    const v1 = api.root.addResource("v1");
    const activities = v1.addResource("activities");
    const search = activities.addResource("search");

    const cacheKeyParameters = [
      "method.request.querystring.age",
      "method.request.querystring.district",
      "method.request.querystring.pricing_type",
      "method.request.querystring.price_min",
      "method.request.querystring.price_max",
      "method.request.querystring.schedule_type",
      "method.request.querystring.day_of_week_utc",
      "method.request.querystring.day_of_month",
      "method.request.querystring.start_minutes_utc",
      "method.request.querystring.end_minutes_utc",
      "method.request.querystring.start_at_utc",
      "method.request.querystring.end_at_utc",
      "method.request.querystring.language",
      "method.request.querystring.limit",
      "method.request.querystring.cursor",
    ];
    const requestParameters: Record<string, boolean> = {};
    for (const param of cacheKeyParameters) {
      requestParameters[param] = false;
    }

    search.addMethod("GET", new apigateway.LambdaIntegration(searchFunction), {
      authorizationType: apigateway.AuthorizationType.CUSTOM,
      authorizer: deviceAttestationAuthorizer,
      apiKeyRequired: true,
      requestParameters,
    });

    // Admin routes
    const admin = v1.addResource("admin");
    const adminResources = [
      "organizations",
      "locations",
      "activities",
      "pricing",
      "schedules",
    ];
    const adminIntegration = new apigateway.Integration({
      type: apigateway.IntegrationType.AWS_PROXY,
      integrationHttpMethod: "POST",
      uri: `arn:aws:apigateway:${cdk.Stack.of(this).region}:lambda:path/2015-03-31/functions/${adminFunction.functionArn}/invocations`,
    });
    adminFunction.addPermission("AdminApiInvokePermission", {
      principal: new iam.ServicePrincipal("apigateway.amazonaws.com"),
      sourceArn: api.arnForExecuteApi(),
    });

    for (const resourceName of adminResources) {
      const resource = admin.addResource(resourceName);
      resource.addMethod("GET", adminIntegration, {
        authorizationType: apigateway.AuthorizationType.COGNITO,
        authorizer,
      });
      resource.addMethod("POST", adminIntegration, {
        authorizationType: apigateway.AuthorizationType.COGNITO,
        authorizer,
      });

      const resourceById = resource.addResource("{id}");
      resourceById.addMethod("GET", adminIntegration, {
        authorizationType: apigateway.AuthorizationType.COGNITO,
        authorizer,
      });
      resourceById.addMethod("PUT", adminIntegration, {
        authorizationType: apigateway.AuthorizationType.COGNITO,
        authorizer,
      });
      resourceById.addMethod("DELETE", adminIntegration, {
        authorizationType: apigateway.AuthorizationType.COGNITO,
        authorizer,
      });
    }

    const users = admin.addResource("users");
    const userByName = users.addResource("{username}");
    const userGroups = userByName.addResource("groups");
    userGroups.addMethod("POST", adminIntegration, {
      authorizationType: apigateway.AuthorizationType.COGNITO,
      authorizer,
    });
    userGroups.addMethod("DELETE", adminIntegration, {
      authorizationType: apigateway.AuthorizationType.COGNITO,
      authorizer,
    });

    // ---------------------------------------------------------------------
    // Admin Bootstrap (Conditional)
    // ---------------------------------------------------------------------
    const adminBootstrapEmail = new cdk.CfnParameter(
      this,
      "AdminBootstrapEmail",
      {
        type: "String",
        default: "",
        description: "Optional admin email for bootstrap user creation",
      }
    );
    const adminBootstrapPassword = new cdk.CfnParameter(
      this,
      "AdminBootstrapTempPassword",
      {
        type: "String",
        default: "",
        noEcho: true,
        description: "Temporary password for bootstrap admin user",
      }
    );
    const bootstrapCondition = new cdk.CfnCondition(
      this,
      "CreateAdminBootstrap",
      {
        expression: cdk.Fn.conditionAnd(
          cdk.Fn.conditionNot(
            cdk.Fn.conditionEquals(adminBootstrapEmail.valueAsString, "")
          ),
          cdk.Fn.conditionNot(
            cdk.Fn.conditionEquals(adminBootstrapPassword.valueAsString, "")
          )
        ),
      }
    );

    const adminBootstrapFunction = createPythonFunction(
      "AdminBootstrapFunction",
      {
        handler: "lambda/admin_bootstrap/handler.lambda_handler",
        memorySize: 256,
        timeout: cdk.Duration.seconds(30),
      }
    );
    adminBootstrapFunction.addPermission(
      "AdminBootstrapInvokePermission",
      {
        principal: new iam.ServicePrincipal("cloudformation.amazonaws.com"),
        sourceArn: cdk.Stack.of(this).stackId,
        sourceAccount: cdk.Stack.of(this).account,
      }
    );

    adminBootstrapFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "cognito-idp:AdminCreateUser",
          "cognito-idp:AdminUpdateUserAttributes",
          "cognito-idp:AdminSetUserPassword",
          "cognito-idp:AdminAddUserToGroup",
        ],
        resources: [userPool.userPoolArn],
      })
    );

    const adminBootstrapResource = new cdk.CustomResource(
      this,
      "AdminBootstrapResource",
      {
        serviceToken: adminBootstrapFunction.functionArn,
        properties: {
          UserPoolId: userPool.userPoolId,
          Email: adminBootstrapEmail.valueAsString,
          TempPassword: adminBootstrapPassword.valueAsString,
          GroupName: adminGroupName,
        },
      }
    );
    const adminBootstrapCfn =
      adminBootstrapResource.node.defaultChild as cdk.CfnResource;
    adminBootstrapCfn.cfnOptions.condition = bootstrapCondition;

    // ---------------------------------------------------------------------
    // Database Migrations
    // ---------------------------------------------------------------------
    const migrationsHash = hashDirectory(
      path.join(__dirname, "../../db/alembic/versions")
    );
    const seedHash = hashFile(path.join(__dirname, "../../db/seed/seed_data.sql"));

    const migrateResource = new cdk.CustomResource(this, "RunMigrations", {
      serviceToken: migrationFunction.functionArn,
      properties: {
        MigrationsHash: migrationsHash,
        SeedHash: seedHash,
        RunSeed: true,
      },
    });
    migrateResource.node.addDependency(database.cluster);

    // ---------------------------------------------------------------------
    // Outputs
    // ---------------------------------------------------------------------
    new cdk.CfnOutput(this, "ApiUrl", {
      value: api.url,
    });

    new cdk.CfnOutput(this, "DatabaseSecretArn", {
      value: database.secret?.secretArn ?? "",
    });

    new cdk.CfnOutput(this, "DatabaseProxyEndpoint", {
      value: database.proxy.endpoint,
    });

    new cdk.CfnOutput(this, "UserPoolId", {
      value: userPool.userPoolId,
    });

    new cdk.CfnOutput(this, "UserPoolClientId", {
      value: userPoolClient.ref,
    });

    const customAuthDomainOutput = new cdk.CfnOutput(
      this,
      "CognitoCustomDomainCloudFront",
      {
        value: customHostedDomain.attrCloudFrontDistribution,
      }
    );
    customAuthDomainOutput.condition = useCustomDomain;
  }
}

// CORS origins must be concrete at synth time for preflight generation.
function resolveCorsAllowedOrigins(scope: Construct): string[] {
  const defaultOrigins = [
    "capacitor://localhost",
    "ionic://localhost",
    "http://localhost",
    "http://localhost:3000",
    "https://siutindei.lx-software.com",
  ];
  const contextOrigins = normalizeCorsOrigins(
    scope.node.tryGetContext("corsAllowedOrigins")
  );
  if (contextOrigins.length > 0) {
    return contextOrigins;
  }
  const envOrigins = normalizeCorsOrigins(process.env.CORS_ALLOWED_ORIGINS);
  if (envOrigins.length > 0) {
    return envOrigins;
  }
  return defaultOrigins;
}

function normalizeCorsOrigins(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((origin) => `${origin}`.trim())
      .filter((origin) => origin.length > 0);
  }
  if (typeof value !== "string") {
    return [];
  }
  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

function parseOptionalPort(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid port value: ${value}`);
  }
  return parsed;
}

function parseOptionalBoolean(value: string | undefined): boolean | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "y"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "n"].includes(normalized)) {
    return false;
  }
  throw new Error(`Invalid boolean value: ${value}`);
}

function hashFile(filePath: string): string {
  if (!fs.existsSync(filePath)) {
    return "missing";
  }
  const data = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(data).digest("hex");
}

function hashDirectory(dirPath: string): string {
  if (!fs.existsSync(dirPath)) {
    return "missing";
  }
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(hashDirectory(fullPath));
    } else {
      files.push(hashFile(fullPath));
    }
  }

  return crypto.createHash("sha256").update(files.sort().join("")).digest("hex");
}
