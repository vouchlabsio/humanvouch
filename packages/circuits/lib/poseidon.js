import { buildPoseidon } from "circomlibjs";

// BLS12-381 scalar field prime (Fr). Every part of the shipping stack hashes content
// into this field — `packages/web/lib/zk.js` and `packages/web/server/utils/chain.ts`
// both reduce SHA-256 modulo this exact value — so the circuits library must use it
// too. (It previously exported the BN254 scalar field prime, which cannot reproduce
// the `contentHash` the deployed BLS12-381 circuit proves over.) See docs/ONCHAIN-STATUS.md.
export const FR =
  52435875175126190479447740508185965837690552500527637822603658699938581184513n;

let _poseidonPromise = null;

export async function getPoseidon() {
  if (!_poseidonPromise) {
    _poseidonPromise = buildPoseidon().then((poseidon) => {
      const F = poseidon.F;
      return {
        F,
        hash(inputs) {
          // poseidon() returns a field element in Montgomery form; F.toObject -> bigint
          const out = poseidon(inputs.map((x) => F.e(x)));
          return F.toObject(out);
        },
      };
    });
  }
  return _poseidonPromise;
}
