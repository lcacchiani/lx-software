import * as cdk from "aws-cdk-lib";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as s3 from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";
import { StaticSiteDistribution } from "./constructs/static-site-distribution";

export interface LxsoftwareAdminWebStackProps extends cdk.StackProps {
  /** Admin SPA hostname (from lxsoftware stack AdminWebDomainName parameter). */
  readonly adminWebDomainName: string;
  /** Admin HTTP API origin for CSP connect-src */
  readonly cspApiConnectOrigin: string;
  /**
   * Space-delimited S3 origins for presigned asset uploads (legacy + regional
   * virtual-hosted bucket URLs).
   */
  readonly cspAssetsConnectOrigins: string;
}

/**
 * Admin SPA delivery: private S3 origin + CloudFront distribution + WAF/CSP.
 */
export class LxsoftwareAdminWebStack extends cdk.Stack {
  public readonly bucket: s3.IBucket;
  public readonly distribution: cloudfront.Distribution;
  public readonly accessLogsBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: LxsoftwareAdminWebStackProps) {
    super(scope, id, props);

    const resourcePrefix = "lxsoftware-admin";

    const certificateArn = new cdk.CfnParameter(this, "AdminWebCertificateArn", {
      type: "String",
      description: "ACM certificate ARN in us-east-1 for the admin domain (CloudFront).",
    });

    const cspCognitoConnectOrigin = new cdk.CfnParameter(
      this,
      "CspCognitoConnectOrigin",
      {
        type: "String",
        description:
          "Cognito OAuth origin for CSP connect-src (no path), e.g. https://auth.example.com",
      }
    );

    const wafWebAclArn = new cdk.CfnParameter(this, "WafWebAclArn", {
      type: "String",
      description: "Optional WAFv2 Web ACL ARN to attach to CloudFront (leave empty to disable).",
      default: "",
      allowedPattern: "^$|^arn:aws:wafv2:us-east-1:[0-9]{12}:global/webacl/.+$",
      constraintDescription:
        "Must be empty or a WAFv2 global Web ACL ARN in us-east-1 for CloudFront.",
    });

    const hasWaf = new cdk.CfnCondition(this, "HasWaf", {
      expression: cdk.Fn.conditionNot(
        cdk.Fn.conditionEquals(wafWebAclArn.valueAsString, "")
      ),
    });

    const bucketName = [resourcePrefix, "web", cdk.Aws.ACCOUNT_ID, cdk.Aws.REGION].join(
      "-"
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
      cspCognitoConnectOrigin.valueAsString,
      " ",
      props.cspApiConnectOrigin,
      " ",
      props.cspAssetsConnectOrigins,
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

    const site = new StaticSiteDistribution(this, "AdminSite", {
      resourcePrefix,
      domainName: props.adminWebDomainName,
      certificateArn: certificateArn.valueAsString,
      createBucketName: bucketName,
      spaMode: "admin",
      responseHeadersPolicy: securityHeadersPolicy,
      functionAssociations: [
        {
          function: spaRewrite,
          eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
        },
      ],
    });

    this.bucket = site.bucket;
    this.distribution = site.distribution;
    this.accessLogsBucket = site.accessLogsBucket;

    const cfnDist = this.distribution.node.defaultChild as cloudfront.CfnDistribution;
    cfnDist.addPropertyOverride(
      "DistributionConfig.WebACLId",
      cdk.Fn.conditionIf(
        hasWaf.logicalId,
        wafWebAclArn.valueAsString,
        cdk.Aws.NO_VALUE
      )
    );

    new cdk.CfnOutput(this, "AdminWebBucketName", {
      value: this.bucket.bucketName,
      exportName: "lxsoftware-admin-web-AdminWebBucketName",
    });

    new cdk.CfnOutput(this, "AdminWebDistributionId", {
      value: this.distribution.distributionId,
      exportName: "lxsoftware-admin-web-AdminWebDistributionId",
    });

    new cdk.CfnOutput(this, "AdminWebDistributionDomain", {
      value: this.distribution.distributionDomainName,
      exportName: "lxsoftware-admin-web-AdminWebDistributionDomain",
    });

    new cdk.CfnOutput(this, "AdminWebLoggingBucketName", {
      value: this.accessLogsBucket.bucketName,
      exportName: "lxsoftware-admin-web-AdminWebLoggingBucketName",
    });
  }
}
