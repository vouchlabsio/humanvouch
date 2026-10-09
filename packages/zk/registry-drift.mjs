#!/usr/bin/env node
// Drift check for the committed demo registry: packages/web/public/zk/registry.json
//
// registry.json is generated output: its `root` and every member's `pathElements` /
// `pathIndices` are a pure function of the member identity secrets and the tree depth
// (the same tree packages/zk/attest-spike.js builds). The file is committed while the
// derived attest_input.json / expected_public.json are gitignored, so a hand-edit or a
// partial regeneration silently desynchronises the browser prover from the on-chain
// root. This script regenerates the Merkle tree from the committed members and fails
// if any derived value no longer matches.
//
// Hashing uses the SAME compiled hasher wasm the circuit uses (the "wasm oracle"
// approach from attest-spike.js) via circom_runtime, so the off-chain tree matches
// the circuit exactly — no JS reimplementation of Poseidon.
//
// Run locally:  node packages/zk/registry-drift.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { WitnessCalculatorBuilder } = require("circom_runtime");

const here = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = path.join(here, "..", "web", "public", "zk", "registry.json");
const HASHER_DIR = path.join(here, "..", "web", "public", "zk");

async function loadHasher(name) {
  const wasm = readFileSync(path.join(HASHER_DIR, `${name}.wasm`));
  const wc = await WitnessCalculatorBuilder(wasm);
  // witness[0] is the constant 1; witness[1] is the circuit's single output.
  return async (inputs) =>
    (await wc.calculateWitness({ in: inputs.map((x) => x.toString()) }, 0))[1];
}

function fail(message) {
  console.error(`registry-drift: FAIL — ${message}`);
  process.exit(1);
}

(async () => {
  const registry = JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
  const depth = registry.depth;
  const members = registry.members;

  if (!Number.isInteger(depth) || depth <= 0) {
    fail(`${REGISTRY_PATH} has an invalid depth (${depth})`);
  }
  if (!Array.isArray(members) || members.length === 0) {
    fail(`${REGISTRY_PATH} has no members`);
  }

  const h1 = await loadHasher("hasher1"); // Poseidon255(1): commitment leaf
  const h2 = await loadHasher("hasher2"); // Poseidon255(2): merkle node / nullifier

  // Precompute the zero-subtree roots (zero-padded tree, as in attest-spike.js).
  const zeros = [0n];
  for (let i = 1; i <= depth; i++) zeros[i] = await h2([zeros[i - 1], zeros[i - 1]]);

  const leaves = [];
  for (const member of members) leaves.push(await h1([BigInt(member.identitySecret)]));

  const layers = [leaves.slice()];
  for (let d = 0; d < depth; d++) {
    const cur = layers[d];
    const next = [];
    for (let i = 0; i < cur.length; i += 2) {
      const left = cur[i];
      const right = i + 1 < cur.length ? cur[i + 1] : zeros[d];
      next.push(await h2([left, right]));
    }
    if (next.length === 0) next.push(zeros[d + 1]);
    layers.push(next);
  }
  const root = layers[depth][0];

  const problems = [];
  if (root.toString() !== String(registry.root)) {
    problems.push(`root: committed ${registry.root} != regenerated ${root.toString()}`);
  }

  members.forEach((member, index) => {
    const pathElements = [];
    const pathIndices = [];
    let j = index;
    for (let d = 0; d < depth; d++) {
      const cur = layers[d];
      const isRight = j % 2 === 1;
      const sibling = isRight ? cur[j - 1] : j + 1 < cur.length ? cur[j + 1] : zeros[d];
      pathElements.push(sibling.toString());
      pathIndices.push(isRight ? 1 : 0);
      j = Math.floor(j / 2);
    }

    const committedElements = (member.pathElements ?? []).map(String);
    const committedIndices = (member.pathIndices ?? []).map(Number);
    if (JSON.stringify(committedElements) !== JSON.stringify(pathElements)) {
      problems.push(`members[${index}].pathElements does not match the regenerated tree`);
    }
    if (JSON.stringify(committedIndices) !== JSON.stringify(pathIndices)) {
      problems.push(`members[${index}].pathIndices does not match the regenerated tree`);
    }
  });

  if (problems.length > 0) {
    for (const problem of problems) console.error(`registry-drift: ${problem}`);
    fail(
      `packages/web/public/zk/registry.json is out of sync — regenerate it from the member identity secrets`,
    );
  }

  console.log(`registry-drift: OK — ${REGISTRY_PATH} matches the regenerated tree`);
  console.log(`  depth   : ${depth}`);
  console.log(`  members : ${members.length}`);
  console.log(`  root    : ${root.toString()}`);
})().catch((error) => {
  fail(error && error.stack ? error.stack : String(error));
});
