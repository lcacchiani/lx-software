import { describe, expect, it } from "vitest";
import { extractS3ErrorCode } from "./useParseStatement";

describe("extractS3ErrorCode", () => {
  it("returns null for an empty body", () => {
    expect(extractS3ErrorCode("")).toBeNull();
  });

  it("returns null when no <Code> tag is present", () => {
    expect(extractS3ErrorCode("<Error><Message>oops</Message></Error>")).toBeNull();
  });

  it("extracts the canonical S3 error code", () => {
    const xml =
      "<?xml version=\"1.0\" encoding=\"UTF-8\"?>" +
      "<Error><Code>EntityTooLarge</Code><Message>Your proposed upload exceeds the maximum allowed size</Message></Error>";
    expect(extractS3ErrorCode(xml)).toBe("EntityTooLarge");
  });

  it("trims surrounding whitespace inside the tag", () => {
    expect(
      extractS3ErrorCode("<Error><Code>\n  AccessDenied\n  </Code></Error>"),
    ).toBe("AccessDenied");
  });

  it("is case-insensitive on the tag name", () => {
    expect(extractS3ErrorCode("<error><code>NoSuchKey</code></error>")).toBe(
      "NoSuchKey",
    );
  });

  it("returns the first <Code> when several appear", () => {
    expect(
      extractS3ErrorCode(
        "<Error><Code>MalformedPOSTRequest</Code><Detail><Code>X</Code></Detail></Error>",
      ),
    ).toBe("MalformedPOSTRequest");
  });
});
