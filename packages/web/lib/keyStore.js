// Wrapping key for the built-in testnet wallet secret.
//
// The AES-GCM key is generated once and stored as a NON-EXTRACTABLE CryptoKey in
// IndexedDB, so raw key material is never written to localStorage and cannot be
// exported by script. Environments without IndexedDB (SSR / unit tests, private
// browsing) fall back to a process-memory key so the encrypt/decrypt round trip
// still works within the session.
const DB_NAME = "humanvouch";
const STORE_NAME = "wallet-keys";
const KEY_ID = "wrap";

let memoryKey = null;

function hasWebCrypto() {
  return typeof crypto !== "undefined" && !!crypto.subtle;
}

function generateKey() {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getMemoryKey() {
  if (!memoryKey) memoryKey = await generateKey();
  return memoryKey;
}

export async function getWrappingKey() {
  if (!hasWebCrypto()) {
    throw new Error("Web Crypto is unavailable; cannot persist the wallet securely");
  }
  if (typeof indexedDB === "undefined") {
    return getMemoryKey();
  }
  try {
    const db = await openDb();
    try {
      const store = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME);
      const existing = await idbRequest(store.get(KEY_ID));
      if (existing) return existing;
      const key = await generateKey();
      await idbRequest(
        db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(key, KEY_ID),
      );
      return key;
    } finally {
      db.close();
    }
  } catch {
    // IndexedDB unavailable (private mode, quota) — keep the secret in-session only.
    return getMemoryKey();
  }
}
