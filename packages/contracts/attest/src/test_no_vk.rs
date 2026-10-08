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
fn attest_before_set_vk_returns_verification_key_not_set() {
    let (env, c) = setup();
    let (root, nul, content) = (h(&env, 1), h(&env, 2), h(&env, 3));
    c.set_root(&root);
    let res = c.try_attest(&zeros(&env, 2 * G1 + G2), &signals(&env, &[&root, &nul, &content]));
    assert_eq!(res, Err(Ok(Error::VerificationKeyNotSet)));
    assert_eq!(c.get_vouches(&content), 0);
}
