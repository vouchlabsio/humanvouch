import { describe, expect, it } from "vitest";
import { contentToField, fieldToBytes32 } from "../server/utils/chain";

// BLS12-381 scalar field prime (must match the literal in server/utils/chain.ts).
const FR = 52435875175126190479447740508185965837690552500527637822603658699938581184513n;

// Pinned SHA-256-to-field digest of "hello".
const PINNED_HELLO =
  20329878786436204988385760252021328656300425018755239228739303522659023427620n;

describe("contentToField", () => {
  it("matches the pinned field element for a fixture string", () => {
    expect(contentToField("hello")).toBe(PINNED_HELLO);
  });

  it("returns a value strictly below the BLS12-381 scalar field prime", () => {
    expect(contentToField("hello")).toBeLessThan(FR);
  });
});

describe("fieldToBytes32", () => {
  it("encodes 0n as a 32-byte buffer of zeros", () => {
    const buf = fieldToBytes32(0n);
    expect(buf.length).toBe(32);
    expect([...buf]).toEqual(new Array(32).fill(0));
  });

  it("left-pads a small value rather than right-padding it", () => {
    const buf = fieldToBytes32(1n);
    expect(buf.length).toBe(32);
    expect(buf[31]).toBe(1);
    expect([...buf.slice(0, 31)]).toEqual(new Array(31).fill(0));
  });
});
