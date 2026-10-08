import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as snarkjs from "snarkjs";

const here = path.dirname(fileURLToPath(import.meta.url));

// The committed demo registry is generated output (packages/zk/attest-spike.js
// writes it). The hasher wasms in packages/web/public/zk are the exact Poseidon255
// (BLS12-381) build the browser proves against, so they are the correct oracle for
// re-walking the registry's Merkle paths.
const REGISTRY = path.resolve(here, "../../web/public/zk/registry.json");
const HASHER1 = path.resolve(here, "../../web/public/zk/hasher1.wasm");
const HASHER2 = path.resolve(here, "../../web/public/zk/hasher2.wasm");

let seq = 0;

// Poseidon255 via the compiled witness calculator: w[0] is the constant 1 and
// w[1] is the template's single `out` signal. sanityCheck keeps the circuit's
// assertions enforced while computing the witness.
async function poseidon(wasm, inputs) {
  const wtns = path.join(tmpdir(), `hv-registry-${process.pid}-${seq++}.wtns`);
  await snarkjs.wtns.calculate(
    { in: inputs.map((x) => x.toString()) },
    wasm,
    wtns,
    { sanityCheck: true },
  );
  const witness = await snarkjs.wtns.exportJson(wtns);
  return witness[1];
}

// Memoised Poseidon255(2) — many members share internal nodes, so this keeps the
// full-registry re-walk cheap.
function hasher2() {
  const cache = new Map();
  return async (inputs) => {
    const key = inputs.map((x) => x.toString()).join(",");
    if (!cache.has(key)) cache.set(key, poseidon(HASHER2, inputs));
    return cache.get(key);
  };
}

// Re-walk one member's inclusion path with the Poseidon255 hasher.
async function reconstructRoot(h1, h2, member) {
  let node = await h1([BigInt(member.identitySecret)]); // commitment
  for (let i = 0; i < member.pathElements.length; i++) {
    const sibling = BigInt(member.pathElements[i]);
    node =
      member.pathIndices[i] === 0
        ? await h2([node, sibling])
        : await h2([sibling, node]);
  }
  return node;
}

describe("registry.json integrity", () => {
  it("re-walks every member path back to the committed root", async () => {
    const registry = JSON.parse(await readFile(REGISTRY, "utf8"));
    const h1 = (inputs) => poseidon(HASHER1, inputs);
    const h2 = hasher2();
    const root = BigInt(registry.root);

    expect(registry.depth).toBe(10);
    expect(registry.members).toHaveLength(16);
    expect(BigInt(registry.fieldPrime)).toBeGreaterThan(root);

    for (const member of registry.members) {
      expect(member.pathElements).toHaveLength(registry.depth);
      expect(member.pathIndices).toHaveLength(registry.depth);
      for (const bit of member.pathIndices) expect([0, 1]).toContain(bit);
      expect(await reconstructRoot(h1, h2, member)).toBe(root);
    }
  });

  it("fails when a single pathElements entry is mutated", async () => {
    const registry = JSON.parse(await readFile(REGISTRY, "utf8"));
    const h1 = (inputs) => poseidon(HASHER1, inputs);
    const h2 = hasher2();

    const member = structuredClone(registry.members[0]);
    member.pathElements[0] = (BigInt(member.pathElements[0]) + 1n).toString();

    expect(await reconstructRoot(h1, h2, member)).not.toBe(
      BigInt(registry.root),
    );
  });
});
