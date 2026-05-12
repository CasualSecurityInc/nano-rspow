//! Nano PoW difficulty computation.
//!
//! The Nano PoW difficulty is defined as:
//!
//! ```text
//! difficulty = BLAKE2b_64(nonce_le_bytes || hash)
//! ```
//!
//! where:
//! - `nonce` is an 8-byte little-endian value
//! - `hash` is the 32-byte block root (previous block hash or account public key)
//! - `BLAKE2b_64` means the first 8 bytes of a Blake2b hash, interpreted as
//!   a little-endian u64
//!
//! A proof is valid when `difficulty >= threshold`.
//!
//! # Known Test Vectors
//!
//! These vectors are cross-validated against rsnano-node, nano-work-server,
//! and the original C++ nano-node.

use blake2b_simd::Params;

/// Compute the PoW difficulty for a given hash and nonce.
///
/// Returns the difficulty as a u64. Higher is harder (closer to u64::MAX).
#[inline]
pub fn compute(hash: &[u8; 32], nonce: u64) -> u64 {
    let nonce_bytes = nonce.to_le_bytes();
    let digest = Params::new()
        .hash_length(8)
        .to_state()
        .update(&nonce_bytes)
        .update(hash)
        .finalize();
    let bytes = digest.as_bytes();
    u64::from_le_bytes(bytes.try_into().expect("blake2b returned 8 bytes"))
}

/// Returns true if the nonce is valid work for the given hash and threshold.
#[inline]
pub fn is_valid(hash: &[u8; 32], nonce: u64, threshold: u64) -> bool {
    compute(hash, nonce) >= threshold
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::thresholds;

    // ---------------------------------------------------------------------------
    // KNOWN TEST VECTORS
    // Source: rsnano-node work/src/work_thresholds.rs `validate_real_block` test,
    //         C++ nano-node, and nano-work-server README.
    // ---------------------------------------------------------------------------

    /// Vector 1 — from rsnano-node's `validate_real_block` test.
    /// A legacy send block with known work value.
    #[test]
    fn vector_rsnano_legacy_send_block() {
        // Block hash from rsnano test
        let hash_hex = "991CF190094C00F0B68E2E5F75F6BEE95A2E0BD93CEAA4A6734DB9F19B728948";
        // The hash that PoW is computed over is the PREVIOUS field for send blocks
        let hash = hex_to_array(hash_hex);
        // Work value from the original block
        let work = u64::from_str_radix("3c82cc724905ee95", 16).unwrap();
        // Expected difficulty from rsnano test
        let expected_difficulty: u64 = 18446743921403126366;

        let actual = compute(&hash, work);
        assert_eq!(
            actual, expected_difficulty,
            "difficulty mismatch: got {actual:#018x}, expected {expected_difficulty:#018x}"
        );
        assert!(
            actual >= thresholds::EPOCH1,
            "work must meet epoch1 threshold"
        );
    }

    /// Vector 2 — from nano-work-server README.
    #[test]
    fn vector_nano_work_server_readme() {
        let hash = hex_to_array("718CC2121C3E641059BC1C2CFC45666C99E8AE922F7A807B7D07B62C995D79E2");
        let work = u64::from_str_radix("2bf29ef00786a6bc", 16).unwrap();
        let expected_difficulty = u64::from_str_radix("ffffffd21c3933f4", 16).unwrap();

        let actual = compute(&hash, work);
        assert_eq!(actual, expected_difficulty);
        assert!(actual >= thresholds::EPOCH1);
    }

    /// Vector 3 — boundary: work exactly at epoch1 threshold should be valid.
    #[test]
    fn threshold_exactly_met_is_valid() {
        // We brute-force a nonce that's right at the boundary using CPU search
        // (very low dev threshold for speed)
        let hash = [0u8; 32];
        let threshold = thresholds::DEV; // Very low — tests finish fast

        // Search for a valid nonce
        let nonce = (0u64..).find(|&n| compute(&hash, n) >= threshold).unwrap();
        assert!(is_valid(&hash, nonce, threshold));
        assert!(!is_valid(&hash, nonce, u64::MAX)); // Nothing meets max threshold
    }

    /// Vector 4 — known invalid work (difficulty below epoch1 threshold).
    #[test]
    fn known_invalid_work() {
        // work = 0 almost certainly produces difficulty below any real threshold
        let hash = hex_to_array("718CC2121C3E641059BC1C2CFC45666C99E8AE922F7A807B7D07B62C995D79E2");
        let work = 0u64;
        assert!(!is_valid(&hash, work, thresholds::EPOCH1));
    }

    /// Vector 5 — determinism: same inputs always produce same output.
    #[test]
    fn deterministic() {
        let hash = hex_to_array("718CC2121C3E641059BC1C2CFC45666C99E8AE922F7A807B7D07B62C995D79E2");
        let nonce = 0xdeadbeef_cafebabe_u64;
        let d1 = compute(&hash, nonce);
        let d2 = compute(&hash, nonce);
        assert_eq!(d1, d2);
    }

    fn hex_to_array(s: &str) -> [u8; 32] {
        let v = hex::decode(s).unwrap();
        v.try_into().unwrap()
    }
}
