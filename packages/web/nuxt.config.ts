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
  devServer: { port: 58273, host: "127.0.0.1" },
  runtimeConfig: {
    public: {
      attestContractId: "CDPDQJB7HX5XVOUHEDQKV6T7KJXNGVTVH3VDCXMFEE7GPIIINOVO5YZT",
      rpcUrl: "https://soroban-testnet.stellar.org",
      networkPassphrase: "Test SDF Network ; September 2015",
      readSourcePublicKey: "GDTLFJ4P2YYJRVO4ED4YQSC5MXKVXYNZPVZXIF3IB5WRMWRFKCJW7BPE",
      // Dedicated x402 payment destination (set PAYMENT_ADDRESS in the deploy env).
      // Kept separate from readSourcePublicKey so incoming payments never share
      // the account whose sequence number every on-chain read depends on.
      paymentAddress: process.env.PAYMENT_ADDRESS || "",
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
