import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { hashToField } from "../lib/identity.js";
import { contentHashField } from "../../web/lib/zk.js";
import { contentToField } from "../../web/server/utils/chain.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const registry = JSON.parse(
  readFileSync(path.join(here, "../../web/public/zk/registry.json"), "utf8"),
);

// Two different fields are in play in this repo:
//   - BN254 scalar field prime — used by packages/circuits/lib/identity.js `hashToField`
//     (the superseded Plan-01 stack).
//   - BLS12-381 scalar field prime Fr — used by packages/web/lib/zk.js `contentHashField`
//     and packages/web/server/utils/chain.ts `contentToField` (the shipping circuit).
const BN254_PRIME =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const BLS12381_FR =
  52435875175126190479447740508185965837690552500527637822603658699938581184513n;

const FIXTURES = [
  registry.demoContent,
  "Investigation: the budget figures the ministry released do not add up. — by a real human.",
  "Hello, world!",
  "The Quiet Erosion — an investigation into a vanished 1.4 billion pesos.",
  "A short note vouch test.",
];

describe("content-hash implementations", () => {
  it("has at least five fixtures including the registry demoContent", () => {
    expect(FIXTURES.length).toBeGreaterThanOrEqual(5);
    expect(FIXTURES[0]).toBe(registry.demoContent);
    expect(typeof registry.demoContent).toBe("string");
  });

  it("browser contentHashField agrees byte-for-byte with server contentToField", async () => {
    for (const text of FIXTURES) {
      expect(await contentHashField(text)).toBe(contentToField(text));
    }
  });

  it("both stay inside the BLS12-381 Fr field", async () => {
    for (const text of FIXTURES) {
      expect(await contentHashField(text)).toBeLessThan(BLS12381_FR);
      expect(contentToField(text)).toBeLessThan(BLS12381_FR);
    }
  });

  it("records the BN254 vs BLS12-381 divergence of hashToField explicitly", async () => {
    const enc = new TextEncoder();
    for (const text of FIXTURES.slice(0, 2)) {
      const bn254 = hashToField(enc.encode(text));
      const bls = await contentHashField(text);
      // hashToField reduces into the BN254 scalar field prime and therefore cannot
      // reproduce the contentHash the deployed BLS12-381 circuit proves over.
      expect(bn254).toBeLessThan(BN254_PRIME);
      expect(bn254).not.toBe(bls);
    }
  });
});
