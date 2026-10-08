// Derived from CircomStellar's proof encoder (https://github.com/jamesbachini/CircomStellar) (MIT License)
// Copyright (c) 2024 James Bachini

const BYTE_LEN_FQ = 48;
const BYTE_LEN_U256 = 32;

function normalizeDecString(value) {
  if (typeof value !== "string") return String(value);
  return value.trim();
}

function toFixedHexFromDecimal(decString, byteLen) {
  const v = BigInt(normalizeDecString(decString));
  if (v < 0n) {
    throw new Error("Negative numbers are not supported for field encoding");
  }
  const max = 1n << BigInt(byteLen * 8);
  if (v >= max) {
    throw new Error(`Value does not fit in ${byteLen} bytes`);
  }
  return v.toString(16).padStart(byteLen * 2, "0");
}

function u32beHex(value) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error("Invalid u32 value");
  }
  return value.toString(16).padStart(8, "0");
}

function g1Hex(point) {
  const [x, y] = point;
  return toFixedHexFromDecimal(x, BYTE_LEN_FQ) + toFixedHexFromDecimal(y, BYTE_LEN_FQ);
}

function g2Hex(point) {
  const [x, y] = point;
  const [x1, x2] = x;
  const [y1, y2] = y;
  // snarkjs emits Fq2 limbs in Solidity-friendly order [c1, c0].
  // Soroban expects Arkworks uncompressed encoding, which serializes limbs as [c0, c1].
  return (
    toFixedHexFromDecimal(x2, BYTE_LEN_FQ) +
    toFixedHexFromDecimal(x1, BYTE_LEN_FQ) +
    toFixedHexFromDecimal(y2, BYTE_LEN_FQ) +
    toFixedHexFromDecimal(y1, BYTE_LEN_FQ)
  );
}

export function proofToHex(proof) {
  if (!proof?.pi_a || !proof?.pi_b || !proof?.pi_c) {
    throw new Error("Malformed proof object");
  }
  return (g1Hex(proof.pi_a) + g2Hex(proof.pi_b) + g1Hex(proof.pi_c)).toLowerCase();
}

export function publicSignalsToHex(publicSignals) {
  if (!Array.isArray(publicSignals)) {
    throw new Error("publicSignals must be an array");
  }

  const encoded = publicSignals
    .map((s) => toFixedHexFromDecimal(s, BYTE_LEN_U256))
    .join("");

  return (u32beHex(publicSignals.length) + encoded).toLowerCase();
}

export function cleanHex(value) {
  if (typeof value !== "string") {
    throw new TypeError(`Expected hex string, received ${typeof value}`);
  }
  const clean = value.trim().toLowerCase().replace(/^0x/, "").replace(/\s+/g, "");
  const invalidMatch = clean.match(/[^0-9a-f]/);
  if (invalidMatch) {
    throw new Error(`Invalid hex character: "${invalidMatch[0]}"`);
  const clean = value.trim().toLowerCase().replace(/^0x/, "").replace(/\s+/g, "");
  const invalid = clean.match(/[^0-9a-f]/u);
  if (invalid) {
    throw new Error(`Invalid hex character ${JSON.stringify(invalid[0])} at index ${invalid.index}`);
  }
  return clean;
}

export function hexToBytes(hex) {
  const clean = cleanHex(hex);
  if (clean.length === 0) {
    return new Uint8Array(0);
  }
  if (clean.length % 2 !== 0) {
    throw new Error("Hex string must have even length");
  }
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = parseInt(clean.slice(i, i + 2), 16);
  }
  return bytes;
}
