import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FR, contentToField } from "../server/utils/chain";

const getVouchesOnChain = vi.fn();
const config = {
  attestContractId: "test-contract",
  readSourcePublicKey: "test-account",
  rpcUrl: "https://invalid.example",
  networkPassphrase: "test-network",
};

beforeEach(() => {
  vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
  vi.stubGlobal("useRuntimeConfig", () => ({ public: config }));
  vi.stubGlobal("getQuery", (event: any) => event.query);
  vi.stubGlobal("getHeader", (event: any) => event.payment);
  vi.stubGlobal("setResponseStatus", (event: any, status: number) => { event.status = status; });
  vi.stubGlobal("FR", FR);
  vi.stubGlobal("contentToField", contentToField);
  vi.stubGlobal("getVouchesOnChain", getVouchesOnChain);
  getVouchesOnChain.mockReset().mockResolvedValue(2);
});

afterEach(() => vi.unstubAllGlobals());

async function request(query: Record<string, unknown>, payment?: string) {
  // Import the real handler. Stub only Nuxt's auto-imports and the chain read;
  // no wallet, payment or external RPC is used by these regression tests.
  const { default: handler } = await import("../server/api/v1/attestation.get");
  const event = { query, payment, status: 200 };
  const body = await handler(event as any);
  return { status: event.status, body };
}

describe("explicit hash validation", () => {
  it.each(["abc", "-1", "+1", "0x10", "1.5", "1e3", " 1", "1 ", "1\n", "", ["1", "2"]])(
    "returns a machine-readable 400 for %j before chain access", async hash => {
      const result = await request({ hash }, "test-receipt");
      expect(result.status).toBe(400);
      expect(result.body).toMatchObject({ code: "INVALID_HASH", error: expect.any(String) });
      expect(getVouchesOnChain).not.toHaveBeenCalled();
    },
  );

  it.each([FR.toString(), (FR + 1n).toString(), "9".repeat(300)])(
    "rejects field elements outside [0, FR): %s", async hash => {
      const result = await request({ hash });
      expect(result.status).toBe(400);
      expect(result.body).toMatchObject({ code: "HASH_OUT_OF_RANGE" });
      expect(getVouchesOnChain).not.toHaveBeenCalled();
    },
  );

  it.each(["0", "1", (FR - 1n).toString(), "0001"])(
    "preserves the 402 challenge for valid %s", async hash => {
      const result = await request({ hash });
      expect(result.status).toBe(402);
      expect(result.body).toMatchObject({
        error: "X-Payment header required",
        accepts: [expect.objectContaining({ resource: `/api/v1/attestation?hash=${BigInt(hash)}` })],
      });
      expect(getVouchesOnChain).not.toHaveBeenCalled();
    },
  );

  it("keeps the existing valid-hash response with a stubbed chain read", async () => {
    const result = await request({ hash: (FR - 1n).toString() }, "test-receipt");
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ contentHash: (FR - 1n).toString(), humanVouches: 2 });
    expect(getVouchesOnChain).toHaveBeenCalledWith(config, FR - 1n);
  });

  it.each([{}, { content: "hello" }, { content: "" }])(
    "preserves content hashing when hash is absent: %j", async query => {
      const result = await request(query);
      expect(result.status).toBe(402);
      expect(result.body).toMatchObject({
        accepts: [expect.objectContaining({ resource: `/api/v1/attestation?hash=${contentToField(query.content ?? "")}` })],
      });
    },
  );

  it("does not fall back to content when an explicit hash is malformed", async () => {
    const result = await request({ hash: "abc", content: "hello" });
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ code: "INVALID_HASH" });
  });

  it("returns 413 when content exceeds 8 KiB", async () => {
    const longContent = "a".repeat(8193);
    const result = await request({ content: longContent });
    expect(result.status).toBe(413);
    expect(result.body).toMatchObject({ code: "CONTENT_TOO_LARGE" });
  });
});
