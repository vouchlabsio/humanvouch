use ark_bls12_381::{Fq, Fq2, G1Affine, G2Affine};
use ark_serialize::CanonicalSerialize;
use num_bigint::BigUint;
use serde::Deserialize;
use std::{fmt, fs, str::FromStr};

/// Canonical (normalised) name of the only curve this tool may encode.
///
/// Circom writes `"curve": "bls12381"` (see `packages/zk/build/verification_key.json`)
/// while the Soroban addendum and the issue title spell it `bls12-381`. Both name
/// the same curve, so `normalize_curve` collapses them before comparison.
const BLS12_381: &str = "bls12381";

#[derive(Deserialize)]
struct VerificationKeyJson {
    /// Optional + default so a key that omits the field fails with the actionable
    /// curve error below instead of a generic serde "missing field" message.
    #[serde(default)]
    curve: Option<String>,
    vk_alpha_1: [String; 3],
    vk_beta_2: [[String; 2]; 3],
    vk_gamma_2: [[String; 2]; 3],
    vk_delta_2: [[String; 2]; 3],
    #[serde(rename = "IC")]
    ic: Vec<[String; 3]>,
    #[serde(rename = "nPublic")]
    n_public: usize,
}

#[derive(Deserialize)]
struct ProofJson {
    pi_a: [String; 3],
    pi_b: [[String; 2]; 3],
    pi_c: [String; 3],
}

type PublicSignalsJson = Vec<String>;

/// Why a verifying key was refused. Refusing is the whole point of the fix: the
/// tool must never emit a key blob whose points are not on BLS12-381.
#[derive(Debug, PartialEq, Eq)]
enum VkError {
    Read,
    Parse,
    MissingCurve,
    CurveMismatch(String),
    IcLength { expected: usize, got: usize },
    NotNormalized(&'static str),
    BadCoordinate(&'static str),
    NotOnCurve(&'static str),
}

impl fmt::Display for VkError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            VkError::Read => write!(f, "failed to read verifying key json"),
            VkError::Parse => write!(f, "invalid verifying key json"),
            VkError::MissingCurve => write!(
                f,
                "curve mismatch: verifying key does not declare a \"curve\"; expected bls12-381 (circom writes \"bls12381\")"
            ),
            VkError::CurveMismatch(got) => write!(
                f,
                "curve mismatch: expected bls12-381 (circom writes \"bls12381\"), got \"{got}\"; refusing to re-encode a key from another curve"
            ),
            VkError::IcLength { expected, got } => {
                write!(f, "IC length {got} does not match nPublic + 1 ({expected})")
            }
            VkError::NotNormalized(point) => write!(
                f,
                "{point} is not normalised: the projective z coordinate must be 1"
            ),
            VkError::BadCoordinate(point) => {
                write!(f, "{point} has a coordinate that is not a valid field element")
            }
            VkError::NotOnCurve(point) => {
                write!(f, "{point} is not a point on BLS12-381")
            }
        }
    }
}

impl std::error::Error for VkError {}

/// Lowercase, drop separators: `"bls12-381"`, `"BLS12_381"` and `"bls12381"` all
/// collapse to `"bls12381"`.
fn normalize_curve(raw: &str) -> String {
    raw.trim()
        .to_ascii_lowercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect()
}

/// Reject any key that is not on BLS12-381 before a single byte is encoded.
fn ensure_bls12_381(vk: &VerificationKeyJson) -> Result<(), VkError> {
    match vk.curve.as_deref() {
        None => Err(VkError::MissingCurve),
        Some(raw) if normalize_curve(raw) == BLS12_381 => Ok(()),
        Some(raw) => Err(VkError::CurveMismatch(raw.to_string())),
    }
}

fn ensure_normalised(point: &[String; 3], label: &'static str) -> Result<(), VkError> {
    if point[2].trim() == "1" {
        Ok(())
    } else {
        Err(VkError::NotNormalized(label))
    }
}

fn g1_point(x: &str, y: &str, label: &'static str) -> Result<G1Affine, VkError> {
    let px = Fq::from_str(x).map_err(|_| VkError::BadCoordinate(label))?;
    let py = Fq::from_str(y).map_err(|_| VkError::BadCoordinate(label))?;
    let point = G1Affine::new_unchecked(px, py);
    if point.is_on_curve() {
        Ok(point)
    } else {
        Err(VkError::NotOnCurve(label))
    }
}

fn g2_point(
    x1: &str,
    x2: &str,
    y1: &str,
    y2: &str,
    label: &'static str,
) -> Result<G2Affine, VkError> {
    let px = Fq2::new(
        Fq::from_str(x1).map_err(|_| VkError::BadCoordinate(label))?,
        Fq::from_str(x2).map_err(|_| VkError::BadCoordinate(label))?,
    );
    let py = Fq2::new(
        Fq::from_str(y1).map_err(|_| VkError::BadCoordinate(label))?,
        Fq::from_str(y2).map_err(|_| VkError::BadCoordinate(label))?,
    );
    let point = G2Affine::new_unchecked(px, py);
    if point.is_on_curve() {
        Ok(point)
    } else {
        Err(VkError::NotOnCurve(label))
    }
}

fn g1_bytes(point: &G1Affine) -> Vec<u8> {
    let mut out = Vec::new();
    point
        .serialize_uncompressed(&mut out)
        .expect("failed to serialize G1");
    out
}

fn g2_bytes(point: &G2Affine) -> Vec<u8> {
    let mut out = Vec::new();
    point
        .serialize_uncompressed(&mut out)
        .expect("failed to serialize G2");
    out
}

fn parse_u256_be(signal: &str) -> [u8; 32] {
    let n = BigUint::parse_bytes(signal.as_bytes(), 10).expect("invalid public signal");
    let mut raw = n.to_bytes_be();
    if raw.len() > 32 {
        panic!("public signal exceeds 256 bits");
    }
    if raw.len() < 32 {
        let mut padded = vec![0u8; 32 - raw.len()];
        padded.append(&mut raw);
        raw = padded;
    }
    raw.try_into().expect("invalid 32-byte conversion")
}

fn vk_hex(path: &str) -> Result<String, VkError> {
    let src = fs::read_to_string(path).map_err(|_| VkError::Read)?;
    let vk: VerificationKeyJson = serde_json::from_str(&src).map_err(|_| VkError::Parse)?;

    ensure_bls12_381(&vk)?;

    if vk.ic.len() != vk.n_public + 1 {
        return Err(VkError::IcLength {
            expected: vk.n_public + 1,
            got: vk.ic.len(),
        });
    }

    ensure_normalised(&vk.vk_alpha_1, "vk_alpha_1")?;

    let mut out = Vec::new();
    out.extend(g1_bytes(&g1_point(
        &vk.vk_alpha_1[0],
        &vk.vk_alpha_1[1],
        "vk_alpha_1",
    )?));
    out.extend(g2_bytes(&g2_point(
        &vk.vk_beta_2[0][0],
        &vk.vk_beta_2[0][1],
        &vk.vk_beta_2[1][0],
        &vk.vk_beta_2[1][1],
        "vk_beta_2",
    )?));
    out.extend(g2_bytes(&g2_point(
        &vk.vk_gamma_2[0][0],
        &vk.vk_gamma_2[0][1],
        &vk.vk_gamma_2[1][0],
        &vk.vk_gamma_2[1][1],
        "vk_gamma_2",
    )?));
    out.extend(g2_bytes(&g2_point(
        &vk.vk_delta_2[0][0],
        &vk.vk_delta_2[0][1],
        &vk.vk_delta_2[1][0],
        &vk.vk_delta_2[1][1],
        "vk_delta_2",
    )?));

    out.extend((vk.ic.len() as u32).to_be_bytes());
    for point in &vk.ic {
        ensure_normalised(point, "IC")?;
        out.extend(g1_bytes(&g1_point(&point[0], &point[1], "IC")?));
    }

    Ok(hex::encode(out))
}

fn proof_hex(path: &str) -> String {
    let src = fs::read_to_string(path).expect("failed to read proof json");
    let proof: ProofJson = serde_json::from_str(&src).expect("invalid proof json");

    let mut out = Vec::new();
    out.extend(g1_bytes(&G1Affine::new_unchecked(
        Fq::from_str(&proof.pi_a[0]).expect("invalid G1 x"),
        Fq::from_str(&proof.pi_a[1]).expect("invalid G1 y"),
    )));
    out.extend(g2_bytes(&G2Affine::new_unchecked(
        Fq2::new(
            Fq::from_str(&proof.pi_b[0][0]).expect("invalid G2 x1"),
            Fq::from_str(&proof.pi_b[0][1]).expect("invalid G2 x2"),
        ),
        Fq2::new(
            Fq::from_str(&proof.pi_b[1][0]).expect("invalid G2 y1"),
            Fq::from_str(&proof.pi_b[1][1]).expect("invalid G2 y2"),
        ),
    )));
    out.extend(g1_bytes(&G1Affine::new_unchecked(
        Fq::from_str(&proof.pi_c[0]).expect("invalid G1 x"),
        Fq::from_str(&proof.pi_c[1]).expect("invalid G1 y"),
    )));

    hex::encode(out)
}

fn public_hex(path: &str) -> String {
    let src = fs::read_to_string(path).expect("failed to read public json");
    let signals: PublicSignalsJson = serde_json::from_str(&src).expect("invalid public json");

    let mut out = Vec::new();
    out.extend((signals.len() as u32).to_be_bytes());
    for s in signals {
        out.extend(parse_u256_be(&s));
    }

    hex::encode(out)
}

fn main() {
    let mut args = std::env::args().skip(1);
    let kind = args
        .next()
        .expect("usage: circom-to-soroban-hex <vk|proof|public> <json-file>");
    let path = args
        .next()
        .expect("usage: circom-to-soroban-hex <vk|proof|public> <json-file>");

    // A refused verifying key prints nothing on stdout and exits non-zero, so a
    // shell pipeline can never capture a mis-curved key blob.
    let result = match kind.as_str() {
        "vk" => vk_hex(&path),
        "proof" => Ok(proof_hex(&path)),
        "public" => Ok(public_hex(&path)),
        other => {
            eprintln!("error: unknown kind: {other}");
            std::process::exit(2);
        }
    };

    match result {
        Ok(hex) => println!("{hex}"),
        Err(err) => {
            eprintln!("error: {err}");
            std::process::exit(1);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ark_serialize::CanonicalDeserialize;

    /// The BN254 key that is actually committed to the repo must be refused:
    /// re-encoding it as BLS12-381 would produce points off the target curve.
    #[test]
    fn bn128_key_is_rejected_without_hex() {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../circuits/build/verification_key.json"
        );
        match vk_hex(path) {
            Err(VkError::CurveMismatch(got)) => assert_eq!(got, "bn128"),
            other => panic!("expected a curve mismatch, got {other:?}"),
        }
    }

    /// The BLS12-381 key the deployed contract was configured with must encode to
    /// the exact byte layout `VerificationKey::from_bytes` consumes:
    /// G1(96) + beta_2(192) + gamma_2(192) + delta_2(192) + u32 ic_len + ic_len*G1(96).
    #[test]
    fn bls12381_key_emits_expected_layout() {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../zk/build/verification_key.json"
        );
        let encoded = vk_hex(path).expect("the committed BLS12-381 key must convert");
        let bytes = hex::decode(&encoded).expect("output must be valid hex");

        // 96 + 3*192 + 4 + 4*96 == 1060 bytes for nPublic = 3.
        assert_eq!(bytes.len(), 1060);
        assert_eq!(encoded.len(), 2120);

        // IC length prefix sits right after the four group elements.
        assert_eq!(&bytes[672..676], &4u32.to_be_bytes());
    }

    /// Circom writes "bls12381"; the spec and the issue title write "bls12-381".
    #[test]
    fn curve_spellings_are_equivalent() {
        assert_eq!(normalize_curve("bls12381"), BLS12_381);
        assert_eq!(normalize_curve("bls12-381"), BLS12_381);
        assert_eq!(normalize_curve(" BLS12_381 "), BLS12_381);
        assert_ne!(normalize_curve("bn128"), BLS12_381);
    }

    /// A key with no `curve` field is a mismatch, not a serde crash.
    #[test]
    fn missing_curve_is_rejected() {
        let vk = VerificationKeyJson {
            curve: None,
            vk_alpha_1: ["0".into(), "0".into(), "1".into()],
            vk_beta_2: std::array::from_fn(|_| ["0".to_string(), "0".to_string()]),
            vk_gamma_2: std::array::from_fn(|_| ["0".to_string(), "0".to_string()]),
            vk_delta_2: std::array::from_fn(|_| ["0".to_string(), "0".to_string()]),
            ic: vec![["0".into(), "0".into(), "1".into()]],
            n_public: 0,
        };
        assert_eq!(ensure_bls12_381(&vk), Err(VkError::MissingCurve));
    }

    /// Arkworks writes each G2 `Fq2` limb as `c1` then `c0`
    /// (`ark-bls12-381 0.4.0`, `curves/g2.rs::serialize_with_mode`), which is the
    /// exact order Soroban's `G2Affine::from_array` decodes. Pinning it here makes a
    /// dependency bump that flips limb order fail loudly instead of silently
    /// shipping a key the on-chain verifier cannot read.
    #[test]
    fn g2_limbs_serialize_as_c1_then_c0() {
        let point = G2Affine::new_unchecked(
            Fq2::new(Fq::from(1u64), Fq::from(2u64)),
            Fq2::new(Fq::from(3u64), Fq::from(4u64)),
        );
        let got = hex::encode(g2_bytes(&point));
        // x = 1 + 2u, y = 3 + 4u  =>  x.c1, x.c0, y.c1, y.c0  =>  2, 1, 4, 3.
        let expected = format!("{:096x}{:096x}{:096x}{:096x}", 2u8, 1u8, 4u8, 3u8);
        assert_eq!(got, expected);
        assert_eq!(got.len(), 192 * 2);
    }

    /// The committed BLS12-381 key's G2 points must survive the same uncompressed
    /// round-trip the on-chain verifier performs (`G2Affine::from_array` wraps
    /// `deserialize_uncompressed` with subgroup validation).
    #[test]
    fn real_vk_g2_points_round_trip() {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../zk/build/verification_key.json"
        );
        let src = fs::read_to_string(path).expect("failed to read vk json");
        let vk: VerificationKeyJson = serde_json::from_str(&src).expect("invalid vk json");
        let encoded = vk_hex(path).expect("the committed BLS12-381 key must convert");
        let bytes = hex::decode(&encoded).expect("output must be valid hex");

        // beta_2 follows alpha_1 (G1 = 96 bytes) and spans one G2 element (192 bytes).
        let decoded = G2Affine::deserialize_uncompressed(&bytes[96..96 + 192])
            .expect("ark must decode the encoded beta_2");

        let expected = g2_point(
            &vk.vk_beta_2[0][0],
            &vk.vk_beta_2[0][1],
            &vk.vk_beta_2[1][0],
            &vk.vk_beta_2[1][1],
            "vk_beta_2",
        )
        .expect("beta_2 must be on curve");
        assert_eq!(decoded, expected);
    }
}
