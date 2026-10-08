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
fn unregistered_root_rejected_even_with_garbage_proof() {
    let (env, c) = setup();
    c.set_vk(&vk_bytes(&env, 4));
    c.set_root(&h(&env, 1)); // a different root is registered
    let (fake_root, nul, content) = (h(&env, 9), h(&env, 2), h(&env, 3));
    let sig = signals(&env, &[&fake_root, &nul, &content]);
    // well-sized proof blob
    assert_eq!(c.try_attest(&zeros(&env, 2 * G1 + G2), &sig), Err(Ok(Error::InvalidRoot)));
    // not even a parseable proof: the root check must still run first
    assert_eq!(c.try_attest(&zeros(&env, 3), &sig), Err(Ok(Error::InvalidRoot)));
    assert_eq!(c.get_vouches(&content), 0);
}

#[test]
fn unregistered_root_rejected_before_vk_lookup() {
    let (env, c) = setup();
    let sig = signals(&env, &[&h(&env, 9), &h(&env, 2), &h(&env, 3)]);
    assert_eq!(c.try_attest(&zeros(&env, 0), &sig), Err(Ok(Error::InvalidRoot)));
}
