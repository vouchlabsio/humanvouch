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
const LS_ENC = "hv_wallet_secret_v2";

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

describe("built-in wallet secret storage", () => {
  it("never persists a directly usable Stellar secret in localStorage", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });

    await connectWallet(cfg);

    expect(globalThis.localStorage.getItem(LS_KEY)).toBeNull();
    expect(globalThis.localStorage.getItem(LS_ENC)).not.toBeNull();

    const dump = [];
    for (let i = 0; i < globalThis.localStorage.length; i++) {
      const key = globalThis.localStorage.key(i);
      dump.push(String(globalThis.localStorage.getItem(key)));
    }
    expect(dump.join("\n")).not.toMatch(/S[A-Z2-7]{55}/);
  });

  it("restores the encrypted wallet and reuses it without re-funding", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = fetchMock;

    const first = await connectWallet(cfg);
    const second = await connectWallet(cfg);

    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("migrates a legacy plaintext hv_wallet_secret to encrypted storage", async () => {
    const kp = StellarSdk.Keypair.random();
    globalThis.localStorage.setItem(LS_KEY, kp.secret());
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    const pub = await connectWallet(cfg);

    expect(pub).toBe(kp.publicKey());
    expect(globalThis.localStorage.getItem(LS_KEY)).toBeNull();
    expect(globalThis.localStorage.getItem(LS_ENC)).not.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
