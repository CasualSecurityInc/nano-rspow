//! `nano-rspow` — Hybrid CPU/GPU Nano (XNO) Proof of Work library.
//!
//! Provides `work_generate`, `work_validate`, and `work_cancel` with a
//! multi-backend architecture: CPU (always on), wgpu/WGSL (default GPU,
//! works on Metal/Vulkan/DX12), and optional OpenCL.
//!
//! # Quick Start
//!
//! ```rust
//! use nano_rspow::{WorkGenerator, thresholds};
//!
//! // Known-good test vector hash from the official nano-node implementation
//! let hash_bytes = hex::decode("718CC2121C3E641059BC1C2CFC45666C99E8AE922F7A807B7D07B62C995D79E2")
//!     .unwrap();
//! let hash: [u8; 32] = hash_bytes.try_into().unwrap();
//!
//! // Validate a known-good work value (nonce) matching the above test vector
//! let work = u64::from_str_radix("2bf29ef00786a6bc", 16).unwrap();
//! let result = nano_rspow::work_validate(&hash, work, thresholds::EPOCH1);
//! assert!(result.is_valid());
//! ```

pub mod difficulty;
pub mod thresholds;
pub mod types;

mod cpu;

#[cfg(feature = "wgpu-backend")]
mod wgpu_backend;

#[cfg(feature = "opencl")]
mod opencl_backend;

pub use types::{CancelToken, WorkError, WorkResult};

use std::sync::Arc;

/// The main entry point for work generation.
///
/// Selects the best available backend automatically, or use the explicit
/// constructors (`cpu()`, `gpu()`) for manual control.
pub struct WorkGenerator {
    inner: Arc<dyn Backend + Send + Sync>,
}

/// Internal backend trait — all compute backends implement this.
pub(crate) trait Backend {
    fn generate(&self, hash: &[u8; 32], threshold: u64, cancel: &CancelToken) -> Option<u64>;
    fn name(&self) -> &'static str;
}

impl WorkGenerator {
    /// Priority: GPU (OpenCL or wgpu) + CPU (concurrently)
    pub fn auto() -> Self {
        let mut backends: Vec<Arc<dyn Backend + Send + Sync>> = Vec::new();

        #[cfg(feature = "opencl")]
        {
            if let Ok(g) = opencl_backend::OpenClBackend::new(Default::default()) {
                backends.push(Arc::new(g));
            }
        }

        #[cfg(feature = "wgpu-backend")]
        {
            if backends.is_empty() && let Ok(g) = wgpu_backend::WgpuBackend::new() {
                backends.push(Arc::new(g));
            }
        }

        backends.push(Arc::new(cpu::CpuBackend::new()));

        if backends.len() == 1 {
            Self { inner: backends.pop().unwrap() }
        } else {
            Self { inner: Arc::new(RaceBackend { backends }) }
        }
    }

    /// Create a CPU-only generator.
    pub fn cpu() -> Self {
        Self {
            inner: Arc::new(cpu::CpuBackend::new()),
        }
    }

    /// Create a generator using the wgpu GPU backend (Vulkan/Metal/DX12).
    #[cfg(feature = "wgpu-backend")]
    pub fn gpu() -> Result<Self, WorkError> {
        let b = wgpu_backend::WgpuBackend::new()?;
        Ok(Self { inner: Arc::new(b) })
    }

    /// Create a generator using the OpenCL GPU backend.
    #[cfg(feature = "opencl")]
    pub fn opencl(config: opencl_backend::OpenClConfig) -> Result<Self, WorkError> {
        let b = opencl_backend::OpenClBackend::new(config)?;
        Ok(Self { inner: Arc::new(b) })
    }

    /// Returns the name of the active backend.
    pub fn backend_name(&self) -> &'static str {
        self.inner.name()
    }

    /// Generate work for a 32-byte block root hash.
    ///
    /// Returns `None` if cancelled before a valid nonce is found.
    pub fn generate(&self, hash: &[u8; 32], threshold: u64) -> Option<WorkResult> {
        let cancel = CancelToken::new();
        self.generate_with_cancel(hash, threshold, &cancel)
    }

    /// Generate work with an external cancel token.
    pub fn generate_with_cancel(
        &self,
        hash: &[u8; 32],
        threshold: u64,
        cancel: &CancelToken,
    ) -> Option<WorkResult> {
        let nonce = self.inner.generate(hash, threshold, cancel)?;
        let diff = difficulty::compute(hash, nonce);
        Some(WorkResult {
            nonce,
            difficulty: diff,
            threshold,
        })
    }

    /// Validate that a given nonce meets the threshold for a hash.
    pub fn validate(&self, hash: &[u8; 32], nonce: u64, threshold: u64) -> WorkResult {
        let diff = difficulty::compute(hash, nonce);
        WorkResult { nonce, difficulty: diff, threshold }
    }
}

/// Convenience: generate work using the best available backend.
/// Uses a statically cached `WorkGenerator` to avoid re-initializing backends
/// (which can be expensive, e.g. for wgpu) on every call.
pub fn work_generate(hash: &[u8; 32], threshold: u64) -> Option<WorkResult> {
    static GENERATOR: std::sync::OnceLock<WorkGenerator> = std::sync::OnceLock::new();
    GENERATOR.get_or_init(WorkGenerator::auto).generate(hash, threshold)
}

/// Convenience: validate work.
pub fn work_validate(hash: &[u8; 32], nonce: u64, threshold: u64) -> WorkResult {
    WorkResult {
        nonce,
        difficulty: difficulty::compute(hash, nonce),
        threshold,
    }
}

/// A backend that races multiple backends concurrently.
struct RaceBackend {
    backends: Vec<Arc<dyn Backend + Send + Sync>>,
}

impl Backend for RaceBackend {
    fn name(&self) -> &'static str {
        "hybrid-race"
    }

    fn generate(&self, hash: &[u8; 32], threshold: u64, cancel: &CancelToken) -> Option<u64> {
        let (tx, rx) = std::sync::mpsc::channel();
        let race_cancel = cancel.clone(); // shared cancel token for this race

        std::thread::scope(|s| {
            for b in &self.backends {
                let tx_clone = tx.clone();
                let b_ref = Arc::clone(b);
                let rc_clone = race_cancel.clone();
                s.spawn(move || {
                    if let Some(nonce) = b_ref.generate(hash, threshold, &rc_clone) {
                        let _ = tx_clone.send(nonce);
                        // Cancel other backends immediately
                        rc_clone.cancel();
                    }
                });
            }
            
            // Drop the original sender so `rx.recv()` isn't waiting indefinitely
            drop(tx);
        });

        rx.recv().ok()
    }
}
