import * as path from "node:path";
import * as cdk from "aws-cdk-lib";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import { HttpJwtAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambdaEventSources from "aws-cdk-lib/aws-lambda-event-sources";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as ses from "aws-cdk-lib/aws-ses";
import * as sesActions from "aws-cdk-lib/aws-ses-actions";
import type { Construct } from "constructs";
import { AuthConstruct } from "./constructs/auth";
import { createPythonLambda } from "./constructs/python-lambda";

/**
 * Consolidated admin backend stack: Cognito user pool (with Pre Token
 * Generation Lambda + Google IdP), DynamoDB tables, private uploads
 * bucket (with its own S3 access logs bucket), and the HTTP API plus
 * the admin Lambda that consumes them.
 *
 * All physical names use the `lxsoftware-admin-*` prefix.
 */
export class LxsoftwareStack extends cdk.Stack {
  public readonly auth: AuthConstruct;
  public readonly recordsTable: dynamodb.Table;
  public readonly auditLogTable: dynamodb.Table;
  public readonly assetsBucket: s3.Bucket;
  public readonly assetsAccessLogsBucket: s3.Bucket;
  public readonly httpApi: apigwv2.HttpApi;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ------------------------------------------------------------------
    // CloudFormation parameters
    // ------------------------------------------------------------------
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

    const adminFederatedEmailAllowlist = new cdk.CfnParameter(
      this,
      "AdminFederatedEmailAllowlist",
      {
        type: "String",
        description:
          "Comma-separated lower-case emails that receive the admin group in tokens (Pre Token Generation). Include every Google admin and the bootstrap email.",
      }
    );

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
      default: "lxsoftware-admin-auth",
    });

    const cognitoCustomDomainName = new cdk.CfnParameter(
      this,
      "CognitoCustomDomainName",
      {
        type: "String",
        default: "",
        description:
          "Optional custom Hosted UI domain (e.g. auth.lx-software.com). " +
          "Set together with CognitoCustomDomainCertificateArn; leave empty for the prefix domain.",
      }
    );

    const cognitoCustomDomainCertificateArn = new cdk.CfnParameter(
      this,
      "CognitoCustomDomainCertificateArn",
      {
        type: "String",
        default: "",
        description:
          "ACM certificate ARN for the Cognito custom domain (must be in us-east-1).",
      }
    );

    const openRouterApiKeySecretArn = new cdk.CfnParameter(
      this,
      "OpenRouterApiKeySecretArn",
      {
        type: "String",
        default: "",
        description:
          "ARN of the AWS Secrets Manager secret holding the OpenRouter API key (used by the admin Lambda to parse uploaded statement PDFs). Leave blank to disable PDF statement parsing.",
      }
    );

    const openRouterModel = new cdk.CfnParameter(this, "OpenRouterModel", {
      type: "String",
      default: "mistralai/mistral-medium-3",
      description:
        "OpenRouter model slug used when extracting statement lines from uploaded PDFs.",
    });

    const openRouterPdfEngine = new cdk.CfnParameter(this, "OpenRouterPdfEngine", {
      type: "String",
      default: "mistral-ocr",
      description:
        "OpenRouter file-parser PDF engine: pdf-text (free, text-based PDFs), mistral-ocr (paid, scanned PDFs), or native (model-native parsing).",
    });

    // ------------------------------------------------------------------
    // 1. Auth (Cognito user pool, Google IdP, hosted UI, bootstrap admin)
    // ------------------------------------------------------------------
    this.auth = new AuthConstruct(this, "Auth", {
      adminWebDomainParameter: adminWebDomainName,
      googleClientIdParameter: googleClientId,
      googleClientSecretParameter: googleClientSecret,
      cognitoDomainPrefixParameter: cognitoDomainPrefix,
      cognitoCustomDomainNameParameter: cognitoCustomDomainName,
      cognitoCustomDomainCertificateArnParameter: cognitoCustomDomainCertificateArn,
      adminBootstrapEmailParameter: adminBootstrapEmail,
      adminBootstrapTempPasswordParameter: adminBootstrapTempPassword,
      adminFederatedEmailAllowlistParameter: adminFederatedEmailAllowlist,
    });

    // ------------------------------------------------------------------
    // 2. Data (DynamoDB tables)
    // ------------------------------------------------------------------
    this.recordsTable = new dynamodb.Table(this, "RecordsTable", {
      tableName: "lxsoftware-admin-records",
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.recordsTable.addGlobalSecondaryIndex({
      indexName: "gsi1",
      partitionKey: { name: "gsi1pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "gsi1sk", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.auditLogTable = new dynamodb.Table(this, "AuditLogTable", {
      tableName: "lxsoftware-admin-audit-log",
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ------------------------------------------------------------------
    // 3. Assets (private uploads bucket + S3 access logs bucket)
    //
    // Bucket-name length budget: S3 caps the name at 63 chars. With a
    // 12-digit account ID and the longest current AWS region label
    // (`ap-southeast-1`, 14 chars) the suffix is `-{12}-{14}` = 28 chars,
    // leaving 35 chars for the prefix. Both names below stay within that
    // budget; `assets-logs` is the deliberately shortened form of the
    // legacy `assets-s3-access-logs` (which would now exceed 63 chars).
    // ------------------------------------------------------------------
    const assetsBucketName = [
      "lxsoftware-admin-assets",
      cdk.Aws.ACCOUNT_ID,
      cdk.Aws.REGION,
    ].join("-");

    const assetsAccessLogsBucketName = [
      "lxsoftware-admin-assets-logs",
      cdk.Aws.ACCOUNT_ID,
      cdk.Aws.REGION,
    ].join("-");

    this.assetsAccessLogsBucket = new s3.Bucket(this, "AssetsS3AccessLogsBucket", {
      bucketName: assetsAccessLogsBucketName,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_PREFERRED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          id: "ExpireOldS3AccessLogs",
          enabled: true,
          expiration: cdk.Duration.days(90),
        },
      ],
    });

    /**
     * Private uploads bucket: BlockPublicAccess does not disable CORS — browsers
     * still send Origin on PUT/POST to S3; CORS is evaluated for authenticated
     * requests including presigned POST/PUT.
     */
    this.assetsBucket = new s3.Bucket(this, "AssetsBucket", {
      bucketName: assetsBucketName,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      serverAccessLogsBucket: this.assetsAccessLogsBucket,
      serverAccessLogsPrefix: "assets-data-bucket/",
      cors: [
        {
          allowedMethods: [
            s3.HttpMethods.PUT,
            s3.HttpMethods.POST,
            s3.HttpMethods.GET,
          ],
          allowedOrigins: [
            cdk.Fn.join("", ["https://", adminWebDomainName.valueAsString]),
          ],
          allowedHeaders: ["*"],
          maxAge: 3000,
        },
      ],
      lifecycleRules: [
        {
          id: "AbortIncompleteMultipartUploads",
          enabled: true,
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
        },
        {
          id: "GlacierInstantRetrievalForNonCurrentVersions",
          enabled: true,
          noncurrentVersionTransitions: [
            {
              storageClass: s3.StorageClass.GLACIER_INSTANT_RETRIEVAL,
              transitionAfter: cdk.Duration.days(30),
            },
          ],
        },
      ],
    });

    // ------------------------------------------------------------------
    // 4. HTTP API + admin Lambda
    // ------------------------------------------------------------------
    const region = cdk.Stack.of(this).region;
    const issuer = `https://cognito-idp.${region}.amazonaws.com/${this.auth.userPool.userPoolId}`;

    /**
     * Contract: jwtAudience is the Cognito app client ID, which matches the
     * `aud` claim on **ID tokens** only. Access tokens use `client_id` instead
     * of `aud`, so the SPA must send ID tokens in Authorization (see
     * apps/admin_web/src/lib/apiAdminClient.ts). Switching to access tokens
     * requires a different authorizer configuration.
     */
    const jwtAuthorizer = new HttpJwtAuthorizer("cognito-jwt", issuer, {
      jwtAudience: [this.auth.userPoolClient.userPoolClientId],
    });

    const adminFn = createPythonLambda(this, "AdminApiFn", {
      entryDir: path.join(__dirname, "..", "..", "lambda", "admin"),
      // PDF statement parsing routes synchronously call OpenRouter, which
      // can take 20-40s for multi-page PDFs. The default 10s timeout is
      // not enough for that path.
      timeout: cdk.Duration.seconds(60),
      memorySize: 1024,
      environment: {
        RECORDS_TABLE_NAME: this.recordsTable.tableName,
        AUDIT_LOG_TABLE_NAME: this.auditLogTable.tableName,
        ASSETS_BUCKET_NAME: this.assetsBucket.bucketName,
        ASSET_MAX_BYTES: String(20 * 1024 * 1024),
        OPENROUTER_API_KEY_SECRET_ARN: openRouterApiKeySecretArn.valueAsString,
        OPENROUTER_MODEL: openRouterModel.valueAsString,
        OPENROUTER_PDF_ENGINE: openRouterPdfEngine.valueAsString,
      },
    });

    this.recordsTable.grantReadWriteData(adminFn);
    this.auditLogTable.grantReadWriteData(adminFn);
    this.assetsBucket.grantReadWrite(adminFn);

    // Grant SecretsManager:GetSecretValue only when an ARN is provided.
    // We can't conditionally call grantRead() from a CfnParameter, so we
    // attach a narrow IAM policy that resolves to the parameter value at
    // deploy time. When the ARN is blank, the resource list collapses to
    // an empty string and the action is effectively a no-op.
    const openRouterSecretArnValue = openRouterApiKeySecretArn.valueAsString;
    const hasOpenRouterSecret = new cdk.CfnCondition(
      this,
      "HasOpenRouterSecret",
      {
        expression: cdk.Fn.conditionNot(
          cdk.Fn.conditionEquals(openRouterSecretArnValue, "")
        ),
      }
    );
    const openRouterSecretPolicy = new iam.Policy(this, "AdminOpenRouterSecretPolicy", {
      statements: [
        new iam.PolicyStatement({
          actions: ["secretsmanager:GetSecretValue"],
          resources: [openRouterSecretArnValue],
        }),
      ],
    });
    openRouterSecretPolicy.attachToRole(adminFn.role!);
    const cfnSecretPolicy = openRouterSecretPolicy.node.defaultChild as iam.CfnPolicy;
    cfnSecretPolicy.cfnOptions.condition = hasOpenRouterSecret;

    // ------------------------------------------------------------------
    // Inbound mail: SES → S3 (raw) → Lambda extracts PDF → same parser as UI
    // ------------------------------------------------------------------
    const inboundMailDomain = new cdk.CfnParameter(this, "InboundMailDomain", {
      type: "String",
      default: "inbound.lx-software.com",
      description:
        "Domain for receiving statement mail (verify domain + MX to SES in this region before use).",
    });

    const inboundMailLocalPart = new cdk.CfnParameter(this, "InboundMailLocalPart", {
      type: "String",
      default: "hillmarton",
      description: "Local part of the Hillmarton statement inbox address.",
    });

    const inboundStatementAddress = cdk.Fn.join("", [
      inboundMailLocalPart.valueAsString,
      "@",
      inboundMailDomain.valueAsString,
    ]);

    const inboundMailBucketName = [
      "lxsoftware-admin-inbound-mail",
      cdk.Aws.ACCOUNT_ID,
      cdk.Aws.REGION,
    ].join("-");

    const inboundMailBucket = new s3.Bucket(this, "InboundMailBucket", {
      bucketName: inboundMailBucketName,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          id: "ExpireRawInboundMail",
          enabled: true,
          expiration: cdk.Duration.days(30),
          prefix: "hillmarton-raw/",
        },
      ],
    });

    const inboundStatementFn = createPythonLambda(this, "InboundStatementMailFn", {
      entryDir: path.join(__dirname, "..", "..", "lambda", "admin"),
      handler: "inbound_email_handler.lambda_handler",
      timeout: cdk.Duration.seconds(60),
      memorySize: 1024,
      environment: {
        RECORDS_TABLE_NAME: this.recordsTable.tableName,
        AUDIT_LOG_TABLE_NAME: this.auditLogTable.tableName,
        ASSETS_BUCKET_NAME: this.assetsBucket.bucketName,
        INBOUND_MAIL_BUCKET_NAME: inboundMailBucket.bucketName,
        INBOUND_FINANCE_HOUSE: "hillmarton",
        INBOUND_AUDIT_USER_SUB: "inbound-email",
        ASSET_MAX_BYTES: String(20 * 1024 * 1024),
        OPENROUTER_API_KEY_SECRET_ARN: openRouterApiKeySecretArn.valueAsString,
        OPENROUTER_MODEL: openRouterModel.valueAsString,
        OPENROUTER_PDF_ENGINE: openRouterPdfEngine.valueAsString,
      },
    });

    this.recordsTable.grantReadWriteData(inboundStatementFn);
    this.auditLogTable.grantReadWriteData(inboundStatementFn);
    this.assetsBucket.grantReadWrite(inboundStatementFn);
    inboundMailBucket.grantRead(inboundStatementFn);
    inboundMailBucket.grantDelete(inboundStatementFn);
    openRouterSecretPolicy.attachToRole(inboundStatementFn.role!);

    inboundStatementFn.addEventSource(
      new lambdaEventSources.S3EventSource(inboundMailBucket, {
        events: [s3.EventType.OBJECT_CREATED],
        filters: [{ prefix: "hillmarton-raw/" }],
      })
    );

    const inboundReceiptRuleSet = new ses.ReceiptRuleSet(this, "InboundMailReceiptRuleSet", {
      receiptRuleSetName: "lxsoftware-inbound-mail",
    });

    inboundReceiptRuleSet.addRule("HillmartonStatementInbox", {
      recipients: [inboundStatementAddress],
      enabled: true,
      actions: [
        new sesActions.S3({
          bucket: inboundMailBucket,
          objectKeyPrefix: "hillmarton-raw/",
        }),
      ],
    });

    const integration = new HttpLambdaIntegration("AdminIntegration", adminFn);

    this.httpApi = new apigwv2.HttpApi(this, "HttpApi", {
      apiName: "lxsoftware-admin-api",
      corsPreflight: {
        allowHeaders: ["authorization", "content-type"],
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.PUT,
          apigwv2.CorsHttpMethod.DELETE,
          apigwv2.CorsHttpMethod.OPTIONS,
        ],
        allowOrigins: [
          cdk.Fn.join("", ["https://", adminWebDomainName.valueAsString]),
        ],
        allowCredentials: false,
      },
    });

    const accessLogGroup = new logs.LogGroup(this, "HttpApiAccessLogs", {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    accessLogGroup.addToResourcePolicy(
      new iam.PolicyStatement({
        principals: [new iam.ServicePrincipal("apigateway.amazonaws.com")],
        actions: ["logs:CreateLogStream", "logs:PutLogEvents"],
        resources: [`${accessLogGroup.logGroupArn}:*`],
      })
    );

    const defaultStage = this.httpApi.defaultStage?.node
      .defaultChild as apigwv2.CfnStage;
    defaultStage.accessLogSettings = {
      destinationArn: accessLogGroup.logGroupArn,
      format: JSON.stringify({
        requestId: "$context.requestId",
        routeKey: "$context.routeKey",
        status: "$context.status",
        integrationError: "$context.integrationErrorMessage",
        authorizerError: "$context.authorizer.error",
        httpMethod: "$context.httpMethod",
        path: "$context.path",
        sourceIp: "$context.identity.sourceIp",
        // Populated by HttpJwtAuthorizer; lets us correlate 4xx with the
        // specific Cognito identity / token without having to add per-handler logs.
        claimSub: "$context.authorizer.claims.sub",
        claimEmail: "$context.authorizer.claims.email",
        claimGroups: "$context.authorizer.claims.cognito:groups",
        claimTokenUse: "$context.authorizer.claims.token_use",
      }),
    };

    this.httpApi.addRoutes({
      path: "/health",
      methods: [apigwv2.HttpMethod.GET],
      integration,
    });

    this.httpApi.addRoutes({
      path: "/me",
      methods: [apigwv2.HttpMethod.GET],
      integration,
      authorizer: jwtAuthorizer,
    });

    this.httpApi.addRoutes({
      path: "/fx/v2/rates",
      methods: [apigwv2.HttpMethod.GET],
      integration,
      authorizer: jwtAuthorizer,
    });

    this.httpApi.addRoutes({
      path: "/assets/upload-url",
      methods: [apigwv2.HttpMethod.POST],
      integration,
      authorizer: jwtAuthorizer,
    });

    this.httpApi.addRoutes({
      path: "/assets/confirm",
      methods: [apigwv2.HttpMethod.POST],
      integration,
      authorizer: jwtAuthorizer,
    });

    this.httpApi.addRoutes({
      path: "/assets/download-url",
      methods: [apigwv2.HttpMethod.GET],
      integration,
      authorizer: jwtAuthorizer,
    });

    this.httpApi.addRoutes({
      path: "/records",
      methods: [
        apigwv2.HttpMethod.GET,
        apigwv2.HttpMethod.POST,
        apigwv2.HttpMethod.PUT,
      ],
      integration,
      authorizer: jwtAuthorizer,
    });

    this.httpApi.addRoutes({
      path: "/finance",
      methods: [apigwv2.HttpMethod.GET],
      integration,
      authorizer: jwtAuthorizer,
    });

    this.httpApi.addRoutes({
      path: "/finance/income",
      methods: [apigwv2.HttpMethod.PUT],
      integration,
      authorizer: jwtAuthorizer,
    });

    this.httpApi.addRoutes({
      path: "/finance/expenses",
      methods: [apigwv2.HttpMethod.PUT],
      integration,
      authorizer: jwtAuthorizer,
    });

    this.httpApi.addRoutes({
      path: "/finance/{house}",
      methods: [apigwv2.HttpMethod.PUT],
      integration,
      authorizer: jwtAuthorizer,
    });

    this.httpApi.addRoutes({
      path: "/finance/{house}/parse-statement",
      methods: [apigwv2.HttpMethod.POST],
      integration,
      authorizer: jwtAuthorizer,
    });

    // ------------------------------------------------------------------
    // CloudFormation outputs (export names kept stable for compatibility
    // with downstream consumers / dashboards / runbooks).
    // ------------------------------------------------------------------
    new cdk.CfnOutput(this, "UserPoolId", {
      value: this.auth.userPool.userPoolId,
      exportName: "lxsoftware-UserPoolId",
    });

    new cdk.CfnOutput(this, "UserPoolClientId", {
      value: this.auth.userPoolClient.userPoolClientId,
      exportName: "lxsoftware-UserPoolClientId",
    });

    new cdk.CfnOutput(this, "UserPoolArn", {
      value: this.auth.userPool.userPoolArn,
      exportName: "lxsoftware-UserPoolArn",
    });

    new cdk.CfnOutput(this, "CognitoDomain", {
      value: this.auth.cognitoOAuthBaseUrl,
      description: "Full https URL for Cognito hosted UI / OAuth.",
      exportName: "lxsoftware-CognitoDomain",
    });

    const cognitoCustomDomainCloudFront = new cdk.CfnOutput(
      this,
      "CognitoCustomDomainCloudFront",
      {
        value: this.auth.cognitoCustomHostedDomain.attrCloudFrontDistribution,
        description:
          "CNAME target for the Cognito custom Hosted UI domain (ACM + DNS).",
        exportName: "lxsoftware-CognitoCustomDomainCloudFront",
      }
    );
    cognitoCustomDomainCloudFront.condition = this.auth.useCustomAuthDomain;

    new cdk.CfnOutput(this, "RecordsTableName", {
      value: this.recordsTable.tableName,
      exportName: "lxsoftware-RecordsTableName",
    });

    new cdk.CfnOutput(this, "RecordsTableArn", {
      value: this.recordsTable.tableArn,
      exportName: "lxsoftware-RecordsTableArn",
    });

    new cdk.CfnOutput(this, "AuditLogTableName", {
      value: this.auditLogTable.tableName,
      exportName: "lxsoftware-AuditLogTableName",
    });

    new cdk.CfnOutput(this, "AuditLogTableArn", {
      value: this.auditLogTable.tableArn,
      exportName: "lxsoftware-AuditLogTableArn",
    });

    new cdk.CfnOutput(this, "AssetsBucketName", {
      value: this.assetsBucket.bucketName,
      exportName: "lxsoftware-AssetsBucketName",
    });

    new cdk.CfnOutput(this, "AssetsBucketArn", {
      value: this.assetsBucket.bucketArn,
      exportName: "lxsoftware-AssetsBucketArn",
    });

    new cdk.CfnOutput(this, "InboundStatementEmail", {
      value: inboundStatementAddress,
      description:
        "Address to email Hillmarton PDF statements (SES domain verification, MX, and active receipt rule set required).",
      exportName: "lxsoftware-InboundStatementEmail",
    });

    new cdk.CfnOutput(this, "InboundMailReceiptRuleSetName", {
      value: inboundReceiptRuleSet.receiptRuleSetName,
      description:
        "SES receipt rule set for inbound mail. Activate once per region: aws ses set-active-receipt-rule-set --rule-set-name lxsoftware-inbound-mail",
      exportName: "lxsoftware-InboundMailReceiptRuleSetName",
    });

    new cdk.CfnOutput(this, "InboundMailMxTarget", {
      value: cdk.Fn.join("", ["inbound-smtp.", cdk.Aws.REGION, ".amazonaws.com"]),
      description: "MX record hostname (use priority 10) for the inbound mail domain.",
      exportName: "lxsoftware-InboundMailMxTarget",
    });

    new cdk.CfnOutput(this, "InboundMailBucketName", {
      value: inboundMailBucket.bucketName,
      description: "S3 bucket where SES stores raw inbound messages before processing.",
      exportName: "lxsoftware-InboundMailBucketName",
    });

    new cdk.CfnOutput(this, "AdminApiBaseUrl", {
      value: this.httpApi.apiEndpoint,
      description: "Invoke URL for the admin HTTP API.",
      exportName: "lxsoftware-AdminApiBaseUrl",
    });
  }
}
