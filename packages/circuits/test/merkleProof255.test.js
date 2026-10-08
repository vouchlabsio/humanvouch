import { describe, it, expect, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as snarkjs from "snarkjs";

const here = path.dirname(fileURLToPath(import.meta.url));

// attestation255.circom enforces the boolean index with
//   pathIndices[i] * (1 - pathIndices[i]) === 0
// and the sibling selection at lines 22-23 depends on it entirely.
const WASM = path.resolve(here, "../../web/public/zk/attestation255.wasm");
const REGISTRY = path.resolve(here, "../../web/public/zk/registry.json");

let seq = 0;

async function witness(member, pathIndices) {
  const wtns = path.join(tmpdir(), `hv-merkle-${process.pid}-${seq++}.wtns`);
  await snarkjs.wtns.calculate(
    {
      identitySecret: member.identitySecret,
      contentHash: "0",
      pathElements: member.pathElements,
      pathIndices: pathIndices.map((x) => x.toString()),
    },
    WASM,
    wtns,
    // Without sanityCheck the witness is still computed for a non-boolean index;
    // this is what runs the `pathIndices[i] * (1 - pathIndices[i]) === 0` assert.
    { sanityCheck: true },
  );
  return snarkjs.wtns.exportJson(wtns);
}

describe("MerkleProof255 boolean path-index constraint", () => {
  let registry;
  beforeAll(async () => {
    registry = JSON.parse(await readFile(REGISTRY, "utf8"));
  });

  it("accepts a valid boolean path and rebuilds the committed root", async () => {
    const member = registry.members[0];
    const w = await witness(member, member.pathIndices);
    expect(w[1]).toBe(BigInt(registry.root)); // w[1] = root
  });

  it("rejects a pathIndices entry of 2", async () => {
    const member = registry.members[0];
    const bad = [...member.pathIndices];
    bad[0] = 2;

    await expect(witness(member, bad)).rejects.toThrow();
  });
});
