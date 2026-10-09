// Browser-side ZK: load the demo registry, hash content, generate the membership
// proof with snarkjs, and encode it to the contract's byte format.
import * as snarkjs from "snarkjs";
import { proofToHex, publicSignalsToHex } from "./snarkHex.js";
import { sha256ToField } from "./field.js";
import { demoIdentitySecret } from "./demoIdentities.js";

const FR = 52435875175126190479447740508185965837690552500527637822603658699938581184513n;

export async function loadRegistry() {
  const res = await fetch("/zk/registry.json");
  if (!res.ok) throw new Error("could not load registry");
  return res.json();
}

// SHA-256(content) reduced into the BLS12-381 scalar field — matches the circuit's contentHash.
export async function contentHashField(text) {
  return sha256ToField(text);
}

export function toBytes32BE(value) {
  const hex = value.toString(16).padStart(64, "0");
  const arr = new Uint8Array(32);
  for (let i = 0; i < 32; i++) arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return arr;
}

// Generate the membership proof for `member` vouching for content with hash `contentHashBig`.
export async function generateVouchProof(member, contentHashBig) {
  const input = {
    // Registry members no longer carry a plaintext secret; the demo supplies it
    // out of band so the public /zk/registry.json exposes only commitments/paths.
    identitySecret: member.identitySecret ?? demoIdentitySecret(member.id),
    pathElements: member.pathElements,
    pathIndices: member.pathIndices,
    contentHash: contentHashBig.toString(),
  };
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    "/zk/attestation255.wasm",
    "/zk/attestation255.zkey",
  );
  return {
    proofHex: proofToHex(proof),
    publicHex: publicSignalsToHex(publicSignals),
    root: publicSignals[0],
    nullifierHash: publicSignals[1],
  };
}
