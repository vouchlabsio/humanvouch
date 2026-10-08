import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as StellarSdk from "@stellar/stellar-sdk";
import { connectWallet } from "../lib/stellar.js";

const cfg = {
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
  attestContractId: "CDPDQJB7HX5XVOUHEDQKV6T7KJXNGVTVH3VDCXMFEE7GPIIINOVO5YZT",
  readSourcePublicKey: "GDTLFJ4P2YYJRVO4ED4YQSC5MXKVXYNZPVZXIF3IB5WRMWRFKCJW7BPE",
};

const LS_KEY = "hv_wallet_secret";

function makeLocalStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    key: (i) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  };
}

let originalFetch;

beforeEach(() => {
  globalThis.localStorage = makeLocalStorage();
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete globalThis.localStorage;
});

describe("connectWallet", () => {
  it("restores a pre-seeded hv_wallet_secret without calling /api/fund", async () => {
    const kp = StellarSdk.Keypair.random();
    globalThis.localStorage.setItem(LS_KEY, kp.secret());
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    const statuses = [];
    const pub = await connectWallet(cfg, (s) => statuses.push(s));

    expect(pub).toBe(kp.publicKey());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(statuses.some((s) => /restoring/i.test(s))).toBe(true);
  });

  it("rejects with the documented message when /api/fund is not OK", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false });
    globalThis.fetch = fetchMock;

    await expect(connectWallet(cfg)).rejects.toThrow(
      "could not fund the wallet on testnet",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/fund?addr=");
  });

  it("generates, funds and persists a fresh wallet, returning its public key", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = fetchMock;

    const pub = await connectWallet(cfg);

    expect(pub).toMatch(/^G[A-Z2-7]{55}$/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const stored = globalThis.localStorage.getItem(LS_KEY);
    expect(stored).toMatch(/^S[A-Z2-7]{55}$/);
    expect(StellarSdk.Keypair.fromSecret(stored).publicKey()).toBe(pub);
  });
});
