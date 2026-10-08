#![no_std]
//! Shared BLS12-381 Groth16 verifier internals.
//!
//! Both `humanvouch-attest` and `soroban-groth16-verifier` parse the same
//! serialized verifying key, proof and public signals and run the same pairing
//! check. Keeping that code here means each fix is applied once instead of once
//! per contract.
//!
//! Byte layout (produced by `circom-to-soroban-hex`):
//!   VerificationKey = alpha(G1) || beta(G2) || gamma(G2) || delta(G2)
//!                     || ic_len(u32 BE) || ic[G1]...
//!   Proof           = a(G1) || b(G2) || c(G1)
//!   PublicSignals   = len(u32 BE) || Fr[32]...

use soroban_sdk::{
    crypto::bls12_381::{Fr, G1Affine, G2Affine, G1_SERIALIZED_SIZE, G2_SERIALIZED_SIZE},
    vec, Bytes, BytesN, Env, Vec, U256,
};

/// Failures shared by the parsing and pairing routines. The contract crates map
/// these onto their own public error enums.
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Groth16Error {
    MalformedVerifyingKey = 1,
    MalformedProof = 2,
    MalformedPublicSignals = 3,
}

#[derive(Clone)]
pub struct VerificationKey {
    pub alpha: G1Affine,
    pub beta: G2Affine,
    pub gamma: G2Affine,
    pub delta: G2Affine,
    pub ic: Vec<G1Affine>,
}

#[derive(Clone)]
pub struct Proof {
    pub a: G1Affine,
    pub b: G2Affine,
    pub c: G1Affine,
}

fn take<const N: usize>(
    bytes: &Bytes,
    pos: &mut u32,
    err: Groth16Error,
) -> Result<[u8; N], Groth16Error> {
    let end = pos.checked_add(N as u32).ok_or(err)?;
    if end > bytes.len() {
        return Err(err);
    }
    let mut arr = [0u8; N];
    bytes.slice(*pos..end).copy_into_slice(&mut arr);
    *pos = end;
    Ok(arr)
}

/// Copy the 32-byte window starting at `pos` out of `bytes` without consuming it.
pub fn slice32(
    env: &Env,
    bytes: &Bytes,
    pos: u32,
    err: Groth16Error,
) -> Result<BytesN<32>, Groth16Error> {
    let mut at = pos;
    Ok(BytesN::from_array(env, &take::<32>(bytes, &mut at, err)?))
}

impl VerificationKey {
    pub fn from_bytes(env: &Env, bytes: &Bytes) -> Result<Self, Groth16Error> {
        let mut pos = 0u32;
        let alpha = G1Affine::from_array(
            env,
            &take::<G1_SERIALIZED_SIZE>(bytes, &mut pos, Groth16Error::MalformedVerifyingKey)?,
        );
        let beta = G2Affine::from_array(
            env,
            &take::<G2_SERIALIZED_SIZE>(bytes, &mut pos, Groth16Error::MalformedVerifyingKey)?,
        );
        let gamma = G2Affine::from_array(
            env,
            &take::<G2_SERIALIZED_SIZE>(bytes, &mut pos, Groth16Error::MalformedVerifyingKey)?,
        );
        let delta = G2Affine::from_array(
            env,
            &take::<G2_SERIALIZED_SIZE>(bytes, &mut pos, Groth16Error::MalformedVerifyingKey)?,
        );
        let ic_len =
            u32::from_be_bytes(take::<4>(bytes, &mut pos, Groth16Error::MalformedVerifyingKey)?);
        let mut ic = Vec::new(env);
        for _ in 0..ic_len {
            ic.push_back(G1Affine::from_array(
                env,
                &take::<G1_SERIALIZED_SIZE>(bytes, &mut pos, Groth16Error::MalformedVerifyingKey)?,
            ));
        }
        if pos != bytes.len() || ic_len == 0 {
            return Err(Groth16Error::MalformedVerifyingKey);
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
    pub fn from_bytes(env: &Env, bytes: &Bytes) -> Result<Self, Groth16Error> {
        let mut pos = 0u32;
        let a = G1Affine::from_array(
            env,
            &take::<G1_SERIALIZED_SIZE>(bytes, &mut pos, Groth16Error::MalformedProof)?,
        );
        let b = G2Affine::from_array(
            env,
            &take::<G2_SERIALIZED_SIZE>(bytes, &mut pos, Groth16Error::MalformedProof)?,
        );
        let c = G1Affine::from_array(
            env,
            &take::<G1_SERIALIZED_SIZE>(bytes, &mut pos, Groth16Error::MalformedProof)?,
        );
        if pos != bytes.len() {
            return Err(Groth16Error::MalformedProof);
        }
        Ok(Self { a, b, c })
    }
}

/// Parse the length-prefixed public signals into `Fr` elements.
pub fn parse_signals(env: &Env, bytes: &Bytes) -> Result<Vec<Fr>, Groth16Error> {
    let mut pos = 0u32;
    let len = u32::from_be_bytes(take::<4>(
        bytes,
        &mut pos,
        Groth16Error::MalformedPublicSignals,
    )?);
    let mut out = Vec::new(env);
    for _ in 0..len {
        let arr = take::<32>(bytes, &mut pos, Groth16Error::MalformedPublicSignals)?;
        let u = U256::from_be_bytes(env, &Bytes::from_array(env, &arr));
        out.push_back(Fr::from_u256(u));
    }
    if pos != bytes.len() {
        return Err(Groth16Error::MalformedPublicSignals);
    }
    Ok(out)
}

/// The Groth16 pairing check:
/// `e(-A, B) · e(alpha, beta) · e(vk_x, gamma) · e(C, delta) == 1`.
pub fn verify_proof(
    env: &Env,
    vk: VerificationKey,
    proof: Proof,
    pub_signals: Vec<Fr>,
) -> Result<bool, Groth16Error> {
    if pub_signals.len() + 1 != vk.ic.len() {
        return Err(Groth16Error::MalformedVerifyingKey);
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
