// Shared BLS12-381 scalar-field helpers.
//
// The field prime and the SHA-256 → field reduction were duplicated (with three
// different names and two different crypto APIs) in the browser prover
// (`lib/zk.js`), the x402 server route (`server/utils/chain.ts`) and the
// off-chain registry builder (`packages/zk/attest-spike.js`). Keeping a single
// copy guarantees all three agree on which content field element a piece of text
// hashes to — a typo in one of the old copies silently changed what a subset of
// the app could attest.
//
// `sha256ToField` uses Web Crypto (`crypto.subtle`), which is available both in
// the browser and in Node 18+, so the identical function runs on the client, in
// Nitro and in the spike script.

// BLS12-381 scalar field (Fr). Must match the prime the circuits are compiled
// over with `circom --prime bls12381`.
export const FIELD_PRIME =
  52435875175126190479447740508185965837690552500527637822603658699938581184513n;

// SHA-256(text) interpreted big-endian, reduced modulo the BLS12-381 Fr — the
// circuit's `contentHash` public input.
export async function sha256ToField(text) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  const hex = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return BigInt("0x" + hex) % FIELD_PRIME;
}
