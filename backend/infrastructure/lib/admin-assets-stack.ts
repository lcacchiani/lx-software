import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";

export class AdminAssetsStack extends cdk.Stack {
  public readonly bucket: s3.Bucket;
  public readonly accessLogsBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    cdk.Tags.of(this).add("Organization", "LX Software");
    cdk.Tags.of(this).add("Project", "Admin Console");

    const bucketName = [
      "lx-admin-assets",
      cdk.Aws.ACCOUNT_ID,
      cdk.Aws.REGION,
    ].join("-");

    const s3AccessLogsName = [
      "lx-admin-assets-s3-access-logs",
      cdk.Aws.ACCOUNT_ID,
      cdk.Aws.REGION,
    ].join("-");

    this.accessLogsBucket = new s3.Bucket(this, "AssetsS3AccessLogsBucket", {
      bucketName: s3AccessLogsName,
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
    this.bucket = new s3.Bucket(this, "AssetsBucket", {
      bucketName,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      serverAccessLogsBucket: this.accessLogsBucket,
      serverAccessLogsPrefix: "assets-data-bucket/",
      cors: [
        {
          allowedMethods: [
            s3.HttpMethods.PUT,
            s3.HttpMethods.POST,
            s3.HttpMethods.GET,
          ],
          allowedOrigins: ["https://admin.lx-software.com"],
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

    new cdk.CfnOutput(this, "AssetsBucketName", {
      value: this.bucket.bucketName,
      exportName: "lx-admin-AssetsBucketName",
    });

    new cdk.CfnOutput(this, "AssetsBucketArn", {
      value: this.bucket.bucketArn,
      exportName: "lx-admin-AssetsBucketArn",
    });
  }
}
