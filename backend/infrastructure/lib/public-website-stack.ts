import * as cdk from "aws-cdk-lib";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as s3 from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";
import { StaticSiteDistribution } from "./constructs/static-site-distribution";

export class PublicWebsiteStack extends cdk.Stack {
  public readonly bucket: s3.IBucket;
  public readonly distribution: cloudfront.Distribution;
  public readonly accessLogsBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

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

    const bucketName = [
      "lxsoftware-public-www",
      cdk.Aws.ACCOUNT_ID,
      cdk.Aws.REGION,
    ].join("-");

    const site = new StaticSiteDistribution(this, "PublicSite", {
      resourcePrefix: "lxsoftware-public-www",
      domainName: domainName.valueAsString,
      certificateArn: certificateArn.valueAsString,
      importBucketName: bucketName,
      spaMode: "public",
    });

    this.bucket = site.bucket;
    this.distribution = site.distribution;
    this.accessLogsBucket = site.accessLogsBucket;

    new cdk.CfnOutput(this, "PublicWebsiteBucketName", {
      value: this.bucket.bucketName,
    });

    new cdk.CfnOutput(this, "PublicWebsiteDistributionId", {
      value: this.distribution.distributionId,
    });

    new cdk.CfnOutput(this, "PublicWebsiteDistributionDomain", {
      value: this.distribution.distributionDomainName,
    });

    new cdk.CfnOutput(this, "CloudFrontAccessLogsBucketName", {
      value: this.accessLogsBucket.bucketName,
    });
  }
}
