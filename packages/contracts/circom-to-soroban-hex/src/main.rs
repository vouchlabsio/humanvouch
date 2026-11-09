use ark_bls12_381::{Fq, Fq2, G1Affine, G1Projective, G2Affine, G2Projective};
use ark_serialize::CanonicalSerialize;
use num_bigint::BigUint;
use serde::Deserialize;
use std::{fs, str::FromStr};

#[derive(Deserialize)]
struct VerificationKeyJson {
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

/// Curve names accepted as BLS12-381 (circom calls the prime `bls12381`).
const BLS_CURVE_NAMES: [&str; 2] = ["bls12-381", "bls12381"];

fn is_bls12_381(curve: &str) -> bool {
    BLS_CURVE_NAMES.iter().any(|name| curve.eq_ignore_ascii_case(name))
}

/// Encode a G1 point from decimal x/y coordinates (uncompressed, 48 bytes per
/// coordinate). Constructed without a curve check (via the projective point)
/// so this stays a pure byte-layout encoder (see
/// `g2_limb_order_matches_js_encoder`); on-curve validity is enforced by
/// `assert_g1_on_curve` / `assert_g2_on_curve` before any hex is emitted.
fn g1_bytes(x: &str, y: &str) -> Vec<u8> {
    let p = G1Projective::new(
        Fq::from_str(x).expect("invalid G1 x"),
        Fq::from_str(y).expect("invalid G1 y"),
    )
    .to_affine();
    let mut out = Vec::new();
    p.serialize_uncompressed(&mut out)
        .expect("failed to serialize G1");
    out
}

/// Encode a G2 point from decimal x1/x2 (re/imag) and y1/y2 (re/imag)
/// coordinates (uncompressed, 48 bytes per coordinate). Same encoder
/// contract as `g1_bytes`: no curve check here, layout only.
fn g2_bytes(x1: &str, x2: &str, y1: &str, y2: &str) -> Vec<u8> {
    let x = Fq2::new(
        Fq::from_str(x1).expect("invalid G2 x1"),
        Fq::from_str(x2).expect("invalid G2 x2"),
    );
    let y = Fq2::new(
        Fq::from_str(y1).expect("invalid G2 y1"),
        Fq::from_str(y2).expect("invalid G2 y2"),
    );
    let p = G2Projective::new(x, y).to_affine();
    let mut out = Vec::new();
    p.serialize_uncompressed(&mut out)
        .expect("failed to serialize G2");
    out
}

/// Reject coordinates that do not sit on BLS12-381 G1 before any hex is
/// emitted (soroban's `G1Affine::from_array` would reject them on-chain).
fn assert_g1_on_curve(x: &str, y: &str, what: &str) {
    let p = G1Affine::new(
        Fq::from_str(x).expect("invalid G1 x"),
        Fq::from_str(y).expect("invalid G1 y"),
    );
    assert!(p.is_some(), "{what} is not a valid BLS12-381 G1 point");
}

fn assert_g2_on_curve(x1: &str, x2: &str, y1: &str, y2: &str, what: &str) {
    let x = Fq2::new(
        Fq::from_str(x1).expect("invalid G2 x1"),
        Fq::from_str(x2).expect("invalid G2 x2"),
    );
    let y = Fq2::new(
        Fq::from_str(y1).expect("invalid G2 y1"),
        Fq::from_str(y2).expect("invalid G2 y2"),
    );
    assert!(
        G2Affine::new(x, y).is_some(),
        "{what} is not a valid BLS12-381 G2 point"
    );
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

fn vk_hex(path: &str) -> String {
    let src = fs::read_to_string(path).expect("failed to read vk json");
    let vk: VerificationKeyJson = serde_json::from_str(&src).expect("invalid vk json");

    // Soroban only exposes BLS12-381 pairing host functions, so a key on any
    // other curve (e.g. the legacy BN254 artifact) can never verify on-chain:
    // refuse to emit hex for it instead of encoding silently.
    match &vk.curve {
        Some(curve) if is_bls12_381(curve) => {}
        curve => panic!(
            "refusing to emit hex: key curve is {:?}, but this tool only supports \
             BLS12-381 (the curve Soroban's native pairing functions expect). \
             Regenerate the key with `circom --prime bls12381` / \
             `snarkjs ... bls12381`.",
            curve
        ),
    }

    if vk.ic.len() != vk.n_public + 1 {
        panic!("IC length does not match nPublic + 1");
    }

    // Every emitted coordinate must actually sit on BLS12-381, otherwise the
    // on-chain VerificationKey::from_bytes would reject the hex.
    assert_g1_on_curve(&vk.vk_alpha_1[0], &vk.vk_alpha_1[1], "vk_alpha_1");
    assert_g2_on_curve(
        &vk.vk_beta_2[0][0],
        &vk.vk_beta_2[0][1],
        &vk.vk_beta_2[1][0],
        &vk.vk_beta_2[1][1],
        "vk_beta_2",
    );
    assert_g2_on_curve(
        &vk.vk_gamma_2[0][0],
        &vk.vk_gamma_2[0][1],
        &vk.vk_gamma_2[1][0],
        &vk.vk_gamma_2[1][1],
        "vk_gamma_2",
    );
    assert_g2_on_curve(
        &vk.vk_delta_2[0][0],
        &vk.vk_delta_2[0][1],
        &vk.vk_delta_2[1][0],
        &vk.vk_delta_2[1][1],
        "vk_delta_2",
    );
    for (i, point) in vk.ic.iter().enumerate() {
        assert_g1_on_curve(&point[0], &point[1], &format!("IC[{}]", i));
    }

    let mut out = Vec::new();
    out.extend(g1_bytes(&vk.vk_alpha_1[0], &vk.vk_alpha_1[1]));
    out.extend(g2_bytes(
        &vk.vk_beta_2[0][0],
        &vk.vk_beta_2[0][1],
        &vk.vk_beta_2[1][0],
        &vk.vk_beta_2[1][1],
    ));
    out.extend(g2_bytes(
        &vk.vk_gamma_2[0][0],
        &vk.vk_gamma_2[0][1],
        &vk.vk_gamma_2[1][0],
        &vk.vk_gamma_2[1][1],
    ));
    out.extend(g2_bytes(
        &vk.vk_delta_2[0][0],
        &vk.vk_delta_2[0][1],
        &vk.vk_delta_2[1][0],
        &vk.vk_delta_2[1][1],
    ));

    out.extend((vk.ic.len() as u32).to_be_bytes());
    for point in &vk.ic {
        out.extend(g1_bytes(&point[0], &point[1]));
    }

    hex::encode(out)
}

fn proof_hex(path: &str) -> String {
    let src = fs::read_to_string(path).expect("failed to read proof json");
    let proof: ProofJson = serde_json::from_str(&src).expect("invalid proof json");

    let mut out = Vec::new();
    out.extend(g1_bytes(&proof.pi_a[0], &proof.pi_a[1]));
    out.extend(g2_bytes(
        &proof.pi_b[0][0],
        &proof.pi_b[0][1],
        &proof.pi_b[1][0],
        &proof.pi_b[1][1],
    ));
    out.extend(g1_bytes(&proof.pi_c[0], &proof.pi_c[1]));

    hex::encode(out)
}

fn public_hex(path: &str) -> String {
    let src = fs::read_to_string(path).expect("failed to read public json");
    let signals: PublicSignalsJson = serde_json::from_str(&src).expect("invalid public json");

    let mut out = Vec::new();
    out.extend((signals.len() as u32).to_be_bytes());
    for s in &signals {
        out.extend(parse_u256_be(s));
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

    let hex = match kind.as_str() {
        "vk" => vk_hex(&path),
        "proof" => proof_hex(&path),
        "public" => public_hex(&path),
        _ => panic!("unknown kind: {kind}"),
    };

    println!("{hex}");
}

#[cfg(test)]
mod tests {
    use super::{g2_bytes, vk_hex};
    use ark_bls12_381::{Fq, Fq2, G1Affine, G2Affine};
    use ark_ff::PrimeField;

    // Must match `packages/web/test/snarkHex.test.js` for the fixed G2 point
    // [[1,2],[3,4]]: Arkworks `serialize_uncompressed` writes each Fq2 as [c0, c1]
    // (no Solidity-style [c1, c0] swap), so the browser encoder must not reorder.
    #[test]
    fn g2_limb_order_matches_js_encoder() {
        let got = hex::encode(g2_bytes("1", "2", "3", "4"));
        let expected = format!("{:096x}{:096x}{:096x}{:096x}", 1u8, 2u8, 3u8, 4u8);
        assert_eq!(got, expected);
        assert_eq!(got.len(), 192 * 2);
    }

    /// Acceptance criterion 1: the committed BN254 key must be rejected with a
    /// curve-mismatch message, not silently encoded.
    #[test]
    #[should_panic(expected = "refusing to emit hex")]
    fn bn128_key_is_rejected_with_curve_mismatch() {
        let _ = vk_hex("../../../circuits/build/verification_key.json");
    }

    /// Acceptance criterion 2: the committed BLS12-381 key must produce hex in
    /// the exact layout `attest::VerificationKey::from_bytes` consumes:
    /// G1(96) + 3 x G2(192) + u32 IC length + IC G1s(96 each), with every
    /// coordinate a valid BLS12-381 point.
    #[test]
    fn bls12_381_key_emits_hex_in_attest_layout() {
        let hex = vk_hex("../../../circuits/build/verification_key.bls12-381.json");
        let bytes = hex::decode(&hex).expect("vk hex is not valid hex");

        const G1: usize = 96;
        const G2: usize = 192;
        assert_eq!(bytes.len(), G1 + 3 * G2 + 4 + 4 * G1);

        let mut pos = 0;
        // alpha: G1
        let alpha = g1_from_limbs(&bytes, &mut pos);
        // beta, gamma, delta: G2
        for _ in 0..3 {
            let (x1, x2, y1, y2) = (
                limb(&bytes, &mut pos),
                limb(&bytes, &mut pos),
                limb(&bytes, &mut pos),
                limb(&bytes, &mut pos),
            );
            let p = G2Affine::new(Fq2::new(x1, x2), Fq2::new(y1, y2));
            assert!(p.is_some(), "vk G2 element is not on the BLS12-381 curve");
        }
        // IC: u32 count + G1 points
        let count = u32::from_be_bytes([
            bytes[pos],
            bytes[pos + 1],
            bytes[pos + 2],
            bytes[pos + 3],
        ]);
        pos += 4;
        assert_eq!(count as usize, 4, "nPublic is 3, so IC must have 4 points");
        for _ in 0..count {
            g1_from_limbs(&bytes, &mut pos);
        }
        assert_eq!(pos, bytes.len(), "trailing bytes after IC");
        assert!(
            G1Affine::new(alpha.0, alpha.1).is_some(),
            "vk_alpha_1 is not on the BLS12-381 curve"
        );
    }

    fn limb(bytes: &[u8], pos: &mut usize) -> Fq {
        let end = *pos + 48;
        let value = Fq::from_be_bytes_mod_order(&bytes[*pos..end]);
        *pos = end;
        value
    }

    fn g1_from_limbs(bytes: &[u8], pos: &mut usize) -> (Fq, Fq) {
        (limb(bytes, pos), limb(bytes, pos))
    }
}
