import { describe, expect, it } from "vitest";
import { contentHashField } from "../lib/zk.js";
import { FR, contentToField } from "../server/utils/chain";

// FR is the BLS12-381 scalar field order (same constant as lib/zk.js line 6).
describe("contentHashField", () => {
  it("is deterministic for the same input", async () => {
    const a = await contentHashField("hello human");
    const b = await contentHashField("hello human");
    expect(typeof a).toBe("bigint");
    expect(a).toBe(b);
  });

  it("is strictly below the field order", async () => {
    for (const s of ["", "a", "hello human", "x".repeat(10_000), "ünïcödé ✓"]) {
      const v = await contentHashField(s);
      expect(v >= 0n && v < FR).toBe(true);
    }
  });

  it("differs for different content and agrees with the server-side contentToField", async () => {
    expect(await contentHashField("a")).not.toBe(await contentHashField("b"));
    expect(await contentHashField("hello human")).toBe(contentToField("hello human"));
  });
});
