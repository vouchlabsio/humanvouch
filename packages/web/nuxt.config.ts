// HumanVouch web — SPA (ssr off) so browser proving (snarkjs) + wallet run client-side.
// Deploys to Vercel; the x402 server route talks directly to Stellar testnet RPC.
export default defineNuxtConfig({
  compatibilityDate: "2026-06-28",
  // Heavy client-only libs (snarkjs / stellar-sdk / wallet kit) are dynamically
  // imported in onMounted + click handlers, so SSR renders only the static shell.
  modules: ["@nuxtjs/tailwindcss"],
  tailwindcss: { cssPath: "~/assets/css/main.css" },
  nitro: {
    // newer target so BigInt literals in the server bundle don't crash
    esbuild: { options: { target: "es2022" } },
  },
  routeRules: {
    "/**": {
      headers: {
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https://soroban-testnet.stellar.org https://friendbot.stellar.org https://challenges.cloudflare.com; img-src 'self' data:;",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
        "X-Frame-Options": "DENY",
      },
    },
  },
  devServer: { port: 58273, host: "127.0.0.1" },
  // Security headers on every response; Nitro applies routeRules `headers`
  // to both server-rendered and prerendered routes.
  routeRules: {
    "/**": {
      headers: {
        "Content-Security-Policy": [
          "default-src 'self'",
          // the Cloudflare Turnstile script + its widget iframe
          "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
          "frame-src https://challenges.cloudflare.com",
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
          "font-src 'self' https://fonts.gstatic.com",
          "img-src 'self' data:",
          "connect-src 'self' https://challenges.cloudflare.com https://soroban-testnet.stellar.org https://friendbot.stellar.org",
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'self'",
        ].join("; "),
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      },
    },
  },
  runtimeConfig: {
    // Per-IP budget for the abuse-prone public routes (see server/middleware/rate-limit.ts).
    rateLimitMax: Number(process.env.RATE_LIMIT_MAX) || 10,
    rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 60_000,
    public: {
      attestContractId: "CDPDQJB7HX5XVOUHEDQKV6T7KJXNGVTVH3VDCXMFEE7GPIIINOVO5YZT",
      rpcUrl: "https://soroban-testnet.stellar.org",
      networkPassphrase: "Test SDF Network ; September 2015",
      readSourcePublicKey: "GDTLFJ4P2YYJRVO4ED4YQSC5MXKVXYNZPVZXIF3IB5WRMWRFKCJW7BPE",
      // Public Turnstile sitekey (the matching secret stays server-side in
      // CF_TURNSTILE_SECRET). Defaults to Cloudflare's public test key.
      turnstileSitekey: process.env.CF_TURNSTILE_SITEKEY || "1x00000000000000000000AA",
    },
  },
  app: {
    head: {
      title: "HumanVouch — proof a human stands behind this",
      htmlAttrs: { lang: "en" },
      meta: [
        { charset: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        {
          name: "description",
          content:
            "Anonymous, sybil-resistant proof that a real, unique human vouches for a piece of content — verified on Stellar with zero-knowledge.",
        },
      ],
      link: [
        { rel: "preconnect", href: "https://fonts.googleapis.com" },
        { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "" },
        {
          rel: "stylesheet",
          href: "https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;1,9..144,400&family=IBM+Plex+Sans:wght@300;400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap",
        },
      ],
    },
  },
});
