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
  const [x0, x1] = x;
  const [y0, y1] = y;
  // snarkjs emits Fq2 limbs in mathematical order [c0, c1]. Soroban expects the
  // Arkworks uncompressed encoding, which serializes each Fq2 as c0 then c1 — the
  // same order the `circom-to-soroban-hex` reference converter produces (it builds
  // Fq2::new(pi_b[0][0], pi_b[0][1]) and lets `serialize_uncompressed` emit c0, c1).
  // The Solidity-friendly [c1, c0] swap belongs only to the EVM pairing precompile,
  // so no reordering happens here. See test/snarkHex.test.js.
  return (
    toFixedHexFromDecimal(x0, BYTE_LEN_FQ) +
    toFixedHexFromDecimal(x1, BYTE_LEN_FQ) +
    toFixedHexFromDecimal(y0, BYTE_LEN_FQ) +
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
  return value.trim().toLowerCase().replace(/^0x/, "").replace(/\s+/g, "");
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
