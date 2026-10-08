import { describe, it, expect } from "vitest";
import { normalizeContent } from "../lib/normalize.js";
import { contentHashField } from "../lib/zk.js";
import { contentToField } from "../server/utils/chain";

describe("normalizeContent", () => {
  it("collapses CRLF, whitespace runs and surrounding whitespace to one form", () => {
    expect(normalizeContent("a\r\nb\t c  ")).toBe("a b c");
    expect(normalizeContent("  The budget  ")).toBe("The budget");
    expect(normalizeContent("line1\rline2")).toBe("line1 line2");
  });

  it("applies Unicode NFC so decomposed text equals its composed form", () => {
    expect(normalizeContent("cafe\u0301")).toBe("caf\u00e9");
    expect(normalizeContent("caf\u00e9")).toBe(normalizeContent("cafe\u0301"));
  });

  it("strips HTML and markdown chrome but keeps the words", () => {
    expect(normalizeContent("<p>Hello <b>world</b></p>")).toBe("Hello world");
    expect(normalizeContent("## Heading\n\nA [link](https://example.com) here")).toBe(
      "Heading A link here",
    );
  });
});

describe("canonical content hashing", () => {
  const article =
    "The Quiet Erosion — an investigation. The totals on page four contradicted the summary.";

  it("hashes CRLF, trailing whitespace and decomposed Unicode variants identically", async () => {
    const variants = [
      article + "\r\n",
      "  " + article + "   ",
      "The Quiet Erosion — an investigation.\r\nThe totals on page four contradicted the summary.",
      article + "\n\n\n",
    ];
    const canonical = await contentHashField(article);
    for (const variant of variants) {
      expect(await contentHashField(variant)).toBe(canonical);
      expect(contentToField(variant)).toBe(canonical);
    }
  });

  it("gives the browser and the server the same field element", async () => {
    expect(await contentHashField(article)).toBe(contentToField(article));
  });

  it("still hashes two different articles differently", async () => {
    const a = "The budget does not add up.";
    const b = "The budget does add up.";
    expect(normalizeContent(a)).not.toBe(normalizeContent(b));
    expect(await contentHashField(a)).not.toBe(await contentHashField(b));
  });
});
