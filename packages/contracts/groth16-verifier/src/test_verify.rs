extern crate std;
use crate::{Groth16VerifierContract, Groth16VerifierContractClient, VerifierError};
use soroban_sdk::{Bytes, Env};

const G1: usize = 96;
const G2: usize = 192;

fn setup() -> (Env, Groth16VerifierContractClient<'static>) {
    let env = Env::default();
    let id = env.register(Groth16VerifierContract, ());
    let c = Groth16VerifierContractClient::new(&env, &id);
    (env, c)
}

fn zeros(env: &Env, n: usize) -> Bytes {
    Bytes::from_slice(env, &std::vec![0u8; n])
}

fn vk_bytes(env: &Env, ic_len: u32) -> Bytes {
    let mut v = std::vec![0u8; G1 + 3 * G2];
    v.extend_from_slice(&ic_len.to_be_bytes());
    v.extend(std::iter::repeat(0u8).take(G1 * ic_len as usize));
    Bytes::from_slice(env, &v)
}

#[test]
fn verify_before_set_vk_returns_not_set() {
    let (env, c) = setup();
    let sig = Bytes::from_array(&env, &0u32.to_be_bytes());
    assert_eq!(c.try_verify(&zeros(&env, 2 * G1 + G2), &sig), Err(Ok(VerifierError::VerificationKeyNotSet)));
}

#[test]
fn set_vk_rejects_malformed_key() {
    let (env, c) = setup();
    let good = vk_bytes(&env, 2);
    assert_eq!(c.try_set_vk(&good.slice(0..good.len() - 1)), Err(Ok(VerifierError::MalformedVerifyingKey)));
    assert_eq!(c.try_set_vk(&zeros(&env, 0)), Err(Ok(VerifierError::MalformedVerifyingKey)));
}

#[test]
fn public_signals_length_prefix_larger_than_payload() {
    let (env, c) = setup();
    c.set_vk(&vk_bytes(&env, 2));
    // claims 5 signals but carries one
    let mut sig = Bytes::from_array(&env, &5u32.to_be_bytes());
    sig.append(&zeros(&env, 32));
    assert_eq!(c.try_verify(&zeros(&env, 2 * G1 + G2), &sig), Err(Ok(VerifierError::MalformedPublicSignals)));
}
