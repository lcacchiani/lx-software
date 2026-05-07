import * as path from "node:path";
import * as cdk from "aws-cdk-lib";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { HttpJwtAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";
import { createPythonLambda } from "./constructs/python-lambda";

export interface AdminApiStackProps extends cdk.StackProps {
  readonly userPool: cognito.IUserPool;
  readonly userPoolClient: cognito.IUserPoolClient;
  readonly recordsTable: dynamodb.ITable;
  readonly auditLogTable: dynamodb.ITable;
  readonly assetsBucket: s3.IBucket;
}

export class AdminApiStack extends cdk.Stack {
  public readonly httpApi: apigwv2.HttpApi;

  constructor(scope: Construct, id: string, props: AdminApiStackProps) {
    super(scope, id, props);

    cdk.Tags.of(this).add("Organization", "LX Software");
    cdk.Tags.of(this).add("Project", "Admin Console");

    const region = cdk.Stack.of(this).region;
    const issuer = `https://cognito-idp.${region}.amazonaws.com/${props.userPool.userPoolId}`;

    /**
     * Contract: jwtAudience is the Cognito app client ID, which matches the
     * `aud` claim on **ID tokens** only. Access tokens use `client_id` instead
     * of `aud`, so the SPA must send ID tokens in Authorization (see
     * apps/admin_web/src/lib/apiAdminClient.ts). Switching to access tokens
     * requires a different authorizer configuration.
     */
    const jwtAuthorizer = new HttpJwtAuthorizer("cognito-jwt", issuer, {
      jwtAudience: [props.userPoolClient.userPoolClientId],
    });

    const adminFn = createPythonLambda(this, "AdminApiFn", {
      entryDir: path.join(__dirname, "..", "..", "lambda", "admin"),
      environment: {
        RECORDS_TABLE_NAME: props.recordsTable.tableName,
        AUDIT_LOG_TABLE_NAME: props.auditLogTable.tableName,
        ASSETS_BUCKET_NAME: props.assetsBucket.bucketName,
        ASSET_MAX_BYTES: String(20 * 1024 * 1024),
      },
    });

    props.recordsTable.grantReadWriteData(adminFn);
    props.auditLogTable.grantReadWriteData(adminFn);
    props.assetsBucket.grantReadWrite(adminFn);

    const integration = new HttpLambdaIntegration("AdminIntegration", adminFn);

    this.httpApi = new apigwv2.HttpApi(this, "HttpApi", {
      apiName: "lx-admin-api",
      corsPreflight: {
        allowHeaders: ["authorization", "content-type"],
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.PUT,
          apigwv2.CorsHttpMethod.DELETE,
          apigwv2.CorsHttpMethod.OPTIONS,
        ],
        allowOrigins: ["https://admin.lx-software.com"],
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
        httpMethod: "$context.httpMethod",
        path: "$context.path",
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
      path: "/records",
      methods: [
        apigwv2.HttpMethod.GET,
        apigwv2.HttpMethod.POST,
        apigwv2.HttpMethod.PUT,
      ],
      integration,
      authorizer: jwtAuthorizer,
    });

    new cdk.CfnOutput(this, "AdminApiBaseUrl", {
      value: this.httpApi.apiEndpoint,
      description: "Invoke URL for the admin HTTP API.",
      exportName: "lx-admin-AdminApiBaseUrl",
    });
  }
}
