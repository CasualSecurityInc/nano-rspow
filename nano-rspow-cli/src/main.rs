//! nano-rspow CLI
//!
//! Commands:
//!   generate <hash> [--threshold <hex>] [--backend <cpu|gpu>]
//!   validate  <hash> <work>  [--threshold <hex>]
//!   benchmark [--count <n>] [--format <table|markdown>]
//!   info

use std::time::Instant;

use clap::{Parser, Subcommand, ValueEnum};
use nano_rspow::{GpuDiagnostics, WgpuConfig, WorkGenerator, difficulty, thresholds};

#[derive(Parser)]
#[command(
    name = "nano-rspow",
    version,
    about = "Hybrid CPU/GPU Nano (XNO) Proof of Work — nano-rspow",
    long_about = None
)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Generate work for a 32-byte block hash (hex encoded)
    Generate {
        /// Block root hash (64 hex chars). Optional if --stream is used.
        hash: Option<String>,

        /// Run in stdio streaming mode (read lines from stdin)
        #[arg(long)]
        stream: bool,

        /// Difficulty threshold (hex, default: epoch2 send)
        #[arg(short, long, default_value = "fffffff800000000")]
        threshold: String,

        /// Backend to use: cpu, gpu, opencl
        #[arg(short, long, default_value = "gpu")]
        backend: String,

        /// For GPU backend: bypass cache and run dispatch tuning probe
        #[arg(long)]
        retune: bool,
    },

    /// Validate that a work value meets the threshold for a hash
    Validate {
        /// Block root hash (64 hex chars)
        hash: String,

        /// Work value (16 hex chars)
        work: String,

        /// Difficulty threshold (hex, default: epoch2 send)
        #[arg(short, long, default_value = "fffffff800000000")]
        threshold: String,
    },

    /// Run benchmarks across all available backends and print a report
    Benchmark {
        /// Number of PoW generations per backend per tier
        #[arg(short, long, default_value_t = 5)]
        count: usize,

        /// Output format: table (ASCII) or markdown
        #[arg(short, long, default_value = "table")]
        format: String,

        /// Hash to use for benchmarking (64 hex chars)
        #[arg(
            short = 'H',
            long,
            // Default to a known-good test vector hash from the official nano-node
            default_value = "718CC2121C3E641059BC1C2CFC45666C99E8AE922F7A807B7D07B62C995D79E2"
        )]
        hash: String,

        /// Benchmark mode: cold (construct backend in timed loop), warm (reuse backend), or both
        #[arg(long, value_enum, default_value_t = BenchMode::Both)]
        mode: BenchMode,

        /// For GPU backend: bypass cache and run dispatch tuning probe
        #[arg(long)]
        retune: bool,
    },

    /// Print information about available backends and GPU
    Info,

    /// Print detailed backend diagnostics
    Diag {
        #[arg(long, default_value = "gpu")]
        backend: String,
        #[arg(long)]
        retune: bool,
        #[arg(long, default_value = "table")]
        format: String,
    },
}

#[derive(Clone, Copy, Debug, ValueEnum, PartialEq, Eq)]
enum BenchMode {
    Cold,
    Warm,
    Both,
}

fn parse_hash(s: &str) -> Result<[u8; 32], String> {
    let bytes = hex::decode(s.trim().trim_start_matches("0x")).map_err(|e| format!("invalid hex: {e}"))?;
    bytes
        .try_into()
        .map_err(|_| "hash must be exactly 32 bytes (64 hex chars)".into())
}

fn parse_threshold(s: &str) -> Result<u64, String> {
    u64::from_str_radix(s.trim_start_matches("0x"), 16)
        .map_err(|e| format!("invalid threshold hex: {e}"))
}

fn parse_work(s: &str) -> Result<u64, String> {
    u64::from_str_radix(s.trim_start_matches("0x"), 16)
        .map_err(|e| format!("invalid work hex: {e}"))
}

fn main() {
    let cli = Cli::parse();

    match cli.command {
        Commands::Info => cmd_info(),
        Commands::Diag { backend, retune, format } => cmd_diag(&backend, retune, &format),
        Commands::Generate { hash, stream, threshold, backend, retune } => {
            cmd_generate(hash.as_deref(), stream, &threshold, &backend, retune)
        }
        Commands::Validate { hash, work, threshold } => cmd_validate(&hash, &work, &threshold),
        Commands::Benchmark { count, format, hash, mode, retune } => cmd_benchmark(count, &format, &hash, mode, retune),
    }
}

// ──────────────────────────────────────────────────────────────────────────────

fn cmd_info() {
    println!("nano-rspow v{}", env!("CARGO_PKG_VERSION"));
    println!();
    println!("Compiled backends:");

    println!("  [✓] cpu     — always available");

    #[cfg(feature = "wgpu-backend")]
    {
        match WorkGenerator::gpu() {
            Ok(g) => {
                println!("  [✓] gpu     — {} (wgpu)", g.backend_name());
                if let Some(d) = g.diagnostics().gpu {
                    println!("      adapter : {} [{}]", d.adapter_name, d.backend_api);
                    println!("      dispatch: {} ({:?})", d.dispatch_x, d.tuning_source);
                }
            }
            Err(e) => println!("  [✗] gpu     — wgpu unavailable: {e}"),
        }
    }
    #[cfg(not(feature = "wgpu-backend"))]
    println!("  [✗] wgpu    — not compiled (enable feature 'wgpu-backend')");

    #[cfg(feature = "opencl")]
    {
        match WorkGenerator::opencl(Default::default()) {
            Ok(g) => println!("  [✓] opencl  — {} (opencl)", g.backend_name()),
            Err(e) => println!("  [✗] opencl  — opencl unavailable: {e}"),
        }
    }
    #[cfg(not(feature = "opencl"))]
    println!("  [✗] opencl  — not compiled (enable feature 'opencl')");

    println!("  [✗] cuda    — not compiled (see feat/cuda-oxide branch)");
    println!();
    println!("Thresholds:");
    println!("  epoch2 send    = {:#018x}", thresholds::EPOCH2_SEND);
    println!("  epoch2 receive = {:#018x}", thresholds::EPOCH2_RECEIVE);
    println!("  epoch1         = {:#018x}", thresholds::EPOCH1);
    println!("  dev (testing)  = {:#018x}", thresholds::DEV);
}

fn print_gpu_diag_table(d: &GpuDiagnostics) {
    println!("backend_api : {}", d.backend_api);
    println!("adapter     : {}", d.adapter_name);
    println!("driver      : {}", d.driver_info);
    println!("vendor_id   : {}", d.vendor_id);
    println!("device_id   : {}", d.device_id);
    println!("max_dispatch: {}", d.max_compute_workgroups_per_dimension);
    println!("dispatch_x  : {}", d.dispatch_x);
    println!("nonces/disp : {}", d.nonces_per_dispatch);
    println!("tuning      : {:?}", d.tuning_source);
    if let Some(path) = &d.cache_path {
        println!("cache_path  : {}", path.display());
    }
}

fn print_gpu_diag_json(d: &GpuDiagnostics) {
    let backend_api = d.backend_api.replace('\"', "\\\"");
    let adapter_name = d.adapter_name.replace('\"', "\\\"");
    let driver_info = d.driver_info.replace('\"', "\\\"");
    let cache_path = d
        .cache_path
        .as_ref()
        .map(|p| p.display().to_string())
        .unwrap_or_default()
        .replace('\"', "\\\"");
    println!(
        "{{\"backend_api\":\"{}\",\"adapter_name\":\"{}\",\"driver_info\":\"{}\",\"vendor_id\":{},\"device_id\":{},\"max_compute_workgroups_per_dimension\":{},\"dispatch_x\":{},\"nonces_per_dispatch\":{},\"tuning_source\":\"{:?}\",\"cache_path\":\"{}\"}}",
        backend_api,
        adapter_name,
        driver_info,
        d.vendor_id,
        d.device_id,
        d.max_compute_workgroups_per_dimension,
        d.dispatch_x,
        d.nonces_per_dispatch,
        d.tuning_source,
        cache_path,
    );
}

fn cmd_diag(backend: &str, retune: bool, format: &str) {
    let generator = match backend {
        "gpu" => {
            #[cfg(feature = "wgpu-backend")]
            {
                WorkGenerator::gpu_with_config(WgpuConfig { retune, ..Default::default() }).ok()
            }
            #[cfg(not(feature = "wgpu-backend"))]
            {
                None
            }
        }
        "cpu" => Some(WorkGenerator::cpu()),
        "opencl" => {
            #[cfg(feature = "opencl")]
            {
                WorkGenerator::opencl(Default::default()).ok()
            }
            #[cfg(not(feature = "opencl"))]
            {
                None
            }
        }
        _ => None,
    };

    let Some(generator) = generator else {
        eprintln!("backend unavailable: {backend}");
        std::process::exit(1);
    };
    let diag = generator.diagnostics();
    if let Some(gpu) = diag.gpu {
        if format == "json" {
            print_gpu_diag_json(&gpu);
        } else {
            print_gpu_diag_table(&gpu);
        }
    } else {
        if format == "json" {
            println!("{{\"backend\":\"{}\",\"gpu\":null}}", diag.backend);
        } else {
            println!("backend: {}", diag.backend);
            println!("gpu: none");
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────────

fn cmd_generate(hash_opt: Option<&str>, stream: bool, threshold_str: &str, backend_str: &str, retune: bool) {
    if !stream && hash_opt.is_none() {
        eprintln!("Error: must provide a hash unless using --stream");
        std::process::exit(1);
    }

    let default_threshold = match parse_threshold(threshold_str) {
        Ok(t) => t,
        Err(e) => { eprintln!("Error: {e}"); std::process::exit(1); }
    };

    let generator = match backend_str {
        "cpu" => WorkGenerator::cpu(),
        "gpu" => {
            #[cfg(feature = "wgpu-backend")]
            {
                match WorkGenerator::gpu_with_config(WgpuConfig { retune, ..Default::default() }) {
                    Ok(g) => g,
                    Err(e) => {
                        eprintln!("GPU unavailable ({e}), falling back to CPU");
                        WorkGenerator::cpu()
                    }
                }
            }
            #[cfg(not(feature = "wgpu-backend"))]
            {
                eprintln!("wgpu not compiled; using CPU");
                WorkGenerator::cpu()
            }
        }
        "opencl" => {
            #[cfg(feature = "opencl")]
            {
                match WorkGenerator::opencl(Default::default()) {
                    Ok(g) => g,
                    Err(e) => {
                        eprintln!("OpenCL unavailable ({e}), falling back to CPU");
                        WorkGenerator::cpu()
                    }
                }
            }
            #[cfg(not(feature = "opencl"))]
            {
                eprintln!("opencl not compiled; using CPU");
                WorkGenerator::cpu()
            }
        }
        _ => {
            eprintln!("Unknown backend '{}'. Use 'cpu', 'gpu', or 'opencl'.", backend_str);
            std::process::exit(1);
        }
    };

    if stream {
        use std::io::BufRead;
        let stdin = std::io::stdin();
        for line in stdin.lock().lines() {
            let line = line.unwrap_or_default();
            let line = line.trim();
            if line.is_empty() {
                continue;
            }

            let mut parts = line.split(':');
            let hash_str = parts.next().unwrap_or("");
            let line_threshold_str = parts.next();

            let hash = match parse_hash(hash_str) {
                Ok(h) => h,
                Err(e) => {
                    eprintln!("Error parsing hash '{hash_str}': {e}");
                    continue;
                }
            };

            let current_threshold = if let Some(ts) = line_threshold_str {
                match parse_threshold(ts) {
                    Ok(t) => t,
                    Err(e) => {
                        eprintln!("Error parsing threshold '{ts}': {e}");
                        continue;
                    }
                }
            } else {
                default_threshold
            };

            match generator.generate(&hash, current_threshold) {
                Some(result) => {
                    println!("{}:{}", hash_str, result.nonce_hex());
                }
                None => {
                    eprintln!("Generation was cancelled for {hash_str}.");
                }
            }
        }
    } else {
        let hash_str = hash_opt.unwrap();
        let hash = parse_hash(hash_str).unwrap(); // already validated or exits above

        println!("Backend  : {}", generator.backend_name());
        println!("Hash     : {hash_str}");
        println!("Threshold: {default_threshold:#018x}");
        print!("Generating...");

        let t0 = Instant::now();
        match generator.generate(&hash, default_threshold) {
            Some(result) => {
                let elapsed = t0.elapsed();
                println!("\r");
                println!("Work      : {}", result.nonce_hex());
                println!("Difficulty: {} ({:#018x})", result.difficulty, result.difficulty);
                println!("Multiplier: {:.4}x", result.multiplier());
                println!("Time      : {:.3}s", elapsed.as_secs_f64());
            }
            None => {
                eprintln!("Generation was cancelled.");
                std::process::exit(1);
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────────

fn cmd_validate(hash_str: &str, work_str: &str, threshold_str: &str) {
    let hash = match parse_hash(hash_str) {
        Ok(h) => h,
        Err(e) => { eprintln!("{e}"); std::process::exit(1); }
    };
    let work = match parse_work(work_str) {
        Ok(w) => w,
        Err(e) => { eprintln!("{e}"); std::process::exit(1); }
    };
    let threshold = match parse_threshold(threshold_str) {
        Ok(t) => t,
        Err(e) => { eprintln!("{e}"); std::process::exit(1); }
    };

    let diff = difficulty::compute(&hash, work);
    let valid = diff >= threshold;

    println!("Hash      : {hash_str}");
    println!("Work      : {work_str}");
    println!("Threshold : {threshold:#018x}");
    println!("Difficulty: {diff:#018x}");
    println!("Valid     : {}", if valid { "✓ YES" } else { "✗ NO" });

    if !valid {
        std::process::exit(1);
    }
}

// ──────────────────────────────────────────────────────────────────────────────

struct BenchRow {
    backend: &'static str,
    mode: &'static str,
    threshold_name: &'static str,
    threshold: u64,
    samples: usize,
    min_ms: f64,
    max_ms: f64,
    mean_ms: f64,
    median_ms: f64,
}

fn run_backend_bench_warm(
    generator: &WorkGenerator,
    hash: &[u8; 32],
    threshold: u64,
    count: usize,
    threshold_name: &'static str,
) -> BenchRow {
    let mut timings: Vec<f64> = Vec::with_capacity(count);
    eprint!("  warm {} × {} ... ", count, threshold_name);
    for _ in 0..count {
        let t0 = Instant::now();
        generator.generate(hash, threshold).expect("generation must succeed");
        timings.push(t0.elapsed().as_secs_f64() * 1000.0);
    }
    timings.sort_by(|a, b| a.partial_cmp(b).unwrap());

    let min = timings.first().copied().unwrap_or(0.0);
    let max = timings.last().copied().unwrap_or(0.0);
    let mean = timings.iter().sum::<f64>() / timings.len() as f64;
    let median = timings[timings.len() / 2];

    eprintln!("done (median {median:.1}ms)");

    BenchRow {
        backend: generator.backend_name(),
        mode: "warm",
        threshold_name,
        threshold,
        samples: count,
        min_ms: min,
        max_ms: max,
        mean_ms: mean,
        median_ms: median,
    }
}

fn run_backend_bench_cold(
    backend_label: &'static str,
    make_generator: impl Fn() -> Option<WorkGenerator>,
    hash: &[u8; 32],
    threshold: u64,
    count: usize,
    threshold_name: &'static str,
) -> Option<BenchRow> {
    let mut timings: Vec<f64> = Vec::with_capacity(count);
    eprint!("  cold {} × {} ... ", count, threshold_name);
    for _ in 0..count {
        let t0 = Instant::now();
        let generator = make_generator()?;
        generator.generate(hash, threshold).expect("generation must succeed");
        timings.push(t0.elapsed().as_secs_f64() * 1000.0);
    }
    timings.sort_by(|a, b| a.partial_cmp(b).unwrap());

    let min = timings.first().copied().unwrap_or(0.0);
    let max = timings.last().copied().unwrap_or(0.0);
    let mean = timings.iter().sum::<f64>() / timings.len() as f64;
    let median = timings[timings.len() / 2];
    eprintln!("done (median {median:.1}ms)");

    Some(BenchRow {
        backend: backend_label,
        mode: "cold",
        threshold_name,
        threshold,
        samples: count,
        min_ms: min,
        max_ms: max,
        mean_ms: mean,
        median_ms: median,
    })
}

fn cmd_benchmark(count: usize, format: &str, hash_str: &str, mode: BenchMode, retune: bool) {
    let hash = match parse_hash(hash_str) {
        Ok(h) => h,
        Err(e) => { eprintln!("Error: {e}"); std::process::exit(1); }
    };

    println!("nano-rspow benchmark");
    println!("  Hash    : {hash_str}");
    println!("  Samples : {count} per backend per tier");
    println!("  Mode    : {}", match mode { BenchMode::Cold => "cold", BenchMode::Warm => "warm", BenchMode::Both => "both" });
    println!();

    let tiers: &[(&'static str, u64)] = &[
        ("dev",    thresholds::DEV),
        ("ep2_recv", thresholds::EPOCH2_RECEIVE),
        ("epoch1", thresholds::EPOCH1),
        ("ep2_send", thresholds::EPOCH2_SEND),
    ];

    let mut rows: Vec<BenchRow> = Vec::new();

    // ── CPU backend ──
    {
        eprintln!("CPU backend:");
        if mode != BenchMode::Warm {
            for &(name, thresh) in tiers {
                if let Some(row) = run_backend_bench_cold("cpu", || Some(WorkGenerator::cpu()), &hash, thresh, count, name) {
                    rows.push(row);
                }
            }
        }
        if mode != BenchMode::Cold {
            let generator = WorkGenerator::cpu();
            generator.generate(&hash, thresholds::DEV);
            for &(name, thresh) in tiers {
                rows.push(run_backend_bench_warm(&generator, &hash, thresh, count, name));
            }
        }
    }

    // ── wgpu GPU backend ──
    #[cfg(feature = "wgpu-backend")]
    {
        match WorkGenerator::gpu_with_config(WgpuConfig { retune, ..Default::default() }) {
            Ok(generator) => {
                eprintln!("wgpu GPU backend:");
                if mode != BenchMode::Warm {
                    for &(name, thresh) in tiers {
                        if let Some(row) = run_backend_bench_cold("wgpu", || WorkGenerator::gpu_with_config(WgpuConfig { retune, ..Default::default() }).ok(), &hash, thresh, count, name) {
                            rows.push(row);
                        } else {
                            eprintln!("  wgpu GPU backend became unavailable during cold mode");
                            break;
                        }
                    }
                }
                if mode != BenchMode::Cold {
                    generator.generate(&hash, thresholds::DEV);
                    for &(name, thresh) in tiers {
                        rows.push(run_backend_bench_warm(&generator, &hash, thresh, count, name));
                    }
                }
            }
            Err(e) => {
                eprintln!("wgpu GPU backend: unavailable — {e}");
            }
        }
    }

    // ── OpenCL GPU backend ──
    #[cfg(feature = "opencl")]
    {
        match WorkGenerator::opencl(Default::default()) {
            Ok(generator) => {
                eprintln!("OpenCL GPU backend:");
                if mode != BenchMode::Warm {
                    for &(name, thresh) in tiers {
                        if let Some(row) = run_backend_bench_cold("opencl", || WorkGenerator::opencl(Default::default()).ok(), &hash, thresh, count, name) {
                            rows.push(row);
                        } else {
                            eprintln!("  OpenCL backend became unavailable during cold mode");
                            break;
                        }
                    }
                }
                if mode != BenchMode::Cold {
                    generator.generate(&hash, thresholds::DEV);
                    for &(name, thresh) in tiers {
                        rows.push(run_backend_bench_warm(&generator, &hash, thresh, count, name));
                    }
                }
            }
            Err(e) => {
                eprintln!("OpenCL GPU backend: unavailable — {e}");
            }
        }
    }

    println!();
    match format {
        "markdown" => print_markdown_table(&rows),
        _ => print_ascii_table(&rows),
    }
}

fn print_ascii_table(rows: &[BenchRow]) {
    let header = format!(
        "{:<10} {:<6} {:<14} {:<22} {:<8} {:>10} {:>10} {:>10} {:>10}",
        "Backend", "Mode", "Tier", "Threshold", "Samples", "Min(ms)", "Max(ms)", "Mean(ms)", "Median(ms)"
    );
    let sep = "─".repeat(header.len() + 2);

    println!("{sep}");
    println!("{header}");
    println!("{sep}");

    for r in rows {
        println!(
            "{:<10} {:<6} {:<14} {:#018x}     {:<8} {:>10.1} {:>10.1} {:>10.1} {:>10.1}",
            r.backend, r.mode, r.threshold_name, r.threshold, r.samples,
            r.min_ms, r.max_ms, r.mean_ms, r.median_ms
        );
    }

    println!("{sep}");
    println!();
    println!(
        "Tiers benchmarked: dev={:#018x} ep2_recv={:#018x} epoch1={:#018x} ep2_send={:#018x}",
        thresholds::DEV,
        thresholds::EPOCH2_RECEIVE,
        thresholds::EPOCH1,
        thresholds::EPOCH2_SEND
    );
}

fn print_markdown_table(rows: &[BenchRow]) {
    println!("## nano-rspow Benchmark Results");
    println!();
    println!("| Backend | Mode | Tier | Threshold | Samples | Min (ms) | Max (ms) | Mean (ms) | Median (ms) |");
    println!("|---------|------|------|-----------|--------:|---------:|---------:|----------:|------------:|");

    for r in rows {
        println!(
            "| `{}` | `{}` | `{}` | `{:#018x}` | {} | {:.1} | {:.1} | {:.1} | {:.1} |",
            r.backend, r.mode, r.threshold_name, r.threshold, r.samples,
            r.min_ms, r.max_ms, r.mean_ms, r.median_ms
        );
    }

    println!();
    println!("> Tiers benchmarked: `dev`, `ep2_recv`, `epoch1`, `ep2_send`.");
}
