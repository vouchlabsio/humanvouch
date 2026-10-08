#![no_std]
//! HumanVouch AttestContract.
//!
//! Wraps a BLS12-381 Groth16 verifier with the registry + accounting that turns a
//! membership proof into an on-chain attestation:
//!   - `set_vk`   : store the circuit verifying key (once).
//!   - `set_root` : the registry issuer publishes a valid Merkle root.
//!   - `attest`   : verify a membership proof, require its root be valid
//!     (MANDATORY — Groth16 validity alone is NOT membership), reject nullifier
//!     replay per content, and record one unique vouch for the content hash.
//!   - `get_vouches` / `is_valid_root` : read-only views.
//!
//! Public signal order (from the circuit): [0]=root, [1]=nullifierHash, [2]=contentHash.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype,
    crypto::bls12_381::{Fr, G1Affine, G2Affine, G1_SERIALIZED_SIZE, G2_SERIALIZED_SIZE},
    symbol_short, vec, Bytes, BytesN, Env, Symbol, Vec, U256,
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

#[derive(Clone)]
struct VerificationKey {
    alpha: G1Affine,
    beta: G2Affine,
    gamma: G2Affine,
    delta: G2Affine,
    ic: Vec<G1Affine>,
}

#[derive(Clone)]
struct Proof {
    a: G1Affine,
    b: G2Affine,
    c: G1Affine,
}

fn take<const N: usize>(bytes: &Bytes, pos: &mut u32, err: Error) -> Result<[u8; N], Error> {
    let end = pos.checked_add(N as u32).ok_or(err)?;
    if end > bytes.len() {
        return Err(err);
    }
    let mut arr = [0u8; N];
    bytes.slice(*pos..end).copy_into_slice(&mut arr);
    *pos = end;
    Ok(arr)
}

fn slice32(env: &Env, bytes: &Bytes, pos: u32, err: Error) -> Result<BytesN<32>, Error> {
    let end = pos.checked_add(32).ok_or(err)?;
    if end > bytes.len() {
        return Err(err);
    }
    let mut arr = [0u8; 32];
    bytes.slice(pos..end).copy_into_slice(&mut arr);
    Ok(BytesN::from_array(env, &arr))
}

impl VerificationKey {
    fn from_bytes(env: &Env, bytes: &Bytes) -> Result<Self, Error> {
        let mut pos = 0u32;
        let alpha = G1Affine::from_array(
            env,
            &take::<G1_SERIALIZED_SIZE>(bytes, &mut pos, Error::MalformedVerifyingKey)?,
        );
        let beta = G2Affine::from_array(
            env,
            &take::<G2_SERIALIZED_SIZE>(bytes, &mut pos, Error::MalformedVerifyingKey)?,
        );
        let gamma = G2Affine::from_array(
            env,
            &take::<G2_SERIALIZED_SIZE>(bytes, &mut pos, Error::MalformedVerifyingKey)?,
        );
        let delta = G2Affine::from_array(
            env,
            &take::<G2_SERIALIZED_SIZE>(bytes, &mut pos, Error::MalformedVerifyingKey)?,
        );
        let ic_len = u32::from_be_bytes(take::<4>(bytes, &mut pos, Error::MalformedVerifyingKey)?);
        let mut ic = Vec::new(env);
        for _ in 0..ic_len {
            ic.push_back(G1Affine::from_array(
                env,
                &take::<G1_SERIALIZED_SIZE>(bytes, &mut pos, Error::MalformedVerifyingKey)?,
            ));
        }
        if pos != bytes.len() || ic_len == 0 {
            return Err(Error::MalformedVerifyingKey);
        }
        Ok(Self {
            alpha,
            beta,
            gamma,
            delta,
            ic,
        })
    }
}

impl Proof {
    fn from_bytes(env: &Env, bytes: &Bytes) -> Result<Self, Error> {
        let mut pos = 0u32;
        let a = G1Affine::from_array(
            env,
            &take::<G1_SERIALIZED_SIZE>(bytes, &mut pos, Error::MalformedProof)?,
        );
        let b = G2Affine::from_array(
            env,
            &take::<G2_SERIALIZED_SIZE>(bytes, &mut pos, Error::MalformedProof)?,
        );
        let c = G1Affine::from_array(
            env,
            &take::<G1_SERIALIZED_SIZE>(bytes, &mut pos, Error::MalformedProof)?,
        );
        if pos != bytes.len() {
            return Err(Error::MalformedProof);
        }
        Ok(Self { a, b, c })
    }
}

// Parse the length-prefixed public signals into Fr elements (for the pairing check).
fn parse_signals(env: &Env, bytes: &Bytes) -> Result<Vec<Fr>, Error> {
    let mut pos = 0u32;
    let len = u32::from_be_bytes(take::<4>(bytes, &mut pos, Error::MalformedPublicSignals)?);
    let mut out = Vec::new(env);
    for _ in 0..len {
        let arr = take::<32>(bytes, &mut pos, Error::MalformedPublicSignals)?;
        let u = U256::from_be_bytes(env, &Bytes::from_array(env, &arr));
        out.push_back(Fr::from_u256(u));
    }
    if pos != bytes.len() {
        return Err(Error::MalformedPublicSignals);
    }
    Ok(out)
}

fn verify_proof(
    env: &Env,
    vk: VerificationKey,
    proof: Proof,
    pub_signals: Vec<Fr>,
) -> Result<bool, Error> {
    if pub_signals.len() + 1 != vk.ic.len() {
        return Err(Error::MalformedVerifyingKey);
    }
    let bls = env.crypto().bls12_381();
    let mut vk_x = vk.ic.get(0).unwrap();
    for (s, v) in pub_signals.iter().zip(vk.ic.iter().skip(1)) {
        let prod = bls.g1_mul(&v, &s);
        vk_x = bls.g1_add(&vk_x, &prod);
    }
    let neg_a = -proof.a;
    let vp1 = vec![env, neg_a, vk.alpha, vk_x, proof.c];
    let vp2 = vec![env, proof.b, vk.beta, vk.gamma, vk.delta];
    Ok(bls.pairing_check(vp1, vp2))
}

#[contract]
pub struct AttestContract;

#[contractimpl]
impl AttestContract {
    /// Store the circuit verifying key (parsed once so a malformed key cannot be stored).
    pub fn set_vk(env: Env, vk_bytes: Bytes) -> Result<(), Error> {
        let _vk = VerificationKey::from_bytes(&env, &vk_bytes)?;
        env.storage().instance().set(&VK_KEY, &vk_bytes);
        Ok(())
    }

    /// Registry issuer publishes a valid Merkle root (idempotent).
    pub fn set_root(env: Env, root: BytesN<32>) {
        let mut roots: Vec<BytesN<32>> = env
            .storage()
            .instance()
            .get(&ROOTS)
            .unwrap_or(Vec::new(&env));
        if !roots.contains(&root) {
            roots.push_back(root);
            env.storage().instance().set(&ROOTS, &roots);
        }
    }

    pub fn is_valid_root(env: Env, root: BytesN<32>) -> bool {
        let roots: Vec<BytesN<32>> = env
            .storage()
            .instance()
            .get(&ROOTS)
            .unwrap_or(Vec::new(&env));
        roots.contains(&root)
    }

    /// Verify a membership proof and record one unique human vouch for the content.
    /// Returns the new unique-vouch count for that content hash.
    pub fn attest(env: Env, proof_bytes: Bytes, pub_signals_bytes: Bytes) -> Result<u32, Error> {
        // public signals: [0]=root, [1]=nullifierHash, [2]=contentHash (length-prefixed)
        let root = slice32(&env, &pub_signals_bytes, 4, Error::MalformedPublicSignals)?;
        let nullifier = slice32(&env, &pub_signals_bytes, 36, Error::MalformedPublicSignals)?;
        let content = slice32(&env, &pub_signals_bytes, 68, Error::MalformedPublicSignals)?;

        let signals = parse_signals(&env, &pub_signals_bytes)?;
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
        let vk = VerificationKey::from_bytes(&env, &vk_bytes)?;
        let proof = Proof::from_bytes(&env, &proof_bytes)?;
        if !verify_proof(&env, vk, proof, signals)? {
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
