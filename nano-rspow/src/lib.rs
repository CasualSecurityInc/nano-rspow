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

pub use types::{CancelToken, GeneratorDiagnostics, GpuDiagnostics, TuningSource, WorkError, WorkResult};
#[cfg(feature = "wgpu-backend")]
pub use wgpu_backend::WgpuConfig;

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
    fn diagnostics(&self) -> GeneratorDiagnostics;
}

impl WorkGenerator {
    /// Priority: GPU (OpenCL or wgpu), gracefully falling back to CPU.
    pub fn auto() -> Self {
        #[cfg(feature = "opencl")]
        {
            if let Ok(g) = opencl_backend::OpenClBackend::new(Default::default()) {
                return Self { inner: Arc::new(g) };
            }
        }

        #[cfg(feature = "wgpu-backend")]
        {
            if let Ok(g) = wgpu_backend::WgpuBackend::new(Default::default()) {
                return Self { inner: Arc::new(g) };
            }
        }

        Self { inner: Arc::new(cpu::CpuBackend::new()) }
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
        let b = wgpu_backend::WgpuBackend::new(Default::default())?;
        Ok(Self { inner: Arc::new(b) })
    }

    #[cfg(feature = "wgpu-backend")]
    pub fn gpu_with_config(config: WgpuConfig) -> Result<Self, WorkError> {
        let b = wgpu_backend::WgpuBackend::new(config)?;
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

    pub fn diagnostics(&self) -> GeneratorDiagnostics {
        self.inner.diagnostics()
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::thread;
    use std::time::Duration;

    fn test_hash() -> [u8; 32] {
        let hash = hex::decode("718CC2121C3E641059BC1C2CFC45666C99E8AE922F7A807B7D07B62C995D79E2")
            .unwrap();
        hash.try_into().unwrap()
    }

    fn assert_repeated_generate_valid(generator: &WorkGenerator) {
        let hash = test_hash();
        for _ in 0..3 {
            let result = generator.generate(&hash, thresholds::DEV).unwrap();
            assert!(result.is_valid());
        }
    }

    fn assert_concurrent_generate_valid(generator: WorkGenerator) {
        let g = Arc::new(generator);
        let hash = test_hash();
        let mut handles = Vec::new();
        for _ in 0..4 {
            let g = Arc::clone(&g);
            handles.push(thread::spawn(move || {
                let result = g.generate(&hash, thresholds::DEV).unwrap();
                assert!(result.is_valid());
            }));
        }
        for h in handles {
            h.join().unwrap();
        }
    }

    fn assert_cancellation(generator: WorkGenerator) {
        let hash = test_hash();
        let cancel = CancelToken::new();
        let cancel_clone = cancel.clone();
        let handle = thread::spawn(move || generator.generate_with_cancel(&hash, u64::MAX, &cancel_clone));
        thread::sleep(Duration::from_millis(10));
        cancel.cancel();
        assert!(handle.join().unwrap().is_none());
    }

    #[test]
    fn cpu_diagnostics_are_present() {
        let g = WorkGenerator::cpu();
        let d = g.diagnostics();
        assert_eq!(d.backend, "cpu");
        assert!(d.gpu.is_none());
    }

    #[cfg(feature = "wgpu-backend")]
    #[test]
    fn wgpu_diagnostics_coherent_when_available() {
        if let Ok(g) = WorkGenerator::gpu() {
            let d = g.diagnostics();
            assert_eq!(d.backend, "wgpu");
            let gpu = d.gpu.expect("wgpu backend should provide gpu diagnostics");
            assert!(gpu.dispatch_x > 0);
            assert_eq!(gpu.nonces_per_dispatch, gpu.dispatch_x as u64 * 64);
        }
    }

    #[cfg(feature = "wgpu-backend")]
    #[test]
    fn wgpu_reuse_and_concurrency() {
        if let Ok(generator) = WorkGenerator::gpu() {
            assert_repeated_generate_valid(&generator);
            assert_concurrent_generate_valid(generator);
        }
    }

    #[cfg(feature = "wgpu-backend")]
    #[test]
    fn wgpu_cancellation() {
        if let Ok(generator) = WorkGenerator::gpu() {
            assert_cancellation(generator);
        }
    }

    #[cfg(feature = "opencl")]
    #[test]
    fn opencl_reuse_and_concurrency() {
        if let Ok(generator) = WorkGenerator::opencl(Default::default()) {
            assert_repeated_generate_valid(&generator);
            assert_concurrent_generate_valid(generator);
        }
    }

    #[cfg(feature = "opencl")]
    #[test]
    fn opencl_cancellation() {
        if let Ok(generator) = WorkGenerator::opencl(Default::default()) {
            assert_cancellation(generator);
        }
    }
}
