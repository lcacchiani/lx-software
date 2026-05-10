import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AdminApiError, adminFetchJson } from "../lib/apiAdminClient";
import {
  statementLineAssetKeys,
  type FinancePersistedState,
  type HouseFinanceData,
  type HouseKey,
} from "../lib/financeModel";
import { uploadFinanceAsset } from "../lib/uploadFinanceAsset";

const DUPLICATE_STATEMENT_BASE_MSG =
  "Remove its imported lines or rename the file, then try again.";

const PARSE_POLL_INITIAL_WAIT_MS = 1000;
const PARSE_POLL_BACKOFF_CAP_MS = 5000;
/** Lambda timeout (120s) + margin for worker completion before client gives up. */
const PARSE_POLL_DEADLINE_MS = 210_000;

/**
 * Collects exact filenames (S3 key basenames) already used by lines with
 * statement attachments. When `excludeLineId` is set, that line is ignored (e.g.
 * while editing the same record).
 */
export function existingImportedStatementBasenames(
  data: HouseFinanceData,
  excludeLineId?: string,
): ReadonlySet<string> {
  const out = new Set<string>();
  for (const line of data.lines) {
    if (excludeLineId && line.id === excludeLineId) continue;
    for (const key of statementLineAssetKeys(line)) {
      const parts = key.split("/");
      const base = parts[parts.length - 1];
      if (base) out.add(base);
    }
  }
  return out;
}

function adminErrorJsonMessage(err: unknown): string | null {
  if (!(err instanceof AdminApiError)) return null;
  try {
    const parsed = JSON.parse(err.responseBody) as { message?: unknown };
    if (typeof parsed.message === "string" && parsed.message.trim()) {
      return parsed.message.trim();
    }
  } catch {
    /* ignore malformed JSON */
  }
  return null;
}

type ParseJobStartResponse = {
  readonly jobId: string;
  readonly status?: string;
};

type ParseJobPollResponse =
  | { readonly status: "pending" | "processing" }
  | {
      readonly status: "succeeded";
      readonly addedLines: number;
      readonly sourceAssetKeys?: readonly string[];
      readonly sourceAssetKey?: string;
    }
  | { readonly status: "failed"; readonly message?: string };

export type ParseStatementResult = {
  readonly addedLines: number;
  readonly sourceAssetKeys: readonly string[];
};

/**
 * Re-exported from `uploadFinanceAsset` for backward compatibility with tests
 * and call sites that imported it from this module.
 */
export { extractS3ErrorCode } from "../lib/uploadFinanceAsset";

async function pollParseJob(
  house: HouseKey,
  jobId: string,
): Promise<ParseStatementResult> {
  const deadline = Date.now() + PARSE_POLL_DEADLINE_MS;
  let nextWaitMs = PARSE_POLL_INITIAL_WAIT_MS;
  while (Date.now() < deadline) {
    const j = await adminFetchJson<ParseJobPollResponse>(
      `/finance/${house}/parse-statement/jobs/${encodeURIComponent(jobId)}`,
    );
    if (j.status === "succeeded") {
      const keys =
        Array.isArray(j.sourceAssetKeys) && j.sourceAssetKeys.length > 0
          ? [...j.sourceAssetKeys]
          : j.sourceAssetKey
            ? [j.sourceAssetKey]
            : [];
      return {
        addedLines: j.addedLines,
        sourceAssetKeys: keys,
      };
    }
    if (j.status === "failed") {
      throw new Error(j.message?.trim() || "Statement import failed.");
    }
    await new Promise((r) => setTimeout(r, nextWaitMs));
    nextWaitMs = Math.min(PARSE_POLL_BACKOFF_CAP_MS, nextWaitMs * 2);
  }
  throw new Error(
    "Statement parse is taking longer than expected. Reload the finance page and check whether new lines appeared.",
  );
}

/**
 * Upload a PDF (or supported image) statement to S3 then call the admin API
 * to extract statement lines via OpenRouter and append them to the house's
 * finance record. Parsing runs asynchronously on the server (avoids API
 * Gateway timeouts); this hook polls until the job completes then refreshes
 * finance data.
 */
export function useParseStatement(house: HouseKey) {
  const qc = useQueryClient();
  return useMutation<ParseStatementResult, Error, File>({
    mutationFn: async (file: File) => {
      if (!file) {
        throw new Error("No file selected");
      }
      const lowered = file.name.toLowerCase();
      const contentType =
        file.type ||
        (lowered.endsWith(".pdf")
          ? "application/pdf"
          : lowered.endsWith(".png")
            ? "image/png"
            : lowered.endsWith(".jpg") || lowered.endsWith(".jpeg")
              ? "image/jpeg"
              : "");
      if (!contentType.startsWith("image/") && contentType !== "application/pdf") {
        throw new Error("Only PDF or image statements are supported.");
      }

      const financeState = qc.getQueryData<FinancePersistedState>(["finance"]);
      if (financeState) {
        const basenames = existingImportedStatementBasenames(financeState[house]);
        if (basenames.has(file.name)) {
          throw new Error(
            `A statement file named "${file.name}" was already imported for this house. ${DUPLICATE_STATEMENT_BASE_MSG}`,
          );
        }
      }

      console.info("[useParseStatement] start", {
        house,
        fileName: file.name,
        fileType: file.type,
        contentTypeRequested: contentType,
        fileSize: file.size,
      });

      const uploadKey = await uploadFinanceAsset(file, house, qc);
      console.info("[useParseStatement] upload + confirm ok", {
        key: uploadKey,
        size: file.size,
      });

      let jobStart: ParseJobStartResponse;
      try {
        jobStart = await adminFetchJson<ParseJobStartResponse>(
          `/finance/${house}/parse-statement`,
          {
            method: "POST",
            body: JSON.stringify({ key: uploadKey }),
          },
        );
      } catch (err) {
        const apiMsg = adminErrorJsonMessage(err);
        if (apiMsg) throw new Error(apiMsg);
        throw err;
      }
      if (!jobStart.jobId?.trim()) {
        throw new Error("Statement parse did not return a job id.");
      }

      const result = await pollParseJob(house, jobStart.jobId.trim());
      await qc.invalidateQueries({ queryKey: ["finance"] });

      console.info("[useParseStatement] parse job ok", {
        key: uploadKey,
        addedLines: result.addedLines,
      });

      return result;
    },
  });
}
