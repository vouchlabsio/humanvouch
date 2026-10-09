// Verify a Cloudflare Turnstile token server-side (real anti-bot human check).
// The secret must come from CF_TURNSTILE_SECRET; when it is unset we fail closed
// instead of falling back to Turnstile's always-passing public test secret.
export default defineEventHandler(async (event) => {
  const secret = process.env.CF_TURNSTILE_SECRET;
  if (!secret) {
    setResponseStatus(event, 503);
    return { success: false, error: "human verification is not configured" };
  }
  const body = await readBody(event).catch(() => ({}));
  const token = (body as any)?.token;
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
    body: JSON.stringify({ secret, response: token }),
  });
  const data = (await res.json()) as TurnstileResponse;
  return { success: !!data.success, errors: data["error-codes"] ?? [] };
});
