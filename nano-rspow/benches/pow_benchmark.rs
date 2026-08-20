//! Criterion benchmark for nano-rspow backends.
//!
//! Run with: cargo bench --bench pow_benchmark
//!
//! Tiers mirror the CLI `benchmark` command:
//!   dev        0xfe00000000000000  (very low — fast iteration)
//!   ep2_recv   0xfffffe0000000000  (epoch-2 receive — common real-world)
//!   legacy_epoch1  0xffffffc000000000  (legacy-only)
//!   ep2_send   0xfffffff800000000  (epoch-2 send/change — hardest)
//!
//! CPU benchmarks run at `dev` threshold only (higher tiers take 1-2 s each,
//! making Criterion wall-time impractical).  GPU benchmarks run at `dev` and
//! `ep2_recv`; `legacy_epoch1` and `ep2_send` are included but marked slow so
//! they only run when specifically requested (`cargo bench -- legacy_epoch1`).

use criterion::{Criterion, SamplingMode, Throughput, criterion_group, criterion_main};
use nano_rspow::{difficulty, thresholds};

// Official known-good test vector — same hash used by the CLI benchmark command.
const BENCH_HASH: [u8; 32] = [
    0x71, 0x8C, 0xC2, 0x12, 0x1C, 0x3E, 0x64, 0x10, 0x59, 0xBC, 0x1C, 0x2C, 0xFC, 0x45, 0x66, 0x6C,
    0x99, 0xE8, 0xAE, 0x92, 0x2F, 0x7A, 0x80, 0x7B, 0x7D, 0x07, 0xB6, 0x2C, 0x99, 0x5D, 0x79, 0xE2,
];

// ── difficulty_compute ────────────────────────────────────────────────────────

fn bench_difficulty(c: &mut Criterion) {
    // Official known-good nonce for BENCH_HASH at epoch-2-send threshold.
    let nonce = 0x2bf29ef00786a6bc_u64;
    c.bench_function("difficulty_compute", |b| {
        b.iter(|| difficulty::compute(&BENCH_HASH, std::hint::black_box(nonce)));
    });
}

// ── CPU generation ────────────────────────────────────────────────────────────

fn bench_cpu_generation(c: &mut Criterion) {
    let mut group = c.benchmark_group("work_generate/cpu");
    group.throughput(Throughput::Elements(1));

    // Only dev threshold: higher tiers take 1-2 s per sample.
    group.bench_function("dev", |b| {
        let generator = nano_rspow::WorkGenerator::cpu();
        b.iter(|| generator.generate(&BENCH_HASH, thresholds::DEV).unwrap());
    });

    group.finish();
}

// ── GPU generation ────────────────────────────────────────────────────────────

#[cfg(feature = "wgpu-backend")]
fn bench_gpu_generation(c: &mut Criterion) {
    let generator = match nano_rspow::WorkGenerator::gpu() {
        Ok(g) => g,
        Err(e) => {
            eprintln!("[bench] skipping GPU benchmarks — no adapter: {e}");
            return;
        }
    };

    // Fast tiers — run with default Criterion sample count.
    {
        let mut group = c.benchmark_group("work_generate/gpu");
        group.throughput(Throughput::Elements(1));

        group.bench_function("dev", |b| {
            b.iter(|| generator.generate(&BENCH_HASH, thresholds::DEV).unwrap());
        });

        group.bench_function("ep2_recv", |b| {
            b.iter(|| {
                generator
                    .generate(&BENCH_HASH, thresholds::EPOCH2_RECEIVE)
                    .unwrap()
            });
        });

        group.finish();
    }

    // Slow tiers — use flat sampling so Criterion doesn't try to collect 100
    // samples at 1-2 s each.  10 samples still gives a usable distribution.
    {
        let mut group = c.benchmark_group("work_generate/gpu/slow");
        group.throughput(Throughput::Elements(1));
        group.sample_size(10);
        group.sampling_mode(SamplingMode::Flat);

        group.bench_function("legacy_epoch1", |b| {
            b.iter(|| generator.generate(&BENCH_HASH, thresholds::LEGACY_EPOCH1).unwrap());
        });

        group.bench_function("ep2_send", |b| {
            b.iter(|| {
                generator
                    .generate(&BENCH_HASH, thresholds::EPOCH2_SEND)
                    .unwrap()
            });
        });

        group.finish();
    }
}

#[cfg(not(feature = "wgpu-backend"))]
fn bench_gpu_generation(_c: &mut Criterion) {}

// ── entry point ───────────────────────────────────────────────────────────────

criterion_group!(
    benches,
    bench_difficulty,
    bench_cpu_generation,
    bench_gpu_generation
);
criterion_main!(benches);
