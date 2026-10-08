// Stellar/Soroban: a built-in browser wallet + submit the attest tx + read vouches.
//
// The wallet is created and held in the browser: a fresh Stellar keypair generated
// on first connect, funded via Friendbot, and persisted **encrypted** in localStorage
// (the secret is wrapped with a non-extractable Web Crypto key — see keyStore.js).
// No browser extension needed — the app spins up a real (testnet) wallet for each
// visitor and signs the attestation with it. (Production can also offer Freighter via
// the Stellar Wallets Kit; the built-in wallet is the zero-friction default.)
import * as StellarSdk from "@stellar/stellar-sdk";
import { hexToBytes } from "./snarkHex.js";
import { getWrappingKey } from "./keyStore.js";

const LS_KEY = "hv_wallet_secret"; // legacy plaintext secret, migrated away on first read
const LS_ENC = "hv_wallet_secret_v2"; // AES-GCM encrypted { iv, ct } (base64)
const IV_BYTES = 12;

function rpc(cfg) {
  const ns = StellarSdk.SorobanRpc || StellarSdk.rpc;
  return new ns.Server(cfg.rpcUrl, { allowHttp: cfg.rpcUrl.startsWith("http://") });
}

function toBase64(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromBase64(value) {
  const bin = atob(value);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Persist the wallet secret encrypted at rest. The AES-GCM key is a non-extractable
// CryptoKey (see keyStore.js) — never a plaintext string in localStorage — so a
// script that reads `hv_wallet_secret_v2` cannot recover a usable Stellar secret.
async function persistSecret(secret) {
  if (typeof localStorage === "undefined") return;
  const key = await getWrappingKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(secret)),
  );
  localStorage.setItem(LS_ENC, JSON.stringify({ iv: toBase64(iv), ct: toBase64(ct) }));
  localStorage.removeItem(LS_KEY); // never leave the legacy plaintext secret behind
}

async function loadKeypair() {
  if (typeof localStorage === "undefined") return null;
  const blob = localStorage.getItem(LS_ENC);
  if (blob) {
    try {
      const { iv, ct } = JSON.parse(blob);
      const key = await getWrappingKey();
      const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: fromBase64(iv) },
        key,
        fromBase64(ct),
      );
      return StellarSdk.Keypair.fromSecret(new TextDecoder().decode(plain));
    } catch {
      return null;
    }
  }
  // One-time migration from the legacy plaintext entry.
  const legacy = localStorage.getItem(LS_KEY);
  if (legacy) {
    await persistSecret(legacy);
    return StellarSdk.Keypair.fromSecret(legacy);
  }
  return null;
}

// Create (or restore) the in-browser wallet and return its public key.
// onStatus is called with human-readable progress so the UI can show the handshake.
export async function connectWallet(_cfg, onStatus) {
  const existing = await loadKeypair();
  if (existing) {
    onStatus?.("Restoring your wallet…");
    await new Promise((r) => setTimeout(r, 400));
    return existing.publicKey();
  }
  onStatus?.("Generating your keys…");
  const kp = StellarSdk.Keypair.random();
  await new Promise((r) => setTimeout(r, 400));
  onStatus?.("Funding your wallet on testnet…");
  const res = await fetch(`/api/fund?addr=${kp.publicKey()}`);
  if (!res.ok) throw new Error("could not fund the wallet on testnet");
  await persistSecret(kp.secret());
  return kp.publicKey();
}

export async function submitAttest(cfg, _address, proofHex, publicHex) {
  const kp = await loadKeypair();
  if (!kp) throw new Error("connect a wallet first");
  const server = rpc(cfg);
  const account = await server.getAccount(kp.publicKey());
  const contract = new StellarSdk.Contract(cfg.attestContractId);
  const op = contract.call(
    "attest",
    StellarSdk.xdr.ScVal.scvBytes(hexToBytes(proofHex)),
    StellarSdk.xdr.ScVal.scvBytes(hexToBytes(publicHex)),
  );
  let tx = new StellarSdk.TransactionBuilder(account, {
    fee: "1000000",
    networkPassphrase: cfg.networkPassphrase,
  })
    .addOperation(op)
    .setTimeout(60)
    .build();

  tx = await server.prepareTransaction(tx);
  tx.sign(kp);
  const sent = await server.sendTransaction(tx);

  let got = await server.getTransaction(sent.hash);
  const start = Date.now();
  while (got.status === "NOT_FOUND" && Date.now() - start < 30000) {
    await new Promise((r) => setTimeout(r, 1500));
    got = await server.getTransaction(sent.hash);
  }
  if (got.status !== "SUCCESS") {
    throw new Error("attest did not succeed: " + got.status);
  }
  return { count: StellarSdk.scValToNative(got.returnValue), hash: sent.hash };
}

export async function getVouches(cfg, _sourceAddress, contentHash32) {
  const server = rpc(cfg);
  const account = await server.getAccount(cfg.readSourcePublicKey);
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
  const ns = StellarSdk.SorobanRpc || StellarSdk.rpc;
  if (ns.Api?.isSimulationError?.(sim) || sim.error) {
    throw new Error(typeof sim.error === "string" ? sim.error : "simulation error");
  }
  return StellarSdk.scValToNative(sim.result.retval);
}
