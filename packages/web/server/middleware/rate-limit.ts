// Per-IP rate limiting for the abuse-prone public routes: Friendbot funding and
// the Turnstile human check. Budgets are configurable through runtimeConfig
// (rateLimitMax / rateLimitWindowMs) rather than hardcoded.
const buckets = new Map<string, { count: number; resetAt: number }>();

const LIMITED_ROUTES = ["/api/fund", "/api/verify-human"];

export default defineEventHandler((event) => {
  const path = getRequestURL(event).pathname;
  if (!LIMITED_ROUTES.includes(path)) return;

  const cfg = useRuntimeConfig(event);
  const max = Number(cfg.rateLimitMax) || 10;
  const windowMs = Number(cfg.rateLimitWindowMs) || 60_000;

  const ip = getRequestIP(event, { xForwardedFor: true }) || "unknown";
  const key = `${path}:${ip}`;
  const now = Date.now();

  const entry = buckets.get(key);
  if (!entry || entry.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }

  entry.count += 1;
  if (entry.count > max) {
    setResponseStatus(event, 429);
    setResponseHeader(event, "Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)));
    return { error: "too many requests" };
  }
});
