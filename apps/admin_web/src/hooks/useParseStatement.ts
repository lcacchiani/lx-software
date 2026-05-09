import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AdminApiError, adminFetchJson } from "../lib/apiAdminClient";
import {
  DEFAULT_FINANCE_STATE,
  normalizeHouseFinanceData,
  type FinancePersistedState,
  type HouseFinanceData,
  type HouseKey,
} from "../lib/financeModel";
import { uploadFinanceAsset } from "../lib/uploadFinanceAsset";

const DUPLICATE_STATEMENT_BASE_MSG =
  "Remove its imported lines or rename the file, then try again.";

/**
 * Collects exact filenames (S3 key basenames) already used by lines with a
 * `sourceAssetKey`. When `excludeLineId` is set, that line is ignored (e.g. while
 * editing the same record).
 */
export function existingImportedStatementBasenames(
  data: HouseFinanceData,
  excludeLineId?: string,
): ReadonlySet<string> {
  const out = new Set<string>();
  for (const line of data.lines) {
    if (excludeLineId && line.id === excludeLineId) continue;
    const key = line.sourceAssetKey?.trim();
    if (!key) continue;
    const parts = key.split("/");
    const base = parts[parts.length - 1];
    if (base) out.add(base);
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

type ParseStatementResponse = {
  readonly data: HouseFinanceData;
  readonly addedLines: number;
  readonly sourceAssetKey: string;
};

export type ParseStatementResult = {
  readonly addedLines: number;
  readonly sourceAssetKey: string;
};

/**
 * Re-exported from `uploadFinanceAsset` for backward compatibility with tests
 * and call sites that imported it from this module.
 */
export { extractS3ErrorCode } from "../lib/uploadFinanceAsset";

/**
 * Upload a PDF (or supported image) statement to S3 then call the admin API
 * to extract statement lines via OpenRouter and append them to the house's
 * finance record. Invalidates the `["finance"]` query on success so the
 * statement table refreshes.
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

      let parsed: ParseStatementResponse;
      try {
        parsed = await adminFetchJson<ParseStatementResponse>(
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
      console.info("[useParseStatement] /parse-statement ok", {
        key: uploadKey,
        addedLines: parsed.addedLines,
      });

      const normalized = normalizeHouseFinanceData(parsed.data);
      qc.setQueryData<FinancePersistedState>(["finance"], (old) => ({
        ...(old ?? DEFAULT_FINANCE_STATE),
        [house]: normalized,
      }));

      return {
        addedLines: parsed.addedLines,
        sourceAssetKey: parsed.sourceAssetKey,
      };
    },
  });
}
