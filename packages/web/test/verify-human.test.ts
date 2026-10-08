import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("defineEventHandler", (h: unknown) => h);
  vi.stubGlobal("readBody", async (e: any) => {
    if (e.body instanceof Error) throw e.body;
    return e.body;
  });
  vi.stubGlobal("setResponseStatus", (e: any, s: number) => { e.status = s; });
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

async function call(body: unknown) {
  const { default: handler } = await import("../server/api/verify-human.post");
  const event = { body, status: 200 };
  const res = await handler(event as any);
  return { status: event.status, body: res };
}

describe("POST /api/verify-human", () => {
  it.each([{}, undefined, { token: "" }, new Error("bad json")])(
    "returns 400 and success:false without a token (%j)", async (body) => {
      const r = await call(body);
      expect(r.status).toBe(400);
      expect(r.body).toMatchObject({ success: false });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("passes Cloudflare error-codes through in errors", async () => {
    fetchMock.mockResolvedValue({ json: async () => ({ success: false, "error-codes": ["invalid-input-response"] }) });
    const r = await call({ token: "t" });
    expect(r.body).toEqual({ success: false, errors: ["invalid-input-response"] });
  });

  it("returns success and sends the token to siteverify", async () => {
    fetchMock.mockResolvedValue({ json: async () => ({ success: true }) });
    const r = await call({ token: "tok" });
    expect(r.body).toEqual({ success: true, errors: [] });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(JSON.parse(init.body)).toMatchObject({ response: "tok" });
  });
});
