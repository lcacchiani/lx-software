import * as cdk from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";

export interface AdminWebStackProps extends cdk.StackProps {
  /** Full https Cognito hosted UI origin for Content-Security-Policy connect-src */
  readonly cspCognitoConnectOrigin: string;
  /** Admin HTTP API origin (https://{api-id}.execute-api.{region}.amazonaws.com) for CSP connect-src */
  readonly cspApiConnectOrigin: string;
}

export class AdminWebStack extends cdk.Stack {
  public readonly bucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;
  public readonly accessLogsBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: AdminWebStackProps) {
    super(scope, id, props);

    cdk.Tags.of(this).add("Organization", "LX Software");
    cdk.Tags.of(this).add("Project", "Admin Console");

    const resourcePrefix = "lx-admin";

    const domainName = new cdk.CfnParameter(this, "AdminWebDomainName", {
      type: "String",
      description: "Custom domain for the admin SPA (CloudFront alias).",
      default: "admin.lx-software.com",
    });

    const certificateArn = new cdk.CfnParameter(this, "AdminWebCertificateArn", {
      type: "String",
      description: "ACM certificate ARN in us-east-1 for the admin domain (CloudFront).",
    });

    const wafWebAclArn = new cdk.CfnParameter(this, "WafWebAclArn", {
      type: "String",
      description: "Optional WAFv2 Web ACL ARN to attach to CloudFront (leave empty to disable).",
      default: "",
    });

    const hasWaf = new cdk.CfnCondition(this, "HasWaf", {
      expression: cdk.Fn.conditionNot(
        cdk.Fn.conditionEquals(wafWebAclArn.valueAsString, "")
      ),
    });

    const bucketName = [resourcePrefix, "web", cdk.Aws.ACCOUNT_ID, cdk.Aws.REGION].join(
      "-"
    );

    const logsBucketName = [
      resourcePrefix,
      "web-logs",
      cdk.Aws.ACCOUNT_ID,
      cdk.Aws.REGION,
    ].join("-");

    this.accessLogsBucket = new s3.Bucket(this, "CloudFrontAccessLogsBucket", {
      bucketName: logsBucketName,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_PREFERRED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          id: "ExpireOldLogs",
          enabled: true,
          expiration: cdk.Duration.days(90),
        },
      ],
    });

    this.bucket = new s3.Bucket(this, "AdminWebBucket", {
      bucketName,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const certificate = acm.Certificate.fromCertificateArn(
      this,
      "AdminWebCertificate",
      certificateArn.valueAsString
    );

    const spaRewrite = new cloudfront.Function(this, "SpaRewrite", {
      code: cloudfront.FunctionCode.fromInline(`function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (uri.startsWith('/assets/')) return request;
  if (uri.indexOf('.') === -1) {
    request.uri = '/index.html';
  }
  return request;
}`),
    });

    const cspValue = cdk.Fn.join("", [
      "default-src 'self'; script-src 'self'; connect-src 'self' ",
      props.cspCognitoConnectOrigin,
      " ",
      props.cspApiConnectOrigin,
      "; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
    ]);

    const securityHeadersPolicy = new cloudfront.ResponseHeadersPolicy(
      this,
      "AdminSecurityHeaders",
      {
        responseHeadersPolicyName: `${resourcePrefix}-security-headers`,
        securityHeadersBehavior: {
          strictTransportSecurity: {
            accessControlMaxAge: cdk.Duration.seconds(31_536_000),
            includeSubdomains: true,
            preload: true,
            override: true,
          },
          contentTypeOptions: { override: true },
          referrerPolicy: {
            referrerPolicy:
              cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
            override: true,
          },
          contentSecurityPolicy: {
            contentSecurityPolicy: cspValue,
            override: true,
          },
        },
        customHeadersBehavior: {
          customHeaders: [
            {
              header: "Permissions-Policy",
              value: "camera=(), microphone=(), geolocation=()",
              override: true,
            },
          ],
        },
      }
    );

    const origin = origins.S3BucketOrigin.withOriginAccessControl(this.bucket);

    this.distribution = new cloudfront.Distribution(
      this,
      "AdminWebDistribution",
      {
        defaultRootObject: "index.html",
        domainNames: [domainName.valueAsString],
        certificate,
        defaultBehavior: {
          origin,
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          responseHeadersPolicy: securityHeadersPolicy,
          functionAssociations: [
            {
              function: spaRewrite,
              eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
            },
          ],
        },
        errorResponses: [
          {
            httpStatus: 403,
            responseHttpStatus: 200,
            responsePagePath: "/index.html",
            ttl: cdk.Duration.minutes(5),
          },
          {
            httpStatus: 404,
            responseHttpStatus: 200,
            responsePagePath: "/index.html",
            ttl: cdk.Duration.minutes(5),
          },
        ],
        enableLogging: true,
        logBucket: this.accessLogsBucket,
        logFilePrefix: "cloudfront/",
      }
    );

    const cfnDist = this.distribution.node.defaultChild as cloudfront.CfnDistribution;
    cfnDist.addPropertyOverride(
      "DistributionConfig.WebACLId",
      cdk.Fn.conditionIf(
        hasWaf.logicalId,
        wafWebAclArn.valueAsString,
        cdk.Aws.NO_VALUE
      )
    );

    const bucketPolicy = new s3.BucketPolicy(this, "AdminWebBucketPolicy", {
      bucket: this.bucket,
    });

    bucketPolicy.document.addStatements(
      new iam.PolicyStatement({
        sid: "AllowCloudFrontServicePrincipalReadOnly",
        effect: iam.Effect.ALLOW,
        actions: ["s3:GetObject"],
        resources: [this.bucket.arnForObjects("*")],
        principals: [new iam.ServicePrincipal("cloudfront.amazonaws.com")],
        conditions: {
          StringEquals: {
            "AWS:SourceArn": cdk.Arn.format(
              {
                service: "cloudfront",
                resource: "distribution",
                resourceName: this.distribution.distributionId,
                region: "",
              },
              this
            ),
          },
        },
      })
    );

    new cdk.CfnOutput(this, "AdminWebBucketName", {
      value: this.bucket.bucketName,
      exportName: "lx-admin-AdminWebBucketName",
    });

    new cdk.CfnOutput(this, "AdminWebDistributionId", {
      value: this.distribution.distributionId,
      exportName: "lx-admin-AdminWebDistributionId",
    });

    new cdk.CfnOutput(this, "AdminWebDistributionDomain", {
      value: this.distribution.distributionDomainName,
      exportName: "lx-admin-AdminWebDistributionDomain",
    });

    new cdk.CfnOutput(this, "AdminWebLoggingBucketName", {
      value: this.accessLogsBucket.bucketName,
      exportName: "lx-admin-AdminWebLoggingBucketName",
    });
  }
}
