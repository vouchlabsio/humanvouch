extern crate std;
use crate::{AttestContract, AttestContractClient, Error};
use soroban_sdk::{Bytes, BytesN, Env};

fn setup() -> (Env, AttestContractClient<'static>) {
    let env = Env::default();
    let id = env.register(AttestContract, ());
    let client = AttestContractClient::new(&env, &id);
    (env, client)
}

fn h(env: &Env, tag: u8) -> BytesN<32> {
    let mut a = [0u8; 32];
    a[31] = tag;
    BytesN::from_array(env, &a)
}

fn vk_bytes(env: &Env, ic_len: u32) -> Bytes {
    let mut v = std::vec![0u8; 96 + 3 * 192];
    v.extend_from_slice(&ic_len.to_be_bytes());
    v.extend(std::iter::repeat(0u8).take(96 * ic_len as usize));
    Bytes::from_slice(env, &v)
}

fn signals3(env: &Env, root: &BytesN<32>) -> Bytes {
    let mut b = Bytes::from_array(env, &3u32.to_be_bytes());
    for v in [root.clone(), h(env, 2), h(env, 3)] {
        b.append(&Bytes::from_array(env, &v.to_array()));
    }
    b
}

#[test]
fn signal_count_mismatch_with_the_key_is_wrong_signal_count() {
    let (env, c) = setup();
    c.set_vk(&vk_bytes(&env, 2)); // key for 1 public signal, attest always sends 3
    let root = h(&env, 1);
    c.set_root(&root);
    let proof = Bytes::from_slice(&env, &[0u8; 96 + 192 + 96]);
    assert_eq!(c.try_attest(&proof, &signals3(&env, &root)), Err(Ok(Error::WrongSignalCount)));
}

#[test]
fn truncated_key_is_still_malformed_verifying_key() {
    let (env, c) = setup();
    let vk = vk_bytes(&env, 4);
    assert_eq!(c.try_set_vk(&vk.slice(0..vk.len() - 1)), Err(Ok(Error::MalformedVerifyingKey)));
}
