import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as kms from "aws-cdk-lib/aws-kms";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";
import * as fs from "fs";
import * as path from "path";

/**
 * Properties for the PythonLambda construct.
 */
export interface PythonLambdaProps {
  /** Function name (optional - CloudFormation will generate if not provided). */
  functionName?: string;
  /** Handler path (e.g., "lambda/handler.lambda_handler"). */
  handler: string;
  /** Optional function description. */
  description?: string;
  /** Environment variables. */
  environment?: Record<string, string>;
  /** Function timeout. */
  timeout?: cdk.Duration;
  /** Memory size in MB. */
  memorySize?: number;
  /** VPC to deploy into (optional). */
  vpc?: ec2.IVpc;
  /** Security groups (required if vpc is provided). */
  securityGroups?: ec2.ISecurityGroup[];
  /** Extra paths (relative to backend root) to copy. */
  extraCopyPaths?: string[];
  /** Custom code asset (overrides default bundling). */
  code?: lambda.Code;
  /** Reserved concurrency limit. */
  reservedConcurrentExecutions?: number;
  /** KMS key to encrypt environment variables. */
  environmentEncryptionKey?: kms.IKey;
  /** Dead letter queue for failed invocations. */
  deadLetterQueue?: sqs.IQueue;
}

/**
 * Construct for Python Lambda functions with standard configuration.
 *
 * Features:
 * - Automatic bundling with pip install
 * - VPC support
 * - Standard PYTHONPATH configuration
 */
export class PythonLambda extends Construct {
  /** The Lambda function. */
  public readonly function: lambda.Function;

  constructor(scope: Construct, id: string, props: PythonLambdaProps) {
    super(scope, id);

    const sourceRoot = path.join(__dirname, "../../../");
    const extraCopyPaths = normalizeExtraCopyPaths(props.extraCopyPaths);
    const localBundleBase = path.join(sourceRoot, ".lambda-build", "base");
    const cleanupCommands = [
      "find /asset-output -type d -name __pycache__ -prune -exec rm -rf {} +",
      'find /asset-output -type f -name "*.pyc" -delete',
      'find /asset-output -type f -name "*.pyo" -delete',
    ];
    const copyCommands = [
      "PYTHONDONTWRITEBYTECODE=1 python -m pip install --upgrade " +
        "pip==25.3 --no-warn-script-location",
      "PYTHONDONTWRITEBYTECODE=1 python -m pip install -r requirements.txt " +
        "-t /asset-output --no-compile",
      "cp -au lambda /asset-output/lambda",
      "cp -au src /asset-output/src",
      ...extraCopyPaths.map(
        (extraPath) => `cp -au "${extraPath}" "/asset-output/${extraPath}"`
      ),
      ...cleanupCommands,
    ];

    function normalizeExtraCopyPaths(
      paths: string[] | undefined
    ): string[] {
      const normalized: string[] = [];
      for (const extraPath of paths ?? []) {
        const trimmed = extraPath.trim();
        if (!trimmed) {
          continue;
        }
        if (path.isAbsolute(trimmed)) {
          throw new Error("Extra copy paths must be relative.");
        }
        const sanitized = trimmed.replace(/^(\.\/)+/, "");
        if (sanitized.startsWith("..")) {
          throw new Error("Extra copy paths must stay under backend root.");
        }
        if (!/^[a-zA-Z0-9._/-]+$/.test(sanitized)) {
          throw new Error("Extra copy paths contain invalid characters.");
        }
        normalized.push(sanitized);
      }
      return normalized;
    }

    function tryLocalBundle(outputDir: string): boolean {
      if (!fs.existsSync(localBundleBase)) {
        throw new Error(
          "Local Lambda bundle missing. Run `python3 " +
            "backend/scripts/build_lambda_bundle.py` first."
        );
      }
      fs.cpSync(localBundleBase, outputDir, { recursive: true });
      for (const extraPath of extraCopyPaths) {
        const sourcePath = path.join(sourceRoot, extraPath);
        if (!fs.existsSync(sourcePath)) {
          throw new Error(`Missing extra bundle path: ${extraPath}`);
        }
        const targetPath = path.join(outputDir, extraPath);
        fs.cpSync(sourcePath, targetPath, { recursive: true });
      }
      return true;
    }

    const environmentEncryptionKey =
      props.environmentEncryptionKey ??
      new kms.Key(this, "EnvironmentEncryptionKey", {
        enableKeyRotation: true,
      });

    const deadLetterQueue =
      props.deadLetterQueue ??
      new sqs.Queue(this, "DeadLetterQueue", {
        encryption: sqs.QueueEncryption.KMS_MANAGED,
        retentionPeriod: cdk.Duration.days(14),
      });

    this.function = new lambda.Function(this, "Function", {
      functionName: props.functionName,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: props.handler,
      description: props.description,
      code:
        props.code ??
        lambda.Code.fromAsset(path.join(__dirname, "../../../"), {
          assetHashType: cdk.AssetHashType.SOURCE,
          exclude: [
            ".git/**",
            ".venv/**",
            ".pytest_cache/**",
            ".ruff_cache/**",
            ".mypy_cache/**",
            "node_modules/**",
            "dist/**",
            "build/**",
            "cdk.out/**",
            "**/__pycache__/**",
            "**/*.pyc",
            "**/*.pyo",
          ],
          bundling: {
            image: lambda.Runtime.PYTHON_3_12.bundlingImage,
            command: ["bash", "-c", copyCommands.join(" && ")],
            environment: {
              HOME: "/tmp",
              PIP_CACHE_DIR: "/tmp/pip-cache",
              PYTHONUSERBASE: "/tmp/.local",
              PYTHONDONTWRITEBYTECODE: "1",
              PYTHONHASHSEED: "0",
            },
            local: {
              tryBundle(outputDir: string) {
                return tryLocalBundle(outputDir);
              },
            },
          },
        }),
      memorySize: props.memorySize ?? 512,
      timeout: props.timeout ?? cdk.Duration.seconds(30),
      vpc: props.vpc,
      securityGroups: props.securityGroups,
      vpcSubnets: props.vpc
        ? { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }
        : undefined,
      environmentEncryption: environmentEncryptionKey,
      deadLetterQueue,
      deadLetterQueueEnabled: true,
      reservedConcurrentExecutions:
        props.reservedConcurrentExecutions ?? 25,
      environment: {
        PYTHONPATH: "/var/task/src",
        LOG_LEVEL: "INFO",
        ...props.environment,
      },
    });

  }

  /**
   * Grant permissions to connect to RDS Proxy.
   */
  public grantProxyConnect(
    proxy: { grantConnect: (grantee: lambda.IFunction, dbUser: string) => void },
    dbUser: string
  ): void {
    proxy.grantConnect(this.function, dbUser);
  }

  /**
   * Grant read access to a secret.
   */
  public grantSecretRead(
    secret: { grantRead: (grantee: lambda.IFunction) => void }
  ): void {
    secret.grantRead(this.function);
  }
}

/**
 * Factory for creating multiple Lambda functions with shared configuration.
 */
export class PythonLambdaFactory {
  private readonly scope: Construct;
  private readonly defaults: Partial<PythonLambdaProps>;

  constructor(scope: Construct, defaults: Partial<PythonLambdaProps> = {}) {
    this.scope = scope;
    this.defaults = defaults;
  }

  /**
   * Create a new Lambda function with factory defaults.
   */
  public create(id: string, props: PythonLambdaProps): PythonLambda {
    return new PythonLambda(this.scope, id, {
      ...this.defaults,
      ...props,
      environment: {
        ...this.defaults.environment,
        ...props.environment,
      },
    });
  }
}
