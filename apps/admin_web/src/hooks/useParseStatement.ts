import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AdminApiError, adminFetchJson } from "../lib/apiAdminClient";
import {
  DEFAULT_FINANCE_STATE,
  normalizeHouseFinanceData,
  type FinancePersistedState,
  type HouseFinanceData,
  type HouseKey,
} from "../lib/financeModel";

const DUPLICATE_STATEMENT_BASE_MSG =
  "Remove its imported lines or rename the file, then try again.";

/** Collects exact filenames (S3 key basenames) already used by imported lines. */
export function existingImportedStatementBasenames(
  data: HouseFinanceData,
): ReadonlySet<string> {
  const out = new Set<string>();
  for (const line of data.lines) {
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

type PresignedUpload = {
  readonly url: string;
  readonly fields: Record<string, string>;
};

type UploadUrlResponse = {
  readonly upload: PresignedUpload;
  readonly key: string;
};

type ConfirmAssetResponse = {
  readonly item: { readonly pk: string };
};

type ParseStatementResponse = {
  readonly data: HouseFinanceData;
  readonly addedLines: number;
  readonly sourceAssetKey: string;
};

export type ParseStatementResult = {
  readonly addedLines: number;
  readonly sourceAssetKey: string;
};

async function sha256Hex(file: File): Promise<string | undefined> {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    return undefined;
  }
  try {
    const buf = await file.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return undefined;
  }
}

/**
 * Pull the `<Code>…</Code>` value out of an S3 error XML body so we can
 * surface a short, actionable message in the UI (e.g. `EntityTooLarge`,
 * `AccessDenied`, `MalformedPOSTRequest`) instead of an XML wall.
 *
 * Exported for tests.
 */
export function extractS3ErrorCode(body: string): string | null {
  if (!body) return null;
  const m = /<Code>\s*([^<\s][^<]*?)\s*<\/Code>/i.exec(body);
  return m ? m[1].trim() : null;
}

async function uploadToS3(presigned: PresignedUpload, file: File): Promise<void> {
  const form = new FormData();
  for (const [k, v] of Object.entries(presigned.fields)) {
    form.append(k, v);
  }
  // Per S3 presigned POST contract, the binary content must be the LAST
  // field in the multipart body.
  form.append("file", file);

  const contentTypeField = presigned.fields["Content-Type"];
  const keyField = presigned.fields.key;
  console.info("[useParseStatement] uploading to S3", {
    url: presigned.url,
    key: keyField,
    contentTypeField,
    fileType: file.type,
    fileSize: file.size,
    fileName: file.name,
  });

  let res: Response;
  try {
    res = await fetch(presigned.url, { method: "POST", body: form });
  } catch (err) {
    // Network / CORS preflight failures land here as a TypeError with no
    // status. Make the message say so explicitly so the bug report shows
    // "TypeError: Failed to fetch" instead of a vague "Statement import
    // failed".
    console.error("[useParseStatement] S3 POST transport failure", err);
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `S3 upload network/CORS failure (no HTTP response): ${reason}`,
    );
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const code = extractS3ErrorCode(text);
    const summary = code
      ? `${code}`
      : text.slice(0, 200) || "no body";
    console.error("[useParseStatement] S3 POST rejected", {
      status: res.status,
      code,
      bodyPreview: text.slice(0, 1000),
      contentTypeField,
      keyField,
    });
    throw new Error(`S3 upload failed (${res.status}): ${summary}`);
  }
  console.info("[useParseStatement] S3 upload OK", { status: res.status });
}

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

      const upload = await adminFetchJson<UploadUrlResponse>(
        "/assets/upload-url",
        {
          method: "POST",
          body: JSON.stringify({
            filename: file.name,
            contentType,
          }),
        },
      );
      console.info("[useParseStatement] /assets/upload-url ok", {
        key: upload.key,
        contentTypeFieldFromServer: upload.upload.fields["Content-Type"],
      });

      await uploadToS3(upload.upload, file);

      const sha256 = await sha256Hex(file);
      await adminFetchJson<ConfirmAssetResponse>("/assets/confirm", {
        method: "POST",
        body: JSON.stringify({
          key: upload.key,
          size: file.size,
          ...(sha256 ? { sha256 } : {}),
        }),
      });
      console.info("[useParseStatement] /assets/confirm ok", {
        key: upload.key,
        size: file.size,
      });

      let parsed: ParseStatementResponse;
      try {
        parsed = await adminFetchJson<ParseStatementResponse>(
          `/finance/${house}/parse-statement`,
          {
            method: "POST",
            body: JSON.stringify({ key: upload.key }),
          },
        );
      } catch (err) {
        const apiMsg = adminErrorJsonMessage(err);
        if (apiMsg) throw new Error(apiMsg);
        throw err;
      }
      console.info("[useParseStatement] /parse-statement ok", {
        key: upload.key,
        addedLines: parsed.addedLines,
      });

      const normalized = normalizeHouseFinanceData(parsed.data);
      qc.setQueryData<FinancePersistedState>(["finance"], (old) => ({
        ...(old ?? DEFAULT_FINANCE_STATE),
        [house]: normalized,
      }));
      void qc.invalidateQueries({ queryKey: ["admin", "asset-records"] });

      return {
        addedLines: parsed.addedLines,
        sourceAssetKey: parsed.sourceAssetKey,
      };
    },
  });
}
