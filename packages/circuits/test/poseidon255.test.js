import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as snarkjs from "snarkjs";

const here = path.dirname(fileURLToPath(import.meta.url));

// The compiled Poseidon255 (BLS12-381) hashers: hasher1 = Poseidon255(1)
// (the commitment), hasher2 = Poseidon255(2) (tree nodes / nullifier). These are
// the exact wasms the browser proves against in packages/web/lib/zk.js.
const HASHER1 = path.resolve(here, "../../web/public/zk/hasher1.wasm");
const HASHER2 = path.resolve(here, "../../web/public/zk/hasher2.wasm");

// Correctness oracle from
// docs/superpowers/specs/2026-06-29-bls12381-onchain-addendum.md:
//   poseidon([1,2]) == 0x3fb8310b0e962b75bffec5f9cfcbf3f965a7b1d2dcac8d95ccb13d434e08e5fa
const POSEIDON_1_2 =
  0x3fb8310b0e962b75bffec5f9cfcbf3f965a7b1d2dcac8d95ccb13d434e08e5fan;

let seq = 0;

// Poseidon255 via the witness calculator: w[0] is the constant 1 and w[1] is the
// template's single `out` signal.
async function hash(wasm, inputs) {
  const wtns = path.join(tmpdir(), `hv-poseidon-${process.pid}-${seq++}.wtns`);
  await snarkjs.wtns.calculate(
    { in: inputs.map((x) => x.toString()) },
    wasm,
    wtns,
    { sanityCheck: true },
  );
  const witness = await snarkjs.wtns.exportJson(wtns);
  return witness[1];
}

describe("Poseidon255 (BLS12-381)", () => {
  it("matches the published [1,2] oracle", async () => {
    expect(await hash(HASHER2, [1n, 2n])).toBe(POSEIDON_1_2);
  });

  it("is sensitive to input order and to different inputs", async () => {
    expect(await hash(HASHER2, [2n, 1n])).not.toBe(POSEIDON_1_2);
    expect(await hash(HASHER2, [1n, 3n])).not.toBe(POSEIDON_1_2);
    expect(await hash(HASHER2, [2n, 2n])).not.toBe(POSEIDON_1_2);
  });

  it("hashes the single-input commitment case deterministically", async () => {
    const a = await hash(HASHER1, [1n]);
    const b = await hash(HASHER1, [1n]);
    expect(a).toBe(b);
    expect(a).not.toBe(1n);
    expect(a).not.toBe(POSEIDON_1_2);
  });
});
