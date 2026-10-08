extern crate std;
use crate::{record_vouch, AttestContract, DataKey, Error, VOUCH_TTL_LEDGERS};
use soroban_sdk::{testutils::storage::Persistent as _, testutils::Ledger as _, BytesN, Env};

fn h(env: &Env, tag: u8) -> BytesN<32> {
    let mut a = [0u8; 32];
    a[31] = tag;
    BytesN::from_array(env, &a)
}

#[test]
fn successful_vouch_extends_both_persistent_ttls() {
    let env = Env::default();
    let id = env.register(AttestContract, ());
    let (content, nullifier) = (h(&env, 3), h(&env, 2));
    let default_ttl = env.ledger().get().min_persistent_entry_ttl;
    env.as_contract(&id, || {
        assert_eq!(record_vouch(&env, content.clone(), nullifier.clone()), Ok(1));
        let store = env.storage().persistent();
        for ttl in [
            store.get_ttl(&DataKey::Nullifier(content.clone(), nullifier.clone())),
            store.get_ttl(&DataKey::Vouches(content.clone())),
        ] {
            assert!(ttl > default_ttl, "ttl {ttl} must exceed the default {default_ttl}");
            assert!(ttl >= VOUCH_TTL_LEDGERS.min(env.storage().max_ttl()));
        }
    });
}

#[test]
fn replayed_nullifier_is_still_rejected() {
    let env = Env::default();
    let id = env.register(AttestContract, ());
    env.as_contract(&id, || {
        assert_eq!(record_vouch(&env, h(&env, 3), h(&env, 2)), Ok(1));
        assert_eq!(record_vouch(&env, h(&env, 3), h(&env, 2)), Err(Error::AlreadyVouched));
        assert_eq!(record_vouch(&env, h(&env, 3), h(&env, 4)), Ok(2));
    });
}
