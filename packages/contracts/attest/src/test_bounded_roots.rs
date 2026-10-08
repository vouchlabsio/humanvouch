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
use crate::MAX_ROOTS;
use soroban_sdk::{symbol_short, Vec};

#[test]
fn roots_vector_never_exceeds_the_cap_and_evicts_oldest() {
    let (env, c) = setup();
    let n = MAX_ROOTS + 8;
    for i in 0..n {
        c.set_root(&h(&env, i as u8 + 1));
        let roots: Vec<BytesN<32>> = env.as_contract(&c.address, || env.storage().instance().get(&symbol_short!("ROOTS")).unwrap());
        assert!(roots.len() <= MAX_ROOTS);
    }
    assert!(c.is_valid_root(&h(&env, n as u8)), "newest root must stay valid");
    assert!(c.is_valid_root(&h(&env, (n - MAX_ROOTS + 1) as u8)), "oldest kept root");
    assert!(!c.is_valid_root(&h(&env, 1)), "oldest root is evicted");
}
