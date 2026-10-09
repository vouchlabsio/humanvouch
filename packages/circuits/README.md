# @humanvouch/circuits

Circom/Groth16 circuit proving anonymous unique-human content attestation.

## What it proves
Given a private `identitySecret` and a Poseidon Merkle registry, the circuit proves:
- `commitment = Poseidon([identitySecret])` is a member of the tree (output `root`), and
- `nullifierHash = Poseidon([identitySecret, contentHash])` is correctly derived.
Public signals: `root`, `nullifierHash`, `contentHash`. Nothing else is revealed.

## Build
Requires the Circom compiler on PATH (`circom --version` → 2.1.x).
`yarn workspace @humanvouch/circuits build`
Artifacts: `build/attestation_js/attestation.wasm`, `build/attestation_final.zkey`, `build/verification_key.json`.

## API
- `generateAttestationProof({ identitySecret, contentHash, leaves, leafIndex, depth=20 })` → `{ proof, publicSignals }`
- `verifyAttestationProof(proof, publicSignals)` → `boolean`
- `buildTree(leaves, depth=20)` → `{ root, proof(i), depth }`
- `commitment(secret)`, `nullifierHash(secret, contentHash)`, `hashToField(bytes)`

## Consumed by
- Plan 02 (Soroban): `verification_key.json` → on-chain Groth16 verifier.
- Plan 03 (API): `generateAttestationProof` → attestation payload; `hashToField` → canonical content hash.

## Security & integration invariants (READ before Plan 02/03)

- **On-chain root validation is mandatory.** The circuit's `root` is a public OUTPUT computed from the supplied Merkle path — it is NOT constrained to a known registry root. Therefore `verifyAttestationProof` returning `true` proves only that *some* tree produced that root + a correct nullifier. A non-member can produce a Groth16-valid proof carrying a root from their own fake tree. **The on-chain verifier MUST reject any proof whose `root` is not a currently-valid registry root.** Groth16 validity alone is necessary but NOT sufficient for membership.
- **Public signal order (for the contract):** `publicSignals[0] = root` (check against registry), `publicSignals[1] = nullifierHash` (replay-protect per content), `publicSignals[2] = contentHash` (record).
- **Canonical content normalization (Plan 03):** the author-side and verifier-side hash MUST agree despite platform reformatting. Both `packages/web/lib/zk.js` `contentHashField` and `packages/web/server/utils/chain.ts` `contentToField` run the content through the shared `packages/web/lib/normalize.js` `normalizeContent` rule set before hashing — strip HTML comments/tags, reduce markdown links/images to their text, drop ATX heading and blockquote markers, unify line endings to LF, apply Unicode NFC, then collapse whitespace runs and trim. Changing this rule set changes every content hash; treat it as an on-chain interface.
- **Trusted setup is NON-PRODUCTION.** `scripts/build.sh` uses hard-coded entropy and is deterministic (rebuilding reproduces `verification_key.json` byte-for-byte), so the toxic waste is public and proofs are forgeable. This is fine for the hackathon demo (mocked registry) but production requires a real multi-party ceremony (Perpetual Powers of Tau phase-1 + multi-party phase-2). Also note: the committed `verification_key.json` was produced with `circom 2.2.2` and `snarkjs 0.7.5`; the on-chain vkey, the `zkey`, and the `wasm` MUST all come from the same build (a different toolchain yields a different vkey → on-chain mismatch).
