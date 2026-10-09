// HumanVouch — agent-consumable attestation endpoint (x402).
//
// An AI agent asks: "does a real, unique human stand behind this content?"
// The answer is gated by an x402 (HTTP 402 Payment Required) micropayment on
// Stellar, then resolved from the on-chain AttestContract.
//
//   GET /api/v1/attestation?content=<text>        (or ?hash=<fieldElement>)
//   -> 402 with payment requirements  (no X-Payment header)
//   -> 200 with the on-chain attestation (with X-Payment header)
//
// `content` and `hash` are single-value parameters: a repeated parameter
// (?content=a&content=b) would silently probe content that was never vouched,
// so it is rejected with a 400 naming the offending parameter.
//
// This turns HumanVouch from a button into infrastructure: a verifiable,
// machine-payable signal of human authorship for the agent era.
export default defineEventHandler(async (event) => {
  const cfg = useRuntimeConfig().public as unknown as ChainCfg;
  const q = getQuery(event);

  // getQuery returns a string[] for a repeated parameter; String(["a","b"])
  // would collapse it to "a,b" and hash a value that was never vouched.
  if (Array.isArray(q.hash)) {
    setResponseStatus(event, 400);
    return { error: "invalid hash: expected a single value, not a repeated parameter" };
  }
  if (Array.isArray(q.content)) {
    setResponseStatus(event, 400);
    return { error: "invalid content: expected a single value, not a repeated parameter" };
  let contentField: bigint;
  if (typeof q.hash === "string" && q.hash.length) {
    // Must be a canonical, non-negative BLS12-381 scalar. Letting BigInt() throw
    // on bad input surfaces as a 500, and "-1" would encode as a malformed value.
    if (!/^[0-9]+$/.test(q.hash)) {
      setResponseStatus(event, 400);
      return { error: "invalid hash: expected a non-negative decimal field element" };
    }
    const hash = BigInt(q.hash);
    if (hash >= FR) {
      setResponseStatus(event, 400);
      return { error: "invalid hash: value must be below the BLS12-381 scalar field prime" };
    }
    contentField = hash;
  } else {
    contentField = contentToField(String(q.content ?? ""));
  }
  const contentField =
    typeof q.hash === "string" && q.hash.length
      ? BigInt(q.hash)
      : await contentToField(String(q.content ?? ""));

  const contentField =
    typeof q.hash === "string" && q.hash.length
      ? BigInt(q.hash)
      : contentToField(String(q.content ?? ""));

  const resource = `/api/v1/attestation?hash=${contentField.toString()}`;

  // x402: require a *verified* micropayment before serving the verification.
  // A header that cannot be proven to pay the endpoint is treated as no payment.
  const payment = getHeader(event, "x-payment");
  const paid = payment ? await verifyX402Payment(cfg, payment) : false;
  if (!paid) {
    setResponseStatus(event, 402);
    return {
      x402Version: 1,
      error: payment
        ? "X-Payment header present but no verified payment was found"
        : "X-Payment header required",
      accepts: [
        {
          scheme: "exact",
          network: "stellar-testnet",
          maxAmountRequired: "100000", // 0.01 XLM, in stroops
          asset: "native",
          payTo: cfg.paymentAddress,
          resource,
          mimeType: "application/json",
          description:
            "Verify whether a unique, verified human vouches for this content (anonymous, sybil-resistant).",
        },
      ],
    };
  }

  // Paid: resolve the attestation from the AttestContract on Stellar.
  const humanVouches = await getVouchesOnChain(cfg, contentField);
  return {
    standard: "humanvouch/v1",
    contentHash: contentField.toString(),
    humanVouches,
    backedByHuman: humanVouches > 0,
    anonymous: true,
    sybilResistant: true,
    network: "stellar-testnet",
    contract: cfg.attestContractId,
    note: "Proof of a unique human attribution — not a claim that a human wrote the bytes.",
  };
});
