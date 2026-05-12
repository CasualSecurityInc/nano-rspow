//! Nano PoW threshold constants for all network epochs.
//!
//! Source: rsnano-node `work/src/work_thresholds.rs` and the original
//! C++ nano-node `nano/lib/work.cpp`.

/// Epoch 2 send/change threshold (current live network default for sends).
/// 8x harder than EPOCH1.
pub const EPOCH2_SEND: u64 = 0xfffffff800000000;

/// Epoch 2 receive threshold.
/// 8x easier than EPOCH1.
pub const EPOCH2_RECEIVE: u64 = 0xfffffe0000000000;

/// Epoch 1 threshold (legacy / open blocks).
pub const EPOCH1: u64 = 0xffffffc000000000;

/// Beta network epoch 1 threshold (64x lower than live epoch 1).
pub const BETA_EPOCH1: u64 = 0xfffff00000000000;

/// Dev network threshold (very low, for testing).
pub const DEV: u64 = 0xfe00000000000000;

/// The highest threshold across all epochs — used as the base for multiplier
/// calculations.
pub const BASE: u64 = EPOCH2_SEND;

/// Compute a difficulty multiplier relative to a base threshold.
///
/// A multiplier of 1.0 means exactly at base difficulty. >1.0 means harder.
pub fn to_multiplier(difficulty: u64, base: u64) -> f64 {
    debug_assert!(base > 0);
    let max = u64::MAX as f64;
    (max - base as f64) / (max - difficulty as f64)
}

/// Compute the difficulty from a multiplier and base threshold.
pub fn from_multiplier(multiplier: f64, base: u64) -> u64 {
    debug_assert!(multiplier >= 1.0);
    let max = u64::MAX as f64;
    u64::MAX - ((max - base as f64) / multiplier) as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn multiplier_epoch2_vs_epoch1() {
        // rsnano confirms live epoch_2 is 8x epoch_1
        let m = to_multiplier(EPOCH2_SEND, EPOCH1);
        assert!((m - 8.0).abs() < 0.01, "expected 8.0, got {m}");
    }

    #[test]
    fn multiplier_epoch2_receive_vs_epoch1() {
        // epoch_2_receive is 1/8 of epoch_1
        let m = to_multiplier(EPOCH2_RECEIVE, EPOCH1);
        assert!((m - 0.125).abs() < 0.001, "expected 0.125, got {m}");
    }

    #[test]
    fn roundtrip_multiplier() {
        let m = 2.5_f64;
        let d = from_multiplier(m, EPOCH1);
        let m2 = to_multiplier(d, EPOCH1);
        assert!((m - m2).abs() < 0.001);
    }
}
