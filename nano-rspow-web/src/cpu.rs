use nano_rspow::difficulty;

/// XorShift1024* PRNG — same algorithm as rsnano-node / nano-rspow's CpuBackend.
/// High performance, non-cryptographic, excellent for PoW nonce exploration.
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

/// Synchronously generate Proof of Work using a single-threaded WASM CPU backend.
/// Runs at maximum native performance.
pub fn generate_cpu(hash: &[u8; 32], threshold: u64) -> u64 {
    // Initialize RNG with a secure seed
    let mut rng = XorShift1024Star::new(rand::random());
    
    loop {
        let nonce = rng.next();
        if difficulty::compute(hash, nonce) >= threshold {
            return nonce;
        }
    }
}
