#![no_std]

use groth16_core::{parse_signals, verify_proof, Groth16Error, Proof, VerificationKey};
use soroban_sdk::{contract, contracterror, contractimpl, symbol_short, Bytes, Env, Symbol};

const VK_KEY: Symbol = symbol_short!("VK");

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum VerifierError {
    MalformedVerifyingKey = 1,
    VerificationKeyNotSet = 2,
    MalformedProof = 3,
    MalformedPublicSignals = 4,
}

/// Map the shared verifier failure onto this contract's error enum.
fn map_groth16_error(err: Groth16Error) -> VerifierError {
    match err {
        Groth16Error::MalformedVerifyingKey => VerifierError::MalformedVerifyingKey,
        Groth16Error::MalformedProof => VerifierError::MalformedProof,
        Groth16Error::MalformedPublicSignals => VerifierError::MalformedPublicSignals,
    }
}

#[contract]
pub struct Groth16VerifierContract;

#[contractimpl]
impl Groth16VerifierContract {
    pub fn set_vk(env: Env, vk_bytes: Bytes) -> Result<(), VerifierError> {
        // Parse once here so malformed keys fail fast and cannot be stored.
        let _vk = VerificationKey::from_bytes(&env, &vk_bytes).map_err(map_groth16_error)?;
        env.storage().instance().set(&VK_KEY, &vk_bytes);
        Ok(())
    }

    pub fn verify(
        env: Env,
        proof_bytes: Bytes,
        pub_signals_bytes: Bytes,
    ) -> Result<bool, VerifierError> {
        let vk_bytes: Bytes = env
            .storage()
            .instance()
            .get(&VK_KEY)
            .ok_or(VerifierError::VerificationKeyNotSet)?;

        let vk = VerificationKey::from_bytes(&env, &vk_bytes).map_err(map_groth16_error)?;
        let proof = Proof::from_bytes(&env, &proof_bytes).map_err(map_groth16_error)?;
        let signals = parse_signals(&env, &pub_signals_bytes).map_err(map_groth16_error)?;

        verify_proof(&env, vk, proof, signals).map_err(map_groth16_error)
    }
}
