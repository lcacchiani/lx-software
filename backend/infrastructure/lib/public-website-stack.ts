import * as cdk from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export class PublicWebsiteStack extends cdk.Stack {
  public readonly bucket: s3.IBucket;
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    cdk.Tags.of(this).add("Organization", "LX Software");
    cdk.Tags.of(this).add("Project", "Public Website");

    const domainName = new cdk.CfnParameter(this, "PublicWebsiteDomainName", {
      type: "String",
      description: "Custom domain for the public website (CloudFront alias).",
    });

    const certificateArn = new cdk.CfnParameter(
      this,
      "PublicWebsiteCertificateArn",
      {
        type: "String",
        description: "ACM certificate ARN for the public website domain.",
      }
    );

    // Bucket name: lxsoftware-public-www-{account}-{region} (49 chars)
    const bucketName = [
      "lxsoftware-public-www",
      cdk.Aws.ACCOUNT_ID,
      cdk.Aws.REGION,
    ].join("-");

    // Import existing bucket using attributes so we have the ARN for policy creation
    this.bucket = s3.Bucket.fromBucketAttributes(this, "PublicWebsiteBucket", {
      bucketName: bucketName,
      bucketArn: cdk.Arn.format({
        service: "s3",
        resource: bucketName,
        region: "",
        account: "",
      }, this),
    });

    const certificate = acm.Certificate.fromCertificateArn(
      this,
      "PublicWebsiteCertificate",
      certificateArn.valueAsString
    );

    // Use Origin Access Control (OAC) - the recommended approach for S3 origins
    // OAC is more secure than the legacy OAI and supports additional features
    const origin = origins.S3BucketOrigin.withOriginAccessControl(this.bucket);

    this.distribution = new cloudfront.Distribution(
      this,
      "PublicWebsiteDistribution",
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
      }
    );

    // Add explicit bucket policy to grant CloudFront OAC access to the imported bucket.
    // This is required because CDK cannot auto-add policies to imported buckets.
    const bucketPolicy = new s3.BucketPolicy(this, "PublicWebsiteBucketPolicy", {
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
            "AWS:SourceArn": cdk.Arn.format({
              service: "cloudfront",
              resource: "distribution",
              resourceName: this.distribution.distributionId,
              region: "",
            }, this),
          },
        },
      })
    );

    new cdk.CfnOutput(this, "PublicWebsiteBucketName", {
      value: this.bucket.bucketName,
    });

    new cdk.CfnOutput(this, "PublicWebsiteDistributionId", {
      value: this.distribution.distributionId,
    });

    new cdk.CfnOutput(this, "PublicWebsiteDistributionDomain", {
      value: this.distribution.distributionDomainName,
    });
  }
}
