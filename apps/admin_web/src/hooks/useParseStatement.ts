import { useMutation, useQueryClient } from "@tanstack/react-query";
import { adminFetchJson } from "../lib/apiAdminClient";
import {
  DEFAULT_FINANCE_STATE,
  normalizeHouseFinanceData,
  type FinancePersistedState,
  type HouseFinanceData,
  type HouseKey,
} from "../lib/financeModel";

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

async function uploadToS3(presigned: PresignedUpload, file: File): Promise<void> {
  const form = new FormData();
  for (const [k, v] of Object.entries(presigned.fields)) {
    form.append(k, v);
  }
  // Per S3 presigned POST contract, the binary content must be the LAST
  // field in the multipart body.
  form.append("file", file);
  const res = await fetch(presigned.url, { method: "POST", body: form });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `S3 upload failed (${res.status}): ${text.slice(0, 500) || "no body"}`,
    );
  }
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

      const parsed = await adminFetchJson<ParseStatementResponse>(
        `/finance/${house}/parse-statement`,
        {
          method: "POST",
          body: JSON.stringify({ key: upload.key }),
        },
      );

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
