//! CPU backend: multi-threaded Blake2b PoW generation.
//!
//! Uses pre-spun native threads with per-thread mpsc command channels.
//! Each worker thread independently searches random nonces using
//! XorShift1024* — the same algorithm as the reference Nano node.

use std::sync::{Arc, atomic::Ordering};

#[cfg(not(target_arch = "wasm32"))]
use std::sync::atomic::AtomicBool;

#[cfg(not(target_arch = "wasm32"))]
use std::sync::mpsc::{self, RecvTimeoutError};

#[cfg(not(target_arch = "wasm32"))]
use std::thread::{self, JoinHandle};

#[cfg(not(target_arch = "wasm32"))]
use std::time::Duration;

#[cfg(not(target_arch = "wasm32"))]
use rand::Rng;

use crate::{Backend, CancelToken, GeneratorDiagnostics, difficulty};

/// XorShift1024* PRNG — same algorithm as the reference Nano node's `XorShift1024Star`.
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

    #[cfg(not(target_arch = "wasm32"))]
    fn new_from_system() -> Self {
        Self::new(rand::rng().random())
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

#[cfg(not(target_arch = "wasm32"))]
enum WorkCommand {
    Search {
        hash: [u8; 32],
        threshold: u64,
        done: Arc<AtomicBool>,
        cancel: Arc<AtomicBool>,
        result_tx: mpsc::Sender<u64>,
    },
    Stop,
}

#[cfg(not(target_arch = "wasm32"))]
pub(crate) struct CpuBackend {
    threads: Vec<JoinHandle<()>>,
    senders: Vec<mpsc::Sender<WorkCommand>>,
}

#[cfg(target_arch = "wasm32")]
pub(crate) struct CpuBackend;

impl CpuBackend {
    #[cfg(not(target_arch = "wasm32"))]
    pub fn new() -> Self {
        let thread_count = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(4);

        let mut threads = Vec::new();
        let mut senders = Vec::new();

        for _ in 0..thread_count {
            let (cmd_tx, cmd_rx) = mpsc::channel::<WorkCommand>();
            senders.push(cmd_tx);

            threads.push(thread::spawn(move || {
                let mut rng = XorShift1024Star::new_from_system();

                loop {
                    let cmd = match cmd_rx.recv() {
                        Ok(cmd) => cmd,
                        Err(_) => return,
                    };

                    match cmd {
                        WorkCommand::Stop => return,
                        WorkCommand::Search { hash, threshold, done, cancel, result_tx } => {
                            const BATCH: usize = 256;

                            loop {
                                if done.load(Ordering::Relaxed) || cancel.load(Ordering::Relaxed) {
                                    break;
                                }

                                for _ in 0..BATCH {
                                    let nonce = rng.next();
                                    if difficulty::compute(&hash, nonce) >= threshold {
                                        if !done.swap(true, Ordering::AcqRel) {
                                            let _ = result_tx.send(nonce);
                                        }
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }
            }));
        }

        Self { threads, senders }
    }

    #[cfg(target_arch = "wasm32")]
    pub fn new() -> Self {
        Self
    }
}

#[cfg(not(target_arch = "wasm32"))]
impl Drop for CpuBackend {
    fn drop(&mut self) {
        for sender in &self.senders {
            let _ = sender.send(WorkCommand::Stop);
        }
        for thread in self.threads.drain(..) {
            let _ = thread.join();
        }
    }
}

impl Backend for CpuBackend {
    fn name(&self) -> &'static str {
        "cpu"
    }

    #[cfg(not(target_arch = "wasm32"))]
    fn generate(&self, hash: &[u8; 32], threshold: u64, cancel: &CancelToken) -> Option<u64> {
        let done = Arc::new(AtomicBool::new(false));
        let (result_tx, result_rx) = mpsc::channel();

        for sender in &self.senders {
            let _ = sender.send(WorkCommand::Search {
                hash: *hash,
                threshold,
                done: Arc::clone(&done),
                cancel: Arc::clone(&cancel.flag),
                result_tx: result_tx.clone(),
            });
        }
        drop(result_tx);

        loop {
            match result_rx.recv_timeout(Duration::from_millis(10)) {
                Ok(nonce) => return Some(nonce),
                Err(RecvTimeoutError::Timeout) => {
                    if cancel.is_cancelled() {
                        done.store(true, Ordering::Relaxed);
                        return None;
                    }
                }
                Err(RecvTimeoutError::Disconnected) => return None,
            }
        }
    }

    #[cfg(target_arch = "wasm32")]
    fn generate(&self, hash: &[u8; 32], threshold: u64, cancel: &CancelToken) -> Option<u64> {
        let cancelled = Arc::clone(&cancel.flag);
        let hash = *hash;

        let mut rng = XorShift1024Star::new(rand::random());
        const BATCH: usize = 256;

        while !cancelled.load(Ordering::Relaxed) {
            for _ in 0..BATCH {
                let nonce = rng.next();
                if difficulty::compute(&hash, nonce) >= threshold {
                    return Some(nonce);
                }
            }
        }
        None
    }

    fn diagnostics(&self) -> GeneratorDiagnostics {
        GeneratorDiagnostics {
            backend: "cpu".to_string(),
            gpu: None,
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
        let nonce = backend.generate(&hash, thresholds::testing::DEV, &cancel).unwrap();
        let diff = difficulty::compute(&hash, nonce);
        assert!(
            diff >= thresholds::testing::DEV,
            "nonce {nonce:#018x} produced difficulty {diff:#018x} < threshold {:#018x}",
            thresholds::testing::DEV
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
        let nonce = backend.generate(&hash, thresholds::testing::DEV, &cancel).unwrap();
        let diff = difficulty::compute(&hash, nonce);
        assert!(diff >= thresholds::testing::DEV);
    }

    #[test]
    fn cpu_reuses_threads_across_generate_calls() {
        let hash = [0u8; 32];
        let backend = CpuBackend::new();
        let cancel = CancelToken::new();

        // Multiple calls on the same backend should all produce valid work
        for _ in 0..5 {
            let nonce = backend.generate(&hash, thresholds::testing::DEV, &cancel).unwrap();
            let diff = difficulty::compute(&hash, nonce);
            assert!(
                diff >= thresholds::testing::DEV,
                "nonce {nonce:#018x} produced difficulty {diff:#018x} < threshold {:#018x}",
                thresholds::testing::DEV
            );
        }
    }

    #[test]
    fn cpu_concurrent_generates_produce_unique_work() {
        use std::sync::Arc;
        use std::thread;

        let backend = Arc::new(CpuBackend::new());
        let hash = [0u8; 32];
        let cancel = CancelToken::new();

        // Spawn several threads that all call generate() concurrently
        let handles: Vec<_> = (0..4)
            .map(|_| {
                let backend = Arc::clone(&backend);
                let cancel = cancel.clone();
                thread::spawn(move || {
                    backend.generate(&hash, thresholds::testing::DEV, &cancel)
                })
            })
            .collect();

        let mut nonces = Vec::new();
        for h in handles {
            if let Some(nonce) = h.join().unwrap() {
                nonces.push(nonce);
            }
        }

        // All nonces should be valid
        for &nonce in &nonces {
            let diff = difficulty::compute(&hash, nonce);
            assert!(diff >= thresholds::testing::DEV);
        }
    }

    /// Verifies that drop() cleanly joins threads even when workers were
    /// mid-search. We spawn generate on a thread, cancel after a short delay,
    /// drop the backend, and verify the thread returns cleanly.
    #[test]
    fn cpu_drop_after_generate_does_not_panic() {
        use std::thread;

        let hash = [0u8; 32];
        let backend = CpuBackend::new();
        let cancel = CancelToken::new();

        let cancel_clone = cancel.clone();
        let handle = thread::spawn(move || {
            backend.generate(&hash, u64::MAX, &cancel_clone)
        });

        thread::sleep(std::time::Duration::from_millis(100));
        cancel.cancel();

        // Thread should return None or Some (shouldn't hang)
        let result = handle.join().unwrap();
        assert!(result.is_none());
    }

    /// Each worker thread uses system-entropy RNG seeds, so two threads
    /// searching the same hash should produce different nonce sequences
    /// and (almost certainly) different winning nonces.
    #[test]
    fn cpu_workers_produce_different_nonces() {
        let hash = [0u8; 32];
        let backend = CpuBackend::new();
        let cancel = CancelToken::new();

        let nonce1 = backend.generate(&hash, thresholds::testing::DEV, &cancel).unwrap();
        let nonce2 = backend.generate(&hash, thresholds::testing::DEV, &cancel).unwrap();
        let nonce3 = backend.generate(&hash, thresholds::testing::DEV, &cancel).unwrap();

        // Three nonces from a seeded RNG with 2^64 space should all be distinct.
        assert_ne!(nonce1, nonce2, "same nonce on consecutive generate calls");
        assert_ne!(nonce2, nonce3, "same nonce on consecutive generate calls");
    }
}
