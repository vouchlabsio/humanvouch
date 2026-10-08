import { describe, expect, it } from "vitest";
import { cleanHex, hexToBytes } from "../lib/snarkHex.js";

describe("cleanHex", () => {
  it("strips 0x, whitespace and case", () => {
    expect(cleanHex("0x AB cd")).toBe("abcd");
    expect(cleanHex("  0XdeadBEEF \n")).toBe("deadbeef");
  });

  it("rejects non-hex characters and non-strings", () => {
    expect(() => cleanHex("0x12g4")).toThrow(/Invalid hex character: "g"/);
    expect(() => cleanHex(42 as unknown as string)).toThrow(TypeError);
  });
});

describe("hexToBytes", () => {
  it("returns an empty Uint8Array for empty input", () => {
    const out = hexToBytes("");
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out.length).toBe(0);
  });

  it("decodes prefixed, spaced, mixed-case hex", () => {
    expect(Array.from(hexToBytes("0x0A ff 10"))).toEqual([10, 255, 16]);
  });

  it("rejects odd-length hex", () => {
    expect(() => hexToBytes("abc")).toThrow(/even length/);
  });
});
