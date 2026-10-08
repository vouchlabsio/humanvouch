# HumanVouch — Design Spec

- **Date:** 2026-06-27
- **Author:** Jesús López (0xJesus)
- **Status:** Draft for review
- **Target:** [Stellar Hacks: Real-World ZK](https://dorahacks.io/hackathon/stellar-hacks-zk/detail) — Stellar Development Foundation. Prize $10k. Deadline 2026-06-29 12:00 PST (extended 2026-07-03). Solo build.

---

## 1. The honest framing (read this first)

You **cannot** prove, from content alone, that a human and not an AI produced the bytes. There is no
mathematical property "inside" text/image/audio that marks it as human-made, and a human and an AI can
emit identical bytes. ZK proves *computations over data you supply* — it cannot manufacture a real-world
truth that isn't in the data. AI detectors are statistical and evadable (Google's *Dipper* paraphraser
dropped one detector from 70.3% → 4.6% accuracy; >20% false positives on non-native English writers).

So HumanVouch does **not** claim "this content is human-written." It proves a different, achievable,
valuable thing:

> A **unique, verified human** (from an anti-sybil personhood registry) **stands behind / vouches for**
> a specific piece of content, **anonymously**, and **cannot sybil-inflate** that endorsement.

The value is **accountable, privacy-preserving, sybil-resistant attribution** — not AI detection.
This honest boundary is a core asset: it is stated explicitly in the demo video and README, and it is
exactly the distinction most hackathon entries in this space will get wrong.

## 2. Goals / Non-goals

**Goals**
- Prove anonymous unique-human endorsement of content and verify it on Stellar/Soroban.
- Make the proof consumable on platforms we don't control (X, Medium) via a portable pointer.
- Verify the *actually published* content (not a self-asserted copy) for X + Medium.
- Ship a working end-to-end demo + 2–3 min video within ~6 days, solo.

**Non-goals (explicit)**
- Detecting whether content was authored by AI vs human (impossible; not attempted).
- Real personhood-provider integration (World ID / passport) — mocked issuer for the demo.
- Roles / selective disclosure (level 2), de-anonymization authority (level 3).
- Perceptual/fuzzy content matching, watermarking, C2PA metadata embedding, browser extension.

## 3. Locked decisions (from brainstorming)

| Decision | Choice | Rationale |
|---|---|---|
| Objective | Win, solo, ~6 days | YAGNI brutal |
| Root of trust | Personhood binding (not AI detection) | Only defensible angle |
| Disclosure level | Level 1: anonymous + unique | Simplest, lowest risk |
| Personhood registry | Mock/self-issued Merkle tree on testnet | Real provider = time sink; not required by hackathon |
| Proving stack | Circom + Groth16 | Official Stellar verifier (`soroban-examples/groth16_verifier`); Semaphore reference circuits in Circom |
| Consumption | Portable pointer + canonical verifier page + platform adapters | Only model that works on platforms that strip metadata / re-encode |
| Target platforms | Medium (primary), X (secondary) | Medium fetch is low-risk; X API is restricted |
| Web template | `ScarlettPlattform/scarlett-hub` (read-only, not modified) | Reuse Nuxt+Express+Prisma+Turbo skeleton |

## 4. Architecture

```
[Enrollment off-chain]        [Circom circuit]          [Soroban]                 [App: Nuxt + Express]
 human → commitment      →     prove membership     →    RegistryContract    ←     author: hash + proof + submit
 issuer → Merkle tree          + content nullifier        AttestContract            reader: paste URL → fetch
 root  → on-chain (Groth16)                              (verify+replay+record)            → normalize → hash → query
```

Four components + a consumption layer.

### 4.1 Personhood Registry (mock issuer + on-chain root)
- Off-chain: each human generates `identitySecret`; `commitment = Poseidon(identitySecret)`.
- Issuer (us, for demo) inserts commitments into a Poseidon Merkle tree; publishes `root` to a Soroban
  `RegistryContract`. Pre-enroll N demo humans before recording the video.
- README states production replaces this with World ID / Self protocol.

### 4.2 Attestation Circuit (Circom) — the core
Public inputs: `merkleRoot`, `contentHash`, `nullifierHash`.
Private witness: `identitySecret`, `merklePathElements[]`, `merklePathIndices[]`.

Predicate `P`:
```
commitment      == Poseidon(identitySecret)
MerkleInclusion(commitment, merklePathElements, merklePathIndices) == merkleRoot
nullifierHash   == Poseidon(identitySecret, contentHash)
```

- `nullifier = Poseidon(identitySecret, contentHash)` binds the vouch to **this human AND this content**.
  → one human can vouch for many *different* contents (distinct nullifier each), but the *same* content
  only once (sybil-resistant "unique human" count, not inflatable).
- `contentHash` is computed off-circuit (SHA-256 of the canonicalized content, reduced into the BN254
  field — single field element for the MVP). The circuit treats it as an opaque public input.
- Merkle tree depth fixed (e.g. 20). Poseidon hashing throughout (cheap in Circom; matches Semaphore).
- Reference: adapt Semaphore's membership + nullifier circuits.

Artifacts produced by trusted setup (Groth16): `.wasm`, `.zkey`, `verification_key.json` → consumed by
snarkjs (proof gen) and exported to the Soroban verifier (verifying key).

### 4.3 Soroban contracts (Rust)
**`RegistryContract`**
- Stores current Merkle `root` and a small history of valid roots (so proofs against a recent root stay valid).
- `update_root(new_root)` — admin (issuer) only.
- `is_valid_root(root) -> bool`.

**`AttestContract`** (embeds the Groth16 verifier from `soroban-examples/groth16_verifier`)

> **CRITICAL invariant (from Plan 01 final review — do NOT drop in Plan 02).** The circuit's `root`
> is a public **output** computed from the prover's supplied Merkle path; it is NOT constrained inside
> the circuit to any known registry root. A Groth16-valid proof therefore only proves "*some* tree
> produced this root + a correct nullifier" — a non-member can forge a valid proof carrying a root from
> their own fake tree. **Groth16 validity is necessary but NOT sufficient for membership.** Step 1 below
> (`is_valid_root`) is the load-bearing membership check; omitting it is a complete authentication bypass.
>
> **Exact `publicSignals` order produced by the circuit (snarkjs: outputs first, then public inputs):**
> `publicSignals[0] = root`, `publicSignals[1] = nullifierHash`, `publicSignals[2] = contentHash`.
> The contract MUST use these indices (not the loose `[merkleRoot, contentHash, nullifierHash]` ordering
> written elsewhere in this doc for readability).

- `attest(proof, publicSignals)` where `publicSignals = [root, nullifierHash, contentHash]`:
  1. `RegistryContract.is_valid_root(publicSignals[0])` — else reject. **(mandatory membership check)**
  2. Verify Groth16 proof against the circuit's verifying key — else reject.
  3. `nullifierHash` (`publicSignals[1]`) not already used for this `contentHash` (`publicSignals[2]`) — else reject (anti-replay).
  4. Record: `contentHash → unique_human_count++`, store `(contentHash, nullifierHash)` used-set, timestamp.
- `get_vouches(contentHash) -> (count, timestamps)` — view.
- Storage record (MUST) is sufficient on its own. An optional **content-bound attestation NFT** (SHOULD /
  stretch) can be minted referencing `contentHash` — a "certificate of authenticity" for the *content*,
  not soulbound to a person (the human is anonymous). On-chain cost is negligible (testnet free; mainnet
  fractions of a cent per mint + small state rent), so the only constraint is dev time. Build it only
  after the vertical slice + consumption work.

### 4.4 App (Nuxt frontend + Express API)
**Author flow**
1. Author enters content in the Nuxt UI; content is canonicalized (deterministic module, can run
   client- or server-side — no secret involved) → `contentHash`.
2. **Proof generation runs client-side in the browser** (snarkjs wasm + `.zkey`): the author's
   `identitySecret` + Merkle path → Groth16 proof. **The secret never leaves the author's device** —
   this is what keeps the privacy guarantee honest. (The shipped testnet demo is an exception: its
   sixteen test secrets are bundled client-side in `packages/web/lib/demoIdentities.js` rather than
   served from the public registry; production keeps secrets device-local.) (A local CLI/Node script is the fallback for the
   demo if browser proving is flaky; it still runs on the author's machine, not the server.)
3. The browser sends only `{proof, [merkleRoot, contentHash, nullifierHash]}` to the API; the API relays
   the `attest` tx to Soroban via `@stellar/stellar-sdk`. The API never sees `identitySecret`.
4. Returns a verification link `…/v/{id}` + copy-paste badge snippet. Canonical content (not the secret)
   stored in SQLite (demo) / IPFS (prod) so the verifier can display/compare it.

**Reader flow**
1. Reader opens `…/v/{id}` OR pastes a **platform post URL** into the verifier.
2. Verifier renders canonical content + "✅ Vouched by N unique verified humans · anonymous · on Stellar"
   + live on-chain check button.

## 5. Consumption layer (the critical product piece)

**Principle: you paste a *pointer*, not the proof.** The Groth16 proof is verified once on-chain; the
canonical content lives in a neutral store. What travels across platforms is a short text link/badge —
which works everywhere because it needs zero platform cooperation (survives metadata-stripping and
re-encoding).

Badge snippet (plain text, pasteable in any tweet / article footer / video description):
```
🧑 Human-Vouched ✓ · humanvouch.xyz/v/a1b2c3
```

### 5.1 Platform adapters (verify the *actually published* content)
Adapter pipeline — only step 1 differs per platform; steps 2–4 are shared:
```
post URL → [1 fetch published content] → [2 canonical normalize] → [3 hash] → [4 query AttestContract]
                                                                                   → N vouches / not attested
```
- **Medium (primary, low risk):** fetch public HTML → `@mozilla/readability` + `jsdom` → canonical text.
- **X (secondary, medium risk):** oEmbed / syndication endpoint for public tweet text. If X's fetch path
  is blocked, ship Medium and mark X "in progress" — does not sink the deliverable.

### 5.2 Canonical normalization (the real engineering risk — not the blockchain)
Author-side hash and verifier-side hash MUST agree despite platform reformatting. Shared deterministic
normalization module:
- HTML/markdown → plain text · collapse/normalize whitespace · Unicode NFC · strip platform chrome.
- X = easy (short, plain). Medium = the hard case (long, rich formatting) → readability + aggressive
  normalization.
- **Correct, honest consequence:** if the author edits the post on-platform after attesting, the hash
  won't match → "not verified." That is the intended behavior (you vouched for *those* bytes).
  Fuzzy-match/diff is future scope.

## 6. Tech stack

| Layer | Technology | Source |
|---|---|---|
| Monorepo / tooling | Turborepo + Yarn 4 workspaces + Vitest + dotenvx | Template |
| Frontend (verifier + author UI) | Nuxt 3 + Tailwind + radix-vue + Pinia + lucide + marked | Template (`packages/dashboard`) |
| Backend API | Express 5 (ESM) + pino + helmet + cors + rate-limit | Template (`packages/api`) |
| Index / content store | Prisma 7 + SQLite (demo) → IPFS (prod) | Template (Prisma); SQLite = YAGNI adjustment |
| ZK circuit | Circom 2 + circomlib (Poseidon, Merkle) + snarkjs (setup + proof) | NEW (`packages/circuits`) |
| Contracts | Soroban (Rust) + soroban-cli, based on `soroban-examples/groth16_verifier` | NEW (`packages/contracts`) |
| Stellar tx / query | @stellar/stellar-sdk (in API) | NEW |
| Consumption adapters | undici + @mozilla/readability + jsdom (Medium); oembed/syndication (X) | NEW (in API) |
| Mock issuer + enroll | Node script: commitments + Poseidon Merkle tree + publish root | NEW (`scripts/`) |

`ScarlettPlattform/scarlett-hub` is used **read-only as a template** (structure + conventions copied to
the new `HumanVouch/` folder); the original is never modified. We pull only needed deps (drop bullmq,
lancedb, stripe, AI SDK, S3, MariaDB → SQLite).

## 7. Threat model

| ✅ Guarantees | ❌ Does NOT guarantee |
|---|---|
| A unique verified human from the registry vouches for the content, anonymously | That the human *wrote* the bytes (could paste AI output) — it's *attribution*, not *authorship* |
| Sybil-resistant: 1 human = 1 vouch per content | Anything stronger than the registry (mocked in demo) |
| Privacy: chain/reader **and the HumanVouch server** never learn which human (proof generated client-side; secret never leaves the author's device) | Content provenance beyond the vouch |
| Replay-proof: nullifier prevents double-attestation; content binding prevents proof reuse on other content | Correct match if author edits on-platform after attesting (by design) |
| On-chain membership enforced via `is_valid_root` (Groth16 validity alone is insufficient — see §4.3 invariant) | Soundness of proofs themselves — see trusted-setup note below |

**Trusted setup (NON-PRODUCTION).** The Groth16 setup in `scripts/build.sh` uses hard-coded entropy and
is deterministic (rebuilding reproduces `verification_key.json` byte-for-byte). The toxic waste is
therefore public and **proofs are forgeable** — acceptable for this hackathon demo (registry is mocked
anyway), but production requires a real multi-party ceremony (Perpetual Powers of Tau phase-1 +
multi-party phase-2). The committed vkey was produced with `circom 2.2.2` + `snarkjs 0.7.5`; the on-chain
vkey, the `.zkey`, and the `.wasm` MUST all come from the same build (toolchain drift → vkey mismatch).
State this disclaimer in the demo video and README.

## 8. Scope

**MUST**
- Circom circuit (Merkle inclusion + content nullifier) + Groth16 trusted setup + artifacts.
- `RegistryContract` + `AttestContract` (verify + valid-root + replay guard + record + view) on testnet.
- Enrollment script (mock issuer) + proof-gen path (API/snarkjs).
- Express API: submit attestation, query vouches, Medium adapter, canonical normalization.
- Nuxt verifier page (canonical content + vouch count + live check) + author submit UI.
- Portable badge/link.
- README with explicit honest threat model + "production uses World ID".
- 2–3 min demo video.

**SHOULD**
- X adapter (if fetch path cooperates).
- Content-bound attestation NFT (stretch; cheap on-chain, build only after MUST is done).

**CUT**
- Real personhood provider, roles/disclosure, de-anonymization, QR badge, C2PA embedding,
  browser extension, watermarking, perceptual/fuzzy matching, other platforms, MariaDB.

## 9. Testing

- **Circuit:** member → proof verifies; non-member → fails; wrong nullifier → fails.
- **Contracts:** accept valid; reject replay (same nullifier+content); reject invalid/stale root; count increments.
- **Normalization:** author text and platform-fetched text of the same logical content hash equal;
  edited content hashes differ.
- **E2E:** enroll → attest → `get_vouches`=1; same human+content → reject; different human+same content → 2;
  reader pastes Medium URL → verifier shows correct count.

## 10. Open risks

1. **X fetch** under current API restrictions — mitigated by Medium-first, X-optional.
2. **Medium normalization** determinism on rich articles — the main time sink; budget for it.
3. **Groth16 verifier integration** on Soroban (gas/format of public inputs) — de-risked by using the
   official example, but verify field-element encoding of `contentHash` early.
4. **6-day solo budget** — circuit + contracts are the critical path; build a vertical slice first
   (enroll → attest → verify count) before the consumption polish.

## 11. Demo / video narrative

1. Show the honest framing ("we do NOT detect AI; we prove anonymous unique-human accountability").
2. Author vouches for an article → gets a badge.
3. Paste the badge into a real Medium post; paste the Medium URL into the verifier → "✅ N unique humans."
4. Show sybil resistance (same human can't double-count) and privacy (no identity revealed).
5. Close with the threat model and the production path (World ID).
