import { describe, expect, it } from "vitest";
import { proofToHex, publicSignalsToHex } from "../lib/snarkHex.js";

const hex48 = (n: number | bigint) => BigInt(n).toString(16).padStart(96, "0");
const proof = {
  pi_a: ["1", "2", "1"],
  pi_b: [["3", "4"], ["5", "6"], ["1", "0"]],
  pi_c: ["7", "8", "1"],
};

describe("proofToHex", () => {
  it("encodes A (G1, 96 B) + B (G2, 192 B) + C (G1, 96 B) = 384 bytes = 768 hex chars", () => {
    expect(proofToHex(proof)).toHaveLength(2 * (96 + 192 + 96));
  });

  it("writes G2 limbs in Arkworks [c0, c1] order (snarkjs emits [c1, c0])", () => {
    const h = proofToHex(proof);
    const b = h.slice(192, 192 + 384);
    expect(b).toBe(hex48(4) + hex48(3) + hex48(6) + hex48(5));
    expect(h.slice(0, 192)).toBe(hex48(1) + hex48(2));
    expect(h.slice(576)).toBe(hex48(7) + hex48(8));
  });

  it("rejects a malformed proof object", () => {
    expect(() => proofToHex({ pi_a: ["1", "2"] })).toThrow(/Malformed proof/);
  });
});

describe("publicSignalsToHex", () => {
  it("prefixes the count as an 8-hex-digit big-endian u32", () => {
    const h = publicSignalsToHex(["1", "2", "255"]);
    expect(h.slice(0, 8)).toBe("00000003");
    expect(h).toHaveLength(8 + 3 * 64);
    expect(h.slice(8 + 2 * 64)).toBe("ff".padStart(64, "0"));
  });

  it("encodes an empty list as just the zero count", () => {
    expect(publicSignalsToHex([])).toBe("00000000");
  });

  it("rejects values that do not fit in 32 bytes", () => {
    expect(() => publicSignalsToHex([(1n << 256n).toString()])).toThrow(/does not fit/);
  });
});
