extern crate std;
use crate::{AttestContract, AttestContractClient, Error};
use soroban_sdk::{Bytes, BytesN, Env};

const G1: usize = 96;
const G2: usize = 192;

fn setup() -> (Env, AttestContractClient<'static>) {
    let env = Env::default();
    let id = env.register(AttestContract, ());
    let client = AttestContractClient::new(&env, &id);
    (env, client)
}

/// 32-byte value well below the BLS12-381 scalar field order.
fn h(env: &Env, tag: u8) -> BytesN<32> {
    let mut a = [0u8; 32];
    a[31] = tag;
    BytesN::from_array(env, &a)
}

/// Length-prefixed public signals [root, nullifier, content] as attest expects.
fn signals(env: &Env, vals: &[&BytesN<32>]) -> Bytes {
    let mut b = Bytes::from_array(env, &(vals.len() as u32).to_be_bytes());
    for v in vals {
        b.append(&Bytes::from_array(env, &v.to_array()));
    }
    b
}

/// Structurally valid verifying key (alpha, beta, gamma, delta, ic_len, ic[..]); zero points.
fn vk_bytes(env: &Env, ic_len: u32) -> Bytes {
    let mut v = std::vec![0u8; G1 + 3 * G2];
    v.extend_from_slice(&ic_len.to_be_bytes());
    v.extend(std::iter::repeat(0u8).take(G1 * ic_len as usize));
    Bytes::from_slice(env, &v)
}

fn zeros(env: &Env, n: usize) -> Bytes {
    Bytes::from_slice(env, &std::vec![0u8; n])
}

#[test]
fn set_vk_rejects_truncated_trailing_empty_and_zero_ic() {
    let (env, c) = setup();
    let good = vk_bytes(&env, 4);
    assert_eq!(c.try_set_vk(&good), Ok(Ok(())));
    let n = good.len();
    // one byte short
    assert_eq!(c.try_set_vk(&good.slice(0..n - 1)), Err(Ok(Error::MalformedVerifyingKey)));
    // one byte over
    let mut over = good.clone();
    over.push_back(0);
    assert_eq!(c.try_set_vk(&over), Err(Ok(Error::MalformedVerifyingKey)));
    // empty
    assert_eq!(c.try_set_vk(&zeros(&env, 0)), Err(Ok(Error::MalformedVerifyingKey)));
    // ic_len = 0 is rejected
    assert_eq!(c.try_set_vk(&vk_bytes(&env, 0)), Err(Ok(Error::MalformedVerifyingKey)));
}

fn ready(env: &Env, c: &AttestContractClient) -> Bytes {
    c.set_vk(&vk_bytes(env, 4));
    let root = h(env, 1);
    c.set_root(&root);
    signals(env, &[&root, &h(env, 2), &h(env, 3)])
}

#[test]
fn attest_rejects_malformed_proof() {
    let (env, c) = setup();
    let sig = ready(&env, &c);
    let ok_len = 2 * G1 + G2;
    for n in [0usize, ok_len - 1, ok_len + 1] {
        assert_eq!(c.try_attest(&zeros(&env, n), &sig), Err(Ok(Error::MalformedProof)), "proof len {n}");
    }
}

#[test]
fn attest_rejects_malformed_public_signals() {
    let (env, c) = setup();
    let sig = ready(&env, &c);
    let proof = zeros(&env, 2 * G1 + G2);
    let n = sig.len();
    // empty, one byte short
    assert_eq!(c.try_attest(&proof, &zeros(&env, 0)), Err(Ok(Error::MalformedPublicSignals)));
    assert_eq!(c.try_attest(&proof, &sig.slice(0..n - 1)), Err(Ok(Error::MalformedPublicSignals)));
    // one trailing byte
    let mut over = sig.clone();
    over.push_back(0);
    assert_eq!(c.try_attest(&proof, &over), Err(Ok(Error::MalformedPublicSignals)));
    // length prefix larger than the payload
    let mut big = sig.clone();
    big.set(3, 9);
    assert_eq!(c.try_attest(&proof, &big), Err(Ok(Error::MalformedPublicSignals)));
}

#[test]
fn attest_rejects_wrong_signal_count() {
    let (env, c) = setup();
    ready(&env, &c);
    let (r, x) = (h(&env, 1), h(&env, 5));
    let four = signals(&env, &[&r, &x, &x, &x]);
    assert_eq!(c.try_attest(&zeros(&env, 2 * G1 + G2), &four), Err(Ok(Error::WrongSignalCount)));
}
