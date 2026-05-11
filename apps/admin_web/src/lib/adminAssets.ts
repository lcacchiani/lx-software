/** S3 object key embedded after the `ASSET#` Dynamo PK prefix. */
export function objectKeyFromAssetPk(pk: string): string {
  return pk.startsWith("ASSET#") ? pk.slice("ASSET#".length) : pk;
}

export function formatFileSizeBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
