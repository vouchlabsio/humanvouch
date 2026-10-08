import { describe, it, expect, vi, beforeEach } from "vitest";

// In-memory stand-in for @stellar/stellar-sdk so no network is touched.
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
    rpc: { Server, Api },
    SorobanRpc: { Server, Api },
    Contract,
    TransactionBuilder,
    xdr: { ScVal: { scvBytes: (bytes) => bytes } },
    scValToNative: (val) => val.native,
  };
});

import { getVouchesOnChain } from "../server/utils/chain";

const baseCfg = {
  attestContractId: "CDPDQJB7HX5XVOUHEDQKV6T7KJXNGVTVH3VDCXMFEE7GPIIINOVO5YZT",
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
  readSourcePublicKey: "GDTLFJ4P2YYJRVO4ED4YQSC5MXKVXYNZPVZXIF3IB5WRMWRFKCJW7BPE",
};

describe("getVouchesOnChain read-source account cache", () => {
  beforeEach(() => {
    h.getAccount.mockReset();
    h.simulateTransaction.mockReset();
    h.getAccount.mockResolvedValue({});
    h.simulateTransaction.mockResolvedValue({ result: { retval: { native: 1 } } });
  });

  it("performs one getAccount for repeated reads within the TTL", async () => {
    const cfg = { ...baseCfg, rpcUrl: baseCfg.rpcUrl + "/cache-hit" };

    await getVouchesOnChain(cfg, 1n);
    await getVouchesOnChain(cfg, 2n);
    await getVouchesOnChain(cfg, 3n);

    expect(h.getAccount).toHaveBeenCalledTimes(1);
    expect(h.simulateTransaction).toHaveBeenCalledTimes(3);
  });

  it("names readSourcePublicKey when the source account does not exist", async () => {
    const cfg = { ...baseCfg, rpcUrl: baseCfg.rpcUrl + "/missing" };
    h.getAccount.mockRejectedValue(new Error("account not found"));

    await expect(getVouchesOnChain(cfg, 1n)).rejects.toThrow(
      baseCfg.readSourcePublicKey,
    );
  });
});
