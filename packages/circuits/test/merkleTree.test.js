import { describe, it, expect } from "vitest";
import { getPoseidon } from "../lib/poseidon.js";
import { buildTree } from "../lib/merkleTree.js";

describe("merkleTree", () => {
  it("recomputes the root from every member's proof at depth 10", async () => {
    const p = await getPoseidon();
    const leaves = [11n, 22n, 33n, 44n, 55n];
    const tree = await buildTree(leaves, 10);

    expect(tree.depth).toBe(10);
    for (const [leafIndex, leaf] of leaves.entries()) {
      const { pathElements, pathIndices } = tree.proof(leafIndex);
      expect(pathElements).toHaveLength(10);
      expect(pathIndices).toHaveLength(10);

      let node = leaf;
      for (let i = 0; i < pathElements.length; i++) {
        expect(pathIndices[i]).toBe((leafIndex >> i) & 1);
        node =
          pathIndices[i] === 0
            ? p.hash([node, pathElements[i]])
            : p.hash([pathElements[i], node]);
      }
      expect(node).toBe(tree.root);
    }
  });

  it("returns a valid proof and zero-padded root for one leaf at depth 10", async () => {
    const p = await getPoseidon();
    const leaf = 11n;
    const tree = await buildTree([leaf], 10);
    const { pathElements, pathIndices } = tree.proof(0);

    expect(pathElements).toHaveLength(10);
    expect(pathIndices).toEqual(Array(10).fill(0));

    let zero = 0n;
    let node = leaf;
    for (let i = 0; i < 10; i++) {
      expect(pathElements[i]).toBe(zero);
      node = p.hash([node, zero]);
      zero = p.hash([zero, zero]);
    }
    expect(node).toBe(tree.root);
    expect(() => tree.proof(1)).toThrow();
  });

  it("recomputes the root from a member's proof", async () => {
    const p = await getPoseidon();
    const leaves = [11n, 22n, 33n, 44n];
    const tree = await buildTree(leaves, 20);
    const { pathElements, pathIndices } = tree.proof(2); // leaf 33n

    // Re-walk the path exactly as the circuit will.
    let node = 33n;
    for (let i = 0; i < pathElements.length; i++) {
      node =
        pathIndices[i] === 0
          ? p.hash([node, pathElements[i]])
          : p.hash([pathElements[i], node]);
    }
    expect(node).toBe(tree.root);
  });

  it("a non-member proof does not reproduce the root", async () => {
    const p = await getPoseidon();
    const tree = await buildTree([11n, 22n, 33n, 44n], 20);
    const { pathElements, pathIndices } = tree.proof(0);
    let node = 999n; // wrong leaf
    for (let i = 0; i < pathElements.length; i++) {
      node =
        pathIndices[i] === 0
          ? p.hash([node, pathElements[i]])
          : p.hash([pathElements[i], node]);
    }
    expect(node).not.toBe(tree.root);
  });

  it("proof() throws for out-of-range leafIndex", async () => {
    const tree = await buildTree([11n, 22n, 33n, 44n], 20);
    expect(() => tree.proof(-1)).toThrow();
    expect(() => tree.proof(4)).toThrow();
    expect(() => tree.proof(100)).toThrow();
  });
});
