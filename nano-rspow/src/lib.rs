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
//! let result = nano_rspow::work_validate(&hash, work, thresholds::LEGACY_EPOCH1);
//! assert!(result.is_valid());
//! ```

pub mod difficulty;
pub mod thresholds;
pub mod types;

mod cpu;

#[cfg(any(feature = "wgpu-backend", feature = "wgpu-types"))]
mod wgpu_shared;

#[cfg(feature = "wgpu-backend")]
mod wgpu_backend;

#[cfg(feature = "opencl")]
mod opencl_backend;

// Shared wgpu types exposed to WASM builds that compile wgpu independently.
#[cfg(feature = "wgpu-types")]
pub mod wgpu_types {
    pub use crate::wgpu_shared::{SHADER, Uniforms, WORKGROUP_SIZE};
}

pub use types::{
    CancelToken, GeneratorDiagnostics, GpuDiagnostics, TuningSource, WorkError, WorkResult,
};
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
    /// Priority: GPU (wgpu or OpenCL), gracefully falling back to CPU.
    pub fn auto() -> Self {
        #[cfg(feature = "wgpu-backend")]
        {
            let wgpu_res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                wgpu_backend::WgpuBackend::new(Default::default())
            }));
            if let Ok(Ok(g)) = wgpu_res {
                return Self { inner: Arc::new(g) };
            }
        }

        #[cfg(feature = "opencl")]
        {
            let opencl_res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                opencl_backend::OpenClBackend::new(Default::default())
            }));
            if let Ok(Ok(g)) = opencl_res {
                return Self { inner: Arc::new(g) };
            }
        }

        Self {
            inner: Arc::new(cpu::CpuBackend::new()),
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
        WorkResult {
            nonce,
            difficulty: diff,
            threshold,
        }
    }
}

/// Convenience: generate work using the best available backend.
/// Uses a statically cached `WorkGenerator` to avoid re-initializing backends
/// (which can be expensive, e.g. for wgpu) on every call.
pub fn work_generate(hash: &[u8; 32], threshold: u64) -> Option<WorkResult> {
    static GENERATOR: std::sync::OnceLock<WorkGenerator> = std::sync::OnceLock::new();
    GENERATOR
        .get_or_init(WorkGenerator::auto)
        .generate(hash, threshold)
}

/// Convenience: validate work.
pub fn work_validate(hash: &[u8; 32], nonce: u64, threshold: u64) -> WorkResult {
    WorkResult {
        nonce,
        difficulty: difficulty::compute(hash, nonce),
        threshold,
    }
}

/// Runs a short diagnostic smoke test to decide if the current machine
/// is capable of performing local PoW fast enough.
/// It uses a cached result if available in the temp directory.
pub fn recommend_local_pow() -> bool {
    let cache_dir = std::env::temp_dir().join("nano-rspow");
    let cache_file = cache_dir.join("pow-tuning.json");
    if let Ok(content) = std::fs::read_to_string(&cache_file) {
        if content.contains("\"is_local_pow_recommended\":true") {
            return true;
        } else if content.contains("\"is_local_pow_recommended\":false") {
            return false;
        }
    }

    let generator = WorkGenerator::auto();
    let is_recommended = if generator.backend_name() != "cpu" {
        true
    } else {
        let start = std::time::Instant::now();
        let hash = [0u8; 32];
        let mut hashes: u64 = 0;
        let budget = std::time::Duration::from_millis(10);
        while start.elapsed() < budget {
            for _ in 0..1000 {
                let _ = difficulty::compute(&hash, hashes);
                hashes += 1;
            }
        }
        
        let elapsed_secs = start.elapsed().as_secs_f64();
        let hashes_per_sec = hashes as f64 / elapsed_secs;
        
        #[cfg(not(target_arch = "wasm32"))]
        let core_count = rayon::current_num_threads() as f64;
        #[cfg(target_arch = "wasm32")]
        let core_count = 1.0;

        let estimated_total_hps = hashes_per_sec * core_count;
        
        // Target: ~15 MH/s minimum for reasonable EPOCH2_SEND speed
        estimated_total_hps >= 15_000_000.0
    };

    if std::fs::create_dir_all(&cache_dir).is_ok() {
        let json = format!(r#"{{"is_local_pow_recommended":{}}}"#, is_recommended);
        let _ = std::fs::write(&cache_file, json);
    }

    is_recommended
}

/// Clears the persistent performance tuning cache.
/// Returns true if the cache directory was found and deleted.
pub fn clear_pow_tuning_cache() -> bool {
    let path = std::env::temp_dir().join("nano-rspow");
    if path.exists() {
        std::fs::remove_dir_all(path).is_ok()
    } else {
        false
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
        let handle =
            thread::spawn(move || generator.generate_with_cancel(&hash, u64::MAX, &cancel_clone));
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
            assert_eq!(
                gpu.nonces_per_dispatch,
                gpu.dispatch_x as u64 * wgpu_shared::WORKGROUP_SIZE as u64
            );
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
