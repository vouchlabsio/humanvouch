#!/usr/bin/env node
// Provenance/shape gate for the committed Groth16 verification key.
//
// packages/circuits/build/verification_key.json is committed on purpose (the
// circuits .gitignore re-includes it) and feeds the on-chain verifier, so a
// hand-edited or mismatched key silently breaks on-chain verification. This
// check asserts the invariants the AttestContract relies on:
//   * protocol == "groth16"
//   * curve    == "bn128"   (the curve the deployed contract expects)
//   * nPublic  == 3         (public signals: root, nullifierHash, contentHash)
//   * IC.length == nPublic + 1   (the invariant circom-to-soroban-hex panics on)
//
// Run locally:  node packages/circuits/scripts/check-vkey.mjs
// Override the target with VKEY_PATH=/path/to/verification_key.json.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const VKEY_PATH =
  process.env.VKEY_PATH ?? path.join(here, "..", "build", "verification_key.json");

const EXPECTED_PROTOCOL = "groth16";
const EXPECTED_CURVE = "bn128";
const EXPECTED_NPUBLIC = 3;

function fail(message) {
  console.error(`vkey-check: FAIL — ${message}`);
  process.exit(1);
}

let vkey;
try {
  vkey = JSON.parse(readFileSync(VKEY_PATH, "utf8"));
} catch (error) {
  fail(`could not read ${VKEY_PATH}: ${error.message}`);
}

const icLength = Array.isArray(vkey.IC) ? vkey.IC.length : "n/a";
console.log(`vkey-check: ${VKEY_PATH}`);
console.log(`  protocol : ${vkey.protocol}`);
console.log(`  curve    : ${vkey.curve}`);
console.log(`  nPublic  : ${vkey.nPublic}`);
console.log(`  IC.length: ${icLength}`);

if (vkey.protocol !== EXPECTED_PROTOCOL) {
  fail(`protocol is "${vkey.protocol}", expected "${EXPECTED_PROTOCOL}"`);
}
if (vkey.curve !== EXPECTED_CURVE) {
  fail(`curve is "${vkey.curve}", expected "${EXPECTED_CURVE}"`);
}
if (vkey.nPublic !== EXPECTED_NPUBLIC) {
  fail(`nPublic is ${vkey.nPublic}, expected ${EXPECTED_NPUBLIC}`);
}
if (!Array.isArray(vkey.IC) || vkey.IC.length !== vkey.nPublic + 1) {
  fail(`IC.length is ${icLength}, expected nPublic + 1 (${vkey.nPublic + 1})`);
}

console.log("vkey-check: OK");
