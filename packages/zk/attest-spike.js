// Off-chain: build a REAL Poseidon-bls12381 Merkle registry + membership witness,
// using the compiled hasher wasms as the hashing oracle (guarantees the off-chain
// hashes match the circuit exactly). No mocked values anywhere.
//
// This workspace member is ESM (the root package.json sets "type": "module"), so the
// module system is `import` — `require` is not defined here. The generated
// witness_calculator is a CommonJS build, so it is pulled in with a dynamic import().
import fs from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const CIRC = path.dirname(fileURLToPath(import.meta.url));
const Fr =
  52435875175126190479447740508185965837690552500527637822603658699938581184513n;
const DEPTH = 10;

async function loadHasher(name) {
  const calculatorPath = `${CIRC}/build/${name}_js/witness_calculator.js`;
  // Dynamic import so the CommonJS builder is loaded from an ESM module.
  const mod = await import(pathToFileURL(calculatorPath).href);
  const builder = mod.default ?? mod;
  const wasm = fs.readFileSync(`${CIRC}/build/${name}_js/${name}.wasm`);
  const wc = await builder(wasm);
  return async (inputs) =>
    (await wc.calculateWitness({ in: inputs.map((x) => x.toString()) }, 0))[1];
}

function sha256ToField(str) {
  const h = createHash("sha256").update(str).digest("hex");
  return BigInt("0x" + h) % Fr;
}

(async () => {
  const h1 = await loadHasher("hasher1"); // Poseidon255(1) — commitment
  const h2 = await loadHasher("hasher2"); // Poseidon255(2) — merkle node / nullifier

  // precompute zero-subtree roots
  const zeros = [0n];
  for (let i = 1; i <= DEPTH; i++) zeros[i] = await h2([zeros[i - 1], zeros[i - 1]]);

  // a REAL registry of 5 enrolled humans (their identity secrets)
  const secrets = [111n, 222n, 333n, 444n, 555n];
  const commitments = [];
  for (const s of secrets) commitments.push(await h1([s]));

  // build the Merkle tree (zero-padded)
  const layers = [commitments.slice()];
  for (let d = 0; d < DEPTH; d++) {
    const cur = layers[d];
    const next = [];
    for (let i = 0; i < cur.length; i += 2) {
      const L = cur[i];
      const R = i + 1 < cur.length ? cur[i + 1] : zeros[d];
      next.push(await h2([L, R]));
    }
    if (next.length === 0) next.push(zeros[d + 1]);
    layers.push(next);
  }
  const root = layers[DEPTH][0];

  // prove membership of human #2 (index 2) over a real article
  const idx = 2;
  const pathElements = [];
  const pathIndices = [];
  let j = idx;
  for (let d = 0; d < DEPTH; d++) {
    const cur = layers[d];
    const isRight = j % 2 === 1;
    const sib = isRight ? cur[j - 1] : j + 1 < cur.length ? cur[j + 1] : zeros[d];
    pathElements.push(sib.toString());
    pathIndices.push(isRight ? 1 : 0);
    j = Math.floor(j / 2);
  }

  const identitySecret = secrets[idx];
  const contentHash = sha256ToField(
    "Investigation: the budget figures the ministry released do not add up. — by a real human.",
  );
  const nullifier = await h2([identitySecret, contentHash]);

  fs.writeFileSync(
    `${CIRC}/attest_input.json`,
    JSON.stringify({
      identitySecret: identitySecret.toString(),
      contentHash: contentHash.toString(),
      pathElements,
      pathIndices,
    }),
  );

  // expected public signals, order [root, nullifierHash, contentHash]
  fs.writeFileSync(
    `${CIRC}/expected_public.json`,
    JSON.stringify({
      root: root.toString(),
      nullifierHash: nullifier.toString(),
      contentHash: contentHash.toString(),
    }),
  );

  console.log("registry size   :", secrets.length, "humans");
  console.log("merkle root      :", root.toString());
  console.log("proving member   : index", idx);
  console.log("contentHash      :", contentHash.toString());
  console.log("expected nullif  :", nullifier.toString());
})();
