//! Criterion benchmark for nano-rspow backends.
//!
//! Run with: cargo bench --bench pow_benchmark
//!
//! Benchmarks Blake2b difficulty computation and full PoW generation
//! (at dev threshold for speed) across all compiled backends.

use criterion::{Criterion, Throughput, criterion_group, criterion_main};
use nano_rspow::{difficulty, thresholds};

const BENCH_HASH: [u8; 32] = [
    0x71, 0x8C, 0xC2, 0x12, 0x1C, 0x3E, 0x64, 0x10,
    0x59, 0xBC, 0x1C, 0x2C, 0xFC, 0x45, 0x66, 0x6C,
    0x99, 0xE8, 0xAE, 0x92, 0x2F, 0x7A, 0x80, 0x7B,
    0x7D, 0x07, 0xB6, 0x2C, 0x99, 0x5D, 0x79, 0xE2,
];

fn bench_difficulty(c: &mut Criterion) {
    c.bench_function("difficulty_compute", |b| {
        let nonce = 0x2bf29ef00786a6bc_u64;
        b.iter(|| difficulty::compute(&BENCH_HASH, std::hint::black_box(nonce)));
    });
}

fn bench_cpu_generation(c: &mut Criterion) {
    let mut group = c.benchmark_group("work_generate");
    group.throughput(Throughput::Elements(1));
    // Use dev threshold so bench completes quickly
    group.bench_function("cpu_dev_threshold", |b| {
        let generator = nano_rspow::WorkGenerator::cpu();
        b.iter(|| generator.generate(&BENCH_HASH, thresholds::DEV).unwrap());
    });
    group.finish();
}

criterion_group!(benches, bench_difficulty, bench_cpu_generation);
criterion_main!(benches);
