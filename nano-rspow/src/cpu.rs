//! CPU backend: multi-threaded Blake2b PoW generation.
//!
//! Uses rayon for parallelism. Each worker thread independently searches
//! random nonces using XorShift1024* (same RNG as rsnano-node).

use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc,
};

use rayon::prelude::*;

use crate::{Backend, CancelToken, difficulty};

/// XorShift1024* PRNG — same algorithm as rsnano-node's `XorShift1024Star`.
/// Fast, non-cryptographic, good for PoW nonce exploration.
struct XorShift1024Star {
    state: [u64; 16],
    p: usize,
}

impl XorShift1024Star {
    fn new(seed: u64) -> Self {
        // Splitmix64 to populate state from a single seed
        let mut s = seed;
        let mut state = [0u64; 16];
        for x in state.iter_mut() {
            s = s.wrapping_add(0x9e3779b97f4a7c15);
            let mut z = s;
            z = (z ^ (z >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
            z = (z ^ (z >> 27)).wrapping_mul(0x94d049bb133111eb);
            *x = z ^ (z >> 31);
        }
        Self { state, p: 0 }
    }

    #[inline]
    fn next(&mut self) -> u64 {
        let s0 = self.state[self.p];
        self.p = (self.p + 1) & 15;
        let mut s1 = self.state[self.p];
        s1 ^= s1 << 31;
        self.state[self.p] = s1 ^ s0 ^ (s1 >> 11) ^ (s0 >> 30);
        self.state[self.p].wrapping_mul(1181783497276652981)
    }
}

pub(crate) struct CpuBackend;

impl CpuBackend {
    pub fn new() -> Self {
        Self
    }
}

impl Backend for CpuBackend {
    fn name(&self) -> &'static str {
        "cpu"
    }

    fn generate(&self, hash: &[u8; 32], threshold: u64, cancel: &CancelToken) -> Option<u64> {
        let cancelled = Arc::clone(&cancel.flag);
        let found = Arc::new(AtomicBool::new(false));
        let result = Arc::new(AtomicU64::new(0));

        // Use rayon's thread pool — one worker per available CPU core.
        // Each worker starts from a different random seed and searches in batches.
        let hash = *hash;
        let thread_count = rayon::current_num_threads();

        (0..thread_count).into_par_iter().for_each(|thread_idx| {
            let mut rng = XorShift1024Star::new(
                // Distinct seed per thread using splitmix on thread index
                thread_idx as u64 ^ 0xdeadbeef_cafebabe,
            );

            const BATCH: usize = 256;

            while !cancelled.load(Ordering::Relaxed) && !found.load(Ordering::Relaxed) {
                for _ in 0..BATCH {
                    let nonce = rng.next();
                    if difficulty::compute(&hash, nonce) >= threshold {
                        // Atomically claim the result
                        if !found.swap(true, Ordering::AcqRel) {
                            result.store(nonce, Ordering::Release);
                        }
                        return;
                    }
                }
            }
        });

        if found.load(Ordering::Acquire) {
            Some(result.load(Ordering::Acquire))
        } else {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::thresholds;

    #[test]
    fn xorshift_is_deterministic() {
        let mut a = XorShift1024Star::new(42);
        let mut b = XorShift1024Star::new(42);
        for _ in 0..1000 {
            assert_eq!(a.next(), b.next());
        }
    }

    #[test]
    fn xorshift_distinct_seeds_differ() {
        let mut a = XorShift1024Star::new(1);
        let mut b = XorShift1024Star::new(2);
        // Should produce different sequences
        let va: Vec<u64> = (0..10).map(|_| a.next()).collect();
        let vb: Vec<u64> = (0..10).map(|_| b.next()).collect();
        assert_ne!(va, vb);
    }

    #[test]
    fn cpu_generates_valid_work_dev_threshold() {
        let hash = [0u8; 32];
        let backend = CpuBackend::new();
        let cancel = CancelToken::new();
        let nonce = backend.generate(&hash, thresholds::DEV, &cancel).unwrap();
        let diff = difficulty::compute(&hash, nonce);
        assert!(
            diff >= thresholds::DEV,
            "nonce {nonce:#018x} produced difficulty {diff:#018x} < threshold {:#018x}",
            thresholds::DEV
        );
    }

    #[test]
    fn cpu_respects_cancellation() {
        let hash = [0u8; 32];
        let backend = CpuBackend::new();
        let cancel = CancelToken::new();
        // Cancel immediately — should return None
        cancel.cancel();
        let result = backend.generate(&hash, u64::MAX, &cancel);
        assert!(result.is_none());
    }

    /// Round-trip: generate then validate using the same known vectors
    /// from difficulty.rs.
    #[test]
    fn roundtrip_work_validate() {
        use crate::difficulty;

        // Official known-good test vector hash from the nano-node core implementation
        let hash = hex::decode("718CC2121C3E641059BC1C2CFC45666C99E8AE922F7A807B7D07B62C995D79E2")
            .unwrap();
        let hash: [u8; 32] = hash.try_into().unwrap();

        let backend = CpuBackend::new();
        let cancel = CancelToken::new();
        let nonce = backend.generate(&hash, thresholds::DEV, &cancel).unwrap();
        let diff = difficulty::compute(&hash, nonce);
        assert!(diff >= thresholds::DEV);
    }
}
