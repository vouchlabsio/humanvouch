import { describe, it, expect } from "vitest";
import { proofToHex, publicSignalsToHex, hexToBytes } from "../lib/snarkHex.js";

// One Fq limb is 48 bytes -> 96 lowercase hex characters (BLS12-381, uncompressed).
const fq = (value) => value.toString(16).padStart(96, "0");

// A fixed, deliberately tiny snarkjs-shaped proof. The G2 segment is the second
// 96-byte component of `proofToHex`: [G1 pi_a | G2 pi_b | G1 pi_c].
const FIXED_PROOF = {
  pi_a: ["1", "2", "1"],
  pi_b: [
    ["1", "2"],
    ["3", "4"],
  ],
  pi_c: ["5", "6", "1"],
};

describe("proofToHex G2 limb order", () => {
  it("encodes Fq2 limbs as [c0, c1] matching the Rust encoder", () => {
    const hex = proofToHex(FIXED_PROOF);
    const g2 = hex.slice(96 * 2, 96 * 2 + 96 * 4); // skip G1 pi_a (96 bytes)

    // Arkworks `serialize_uncompressed` writes x.c0, x.c1, y.c0, y.c1 — no swap.
    // `packages/contracts/circom-to-soroban-hex` `g2_bytes` produces the same bytes:
    // its Rust unit test (`g2_limb_order_matches_js_encoder`) asserts this exact string.
    const expected = fq(1n) + fq(2n) + fq(3n) + fq(4n);
    expect(g2).toBe(expected);
    expect(g2).toHaveLength(192 * 2);
  });

  it("would differ if the limbs were swapped (guards against regressing to [c1, c0])", () => {
    const hex = proofToHex(FIXED_PROOF);
    const g2 = hex.slice(96 * 2, 96 * 2 + 96 * 4);
    const swapped = fq(2n) + fq(1n) + fq(4n) + fq(3n);
    expect(g2).not.toBe(swapped);
  });

  it("rejects a malformed proof", () => {
    expect(() => proofToHex({})).toThrow(/Malformed proof/);
  });
});

describe("publicSignalsToHex", () => {
  it("length-prefixes 32-byte big-endian signals", () => {
    const hex = publicSignalsToHex(["1", "2"]);
    expect(hex).toBe(
      "00000002" + "1".padStart(64, "0") + "2".padStart(64, "0"),
    );
  });
});

describe("hexToBytes", () => {
  it("round-trips a hex string (0x-prefixed, mixed case, whitespace)", () => {
    expect(Array.from(hexToBytes("0x0A ff"))).toEqual([0x0a, 0xff]);
  });
});
