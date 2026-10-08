import { describe, it, expect, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as snarkjs from "snarkjs";

const here = path.dirname(fileURLToPath(import.meta.url));

// The shipping circuit: the browser proves against this exact wasm
// (packages/web/lib/zk.js -> fullProve input shape mirrors `inputFor` below).
const WASM = path.resolve(here, "../../web/public/zk/attestation255.wasm");
const REGISTRY = path.resolve(here, "../../web/public/zk/registry.json");

let seq = 0;

// Run the Attestation255 witness calculator and return the raw witness.
// Layout: w[0] = 1, w[1] = root, w[2] = nullifierHash, w[3] = contentHash
// (public outputs first, then the public input), then private inputs.
async function witness(input) {
  const wtns = path.join(tmpdir(), `hv-255-${process.pid}-${seq++}.wtns`);
  await snarkjs.wtns.calculate(input, WASM, wtns, { sanityCheck: true });
  const w = await snarkjs.wtns.exportJson(wtns);
  return w;
}

function inputFor(member, contentHash) {
  return {
    identitySecret: member.identitySecret,
    contentHash: contentHash.toString(),
    pathElements: member.pathElements,
    pathIndices: member.pathIndices.map((x) => x.toString()),
  };
}

describe("Attestation255 witness", () => {
  let registry;
  beforeAll(async () => {
    registry = JSON.parse(await readFile(REGISTRY, "utf8"));
  });

  it("emits public signals in the [root, nullifierHash, contentHash] order", async () => {
    const contentHash = 67890n;
    const w = await witness(inputFor(registry.members[0], contentHash));

    expect(w[0]).toBe(1n);
    // publicSignals[0] = root — a valid member path rebuilds the committed root.
    expect(w[1]).toBe(BigInt(registry.root));
    // publicSignals[2] = contentHash — echoed back as the public input.
    expect(w[3]).toBe(contentHash);
    // publicSignals[1] = nullifierHash — distinct from both neighbours.
    expect(w[2]).not.toBe(w[1]);
    expect(w[2]).not.toBe(w[3]);
  });

  it("reproduces the committed root for the spike witness input", async () => {
    // Mirrors the input `packages/zk/attest-spike.js` writes to attest_input.json.
    const w = await witness(inputFor(registry.members[0], 0n));
    expect(w[1]).toBe(BigInt(registry.root));
  });

  it("binds the nullifier to both the member and the content", async () => {
    const a = await witness(inputFor(registry.members[0], 111n));
    const b = await witness(inputFor(registry.members[0], 222n)); // same member, different content
    const c = await witness(inputFor(registry.members[1], 111n)); // different member

    expect(b[2]).not.toBe(a[2]);
    expect(c[2]).not.toBe(a[2]);
    // every registry member shares the same root
    expect(a[1]).toBe(b[1]);
    expect(c[1]).toBe(BigInt(registry.root));
  });
});
