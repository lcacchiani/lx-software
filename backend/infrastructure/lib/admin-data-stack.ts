import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import type { Construct } from "constructs";

export class AdminDataStack extends cdk.Stack {
  public readonly recordsTable: dynamodb.Table;
  public readonly auditLogTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    cdk.Tags.of(this).add("Organization", "LX Software");
    cdk.Tags.of(this).add("Project", "Admin Console");

    this.recordsTable = new dynamodb.Table(this, "RecordsTable", {
      tableName: "lx-admin-records",
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
      tableName: "lx-admin-audit-log",
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    new cdk.CfnOutput(this, "RecordsTableName", {
      value: this.recordsTable.tableName,
      exportName: "lx-admin-RecordsTableName",
    });

    new cdk.CfnOutput(this, "RecordsTableArn", {
      value: this.recordsTable.tableArn,
      exportName: "lx-admin-RecordsTableArn",
    });

    new cdk.CfnOutput(this, "AuditLogTableName", {
      value: this.auditLogTable.tableName,
      exportName: "lx-admin-AuditLogTableName",
    });

    new cdk.CfnOutput(this, "AuditLogTableArn", {
      value: this.auditLogTable.tableArn,
      exportName: "lx-admin-AuditLogTableArn",
    });
  }
}
