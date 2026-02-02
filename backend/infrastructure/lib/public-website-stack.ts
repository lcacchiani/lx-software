import * as cdk from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export class PublicWebsiteStack extends cdk.Stack {
  public readonly bucket: s3.Bucket;
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

    this.bucket = new s3.Bucket(this, "PublicWebsiteBucket", {
      bucketName,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const originAccessIdentity = new cloudfront.OriginAccessIdentity(
      this,
      "PublicWebsiteOai",
      {
        comment: "OAI for public website CloudFront distribution.",
      }
    );
    this.bucket.grantRead(originAccessIdentity);

    const certificate = acm.Certificate.fromCertificateArn(
      this,
      "PublicWebsiteCertificate",
      certificateArn.valueAsString
    );

    const origin = origins.S3BucketOrigin.withOriginAccessIdentity(
      this.bucket,
      {
        originAccessIdentity,
      }
    );

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
