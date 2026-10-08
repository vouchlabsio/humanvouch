#![no_std]
//! HumanVouch AttestContract.
//!
//! Wraps a BLS12-381 Groth16 verifier with the registry + accounting that turns a
//! membership proof into an on-chain attestation:
//!   - `set_vk`   : store the circuit verifying key (once).
//!   - `set_root` : the registry issuer publishes a valid Merkle root.
//!   - `attest`   : verify a membership proof, require its root be valid (MANDATORY —
//!                  Groth16 validity alone is NOT membership), reject nullifier replay
//!                  per content, and record one unique vouch for the content hash.
//!   - `get_vouches` / `is_valid_root` : read-only views.
//!
//! Public signal order (from the circuit): [0]=root, [1]=nullifierHash, [2]=contentHash.

use groth16_core::{parse_signals, verify_proof, Groth16Error, Proof, VerificationKey};
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Bytes, BytesN, Env, Symbol,
    Vec,
};

const VK_KEY: Symbol = symbol_short!("VK");
const ROOTS: Symbol = symbol_short!("ROOTS");

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    MalformedVerifyingKey = 1,
    VerificationKeyNotSet = 2,
    MalformedProof = 3,
    MalformedPublicSignals = 4,
    InvalidRoot = 5,
    InvalidProof = 6,
    AlreadyVouched = 7,
    WrongSignalCount = 8,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Nullifier(BytesN<32>, BytesN<32>), // (contentHash, nullifier) -> used
    Vouches(BytesN<32>),               // contentHash -> count
}

/// Map the shared verifier failure onto this contract's error enum.
fn map_groth16_error(err: Groth16Error) -> Error {
    match err {
        Groth16Error::MalformedVerifyingKey => Error::MalformedVerifyingKey,
        Groth16Error::MalformedProof => Error::MalformedProof,
        Groth16Error::MalformedPublicSignals => Error::MalformedPublicSignals,
    }
}

/// Copy the 32-byte public-signal window starting at `pos`.
fn slice32(env: &Env, bytes: &Bytes, pos: u32) -> Result<BytesN<32>, Error> {
    groth16_core::slice32(env, bytes, pos, Groth16Error::MalformedPublicSignals)
        .map_err(map_groth16_error)
}

#[contract]
pub struct AttestContract;

#[contractimpl]
impl AttestContract {
    /// Store the circuit verifying key (parsed once so a malformed key cannot be stored).
    pub fn set_vk(env: Env, vk_bytes: Bytes) -> Result<(), Error> {
        let _vk = VerificationKey::from_bytes(&env, &vk_bytes).map_err(map_groth16_error)?;
        env.storage().instance().set(&VK_KEY, &vk_bytes);
        Ok(())
    }

    /// Registry issuer publishes a valid Merkle root (idempotent).
    pub fn set_root(env: Env, root: BytesN<32>) {
        let mut roots: Vec<BytesN<32>> =
            env.storage().instance().get(&ROOTS).unwrap_or(Vec::new(&env));
        let mut found = false;
        for r in roots.iter() {
            if r == root {
                found = true;
                break;
            }
        }
        if !found {
            roots.push_back(root);
            env.storage().instance().set(&ROOTS, &roots);
        }
    }

    pub fn is_valid_root(env: Env, root: BytesN<32>) -> bool {
        let roots: Vec<BytesN<32>> =
            env.storage().instance().get(&ROOTS).unwrap_or(Vec::new(&env));
        for r in roots.iter() {
            if r == root {
                return true;
            }
        }
        false
    }

    /// Verify a membership proof and record one unique human vouch for the content.
    /// Returns the new unique-vouch count for that content hash.
    pub fn attest(env: Env, proof_bytes: Bytes, pub_signals_bytes: Bytes) -> Result<u32, Error> {
        // public signals: [0]=root, [1]=nullifierHash, [2]=contentHash (length-prefixed)
        let root = slice32(&env, &pub_signals_bytes, 4)?;
        let nullifier = slice32(&env, &pub_signals_bytes, 36)?;
        let content = slice32(&env, &pub_signals_bytes, 68)?;

        let signals = parse_signals(&env, &pub_signals_bytes).map_err(map_groth16_error)?;
        if signals.len() != 3 {
            return Err(Error::WrongSignalCount);
        }

        // membership is MANDATORY — Groth16 validity alone proves nothing about the registry
        if !Self::is_valid_root(env.clone(), root.clone()) {
            return Err(Error::InvalidRoot);
        }

        let vk_bytes: Bytes = env
            .storage()
            .instance()
            .get(&VK_KEY)
            .ok_or(Error::VerificationKeyNotSet)?;
        let vk = VerificationKey::from_bytes(&env, &vk_bytes).map_err(map_groth16_error)?;
        let proof = Proof::from_bytes(&env, &proof_bytes).map_err(map_groth16_error)?;
        if !verify_proof(&env, vk, proof, signals).map_err(map_groth16_error)? {
            return Err(Error::InvalidProof);
        }

        // one human, one vouch per content
        let nk = DataKey::Nullifier(content.clone(), nullifier);
        if env.storage().persistent().has(&nk) {
            return Err(Error::AlreadyVouched);
        }
        env.storage().persistent().set(&nk, &true);

        let vkey = DataKey::Vouches(content);
        let count: u32 = env.storage().persistent().get(&vkey).unwrap_or(0) + 1;
        env.storage().persistent().set(&vkey, &count);
        Ok(count)
    }

    pub fn get_vouches(env: Env, content_hash: BytesN<32>) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::Vouches(content_hash))
            .unwrap_or(0)
    }
}
