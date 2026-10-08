import test from "node:test";
import assert from "node:assert";
import { cleanHex, hexToBytes } from "../lib/snarkHex.js";

test("cleanHex normalizes valid hex strings with 0x prefix and spaces", () => {
  assert.strictEqual(cleanHex("0xdeadBEEF"), "deadbeef");
  assert.strictEqual(cleanHex("  0x1a 2b 3c  "), "1a2b3c");
  assert.strictEqual(cleanHex(""), "");
});

test("cleanHex throws descriptive error on invalid hex characters", () => {
  assert.throws(
    () => cleanHex("zz"),
    /Invalid hex character: "z"/
  );
  assert.throws(
    () => cleanHex("0x12g4"),
    /Invalid hex character: "g"/
  );
  assert.throws(
    () => cleanHex("0x12?4"),
    /Invalid hex character: "\?"/
  );
});

test("cleanHex and hexToBytes reject nonstring inputs with TypeError", () => {
  assert.throws(
    () => cleanHex(10),
    TypeError
  );
  assert.throws(
    () => hexToBytes(10),
    TypeError
  );
  assert.throws(
    () => hexToBytes(null),
    TypeError
  );
  assert.throws(
    () => hexToBytes(undefined),
    TypeError
  );
});

test("hexToBytes successfully decodes valid hex to Uint8Array", () => {
  const bytes = hexToBytes("0xdeadBEEF");
  assert.strictEqual(bytes instanceof Uint8Array, true);
  assert.strictEqual(bytes.length, 4);
  assert.deepStrictEqual(Array.from(bytes), [0xde, 0xad, 0xbe, 0xef]);
});

test("hexToBytes returns empty Uint8Array for empty input", () => {
  const bytes = hexToBytes("");
  assert.strictEqual(bytes instanceof Uint8Array, true);
  assert.strictEqual(bytes.length, 0);
});

test("hexToBytes throws instead of returning zero bytes for non-hex input", () => {
  assert.throws(
    () => hexToBytes("zz"),
    /Invalid hex character: "z"/
  );
  assert.throws(
    () => hexToBytes("00zz"),
    /Invalid hex character: "z"/
  );
});

test("hexToBytes throws on odd length hex string", () => {
  assert.throws(
    () => hexToBytes("123"),
    /Hex string must have even length/
  );
});
import { describe, expect, it } from "vitest";
import { cleanHex, hexToBytes } from "../lib/snarkHex.js";

describe("hex validation", () => {
  it.each(["zz", "1g", "g1", "00gg", "0xdeadBEEZ", "0x12-4", "0x12_4", "0x１２", "00🙂"])(
    "rejects invalid characters in %j from both entry points", value => {
      expect(() => cleanHex(value)).toThrow(/Invalid hex character/);
      expect(() => hexToBytes(value)).toThrow(/Invalid hex character/);
    },
  );

  it("reports the first invalid character and its normalized position", () => {
    expect(() => hexToBytes(" 0xDE ADg0 ")).toThrow('Invalid hex character "g" at index 4');
  });

  it("names a non-ASCII character without splitting its surrogate pair", () => {
    expect(() => cleanHex("00🙂")).toThrow('Invalid hex character "🙂" at index 2');
  });

  it.each(["deadbeef", "0xdeadBEEF", "0XDEADBEEF", "  0xDe Ad\tBe\nef  "])(
    "preserves supported normalization for %j", value => {
      expect(cleanHex(value)).toBe("deadbeef");
      expect(hexToBytes(value)).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
    },
  );

  it.each(["", "0x", " \n\t "])("preserves empty hex input %j", value => {
    expect(cleanHex(value)).toBe("");
    expect(hexToBytes(value)).toEqual(new Uint8Array(0));
  });

  it.each(["a", "0xabc", "12345"])("still rejects odd-length bytes %j", value => {
    expect(() => hexToBytes(value)).toThrow("Hex string must have even length");
  });

  it("decodes every valid byte without coercion", () => {
    const hex = Array.from({ length: 256 }, (_, byte) => byte.toString(16).padStart(2, "0")).join("");
    expect(hexToBytes(hex)).toEqual(Uint8Array.from({ length: 256 }, (_, byte) => byte));
  });
});
