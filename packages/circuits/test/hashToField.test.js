import { describe, it, expect } from "vitest";
import { FIELD_PRIME } from "../lib/poseidon.js";
import { hashToField } from "../lib/identity.js";

// Documented in docs/superpowers/plans/2026-06-27-humanvouch-01-zk-circuit.md (Field: BN254 scalar prime r).
// Changing FIELD_PRIME (e.g. moving this package to BLS12-381) must be deliberate and update this pin.
const DOCUMENTED_BN254_R =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

describe("hashToField", () => {
  it("FIELD_PRIME equals the documented BN254 scalar prime", () => {
    expect(FIELD_PRIME).toBe(DOCUMENTED_BN254_R);
  });

  it("returns a value strictly below FIELD_PRIME for several inputs", () => {
    const inputs = [
      Buffer.alloc(0),
      Buffer.from("hello human"),
      Buffer.alloc(1024, 0xff),
      Buffer.from("ünïcödé ✓"),
      ...Array.from({ length: 64 }, (_, i) => Buffer.from(`input-${i}`)),
    ];
    for (const b of inputs) {
      const v = hashToField(b);
      expect(typeof v).toBe("bigint");
      expect(v >= 0n).toBe(true);
      expect(v < FIELD_PRIME).toBe(true);
    }
  });

  it("is deterministic", () => {
    expect(hashToField(Buffer.from("x"))).toBe(hashToField(Buffer.from("x")));
  });
});
