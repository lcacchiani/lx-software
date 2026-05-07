import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import type { Construct } from "constructs";

export interface PythonLambdaFactoryProps {
  /** Directory containing handler.py and optional requirements.txt */
  readonly entryDir: string;
  /** Lambda handler string, e.g. handler.lambda_handler */
  readonly handler?: string;
  readonly runtime?: lambda.Runtime;
  readonly architecture?: lambda.Architecture;
  readonly memorySize?: number;
  readonly timeout?: cdk.Duration;
  readonly environment?: Record<string, string>;
}

function requirementsNeedPip(reqPath: string): boolean {
  if (!fs.existsSync(reqPath)) {
    return false;
  }
  const text = fs.readFileSync(reqPath, "utf8");
  const nonComment = text
    .split("\n")
    .map((line) => line.replace(/#.*/, "").trim())
    .filter(Boolean);
  return nonComment.length > 0;
}

function tryLocalPythonBundle(entry: string, outputDir: string): boolean {
  const pyFiles = fs
    .readdirSync(entry)
    .filter((f) => f.endsWith(".py"));
  if (pyFiles.length === 0) {
    return false;
  }
  fs.mkdirSync(outputDir, { recursive: true });
  for (const f of pyFiles) {
    fs.copyFileSync(path.join(entry, f), path.join(outputDir, f));
  }
  const req = path.join(entry, "requirements.txt");
  if (requirementsNeedPip(req)) {
    const pip = spawnSync(
      "pip3",
      ["install", "-r", "requirements.txt", "-t", outputDir],
      { cwd: entry, stdio: "inherit" }
    );
    if (pip.status !== 0) {
      return false;
    }
  }
  return true;
}

/**
 * Creates a Python 3.12 Lambda with optional Docker-based bundling, a local
 * bundling fallback when Docker is unavailable, and 30-day log retention.
 */
export function createPythonLambda(
  scope: Construct,
  id: string,
  props: PythonLambdaFactoryProps
): lambda.Function {
  const entry = path.resolve(props.entryDir);
  const handler = props.handler ?? "handler.lambda_handler";

  return new lambda.Function(scope, id, {
    runtime: props.runtime ?? lambda.Runtime.PYTHON_3_12,
    architecture: props.architecture ?? lambda.Architecture.ARM_64,
    handler,
    code: lambda.Code.fromAsset(entry, {
      bundling: {
        image: lambda.Runtime.PYTHON_3_12.bundlingImage,
        platform: "linux/arm64",
        local: {
          tryBundle(outputDir: string) {
            return tryLocalPythonBundle(entry, outputDir);
          },
        },
        command: [
          "bash",
          "-c",
          [
            "set -euo pipefail",
            "export PIP_ROOT_USER_ACTION=ignore",
            "if [[ -f requirements.txt ]]; then pip install -r requirements.txt -t /asset-output; fi",
            "shopt -s dotglob nullglob",
            "for f in *.py; do cp -a \"$f\" /asset-output/; done",
          ].join(" && "),
        ],
      },
    }),
    memorySize: props.memorySize ?? 512,
    timeout: props.timeout ?? cdk.Duration.seconds(10),
    environment: props.environment,
    logRetention: logs.RetentionDays.ONE_MONTH,
  });
}
