import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// The route relies on Nitro auto-imports (defineEventHandler, useRuntimeConfig,
// getQuery, getHeader, setResponseStatus, contentToField, getVouchesOnChain).
// Stub them as globals before the handler module is loaded.
const cfg = {
  attestContractId: "CTEST",
  rpcUrl: "https://rpc.test",
  networkPassphrase: "Test SDF Network ; September 2015",
  readSourcePublicKey: "GSOURCE",
};

const getVouchesOnChain = vi.fn();

vi.stubGlobal("defineEventHandler", (h: unknown) => h);
vi.stubGlobal("useRuntimeConfig", () => ({ public: cfg }));
vi.stubGlobal("getQuery", (event: any) => event.query);
vi.stubGlobal("getHeader", (event: any, key: string) => event.headers?.[key]);
vi.stubGlobal("setResponseStatus", (event: any, status: number) => {
  event.status = status;
});
vi.stubGlobal("contentToField", () => 123n);
vi.stubGlobal("getVouchesOnChain", getVouchesOnChain);

const handler = (await import("../server/api/v1/attestation.get")).default as (
  event: any,
) => Promise<any>;

function makeEvent(headers: Record<string, string> = {}) {
  return { query: { content: "hello" }, headers };
}

beforeEach(() => {
  getVouchesOnChain.mockReset();
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("GET /api/v1/attestation (x402 challenge)", () => {
  it("returns 402 with the documented accepts entry when X-Payment is absent", async () => {
    const event = makeEvent();
    const body = await handler(event);

    expect(event.status).toBe(402);
    expect(body.x402Version).toBe(1);
    expect(body.accepts[0].network).toBe("stellar-testnet");
    expect(body.accepts[0].maxAmountRequired).toBe("100000");
    expect(body.accepts[0].payTo).toBe(cfg.readSourcePublicKey);
    expect(body.accepts[0].resource).toBe("/api/v1/attestation?hash=123");
    expect(getVouchesOnChain).not.toHaveBeenCalled();
  });
});

describe("GET /api/v1/attestation (paid response)", () => {
  it("reports backedByHuman false when the on-chain count is 0", async () => {
    getVouchesOnChain.mockResolvedValue(0);
    const body = await handler(makeEvent({ "x-payment": "paid" }));

    expect(body.humanVouches).toBe(0);
    expect(body.backedByHuman).toBe(false);
  });

  it("reports backedByHuman true when the on-chain count is 2", async () => {
    getVouchesOnChain.mockResolvedValue(2);
    const body = await handler(makeEvent({ "x-payment": "paid" }));

    expect(body.humanVouches).toBe(2);
    expect(body.backedByHuman).toBe(true);
  });
});
