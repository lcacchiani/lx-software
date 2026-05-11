import * as path from "node:path";
import * as cdk from "aws-cdk-lib";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import { HttpJwtAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as kms from "aws-cdk-lib/aws-kms";
import * as lambdaEventSources from "aws-cdk-lib/aws-lambda-event-sources";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as ses from "aws-cdk-lib/aws-ses";
import * as sesActions from "aws-cdk-lib/aws-ses-actions";
import * as sqs from "aws-cdk-lib/aws-sqs";
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
  /**
   * Shared customer-managed KMS key used to encrypt:
   * - Lambda environment variables (Checkov CKV_AWS_173)
   * - CloudWatch log groups (Checkov CKV_AWS_158)
   * - DynamoDB tables (Checkov CKV_AWS_119)
   *
   * Cost: $1/month flat. KMS API calls for this workload (admin-only,
   * low-traffic) stay well under the 20,000/month free tier. Key
   * rotation is enabled (annual, AWS-managed).
   */
  public readonly sharedEncryptionKey: kms.Key;
  /**
   * Shared SQS dead-letter queue for failed async Lambda invocations
   * (Checkov CKV_AWS_116). One queue is used for every application
   * Lambda in the stack — sharing avoids per-function queue overhead and
   * stays within the SQS free tier (1M requests/month) for our admin
   * workload. Encrypted with the same shared CMK.
   */
  public readonly lambdaDeadLetterQueue: sqs.Queue;

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
    // 1. Shared KMS encryption key + Lambda DLQ
    //
    // One customer-managed key fans out to Lambda env vars, CloudWatch
    // log groups, DynamoDB tables, and the shared SQS DLQ. This keeps
    // the recurring KMS bill at $1/month total (vs. ~$7/month if every
    // resource minted its own key) while still satisfying Checkov
    // CKV_AWS_158 / 173 / 119.
    //
    // The key policy below grants the CloudWatch Logs service principal
    // the Encrypt/Decrypt actions it needs to write encrypted log events,
    // scoped via `kms:EncryptionContext:aws:logs:arn` to log groups in
    // this account/region only.
    // ------------------------------------------------------------------
    this.sharedEncryptionKey = new kms.Key(this, "SharedEncryptionKey", {
      alias: "lxsoftware-admin/shared",
      description:
        "Shared CMK for Lambda env vars, CloudWatch logs, DynamoDB, and SQS DLQ in the lxsoftware admin stack.",
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const region = cdk.Stack.of(this).region;
    const accountId = cdk.Stack.of(this).account;
    this.sharedEncryptionKey.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: "AllowCloudWatchLogsEncryption",
        principals: [
          new iam.ServicePrincipal(`logs.${region}.amazonaws.com`),
        ],
        actions: [
          "kms:Encrypt*",
          "kms:Decrypt*",
          "kms:ReEncrypt*",
          "kms:GenerateDataKey*",
          "kms:Describe*",
        ],
        resources: ["*"],
        conditions: {
          ArnLike: {
            "kms:EncryptionContext:aws:logs:arn": `arn:aws:logs:${region}:${accountId}:*`,
          },
        },
      })
    );

    this.lambdaDeadLetterQueue = new sqs.Queue(this, "LambdaDeadLetterQueue", {
      queueName: "lxsoftware-admin-lambda-dlq",
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: this.sharedEncryptionKey,
      retentionPeriod: cdk.Duration.days(14),
    });

    // ------------------------------------------------------------------
    // 2. Auth (Cognito user pool, Google IdP, hosted UI, bootstrap admin)
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
      sharedEncryptionKey: this.sharedEncryptionKey,
      sharedDeadLetterQueue: this.lambdaDeadLetterQueue,
    });

    // ------------------------------------------------------------------
    // 3. Data (DynamoDB tables)
    //
    // Both tables use the shared customer-managed KMS key (CKV_AWS_119).
    // KMS API calls are charged per request beyond the free tier (20k/mo),
    // but the admin-only workload stays well below that ceiling.
    // ------------------------------------------------------------------
    this.recordsTable = new dynamodb.Table(this, "RecordsTable", {
      tableName: "lxsoftware-admin-records",
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: this.sharedEncryptionKey,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.recordsTable.addGlobalSecondaryIndex({
      indexName: "gsi1",
      partitionKey: { name: "gsi1pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "gsi1sk", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    const recordsTableCfn = this.recordsTable.node.defaultChild as dynamodb.CfnTable;
    recordsTableCfn.timeToLiveSpecification = {
      attributeName: "expiresAt",
      enabled: true,
    };

    this.auditLogTable = new dynamodb.Table(this, "AuditLogTable", {
      tableName: "lxsoftware-admin-audit-log",
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: this.sharedEncryptionKey,
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
      // PDF parsing uses OpenRouter; worker runs can exceed a minute. HTTP API
      // integrations stay within ~30s; async parse jobs cover longer work.
      timeout: cdk.Duration.seconds(120),
      memorySize: 1024,
      environmentEncryptionKey: this.sharedEncryptionKey,
      logEncryptionKey: this.sharedEncryptionKey,
      deadLetterQueue: this.lambdaDeadLetterQueue,
      environment: {
        RECORDS_TABLE_NAME: this.recordsTable.tableName,
        AUDIT_LOG_TABLE_NAME: this.auditLogTable.tableName,
        ASSETS_BUCKET_NAME: this.assetsBucket.bucketName,
        ASSET_MAX_BYTES: String(20 * 1024 * 1024),
        OPENROUTER_API_KEY_SECRET_ARN: openRouterApiKeySecretArn.valueAsString,
        OPENROUTER_MODEL: openRouterModel.valueAsString,
        OPENROUTER_PDF_ENGINE: openRouterPdfEngine.valueAsString,
        PARSE_JOB_STALE_SECONDS: "150",
        PARSE_JOB_STUCK_SECONDS: "240",
        PARSE_JOB_TTL_SECONDS: "604800",
      },
    });

    // Self-invoke worker name: handler falls back to the Lambda runtime's
    // built-in `AWS_LAMBDA_FUNCTION_NAME` env var when `PARSE_WORKER_FUNCTION_NAME`
    // is unset, so we deliberately do NOT add a self-referencing env var here
    // (`addEnvironment("PARSE_WORKER_FUNCTION_NAME", adminFn.functionName)` would
    // make AdminApiFn depend on itself via `Ref`, which CloudFormation rejects
    // as a circular dependency).

    new lambda.EventInvokeConfig(this, "AdminApiAsyncInvoke", {
      function: adminFn,
      retryAttempts: 0,
      maxEventAge: cdk.Duration.minutes(6),
    });

    // Self-invoke permission for async parse worker. Using
    // `adminFn.grantInvoke(adminFn)` would add a `Fn::GetAtt` of the function
    // ARN into the function's own role default policy, while CDK adds a
    // `DependsOn: AdminApiFnServiceRoleDefaultPolicy` on the function — that
    // pair forms a circular dependency. Construct the resource ARN from the
    // stack's pseudo-parameters (no Ref/GetAtt on the function itself) to
    // break the cycle. The wildcard is acceptable because the role is
    // attached only to this Lambda, whose code is the sole consumer.
    const selfInvokeArn = cdk.Stack.of(this).formatArn({
      service: "lambda",
      resource: "function",
      resourceName: "*",
      arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
    });
    new iam.Policy(this, "AdminApiFnSelfInvokePolicy", {
      statements: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ["lambda:InvokeFunction"],
          resources: [selfInvokeArn],
        }),
      ],
    }).attachToRole(adminFn.role!);

    // Allow async-invocation DLQ writes from this function.
    this.lambdaDeadLetterQueue.grantSendMessages(adminFn);

    this.recordsTable.grantReadWriteData(adminFn);
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

    /**
     * Raw objects land at ``<inboundRawMailPrefix>/<houseKey>/…``. Lambda env
     * ``INBOUND_RAW_MAIL_PREFIX`` must match ``inboundRawMailPrefix``.
     */
    const inboundRawMailPrefix = "inbound-raw";

    /**
     * Map each inbox local-part to a finance house key (must match
     * ``FINANCE_HOUSE_KEYS`` / ``HouseKey`` in the admin app). Display names
     * differ: e.g. "32 Hillmarton" in the UI uses key ``hillmarton``; the
     * Morrison house uses key ``morrison``.
     */
    const inboundHouseMailboxes: ReadonlyArray<{
      readonly localPart: string;
      readonly houseKey: string;
    }> = [
      { localPart: "32-hillmarton", houseKey: "hillmarton" },
      // { localPart: "the-morrison", houseKey: "morrison" },
    ];

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
          prefix: `${inboundRawMailPrefix}/`,
        },
      ],
    });

    const inboundStatementFn = createPythonLambda(this, "InboundStatementMailFn", {
      entryDir: path.join(__dirname, "..", "..", "lambda", "admin"),
      handler: "inbound_email_handler.lambda_handler",
      timeout: cdk.Duration.seconds(120),
      memorySize: 1024,
      environmentEncryptionKey: this.sharedEncryptionKey,
      logEncryptionKey: this.sharedEncryptionKey,
      deadLetterQueue: this.lambdaDeadLetterQueue,
      environment: {
        RECORDS_TABLE_NAME: this.recordsTable.tableName,
        AUDIT_LOG_TABLE_NAME: this.auditLogTable.tableName,
        ASSETS_BUCKET_NAME: this.assetsBucket.bucketName,
        INBOUND_MAIL_BUCKET_NAME: inboundMailBucket.bucketName,
        INBOUND_RAW_MAIL_PREFIX: inboundRawMailPrefix,
        INBOUND_AUDIT_USER_SUB: "inbound-email",
        ASSET_MAX_BYTES: String(20 * 1024 * 1024),
        OPENROUTER_API_KEY_SECRET_ARN: openRouterApiKeySecretArn.valueAsString,
        OPENROUTER_MODEL: openRouterModel.valueAsString,
        OPENROUTER_PDF_ENGINE: openRouterPdfEngine.valueAsString,
        PARSE_WORKER_FUNCTION_NAME: adminFn.functionName,
        PARSE_JOB_STALE_SECONDS: "150",
        PARSE_JOB_STUCK_SECONDS: "240",
        PARSE_JOB_TTL_SECONDS: "604800",
      },
    });

    this.recordsTable.grantReadWriteData(inboundStatementFn);
    this.auditLogTable.grantReadWriteData(inboundStatementFn);
    this.assetsBucket.grantReadWrite(inboundStatementFn);
    inboundMailBucket.grantRead(inboundStatementFn);
    inboundMailBucket.grantDelete(inboundStatementFn);
    openRouterSecretPolicy.attachToRole(inboundStatementFn.role!);
    this.lambdaDeadLetterQueue.grantSendMessages(inboundStatementFn);

    adminFn.grantInvoke(inboundStatementFn);

    // AdminApiFn is invoked asynchronously for OpenRouter work (self-invoke from
    // the HTTP API + invoke from InboundStatementMailFn). A future split to
    // SQS + a dedicated parser Lambda would separate concurrency from API routes;
    // this stack keeps a single code bundle for low admin traffic.

    const inboundReceiptRuleSet = new ses.ReceiptRuleSet(this, "InboundMailReceiptRuleSet", {
      receiptRuleSetName: "lxsoftware-inbound-mail",
    });

    for (const mailbox of inboundHouseMailboxes) {
      const rawKeyPrefix = `${inboundRawMailPrefix}/${mailbox.houseKey}/`;

      inboundStatementFn.addEventSource(
        new lambdaEventSources.S3EventSource(inboundMailBucket, {
          events: [s3.EventType.OBJECT_CREATED],
          filters: [{ prefix: rawKeyPrefix }],
        })
      );

      inboundReceiptRuleSet.addRule(`InboundMailbox-${mailbox.houseKey}`, {
        recipients: [
          cdk.Fn.join("", [mailbox.localPart, "@", inboundMailDomain.valueAsString]),
        ],
        enabled: true,
        actions: [
          new sesActions.S3({
            bucket: inboundMailBucket,
            objectKeyPrefix: rawKeyPrefix,
          }),
        ],
      });
    }

    // AWS::ApiGatewayV2::Integration TimeoutInMillis must be 50–30000 ms in this
    // account/region; CDK defaults (~29s). Do not raise via L1 overrides.
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
      // CKV_AWS_158: encrypt at rest with the stack's shared CMK. The
      // CloudWatch Logs service principal is granted Encrypt*/Decrypt*
      // on the key in the stack-level policy above.
      encryptionKey: this.sharedEncryptionKey,
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
      methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST],
      integration,
      authorizer: jwtAuthorizer,
    });

    this.httpApi.addRoutes({
      path: "/assets/delete",
      methods: [apigwv2.HttpMethod.POST],
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

    this.httpApi.addRoutes({
      path: "/finance/{house}/parse-statement/jobs/{jobId}",
      methods: [apigwv2.HttpMethod.GET],
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

    for (const mailbox of inboundHouseMailboxes) {
      const suffix = mailbox.houseKey.replace(/[^a-zA-Z0-9]/g, "");
      const displayHint =
        mailbox.houseKey === "hillmarton"
          ? 'Statement PDF inbox for "32 Hillmarton"'
          : `Statement PDF inbox (finance house key "${mailbox.houseKey}")`;
      new cdk.CfnOutput(this, `InboundMailboxAddress${suffix}`, {
        value: cdk.Fn.join("", [mailbox.localPart, "@", inboundMailDomain.valueAsString]),
        description: `${displayHint}; DDB/API key is "${mailbox.houseKey}".`,
        exportName: `lxsoftware-InboundMailbox-${mailbox.houseKey}`,
      });
    }

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
