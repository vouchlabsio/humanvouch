import { createHash } from "node:crypto";
import { getPoseidon, FR } from "./poseidon.js";

export async function commitment(identitySecret) {
  const p = await getPoseidon();
  return p.hash([identitySecret]);
}

export async function nullifierHash(identitySecret, contentHash) {
  const p = await getPoseidon();
  return p.hash([identitySecret, contentHash]);
}

export function hashToField(bytes) {
  const digest = createHash("sha256").update(bytes).digest(); // 32 bytes
  const asBig = BigInt("0x" + digest.toString("hex"));
  return asBig % FR;
}
