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
// This turns HumanVouch from a button into infrastructure: a verifiable,
// machine-payable signal of human authorship for the agent era.
export default defineEventHandler(async (event) => {
  const cfg = useRuntimeConfig().public as unknown as ChainCfg;
  const q = getQuery(event);

  let contentField: bigint;
  if (q.hash !== undefined) {
    if (typeof q.hash !== "string" || !q.hash.length || /[^0-9]/.test(q.hash)) {
      setResponseStatus(event, 400);
      return { code: "INVALID_HASH", error: "hash must be a non-negative decimal integer" };
    }
    contentField = BigInt(q.hash);
    if (contentField >= FR) {
      setResponseStatus(event, 400);
      return { code: "HASH_OUT_OF_RANGE", error: "hash must be less than the BLS12-381 scalar field modulus" };
    }
  } else {
    contentField = contentToField(String(q.content ?? ""));
  }

  const resource = `/api/v1/attestation?hash=${contentField.toString()}`;

  // x402: require a micropayment before serving the verification.
  const payment = getHeader(event, "x-payment");
  if (!payment) {
    setResponseStatus(event, 402);
    return {
      x402Version: 1,
      error: "X-Payment header required",
      accepts: [
        {
          scheme: "exact",
          network: "stellar-testnet",
          maxAmountRequired: "100000", // 0.01 XLM, in stroops
          asset: "native",
          payTo: cfg.readSourcePublicKey,
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
