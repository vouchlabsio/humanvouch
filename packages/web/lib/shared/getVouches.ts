// Shared Soroban read helper for fetching vouches on-chain.
import * as StellarSdk from "@stellar/stellar-sdk";

export interface ChainCfg {
  attestContractId: string;
  rpcUrl: string;
  networkPassphrase: string;
  readSourcePublicKey: string;
  paymentAddress?: string;
}

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

export async function fetchVouches(cfg: ChainCfg, contentHash32: Uint8Array): Promise<number> {
  const ns = StellarSdk.SorobanRpc || StellarSdk.rpc;
  const server = new ns.Server(cfg.rpcUrl, { allowHttp: cfg.rpcUrl.startsWith("http://") });
  const account = await getReadSourceAccount(server, cfg);
  const contract = new StellarSdk.Contract(cfg.attestContractId);
  const op = contract.call("get_vouches", StellarSdk.xdr.ScVal.scvBytes(contentHash32));
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
