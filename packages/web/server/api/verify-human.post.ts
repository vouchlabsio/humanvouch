// Verify a Cloudflare Turnstile token server-side (real anti-bot human check).
// Uses Turnstile's public TEST secret (always passes) so the demo works with no
// signup; swap CF_TURNSTILE_SECRET for a real key in production.
const TURNSTILE_SECRET = "1x0000000000000000000000000000000AA";

interface TurnstileBody {
  token?: string;
}

interface TurnstileResponse {
  success?: boolean;
  "error-codes"?: string[];
}

export default defineEventHandler(async (event) => {
  const body = await readBody<TurnstileBody>(event).catch(() => ({} as TurnstileBody));
  const token = body?.token;
  if (!token) {
    setResponseStatus(event, 400);
    return { success: false, error: "missing token" };
  }
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ secret: TURNSTILE_SECRET, response: token }),
  });
  const data = (await res.json()) as TurnstileResponse;
  return { success: !!data.success, errors: data["error-codes"] ?? [] };
});
