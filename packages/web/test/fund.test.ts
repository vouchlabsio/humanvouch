import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const VALID = "G" + "A".repeat(55);
const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("defineEventHandler", (h: unknown) => h);
  vi.stubGlobal("getQuery", (e: any) => e.query);
  vi.stubGlobal("setResponseStatus", (e: any, s: number) => { e.status = s; });
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

async function call(addr: unknown) {
  const { default: handler } = await import("../server/api/fund.get");
  const event = { query: { addr }, status: 200 };
  const body = await handler(event as any);
  return { status: event.status, body };
}

describe("GET /api/fund", () => {
  it("returns 400 with an error for an address missing one character", async () => {
    const r = await call(VALID.slice(0, -1));
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ error: expect.any(String) });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 400 for a missing or lowercase address", async () => {
    expect((await call(undefined)).status).toBe(400);
    expect((await call(VALID.toLowerCase())).status).toBe(400);
  });

  it("returns 502 when Friendbot answers non-OK", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429 });
    const r = await call(VALID);
    expect(r.status).toBe(502);
    expect(r.body).toMatchObject({ error: expect.any(String), status: 429 });
    expect(fetchMock).toHaveBeenCalledWith(`https://friendbot.stellar.org/?addr=${VALID}`);
  });

  it("returns funded on success", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    const r = await call(VALID);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ funded: true, address: VALID });
  });
});
