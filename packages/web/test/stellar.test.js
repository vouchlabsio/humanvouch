import { describe, it, expect, vi, beforeEach } from "vitest";

// Minimal, deterministic stand-in for @stellar/stellar-sdk. `getVouches` only needs
// a Server with getAccount/simulateTransaction, a Contract, a TransactionBuilder and
// the Soroban Api.isSimulationError helper; nothing here touches the network.
const h = vi.hoisted(() => ({
  getAccount: vi.fn(),
  simulateTransaction: vi.fn(),
}));

vi.mock("@stellar/stellar-sdk", () => {
  class Server {
    getAccount(...args) {
      return h.getAccount(...args);
    }
    simulateTransaction(...args) {
      return h.simulateTransaction(...args);
    }
  }
  class Contract {
    call() {
      return {};
    }
  }
  class TransactionBuilder {
    addOperation() {
      return this;
    }
    setTimeout() {
      return this;
    }
    build() {
      return {};
    }
  }
  const Api = { isSimulationError: (sim) => Boolean(sim && sim.error) };
  return {
    SorobanRpc: { Server, Api },
    rpc: { Server, Api },
    Contract,
    TransactionBuilder,
    xdr: { ScVal: { scvBytes: (bytes) => bytes } },
    scValToNative: (val) => val.native,
    Keypair: { random: () => ({}), fromSecret: () => ({}) },
  };
});

import { getVouches } from "../lib/stellar.js";

const cfg = {
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
  attestContractId: "CDPDQJB7HX5XVOUHEDQKV6T7KJXNGVTVH3VDCXMFEE7GPIIINOVO5YZT",
  readSourcePublicKey: "GDTLFJ4P2YYJRVO4ED4YQSC5MXKVXYNZPVZXIF3IB5WRMWRFKCJW7BPE",
};

const CONTENT_HASH = new Uint8Array(32);

describe("getVouches", () => {
  beforeEach(() => {
    h.getAccount.mockReset();
    h.simulateTransaction.mockReset();
    h.getAccount.mockResolvedValue({});
  });

  it("returns the numeric vouch count from scValToNative on a successful simulation", async () => {
    h.simulateTransaction.mockResolvedValue({ result: { retval: { native: 3 } } });

    await expect(getVouches(cfg, null, CONTENT_HASH)).resolves.toBe(3);
  });

  it("throws the simulation error string instead of returning undefined", async () => {
    h.simulateTransaction.mockResolvedValue({ error: "host invocation failed" });

    await expect(getVouches(cfg, null, CONTENT_HASH)).rejects.toThrow(
      /host invocation failed/,
    );
  });

  it("throws a readable message when Api.isSimulationError reports a non-string error", async () => {
    h.simulateTransaction.mockResolvedValue({ error: { code: 1 } });

    await expect(getVouches(cfg, null, CONTENT_HASH)).rejects.toThrow(
      /simulation error/,
    );
  });
});
