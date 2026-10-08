import { describe, expect, it } from "vitest";
import { contentToField, fieldToBytes32 } from "../server/utils/chain";

const FIELD_MODULUS = 52435875175126190479447740508185965837690552500527637822603658699938581184513n;

describe("contentToField", () => {
  // Pinned independently with Python hashlib: SHA-256 over UTF-8, modulo FR.
  it.each([
    ["HumanVouch", 39354251042659433160979642575165153980398479658258346479765643580184036707534n],
    ["", 50551461074427906550087471814395356952109348147670397170775738301177083902036n],
    ["Hello, 世界 🌍", 44476612476721002173950921773200001020520191419048332704260700335394514905663n],
  ] as const)("matches the pinned field digest for %j", (text, expected) => {
    expect(contentToField(text)).toBe(expected);
  });

  it.each([["empty", ""], ["ASCII", "a"], ["name", "HumanVouch"], ["Unicode", "世界"], ["long", "x".repeat(4096)]])(
    "returns a non-negative field element for the %s fixture", (_, text) => {
      const result = contentToField(text);
      expect(result).toBeGreaterThanOrEqual(0n);
      expect(result).toBeLessThan(FIELD_MODULUS);
    },
  );

  it("commits to the original UTF-8 bytes without implicit normalization", () => {
    expect(contentToField("é")).not.toBe(contentToField("e\u0301"));
  });
});

describe("fieldToBytes32", () => {
  it("encodes zero as exactly 32 zero bytes", () => {
    const result = fieldToBytes32(0n);
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result).toEqual(Buffer.alloc(32));
  });

  it("left-pads one, retaining the least significant byte at the end", () => {
    const expected = Buffer.alloc(32);
    expected[31] = 1;
    expect(fieldToBytes32(1n)).toEqual(expected);
  });

  it("preserves big-endian byte order for a multi-byte value", () => {
    const expected = Buffer.alloc(32);
    expected[30] = 0x12;
    expected[31] = 0x34;
    expect(fieldToBytes32(0x1234n)).toEqual(expected);
  });

  it("encodes the largest field element without truncation", () => {
    expect(fieldToBytes32(FIELD_MODULUS - 1n).toString("hex"))
      .toBe("73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000000");
  });
});
