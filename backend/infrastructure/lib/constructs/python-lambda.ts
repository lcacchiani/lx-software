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

function copyDirRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, name.name);
    const destPath = path.join(dest, name.name);
    if (name.name === "__pycache__" || name.name === ".pytest_cache") {
      continue;
    }
    if (name.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function tryLocalPythonBundle(entry: string, outputDir: string): boolean {
  const req = path.join(entry, "requirements.txt");
  if (requirementsNeedPip(req)) {
    return false;
  }
  copyDirRecursive(entry, outputDir);
  return true;
}

/**
 * Creates a Python 3.12 Lambda with Docker-based bundling (recursive copy of
 * sources + pip when requirements.txt has packages). Local bundling only runs
 * when there are no pip dependencies so macOS wheels are never copied into a
 * Linux ARM runtime bundle. Uses an explicit CloudWatch LogGroup (30-day
 * retention) instead of the deprecated logRetention property.
 */
export function createPythonLambda(
  scope: Construct,
  id: string,
  props: PythonLambdaFactoryProps
): lambda.Function {
  const entry = path.resolve(props.entryDir);
  const handler = props.handler ?? "handler.lambda_handler";

  const logGroup = new logs.LogGroup(scope, `${id}LogGroup`, {
    retention: logs.RetentionDays.ONE_MONTH,
    removalPolicy: cdk.RemovalPolicy.DESTROY,
  });

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
            "for item in *; do",
            "  if [[ \"$item\" == requirements.txt ]]; then continue; fi",
            "  if [[ -d \"$item\" ]]; then cp -a \"$item\" /asset-output/; fi",
            "done",
            "for f in *.py; do",
            "  [[ -f \"$f\" ]] && cp -a \"$f\" /asset-output/",
            "done",
          ].join(" "),
        ],
      },
    }),
    memorySize: props.memorySize ?? 512,
    timeout: props.timeout ?? cdk.Duration.seconds(10),
    environment: props.environment,
    logGroup,
  });
}
