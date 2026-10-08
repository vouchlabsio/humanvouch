# HumanVouch

**Proof that a real, unique human stands behind a piece of content — anonymous, sybil-resistant, and verified on Stellar with zero-knowledge.**

🔗 **Live demo:** https://web-seven-eta-40.vercel.app · 🎬 **Narrated walkthrough:** [`demo/humanvouch-demo-narrated.mp4`](demo/humanvouch-demo-narrated.mp4)

Built for **[Stellar Hacks: Real-World ZK](https://dorahacks.io/hackathon/stellar-hacks-zk)**.

---

## The honest thesis

You **cannot** prove, from content alone, that a human and not an AI wrote it. The bytes are
identical, and AI detectors are unreliable and trivially evaded (Google's *Dipper* paraphraser
dropped one detector from 70% → 4.6% accuracy). HumanVouch does **not** attempt this.

Instead it proves something real and achievable: **a verified, unique human privately vouches for a
piece of content** — putting their (anonymous) personhood behind it, in a way bots and duplicate
accounts cannot fake. It's **attribution, not authorship**; **accountability, not AI-detection**.

## What it does

- **Vouch** — a verified human stakes a private, anonymous vouch on a piece of content. A Groth16
  zero-knowledge proof is generated **in the browser** (the identity secret never leaves the device)
  and the attestation is recorded **on Stellar**.
- **Verify** — anyone can check how many unique verified humans stand behind a piece of content.
- **Shareable credential** — vouching returns a `/?v=<hash>` link + a paste-able badge you drop on X,
  Medium, anywhere; opening it resolves the attestation on-chain.
- **For agents (x402)** — an HTTP endpoint where an **AI agent pays a micropayment over
  [x402](https://github.com/coinbase/x402) (HTTP 402)** and gets a verifiable, on-chain answer to
  *"does a real human stand behind this content?"* — HumanVouch as infrastructure for the agent era.
- **Proof of personhood** — a real Cloudflare Turnstile human check gates getting an identity
  (anti-bot); production upgrades to World ID for true uniqueness.
- **Sybil-resistance** — one human, one vouch per content, enforced on-chain by a nullifier.

## How the zero-knowledge works

The circuit proves, without revealing the human:

```
commitment      = Poseidon(identitySecret)
MerkleInclusion(commitment, path) == root        // membership in a personhood registry
nullifierHash   = Poseidon(identitySecret, contentHash)   // one human, one vouch per content
```

Public signals: `[root, nullifierHash, contentHash]`. The on-chain `AttestContract` verifies the
Groth16 proof, **requires the root be a valid registry root** (Groth16 validity alone ≠ membership),
rejects nullifier replay, and records the vouch.

**On Stellar this means BLS12-381** (Soroban's native pairing). The circuit is compiled with
`circom --prime bls12381` and hashes with [Poseidon over BLS12-381](https://github.com/jmagan/poseidon-bls12381-circom)
— a Poseidon-Merkle membership proof verified on Stellar, which (as far as we found) had not been
demonstrated before.

## On-chain (Stellar testnet)

- **AttestContract:** `CDPDQJB7HX5XVOUHEDQKV6T7KJXNGVTVH3VDCXMFEE7GPIIINOVO5YZT`
  (`set_vk`, `set_root` / `is_valid_root`, `attest`, `get_vouches`).
- Built on the official [`soroban-examples/groth16_verifier`](https://github.com/stellar/soroban-examples/tree/main/groth16_verifier)
  (BLS12-381) + [CircomStellar](https://github.com/jamesbachini/CircomStellar)'s proof encoder.

## Architecture

```
packages/
  zk/          Circom membership + content-nullifier circuit (Poseidon-bls12381) + off-chain witness
  contracts/   Soroban: groth16 verifier + AttestContract (registry + attest + replay guard)
  web/         Nuxt app: built-in wallet, browser proving, verify, shareable links,
               x402 agent endpoint (/api/v1/attestation), Turnstile personhood
  circuits/    Plan-01 circuit lib (BN254, TDD) — superseded on-chain by the bls12381 build
docs/          design spec, BLS12-381 migration addendum, on-chain status
```

**Stack:** Circom 2 + snarkjs (Groth16) · Soroban (Rust) on Stellar testnet · Nuxt 3 / Vue + Tailwind ·
`@stellar/stellar-sdk` · Cloudflare Turnstile · deployed on Vercel.

## Run it

```bash
# the full live app
cd packages/web && yarn install && yarn dev      # http://127.0.0.1:58273

# rebuild the ZK circuit + proof (needs the circom 2 compiler on PATH)
cd packages/zk/circuits
circom attestation255.circom --r1cs --wasm --prime bls12381 -o build
# trusted setup + proof: see docs/ONCHAIN-STATUS.md
```

## Deploy

The reproducible production deploy is [`packages/web/scripts/deploy.sh`](packages/web/scripts/deploy.sh):

```bash
# one-time: authenticate the Vercel CLI (interactive login or a VERCEL_TOKEN)
npx --yes vercel login

packages/web/scripts/deploy.sh        # builds with VERCEL=1 then deploys --prebuilt --prod
```

The script sets `VERCEL=1`, runs `yarn build`, then copies the **complete** `@stellar/stellar-sdk`
package into every `.vercel/output/functions/*.func` directory before running
`vercel deploy --prebuilt --prod`. That post-build patch is required and must not be removed:
stellar-sdk 16's ESM build ships nested, vendored dependencies that Vercel's file tracer misses, so
without the copy the serverless function 500s on a missing `js-xdr` file.

## Honest caveats (also stated in the demo)

- **Not AI detection.** Attribution to an accountable unique human, not a claim about who typed the bytes.
- **Demo trusted setup is non-production** (deterministic entropy → forgeable). Production needs a real MPC.
- **Personhood** is Cloudflare Turnstile (anti-bot) in the demo; production = World ID (unique-personhood).
- The demo personhood registry is operated by us (real Poseidon-bls12381 commitments + Merkle root
  published on-chain) — real cryptography, standing in for World ID / passport.

---

*Real zero-knowledge, real on-chain, for the humans who create — and the agents that increasingly read what we write.*
