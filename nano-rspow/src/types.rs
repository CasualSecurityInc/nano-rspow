//! Shared types for the nano-rspow library.

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::path::PathBuf;

use crate::thresholds;
use thiserror::Error;

/// The result of a successful work generation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkResult {
    /// The valid nonce (work value), to be encoded as little-endian hex.
    pub nonce: u64,
    /// The actual difficulty achieved.
    pub difficulty: u64,
    /// The threshold that was required.
    pub threshold: u64,
}

impl WorkResult {
    /// Returns true if this result meets the required threshold.
    pub fn is_valid(&self) -> bool {
        self.difficulty >= self.threshold
    }

    /// Returns the multiplier relative to the epoch 2 base threshold.
    pub fn multiplier(&self) -> f64 {
        thresholds::to_multiplier(self.difficulty, self.threshold)
    }

    /// The nonce encoded as a lowercase hex string (as Nano RPC expects).
    pub fn nonce_hex(&self) -> String {
        format!("{:016x}", self.nonce)
    }

    /// The difficulty encoded as a lowercase hex string.
    pub fn difficulty_hex(&self) -> String {
        format!("{:016x}", self.difficulty)
    }
}

/// Errors from work generation.
#[derive(Debug, Error)]
pub enum WorkError {
    #[error("GPU backend initialization failed: {0}")]
    GpuInit(String),

    #[error("Work generation was cancelled")]
    Cancelled,

    #[error("No GPU adapter available")]
    NoAdapter,
}

/// A cancellation token. Pass a clone to the generator; call `cancel()` to
/// stop an in-progress generation from another thread.
#[derive(Clone, Debug)]
pub struct CancelToken {
    pub(crate) flag: Arc<AtomicBool>,
}

impl CancelToken {
    pub fn new() -> Self {
        Self {
            flag: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Signal that generation should stop.
    pub fn cancel(&self) {
        self.flag.store(true, Ordering::Relaxed);
    }

    /// Returns true if cancellation has been requested.
    pub fn is_cancelled(&self) -> bool {
        self.flag.load(Ordering::Relaxed)
    }

    /// Reset so the token can be reused.
    pub fn reset(&self) {
        self.flag.store(false, Ordering::Relaxed);
    }
}

impl Default for CancelToken {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GeneratorDiagnostics {
    pub backend: String,
    pub gpu: Option<GpuDiagnostics>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GpuDiagnostics {
    pub backend_api: String,
    pub adapter_name: String,
    pub driver_info: String,
    pub vendor_id: u32,
    pub device_id: u32,
    pub max_compute_workgroups_per_dimension: u32,
    pub dispatch_x: u32,
    pub nonces_per_dispatch: u64,
    pub tuning_source: TuningSource,
    pub cache_path: Option<PathBuf>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TuningSource {
    Cache,
    Probe,
    Heuristic,
    Manual,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn work_result_valid() {
        let r = WorkResult {
            nonce: 0x2bf29ef00786a6bc,
            difficulty: 0xffffffd21c3933f4,
            threshold: 0xffffffc000000000,
        };
        assert!(r.is_valid());
        assert_eq!(r.nonce_hex(), "2bf29ef00786a6bc");
    }

    #[test]
    fn work_result_invalid() {
        let r = WorkResult {
            nonce: 0,
            difficulty: 0,
            threshold: 0xffffffc000000000,
        };
        assert!(!r.is_valid());
    }

    #[test]
    fn cancel_token() {
        let token = CancelToken::new();
        assert!(!token.is_cancelled());
        token.cancel();
        assert!(token.is_cancelled());
        token.reset();
        assert!(!token.is_cancelled());
    }

    #[test]
    fn cancel_token_clone_shares_state() {
        let a = CancelToken::new();
        let b = a.clone();
        a.cancel();
        assert!(b.is_cancelled());
    }
}
