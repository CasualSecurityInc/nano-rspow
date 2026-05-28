use nano_rspow::difficulty;
use std::cell::{Cell, RefCell};
use std::rc::Rc;

/// XorShift1024* PRNG — same algorithm as rsnano-node / nano-rspow's CpuBackend.
#[derive(Clone)]
struct XorShift1024Star {
    state: Rc<RefCell<[u64; 16]>>,
    p: Rc<Cell<usize>>,
}

impl XorShift1024Star {
    fn new(seed: u64) -> Self {
        let mut s = seed;
        let mut state = [0u64; 16];
        for x in state.iter_mut() {
            s = s.wrapping_add(0x9e3779b97f4a7c15);
            let mut z = s;
            z = (z ^ (z >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
            z = (z ^ (z >> 27)).wrapping_mul(0x94d049bb133111eb);
            *x = z ^ (z >> 31);
        }
        Self {
            state: Rc::new(RefCell::new(state)),
            p: Rc::new(Cell::new(0)),
        }
    }

    #[inline]
    fn next(&mut self) -> u64 {
        let mut state = self.state.borrow_mut();
        let p = self.p.get();
        let s0 = state[p];
        self.p.set((p + 1) & 15);
        let mut s1 = state[self.p.get()];
        s1 ^= s1 << 31;
        state[self.p.get()] = s1 ^ s0 ^ (s1 >> 11) ^ (s0 >> 30);
        state[self.p.get()].wrapping_mul(1181783497276652981)
    }
}

thread_local! {
    static RNG: RefCell<Option<XorShift1024Star>> = const { RefCell::new(None) };
}

fn with_rng<F, R>(f: F) -> R
where
    F: FnOnce(&mut XorShift1024Star) -> R,
{
    RNG.with(|cell| {
        let mut opt = cell.borrow_mut();
        if opt.is_none() {
            *opt = Some(XorShift1024Star::new(rand::random()));
        }
        f(opt.as_mut().unwrap())
    })
}

/// Try up to `max_nonces` nonces, returning `Some(nonce)` if one meets the
/// threshold, or `None` if the batch is exhausted. RNG state persists across
/// calls so each batch continues from where the last one left off.
pub fn generate_cpu_batch(hash: &[u8; 32], threshold: u64, max_nonces: u32) -> Option<u64> {
    with_rng(|rng| {
        for _ in 0..max_nonces {
            let nonce = rng.next();
            if difficulty::compute(hash, nonce) >= threshold {
                return Some(nonce);
            }
        }
        None
    })
}

/// Synchronously generate Proof of Work (legacy — blocks until found).
pub fn generate_cpu(hash: &[u8; 32], threshold: u64) -> u64 {
    with_rng(|rng| loop {
        let nonce = rng.next();
        if difficulty::compute(hash, nonce) >= threshold {
            return nonce;
        }
    })
}
