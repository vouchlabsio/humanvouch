# On-chain status — what is PROVEN vs what remains

Last updated: 2026-10-08

## Proven on Stellar testnet (real, no mocks)

- **Curve:** BLS12-381 (mandatory; Soroban native pairing). Plan 01's BN254 setup is superseded.
- **Deployed verifier contract:** `CCOJFWMUSKLD6VAYNXD3JO442PNI76YOHY4VG6JX77EPYKH5UEIT3BKS` (testnet).
  Exposes `set_vk(vk_bytes)` and `verify(proof_bytes, pub_signals_bytes) -> bool`.
- **Deployer identity:** `hv-deployer` → `GDTLFJ4P2YYJRVO4ED4YQSC5MXKVXYNZPVZXIF3IB5WRMWRFKCJW7BPE` (funded via Friendbot; signing key is supplied externally via environment variable or secure vault, not stored in repository path). Dedicated solely to testnet contract deployment and admin configuration.
- **Phase A:** trivial bls12381 proof verified on-chain → `true`.
- **Phase B core:** the REAL membership circuit (`packages/zk/circuits/attestation255.circom`,
  Poseidon-Merkle depth 10, 7366 constraints) verified ON-CHAIN → `true`. Public signals
  `[root, nullifierHash, contentHash]` matched the off-chain-computed values exactly.
- **Off-chain hashing:** Poseidon-bls12381 via the compiled hasher **wasm as oracle** (no JS
  reimplementation). Validated against jmagan's vector `poseidon([1,2]) = 0x3fb8…e5fa`.
- **AttestContract (deployed):** `CDPDQJB7HX5XVOUHEDQKV6T7KJXNGVTVH3VDCXMFEE7GPIIINOVO5YZT` (testnet).
  Real flow proven on-chain: `set_root` (registry root) → `attest(proof, public)` verifies the
  membership proof, enforces `is_valid_root` (MANDATORY), records a vouch → returned `1`
  (tx `f0f823da…`); `get_vouches` → `1`; a replayed attest → `Error #7 AlreadyVouched`
  (one human, one vouch per content). Source: `packages/contracts/attest/`.

## Tooling (installed)

`stellar-cli` 27.0.0 (`~/.local/bin/stellar`), `circom` 2.2.2, `cargo` 1.96, wasm targets
`wasm32v1-none` + `wasm32-unknown-unknown`. snarkjs via `node_modules/.bin/snarkjs`.

## Vendored into the repo (this branch `onchain`)

- `packages/zk/circuits/` — `attestation255.circom` (real circuit) + `hasher1/2.circom` +
  `poseidon255.circom` + `poseidon255_constants.circom` (jmagan, BLS12-381 Poseidon).
- `packages/zk/attest-spike.js` — off-chain registry + Merkle + witness builder (wasm-oracle).
- `packages/contracts/groth16-verifier/` — the working BLS12-381 Groth16 verifier (from
  CircomStellar, MIT). Extended into AttestContract, which also holds the root registry.
- `packages/contracts/circom-to-soroban-hex/` — encodes snarkjs vk/proof/public → contract hex.

Build artifacts (`build/`, `target/`, `*.zkey`, `*.ptau`) are gitignored and regenerated.

## What remains (pure engineering, no crypto risk)

1. ~~**AttestContract + RegistryContract**~~ ✅ DONE — `packages/contracts/attest/`, deployed +
   proven on testnet (see above).
2. ~~**Frontend wiring**~~ ✅ DONE — author flow (paste content → SHA-256 → field → browser proof via
   snarkjs wasm + the attestation zkey → submit `attest` tx) and verifier flow (`get_vouches`):
   - content hash and proof: `packages/web/lib/zk.js` (`contentHashField`, `generateVouchProof`)
   - `attest` submission and vouch count: `packages/web/lib/stellar.js` (`submitAttest`, `getVouches`)
   - interactive UI replacing the static CTAs: `packages/web/app.vue`
   - **Wallet:** the demo does **not** use Stellar Wallets Kit. `connectWallet` in
     `packages/web/lib/stellar.js` generates a built-in testnet keypair in the browser, funds it via
     Friendbot and keeps it in `localStorage`. Wallets Kit (user-owned wallets) remains the production path.
1. ~~**AttestContract + root registry**~~ ✅ DONE — `packages/contracts/attest/`, deployed +
   proven on testnet (see above). No separate `RegistryContract` was built: the root registry lives
   inside `AttestContract` (`packages/contracts/attest/src/lib.rs`) as the `ROOTS` vector in instance
   storage, written by `set_root` and read by `is_valid_root`, which `attest` calls before verifying.
2. **Frontend wiring**: author flow (paste content → SHA256→field → browser generates proof via
   snarkjs wasm + the attestation zkey → submit `attest` tx) and verifier flow (`get_vouches`).
   Wallet connect via Stellar Wallets Kit. Replace the static landing CTAs.
3. ~~**Deploy**~~ ✅ DONE — Nuxt + nitro server routes on Vercel via `packages/web/scripts/deploy.sh`;
   contracts on testnet. See [README → Deploy](../README.md#deploy).
4. **Content index**: a persistent content index (planned on Turso) is not built yet.

## Reproduce the proven core

```
# circuits + off-chain witness (needs circom + snarkjs)
cd packages/zk/circuits && mkdir -p build
circom hasher1.circom --wasm --prime bls12381 -o build
circom hasher2.circom --wasm --prime bls12381 -o build
circom attestation255.circom --r1cs --wasm --prime bls12381 -o build
node ../attest-spike.js                 # builds real tree + attest_input.json
# trusted setup (bls12381), prove, verify — see git history / addendum spec
```
