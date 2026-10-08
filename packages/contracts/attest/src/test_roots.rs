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
use soroban_sdk::{symbol_short, Vec};

#[test]
fn set_root_is_idempotent() {
    let (env, c) = setup();
    let root = h(&env, 7);
    c.set_root(&root);
    c.set_root(&root);
    let roots: Vec<BytesN<32>> = env.as_contract(&c.address, || {
        env.storage().instance().get(&symbol_short!("ROOTS")).unwrap()
    });
    assert_eq!(roots.len(), 1);
    assert_eq!(roots.get(0).unwrap(), root);
}

#[test]
fn is_valid_root_only_for_published_roots() {
    let (env, c) = setup();
    let (a, b, never) = (h(&env, 1), h(&env, 2), h(&env, 3));
    assert!(!c.is_valid_root(&a));
    c.set_root(&a);
    c.set_root(&b);
    assert!(c.is_valid_root(&a));
    assert!(c.is_valid_root(&b));
    assert!(!c.is_valid_root(&never));
}
