// Server-side chain helpers for the x402 agent endpoint.
// stellar-sdk is imported lazily (only when actually reading the chain) so the
// x402 payment-challenge path works even where the SDK is heavy to bundle.
import { sha256ToField } from "../lib/field.js";

export async function contentToField(text: string): Promise<bigint> {
  return sha256ToField(text);
import { createHash } from "node:crypto";
import { normalizeContent } from "../../lib/normalize.js";

const FR = BigInt(
  "52435875175126190479447740508185965837690552500527637822603658699938581184513",
);

export function contentToField(text: string): bigint {
  const hex = createHash("sha256").update(normalizeContent(text), "utf8").digest("hex");
  return BigInt("0x" + hex) % FR;
}

export function fieldToBytes32(value: bigint): Buffer {
  const hex = value.toString(16).padStart(64, "0");
  return Buffer.from(hex, "hex");
}

// x402 "exact" scheme price, in stroops (0.01 XLM), matching the 402 challenge.
const MAX_AMOUNT_REQUIRED = 100000n;

// Pull the base64 envelope out of an X-Payment header. Real x402 clients send a
// JSON receipt with the signed transaction; a bare base64 envelope is also accepted.
function x402Envelope(header: string): string {
  try {
    const parsed = JSON.parse(header);
    const env = parsed?.payload?.transaction ?? parsed?.transaction;
    if (typeof env === "string") return env;
  } catch {
    // not JSON — treat the header itself as the envelope
  }
  return header;
}

// Verify an x402 receipt actually pays the endpoint before serving the answer.
// Returns false for anything that is not a landed, correctly-priced payment.
export async function verifyX402Payment(cfg: ChainCfg, header: string): Promise<boolean> {
  try {
    const StellarSdk: any = await import("@stellar/stellar-sdk");
    const tx = StellarSdk.TransactionBuilder.fromXDR(
      x402Envelope(header),
      cfg.networkPassphrase,
    );
    const payment = tx.operations.find(
      (op: any) =>
        op.type === "payment" &&
        op.destination === cfg.readSourcePublicKey &&
        (!op.asset?.isNative || op.asset.isNative()),
    );
    if (!payment) return false;
    const paidStroops = BigInt(Math.round(Number(payment.amount) * 1e7));
    if (paidStroops < MAX_AMOUNT_REQUIRED) return false;

    // Confirm the signed payment actually landed on-chain; an unsubmitted or
    // forged envelope must not be treated as paid.
    const ns: any = StellarSdk.rpc || StellarSdk.SorobanRpc;
    const server = new ns.Server(cfg.rpcUrl, { allowHttp: cfg.rpcUrl.startsWith("http://") });
    const got = await server.getTransaction(tx.hash().toString("hex"));
    return got?.status === "SUCCESS";
  } catch {
    return false;
  }
}

export interface ChainCfg {
  attestContractId: string;
  rpcUrl: string;
  networkPassphrase: string;
  readSourcePublicKey: string;
  paymentAddress: string;
}

// The read source account is only used to build a simulation transaction that is
// never submitted, and `getAccount` is an RPC round trip. Cache the resolved Account
// for a short TTL so repeated reads within it perform one lookup, not one per request.
const READ_SOURCE_TTL_MS = 30_000;
const readSourceCache = new Map<string, { account: any; expiresAt: number }>();

function readSourceKey(cfg: ChainCfg): string {
  return `${cfg.rpcUrl}::${cfg.readSourcePublicKey}`;
}

async function getReadSourceAccount(server: any, cfg: ChainCfg): Promise<any> {
  const key = readSourceKey(cfg);
  const now = Date.now();
  const cached = readSourceCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.account;
  }
  let account;
  try {
    account = await server.getAccount(cfg.readSourcePublicKey);
  } catch (err: any) {
    const detail = err?.message ?? String(err);
    throw new Error(
      `read source account ${cfg.readSourcePublicKey} is not available on ${cfg.rpcUrl} ` +
        `(check readSourcePublicKey): ${detail}`,
    );
  }
  readSourceCache.set(key, { account, expiresAt: now + READ_SOURCE_TTL_MS });
  return account;
}

// Read-only on-chain query: how many unique humans vouch for this content field element.
export async function getVouchesOnChain(cfg: ChainCfg, contentField: bigint): Promise<number> {
  const StellarSdk: any = await import("@stellar/stellar-sdk");
  const ns: any = StellarSdk.rpc || StellarSdk.SorobanRpc;
  const server = new ns.Server(cfg.rpcUrl, { allowHttp: cfg.rpcUrl.startsWith("http://") });
  const account = await server.getAccount(cfg.readSourcePublicKey);
  const account = await getReadSourceAccount(server, cfg);
  const contract = new StellarSdk.Contract(cfg.attestContractId);
  const op = contract.call(
    "get_vouches",
    StellarSdk.xdr.ScVal.scvBytes(fieldToBytes32(contentField)),
  );
  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: cfg.networkPassphrase,
  })
    .addOperation(op)
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (ns.Api?.isSimulationError?.(sim) || sim.error) {
    throw new Error(typeof sim.error === "string" ? sim.error : "simulation error");
  }
  return Number(StellarSdk.scValToNative(sim.result.retval));
}
