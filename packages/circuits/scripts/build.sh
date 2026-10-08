#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

BUILD=build
POT_POWER=15   # ~32k constraints headroom; the depth-20 poseidon circuit is well under this
# yarn snarkjs resolves via Yarn PnP / hoisted root node_modules — verified to work from
# packages/circuits with `yarn snarkjs --version`.
SNARKJS="yarn snarkjs"

mkdir -p "$BUILD"

echo "==> Compiling circuit"
# The on-chain verifier is BLS12-381 (Soroban's native pairing), so the circuit MUST be
# compiled over that prime. A BN254 build yields a verifying key the deployed contract
# can never accept, so both circom and the powers-of-tau phase below use bls12381.
# Pass both local and repo-root node_modules so circom finds circomlib regardless of
# Yarn hoisting. circomlib is hoisted to the repo root; packages/circuits/node_modules
# is empty under this workspace's Yarn 4 setup.
circom circuits/attestation.circom --r1cs --wasm --sym --prime bls12381 -l node_modules -l ../../node_modules -o "$BUILD"

echo "==> Circuit info"
$SNARKJS r1cs info "$BUILD/attestation.r1cs"

echo "==> Powers of Tau (phase 1)"
$SNARKJS powersoftau new bls12381 "$POT_POWER" "$BUILD/pot_0.ptau" -v
$SNARKJS powersoftau contribute "$BUILD/pot_0.ptau" "$BUILD/pot_1.ptau" --name="hv-1" -v -e="humanvouch entropy 1"
$SNARKJS powersoftau prepare phase2 "$BUILD/pot_1.ptau" "$BUILD/pot_final.ptau" -v

echo "==> Groth16 setup (phase 2)"
$SNARKJS groth16 setup "$BUILD/attestation.r1cs" "$BUILD/pot_final.ptau" "$BUILD/attestation_0.zkey"
$SNARKJS zkey contribute "$BUILD/attestation_0.zkey" "$BUILD/attestation_final.zkey" --name="hv-2" -v -e="humanvouch entropy 2"
$SNARKJS zkey export verificationkey "$BUILD/attestation_final.zkey" "$BUILD/verification_key.json"

echo "==> Done. Artifacts in $BUILD/"
