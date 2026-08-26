//! Nano PoW threshold presets.
//!
//! Use [`current`] for blocks published to current Nano mainnet nodes. The
//! [`legacy`] and [`testing`] modules are deliberately separate so historical
//! and test-only values are not mistaken for current network requirements.
//!
//! Source: rsnano-node `work/src/work_thresholds.rs` and the original
//! C++ nano-node `nano/lib/work.cpp`.

/// Current Nano mainnet minimum thresholds.
pub mod current {
    /// Minimum threshold for send and change blocks.
    pub const SEND: u64 = 0xfffffff800000000;

    /// Minimum threshold for receive, open, and epoch blocks.
    pub const RECEIVE: u64 = 0xfffffe0000000000;
}

/// Historical thresholds for validating or benchmarking Epoch 1 blocks.
pub mod legacy {
    /// Epoch 1 mainnet threshold.
    ///
    /// This value is not required when publishing a current mainnet block.
    pub const EPOCH1: u64 = 0xffffffc000000000;

    /// Epoch 1 beta-network threshold.
    pub const BETA_EPOCH1: u64 = 0xfffff00000000000;
}

/// Non-mainnet thresholds intended only for development and tests.
pub mod testing {
    /// Low-difficulty development threshold.
    pub const DEV: u64 = 0xfe00000000000000;
}

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
    fn current_send_is_eight_times_legacy_epoch1() {
        let m = to_multiplier(current::SEND, legacy::EPOCH1);
        assert!((m - 8.0).abs() < 0.01, "expected 8.0, got {m}");
    }

    #[test]
    fn current_receive_is_one_eighth_of_legacy_epoch1() {
        let m = to_multiplier(current::RECEIVE, legacy::EPOCH1);
        assert!((m - 0.125).abs() < 0.001, "expected 0.125, got {m}");
    }

    #[test]
    fn roundtrip_multiplier() {
        let m = 2.5_f64;
        let d = from_multiplier(m, current::SEND);
        let m2 = to_multiplier(d, current::SEND);
        assert!((m - m2).abs() < 0.001);
    }
}
