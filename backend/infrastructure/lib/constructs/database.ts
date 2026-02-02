import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as kms from "aws-cdk-lib/aws-kms";
import * as rds from "aws-cdk-lib/aws-rds";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";

/**
 * Properties for the DatabaseConstruct.
 */
export interface DatabaseConstructProps {
  /** Resource name prefix for naming resources. */
  resourcePrefix: string;
  /** VPC to deploy the database into. */
  vpc: ec2.IVpc;
  /** Minimum serverless capacity in ACUs. */
  minCapacity?: number;
  /** Maximum serverless capacity in ACUs. */
  maxCapacity?: number;
  /** Default database name. */
  databaseName?: string;
  /** Existing database credentials secret name (optional). */
  dbCredentialsSecretName?: string;
  /** Existing database credentials secret ARN (optional). */
  dbCredentialsSecretArn?: string;
  /** Existing database secret KMS key ARN (optional). */
  dbCredentialsSecretKmsKeyArn?: string;
  /** Existing database security group id (optional). */
  dbSecurityGroupId?: string;
  /** Existing proxy security group id (optional). */
  proxySecurityGroupId?: string;
  /** Existing database cluster identifier (optional). */
  dbClusterIdentifier?: string;
  /** Existing database cluster endpoint hostname (optional). */
  dbClusterEndpoint?: string;
  /** Existing database cluster reader endpoint hostname (optional). */
  dbClusterReaderEndpoint?: string;
  /** Existing database cluster port (optional). */
  dbClusterPort?: number;
  /** Existing database proxy name (optional). */
  dbProxyName?: string;
  /** Existing database proxy ARN (optional). */
  dbProxyArn?: string;
  /** Existing database proxy endpoint (optional). */
  dbProxyEndpoint?: string;
  /** Manage ingress rules on security groups (optional). */
  manageSecurityGroupRules?: boolean;
  /** Apply immutable DB settings like encryption and IAM auth. */
  applyImmutableSettings?: boolean;
}

/**
 * Construct for Aurora PostgreSQL Serverless v2 database with RDS Proxy.
 *
 * Creates:
 * - Security groups for database and proxy
 * - Secrets Manager secret for database credentials
 * - Aurora PostgreSQL Serverless v2 cluster
 * - RDS Proxy with IAM authentication
 */
export class DatabaseConstruct extends Construct {
  /** The Aurora database cluster. */
  public readonly cluster: rds.IDatabaseCluster;
  /** The RDS Proxy for connection pooling. */
  public readonly proxy: rds.IDatabaseProxy;
  /** The database credentials secret. */
  public readonly secret: secretsmanager.ISecret;
  /** Security group for the database cluster. */
  public readonly dbSecurityGroup: ec2.ISecurityGroup;
  /** Security group for the RDS Proxy. */
  public readonly proxySecurityGroup: ec2.ISecurityGroup;
  /** Whether to manage security group ingress rules. */
  private readonly manageSecurityGroupRules: boolean;
  /** KMS key used to encrypt the database secret. */
  private readonly secretKmsKey?: kms.IKey;

  constructor(scope: Construct, id: string, props: DatabaseConstructProps) {
    super(scope, id);

    const name = (suffix: string) => `${props.resourcePrefix}-${suffix}`;

    const dbSecurityGroupId = props.dbSecurityGroupId?.trim();
    const proxySecurityGroupId = props.proxySecurityGroupId?.trim();
    const dbCredentialsSecretName = props.dbCredentialsSecretName?.trim();
    const dbCredentialsSecretArn = props.dbCredentialsSecretArn?.trim();
    const dbCredentialsSecretKmsKeyArn =
      props.dbCredentialsSecretKmsKeyArn?.trim();
    const dbClusterIdentifier = props.dbClusterIdentifier?.trim();
    const dbClusterEndpoint = props.dbClusterEndpoint?.trim();
    const dbClusterReaderEndpoint = props.dbClusterReaderEndpoint?.trim();
    const dbClusterPort = props.dbClusterPort ?? 5432;
    const dbProxyName = props.dbProxyName?.trim();
    const dbProxyArn = props.dbProxyArn?.trim();
    const dbProxyEndpoint = props.dbProxyEndpoint?.trim();
    this.manageSecurityGroupRules = props.manageSecurityGroupRules ?? true;
    const applyImmutableSettings = props.applyImmutableSettings ?? true;

    const useExistingCluster = Boolean(
      dbClusterIdentifier || dbClusterEndpoint || dbClusterReaderEndpoint
    );
    const useExistingProxy = Boolean(
      dbProxyName || dbProxyArn || dbProxyEndpoint
    );

    if (useExistingCluster) {
      if (!dbClusterIdentifier || !dbClusterEndpoint) {
        throw new Error(
          "Existing DB cluster requires identifier and endpoint values."
        );
      }
      if (!dbCredentialsSecretName && !dbCredentialsSecretArn) {
        throw new Error(
          "Existing DB cluster requires DB credentials secret reference."
        );
      }
      if (!dbSecurityGroupId) {
        throw new Error("Existing DB cluster requires DB security group ID.");
      }
    }

    if (useExistingProxy) {
      if (!useExistingCluster) {
        throw new Error("Existing DB proxy requires existing DB cluster.");
      }
      if (!dbProxyName || !dbProxyArn || !dbProxyEndpoint) {
        throw new Error(
          "Existing DB proxy requires name, ARN, and endpoint values."
        );
      }
      if (!dbCredentialsSecretName && !dbCredentialsSecretArn) {
        throw new Error(
          "Existing DB proxy requires DB credentials secret reference."
        );
      }
      if (!proxySecurityGroupId) {
        throw new Error("Existing DB proxy requires proxy security group ID.");
      }
    }

    // Database security group
    this.dbSecurityGroup = dbSecurityGroupId
      ? ec2.SecurityGroup.fromSecurityGroupId(
          this,
          "DatabaseSecurityGroup",
          dbSecurityGroupId,
          { mutable: true }
        )
      : new ec2.SecurityGroup(this, "DatabaseSecurityGroup", {
          vpc: props.vpc,
          allowAllOutbound: true,
          securityGroupName: name("db-sg"),
          description: "Security group for Aurora database cluster",
        });

    // Proxy security group
    this.proxySecurityGroup = proxySecurityGroupId
      ? ec2.SecurityGroup.fromSecurityGroupId(
          this,
          "ProxySecurityGroup",
          proxySecurityGroupId,
          { mutable: true }
        )
      : new ec2.SecurityGroup(this, "ProxySecurityGroup", {
          vpc: props.vpc,
          allowAllOutbound: true,
          securityGroupName: name("proxy-sg"),
          description: "Security group for RDS Proxy",
        });

    if (this.manageSecurityGroupRules) {
      // Allow proxy to access database
      this.dbSecurityGroup.addIngressRule(
        this.proxySecurityGroup,
        ec2.Port.tcp(5432),
        "RDS Proxy access to Aurora"
      );
    }

    const needsManagedSecret =
      !dbCredentialsSecretArn && !dbCredentialsSecretName;
    const secretEncryptionKeyResource = needsManagedSecret
      ? new kms.Key(this, "DatabaseSecretKey", {
          enableKeyRotation: true,
        })
      : undefined;
    const secretEncryptionKey = secretEncryptionKeyResource
      ? kms.Key.fromKeyArn(
          this,
          "DatabaseSecretKeyRef",
          secretEncryptionKeyResource.keyArn
        )
      : undefined;
    const existingSecretKmsKey = dbCredentialsSecretKmsKeyArn
      ? kms.Key.fromKeyArn(
          this,
          "DBCredentialsSecretKmsKey",
          dbCredentialsSecretKmsKeyArn
        )
      : undefined;

    // Database credentials secret
    const dbCredentialsSecret = dbCredentialsSecretArn
      ? secretsmanager.Secret.fromSecretCompleteArn(
          this,
          "DBCredentialsSecret",
          dbCredentialsSecretArn
        )
      : dbCredentialsSecretName
        ? secretsmanager.Secret.fromSecretNameV2(
            this,
            "DBCredentialsSecret",
            dbCredentialsSecretName
          )
        : new secretsmanager.Secret(this, "DBCredentialsSecret", {
            secretName: name("database-credentials"),
            generateSecretString: {
              secretStringTemplate: JSON.stringify({ username: "postgres" }),
              generateStringKey: "password",
              excludePunctuation: true,
              includeSpace: false,
            },
            ...(secretEncryptionKey
              ? { encryptionKey: secretEncryptionKey }
              : {}),
          });
    this.secret = dbCredentialsSecret;
    this.secretKmsKey = existingSecretKmsKey ?? secretEncryptionKey;

    // Aurora PostgreSQL Serverless v2 cluster
    if (useExistingCluster) {
      const readerEndpoint = dbClusterReaderEndpoint ?? dbClusterEndpoint;
      this.cluster = rds.DatabaseCluster.fromDatabaseClusterAttributes(
        this,
        "Cluster",
        {
          clusterIdentifier: dbClusterIdentifier!,
          clusterEndpointAddress: dbClusterEndpoint!,
          readerEndpointAddress: readerEndpoint!,
          port: dbClusterPort,
          securityGroups: [this.dbSecurityGroup],
        }
      );
    } else {
      const monitoringRole = new iam.Role(this, "DatabaseMonitoringRole", {
        assumedBy: new iam.ServicePrincipal("monitoring.rds.amazonaws.com"),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName(
            "service-role/AmazonRDSEnhancedMonitoringRole"
          ),
        ],
      });
      const writerInstance = rds.ClusterInstance.serverlessV2("writer", {
        instanceIdentifier: name("db-writer"),
      });
      const cluster = new rds.DatabaseCluster(this, "Cluster", {
        engine: rds.DatabaseClusterEngine.auroraPostgres({
          version: rds.AuroraPostgresEngineVersion.VER_16_4,
        }),
        cloudwatchLogsExports: ["postgresql"],
        credentials: rds.Credentials.fromSecret(dbCredentialsSecret),
        defaultDatabaseName: props.databaseName ?? "siutindei",
        iamAuthentication: applyImmutableSettings ? true : undefined,
        storageEncrypted: applyImmutableSettings ? true : undefined,
        serverlessV2MinCapacity: props.minCapacity ?? 0.5,
        serverlessV2MaxCapacity: props.maxCapacity ?? 2,
        writer: writerInstance,
        clusterIdentifier: name("db-cluster"),
        vpc: props.vpc,
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        securityGroups: [this.dbSecurityGroup],
      });
      this.cluster = cluster;
      for (const child of cluster.node.findAll()) {
        if (child instanceof rds.CfnDBInstance) {
          child.monitoringInterval = 60;
          child.monitoringRoleArn = monitoringRole.roleArn;
        }
      }
    }

    // RDS Proxy for connection pooling and IAM auth
    if (useExistingProxy) {
      this.proxy = rds.DatabaseProxy.fromDatabaseProxyAttributes(this, "Proxy", {
        dbProxyName: dbProxyName!,
        dbProxyArn: dbProxyArn!,
        endpoint: dbProxyEndpoint!,
        securityGroups: [this.proxySecurityGroup],
      });
    } else {
      this.proxy = new rds.DatabaseProxy(this, "Proxy", {
        proxyTarget: rds.ProxyTarget.fromCluster(this.cluster),
        secrets: [dbCredentialsSecret],
        vpc: props.vpc,
        securityGroups: [this.proxySecurityGroup],
        requireTLS: true,
        iamAuth: true,
        dbProxyName: name("db-proxy"),
      });
    }
  }

  /**
   * Allow a security group to access the RDS Proxy.
   */
  public allowFrom(securityGroup: ec2.ISecurityGroup, description: string): void {
    if (!this.manageSecurityGroupRules) {
      return;
    }
    this.proxySecurityGroup.addIngressRule(
      securityGroup,
      ec2.Port.tcp(5432),
      description
    );
  }

  /**
   * Allow direct database access (for migrations).
   */
  public allowDirectAccessFrom(
    securityGroup: ec2.ISecurityGroup,
    description: string
  ): void {
    if (!this.manageSecurityGroupRules) {
      return;
    }
    this.dbSecurityGroup.addIngressRule(
      securityGroup,
      ec2.Port.tcp(5432),
      description
    );
  }

  /**
   * Grant a Lambda function permission to connect via RDS Proxy.
   */
  public grantConnect(fn: cdk.aws_lambda.IFunction, dbUser: string): void {
    this.proxy.grantConnect(fn, dbUser);
  }

  /**
   * Grant a Lambda function permission to read the database secret.
   */
  public grantSecretRead(fn: cdk.aws_lambda.IFunction): void {
    this.secret.grantRead(fn);
    if (this.secretKmsKey) {
      this.secretKmsKey.grantDecrypt(fn);
    }
  }
}
