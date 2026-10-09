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

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype,
    crypto::bls12_381::{Fr, G1Affine, G2Affine, G1_SERIALIZED_SIZE, G2_SERIALIZED_SIZE},
    symbol_short, vec, Address, Bytes, BytesN, Env, Symbol, Vec, U256,
};

const VK_KEY: Symbol = symbol_short!("VK");
const ROOTS: Symbol = symbol_short!("ROOTS");

// Persistent entries (the per-content nullifier guard and the vouch count) are
// bumped to roughly a month of ledgers so they outlive the attestation window.
// Without this the default (much shorter) entry TTL would let a used nullifier
// be replayed and reset `get_vouches` for content that was genuinely vouched.
const PERSISTENT_TTL_THRESHOLD: u32 = 100_000;
const PERSISTENT_TTL_EXTEND_TO: u32 = 535_680;
const ADMIN_KEY: Symbol = symbol_short!("ADMIN");

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
    NotInitialized = 9,
    AlreadyInitialized = 10,
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

/// Require authorisation from the stored admin before a privileged write.
fn require_admin(env: &Env) -> Result<(), Error> {
    let admin: Address = env
        .storage()
        .instance()
        .get(&ADMIN_KEY)
        .ok_or(Error::NotInitialized)?;
    admin.require_auth();
    Ok(())
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
        Ok(Self { alpha, beta, gamma, delta, ic })
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

fn verify_proof(env: &Env, vk: VerificationKey, proof: Proof, pub_signals: Vec<Fr>) -> Result<bool, Error> {
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
    /// One-time initialisation; records the registry issuer (admin) address.
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if env.storage().instance().has(&ADMIN_KEY) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&ADMIN_KEY, &admin);
        Ok(())
    }

    /// Store the circuit verifying key (admin-only; parsed once so a malformed key cannot be stored).
    pub fn set_vk(env: Env, vk_bytes: Bytes) -> Result<(), Error> {
        require_admin(&env)?;
        let _vk = VerificationKey::from_bytes(&env, &vk_bytes)?;
        env.storage().instance().set(&VK_KEY, &vk_bytes);
        Ok(())
    }

    /// Registry issuer publishes a valid Merkle root (idempotent).
    /// Registry issuer publishes a valid Merkle root (admin-only, idempotent).
    pub fn set_root(env: Env, root: BytesN<32>) {
        require_admin(&env).unwrap();
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
        env.storage()
            .persistent()
            .extend_ttl(&nk, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND_TO);

        let vkey = DataKey::Vouches(content);
        let count: u32 = env.storage().persistent().get(&vkey).unwrap_or(0) + 1;
        env.storage().persistent().set(&vkey, &count);
        env.storage()
            .persistent()
            .extend_ttl(&vkey, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND_TO);
        Ok(count)
    }

    pub fn get_vouches(env: Env, content_hash: BytesN<32>) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::Vouches(content_hash))
            .unwrap_or(0)
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::crypto::bls12_381::{G1Affine, G2Affine};
    use soroban_sdk::testutils::storage::Persistent as _;

    const VK_LEN: usize = G1_SERIALIZED_SIZE * 5 + G2_SERIALIZED_SIZE * 3 + 4;
    const PROOF_LEN: usize = G1_SERIALIZED_SIZE * 2 + G2_SERIALIZED_SIZE;
    const SIGNALS_LEN: usize = 4 + 32 * 3;

    fn put(buf: &mut [u8], pos: &mut usize, bytes: &[u8]) {
        buf[*pos..*pos + bytes.len()].copy_from_slice(bytes);
        *pos += bytes.len();
    }

    fn identity_g1() -> [u8; G1_SERIALIZED_SIZE] {
        let mut b = [0u8; G1_SERIALIZED_SIZE];
        b[0] = 0x40; // uncompressed point-at-infinity encoding
        b
    }

    fn identity_g2() -> [u8; G2_SERIALIZED_SIZE] {
        let mut b = [0u8; G2_SERIALIZED_SIZE];
        b[0] = 0x40;
        b
    }

    /// Build a verifying key and proof whose pairing check succeeds without a
    /// real trusted setup: the only non-identity pairs are `e(P, Q)` and
    /// `e(-P, Q)`, whose product is the identity. Every public signal is fed
    /// against an identity `ic` entry, so the signal values stay unconstrained —
    /// enough to exercise the storage/TTL path under test.
    fn vk_and_proof(env: &Env) -> (Bytes, Bytes) {
        let bls = env.crypto().bls12_381();
        let msg = Bytes::from_slice(env, b"humanvouch-attest-test");
        let dst = Bytes::from_slice(env, b"HV_ATTEST_TEST_DST");
        let p: G1Affine = bls.hash_to_g1(&msg, &dst);
        let q: G2Affine = bls.hash_to_g2(&msg, &dst);
        let neg_p = -p;

        let mut vk = [0u8; VK_LEN];
        let mut pos = 0usize;
        put(&mut vk, &mut pos, &identity_g1()); // alpha
        put(&mut vk, &mut pos, &identity_g2()); // beta
        put(&mut vk, &mut pos, &q.to_array()); // gamma
        put(&mut vk, &mut pos, &identity_g2()); // delta
        put(&mut vk, &mut pos, &4u32.to_be_bytes()); // ic length
        put(&mut vk, &mut pos, &neg_p.to_array()); // ic[0]
        put(&mut vk, &mut pos, &identity_g1()); // ic[1]
        put(&mut vk, &mut pos, &identity_g1()); // ic[2]
        put(&mut vk, &mut pos, &identity_g1()); // ic[3]

        let mut proof = [0u8; PROOF_LEN];
        let mut pos = 0usize;
        put(&mut proof, &mut pos, &neg_p.to_array()); // a -> neg_a = P
        put(&mut proof, &mut pos, &q.to_array()); // b
        put(&mut proof, &mut pos, &identity_g1()); // c

        (Bytes::from_array(env, &vk), Bytes::from_array(env, &proof))
    }

    fn signals(env: &Env, root: &[u8; 32], nullifier: &[u8; 32], content: &[u8; 32]) -> Bytes {
        let mut buf = [0u8; SIGNALS_LEN];
        let mut pos = 0usize;
        put(&mut buf, &mut pos, &3u32.to_be_bytes());
        put(&mut buf, &mut pos, root);
        put(&mut buf, &mut pos, nullifier);
        put(&mut buf, &mut pos, content);
        Bytes::from_array(env, &buf)
    }

    #[test]
    fn attest_extends_persistent_ttl() {
        let env = Env::default();
        let contract_id = env.register(AttestContract, ());
        let client = AttestContractClient::new(&env, &contract_id);

        let (vk, proof) = vk_and_proof(&env);
        client.set_vk(&vk);
        let root = [7u8; 32];
        client.set_root(&BytesN::from_array(&env, &root));

        let nullifier = [1u8; 32];
        let content = [2u8; 32];
        assert_eq!(
            client.attest(&proof, &signals(&env, &root, &nullifier, &content)),
            1
        );

        env.as_contract(&contract_id, || {
            // A scratch entry written now carries the ledger's default persistent TTL.
            let scratch = DataKey::Vouches(BytesN::from_array(&env, &[0u8; 32]));
            env.storage().persistent().set(&scratch, &0u32);
            let default_ttl = env.storage().persistent().get_ttl(&scratch);

            let nk = DataKey::Nullifier(
                BytesN::from_array(&env, &content),
                BytesN::from_array(&env, &nullifier),
            );
            let vkey = DataKey::Vouches(BytesN::from_array(&env, &content));

            assert!(env.storage().persistent().get_ttl(&nk) > default_ttl);
            assert!(env.storage().persistent().get_ttl(&vkey) > default_ttl);
        });
    }
    use soroban_sdk::testutils::Address as _;

    fn setup(env: &Env) -> (AttestContractClient<'_>, Address) {
        env.mock_all_auths();
        let contract_id = env.register(AttestContract, ());
        let client = AttestContractClient::new(env, &contract_id);
        let admin = Address::generate(env);
        client.initialize(&admin);
        (client, admin)
    }

    #[test]
    fn set_root_from_admin_succeeds() {
        let env = Env::default();
        let (client, _admin) = setup(&env);
        let root = BytesN::from_array(&env, &[7u8; 32]);
        client.set_root(&root);
        assert!(client.is_valid_root(&root));
    }

    #[test]
    fn initialize_is_one_time() {
        let env = Env::default();
        let (client, _admin) = setup(&env);
        let other = Address::generate(&env);
        let res = client.try_initialize(&other);
        assert!(matches!(res, Err(Ok(Error::AlreadyInitialized))));
    }

    #[test]
    #[should_panic]
    fn set_root_without_admin_authorisation_panics() {
        let env = Env::default();
        let (client, _admin) = setup(&env);
        // Disable auth mocking so require_auth must see a real (missing) authorisation.
        env.set_auths(&[]);
        client.set_root(&BytesN::from_array(&env, &[7u8; 32]));
    }

    #[test]
    #[should_panic]
    fn set_vk_without_admin_authorisation_panics() {
        let env = Env::default();
        let (client, _admin) = setup(&env);
        env.set_auths(&[]);
        client.set_vk(&Bytes::from_slice(&env, &[0u8; 4]));
    }
}
