import * as cdk from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export interface StaticSiteDistributionProps {
  readonly resourcePrefix: string;
  readonly domainName: string;
  readonly certificateArn: string;
  readonly importBucketName?: string;
  readonly createBucketName?: string;
  readonly logFilePrefix?: string;
  readonly spaMode: "public" | "admin";
  readonly responseHeadersPolicy?: cloudfront.IResponseHeadersPolicy;
  readonly functionAssociations?: cloudfront.FunctionAssociation[];
}

/**
 * Shared CloudFront + S3 static site pattern (access logs bucket, OAC, SPA fallbacks).
 */
export class StaticSiteDistribution extends Construct {
  public readonly accessLogsBucket: s3.Bucket;
  public readonly bucket: s3.IBucket;
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: StaticSiteDistributionProps) {
    super(scope, id);

    const logsBucketName = [
      props.resourcePrefix,
      "logs",
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

    if (props.importBucketName) {
      const bucketName = props.importBucketName;
      this.bucket = s3.Bucket.fromBucketAttributes(this, "SiteBucket", {
        bucketName,
        bucketArn: cdk.Arn.format(
          {
            service: "s3",
            resource: bucketName,
            region: "",
            account: "",
          },
          cdk.Stack.of(this)
        ),
      });
      cdk.Annotations.of(this).acknowledgeWarning(
        "@aws-cdk/aws-cloudfront-origins:updateImportedBucketPolicyOac",
        "OAC access for the imported bucket is granted via SiteBucketPolicy."
      );
    } else if (props.createBucketName) {
      this.bucket = new s3.Bucket(this, "SiteBucket", {
        bucketName: props.createBucketName,
        encryption: s3.BucketEncryption.S3_MANAGED,
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        enforceSSL: true,
        versioned: true,
        removalPolicy: cdk.RemovalPolicy.RETAIN,
        serverAccessLogsBucket: this.accessLogsBucket,
        serverAccessLogsPrefix: "s3-web-origin/",
      });
    } else {
      throw new Error(
        "StaticSiteDistribution requires importBucketName or createBucketName"
      );
    }

    const certificate = acm.Certificate.fromCertificateArn(
      this,
      "SiteCertificate",
      props.certificateArn
    );

    const origin = origins.S3BucketOrigin.withOriginAccessControl(this.bucket);

    const spaErrors: cloudfront.ErrorResponse[] =
      props.spaMode === "public"
        ? [
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
          ]
        : [
            {
              httpStatus: 404,
              responseHttpStatus: 200,
              responsePagePath: "/index.html",
              ttl: cdk.Duration.minutes(5),
            },
          ];

    this.distribution = new cloudfront.Distribution(this, "SiteDistribution", {
      defaultRootObject: "index.html",
      domainNames: [props.domainName],
      certificate,
      defaultBehavior: {
        origin,
        viewerProtocolPolicy:
          cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        ...(props.responseHeadersPolicy
          ? { responseHeadersPolicy: props.responseHeadersPolicy }
          : {}),
        ...(props.functionAssociations?.length
          ? { functionAssociations: props.functionAssociations }
          : {}),
      },
      errorResponses: spaErrors,
      enableLogging: true,
      logBucket: this.accessLogsBucket,
      logFilePrefix: props.logFilePrefix ?? "cloudfront/",
    });

    const bucketPolicy = new s3.BucketPolicy(this, "SiteBucketPolicy", {
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
              cdk.Stack.of(this)
            ),
          },
        },
      })
    );
  }
}
