// Verify a Cloudflare Turnstile token server-side (real anti-bot human check).
// Reads CF_TURNSTILE_SECRET from the environment (see .env.example). Without it,
// falls back to Turnstile's public TEST secret (always passes) so the demo works
// with no signup; set a real key in production.
const TURNSTILE_TEST_SECRET = "1x0000000000000000000000000000000AA";
const TURNSTILE_SECRET = process.env.CF_TURNSTILE_SECRET || TURNSTILE_TEST_SECRET;

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

  let res: Response;
  try {
    res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: TURNSTILE_SECRET, response: token }),
    });
  } catch {
    setResponseStatus(event, 503);
    return { success: false, error: "verification service unavailable" };
  }

  let data: TurnstileResponse;
  try {
    data = (await res.json()) as TurnstileResponse;
  } catch {
    setResponseStatus(event, 503);
    return { success: false, error: "malformed verification response" };
  }

  return { success: !!data.success, errors: data["error-codes"] ?? [] };
});
