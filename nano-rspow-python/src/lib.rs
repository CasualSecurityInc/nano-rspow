//! Python bindings for `nano-rspow` — Hybrid CPU/GPU Nano (XNO) Proof of Work.
//!
//! Exposes the core Rust PoW engine to Python via PyO3.
//! The GIL is released during work generation so Python threads remain unblocked.
//!
//! # Usage
//!
//! ```python
//! import nano_rspow
//! from nano_rspow import WorkType
//!
//! # Generate work (releases the GIL and selects an available backend)
//! result = nano_rspow.generate_work(
//!     "718CC2121C3E641059BC1C2CFC45666C99E8AE922F7A807B7D07B62C995D79E2",
//!     WorkType.Send,
//! )
//! print(result.nonce_hex)
//! print(result.is_valid)
//!
//! # Validate existing work
//! valid = nano_rspow.validate_work(
//!     "718CC2121C3E641059BC1C2CFC45666C99E8AE922F7A807B7D07B62C995D79E2",
//!     "2bf29ef00786a6bc",
//!     WorkType.LegacyEpoch1,
//! )
//! ```

use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;

use ::nano_rspow::{WorkGenerator, difficulty, thresholds};
use std::io::{BufRead, Write};
use std::sync::OnceLock;

// ---------------------------------------------------------------------------
// Singleton generator — lazily initialises the best available backend once.
// Mirrors the OnceLock pattern used in the Node.js bindings.
// ---------------------------------------------------------------------------

static GENERATOR: OnceLock<WorkGenerator> = OnceLock::new();

fn get_generator() -> &'static WorkGenerator {
    GENERATOR.get_or_init(WorkGenerator::auto)
}

// ---------------------------------------------------------------------------
// WorkType enum
// ---------------------------------------------------------------------------

/// Nano network work type — determines the difficulty threshold.
///
/// Values mirror the thresholds defined in `nano-rspow/src/thresholds.rs`:
/// - `Send`    → epoch 2 send/change (0xfffffff800000000)
/// - `Receive` → epoch 2 receive     (0xfffffe0000000000)
/// - `LegacyEpoch1` → legacy threshold only (0xffffffc000000000)
/// - `Epoch1`  → deprecated compatibility alias for `LegacyEpoch1`
#[pyclass(eq, eq_int, from_py_object)]
#[derive(Clone, Copy, PartialEq)]
enum WorkType {
    Send = 0,
    Receive = 1,
    Epoch1 = 2,
    LegacyEpoch1 = 3,
}

impl WorkType {
    fn threshold(self) -> u64 {
        match self {
            WorkType::Send => thresholds::EPOCH2_SEND,
            WorkType::Receive => thresholds::EPOCH2_RECEIVE,
            WorkType::Epoch1 | WorkType::LegacyEpoch1 => thresholds::LEGACY_EPOCH1,
        }
    }
}

// ---------------------------------------------------------------------------
// WorkResult class
// ---------------------------------------------------------------------------

/// The result of a PoW generation or validation.
///
/// All fields are read-only properties:
/// - `nonce_hex`      – the work nonce as a 16-char lowercase hex string
/// - `difficulty_hex` – the achieved difficulty as a 16-char lowercase hex string
/// - `is_valid`       – whether difficulty >= threshold
/// - `multiplier`     – difficulty relative to the required threshold
#[pyclass(frozen)]
struct WorkResult {
    nonce: u64,
    difficulty: u64,
    threshold: u64,
}

#[pymethods]
impl WorkResult {
    /// The nonce (work value) as a 16-character lowercase hex string,
    /// matching the format expected by the Nano RPC protocol.
    #[getter]
    fn nonce_hex(&self) -> String {
        format!("{:016x}", self.nonce)
    }

    /// The achieved difficulty as a 16-character lowercase hex string.
    #[getter]
    fn difficulty_hex(&self) -> String {
        format!("{:016x}", self.difficulty)
    }

    /// Returns `True` if the achieved difficulty meets the required threshold.
    #[getter]
    fn is_valid(&self) -> bool {
        self.difficulty >= self.threshold
    }

    /// Difficulty multiplier relative to the required threshold.
    /// A value of 1.0 means exactly at threshold; >1.0 means harder.
    #[getter]
    fn multiplier(&self) -> f64 {
        thresholds::to_multiplier(self.difficulty, self.threshold)
    }

    fn __repr__(&self) -> String {
        format!(
            "WorkResult(nonce='{}', difficulty='{}', valid={})",
            self.nonce_hex(),
            self.difficulty_hex(),
            self.is_valid(),
        )
    }

    fn __str__(&self) -> String {
        self.nonce_hex()
    }
}

// ---------------------------------------------------------------------------
// Helper: parse a 64-char hex string into [u8; 32]
// ---------------------------------------------------------------------------

fn parse_hash(hash_hex: &str) -> PyResult<[u8; 32]> {
    let bytes = hex::decode(hash_hex.trim().trim_start_matches("0x"))
        .map_err(|e| PyValueError::new_err(format!("Invalid hex: {e}")))?;
    let hash: [u8; 32] = bytes
        .try_into()
        .map_err(|_| PyValueError::new_err("Hash must be exactly 32 bytes (64 hex chars)"))?;
    Ok(hash)
}

// ---------------------------------------------------------------------------
// Public API — module-level functions
// ---------------------------------------------------------------------------

/// Generate valid Proof of Work for a Nano block hash.
///
/// Uses the best available backend, preferring a supported GPU and otherwise CPU.
/// The GIL is released during computation, so other Python threads
/// continue to run while the PoW search is in progress.
///
/// Args:
///     hash_hex: The 32-byte block root hash as a 64-char hex string.
///     work_type: A `WorkType` enum value selecting the difficulty threshold.
///
/// Returns:
///     A `WorkResult` containing the valid nonce and achieved difficulty.
///
/// Raises:
///     ValueError: If the hash is not valid hex or not 32 bytes.
///     RuntimeError: If work generation fails.
#[pyfunction]
fn generate_work(py: Python<'_>, hash_hex: &str, work_type: WorkType) -> PyResult<WorkResult> {
    let hash = parse_hash(hash_hex)?;
    let threshold = work_type.threshold();
    let generator = get_generator();

    // Release the GIL during the heavy PoW computation.
    // PyO3 0.28 renamed allow_threads → detach for free-threaded Python compatibility.
    let result = py.detach(move || generator.generate(&hash, threshold));

    match result {
        Some(r) => Ok(WorkResult {
            nonce: r.nonce,
            difficulty: r.difficulty,
            threshold: r.threshold,
        }),
        None => Err(pyo3::exceptions::PyRuntimeError::new_err(
            "Work generation failed or was cancelled",
        )),
    }
}

/// Generate valid Proof of Work for an arbitrary hexadecimal threshold.
#[pyfunction]
fn generate_work_with_threshold(
    py: Python<'_>,
    hash_hex: &str,
    threshold_hex: &str,
) -> PyResult<WorkResult> {
    let hash = parse_hash(hash_hex)?;
    let threshold = u64::from_str_radix(
        threshold_hex.trim().trim_start_matches("0x"),
        16,
    )
    .map_err(|e| PyValueError::new_err(format!("Invalid threshold hex: {e}")))?;
    let generator = get_generator();

    let result = py.detach(move || generator.generate(&hash, threshold));

    match result {
        Some(r) => Ok(WorkResult {
            nonce: r.nonce,
            difficulty: r.difficulty,
            threshold: r.threshold,
        }),
        None => Err(pyo3::exceptions::PyRuntimeError::new_err(
            "Work generation failed or was cancelled",
        )),
    }
}

/// Validate a work nonce against a hash and threshold.
///
/// Args:
///     hash_hex: The 32-byte block root hash as a 64-char hex string.
///     work_hex: The work nonce as a hex string (up to 16 chars).
///     work_type: A `WorkType` enum value selecting the difficulty threshold.
///
/// Returns:
///     `True` if the work meets the threshold, `False` otherwise.
///
/// Raises:
///     ValueError: If the hash or work value is not valid hex.
#[pyfunction]
fn validate_work(hash_hex: &str, work_hex: &str, work_type: WorkType) -> PyResult<bool> {
    let hash = parse_hash(hash_hex)?;
    let nonce = u64::from_str_radix(work_hex.trim(), 16)
        .map_err(|e| PyValueError::new_err(format!("Invalid work hex: {e}")))?;
    let threshold = work_type.threshold();

    let result = ::nano_rspow::work_validate(&hash, nonce, threshold);
    Ok(result.is_valid())
}

/// Compute the raw PoW difficulty for a hash+nonce pair.
///
/// This is a low-level function useful for validation tooling
/// and custom threshold logic.
///
/// Args:
///     hash_hex: The 32-byte block root hash as a 64-char hex string.
///     nonce_hex: The work nonce as a hex string (up to 16 chars).
///
/// Returns:
///     The difficulty as a 16-character lowercase hex string.
///
/// Raises:
///     ValueError: If inputs are not valid hex.
#[pyfunction]
fn compute_difficulty(hash_hex: &str, nonce_hex: &str) -> PyResult<String> {
    let hash = parse_hash(hash_hex)?;
    let nonce = u64::from_str_radix(nonce_hex.trim(), 16)
        .map_err(|e| PyValueError::new_err(format!("Invalid nonce hex: {e}")))?;

    let diff = difficulty::compute(&hash, nonce);
    Ok(format!("{:016x}", diff))
}

/// Return the name of the active compute backend.
///
/// Returns the selected backend name, such as ``"cpu"``, ``"wgpu"``, or ``"opencl"``.
#[pyfunction]
fn backend_name() -> &'static str {
    get_generator().backend_name()
}

const CLI_HELP: &str = "nano-rspow-python generates Nano proof of work from stdin.\n\nUsage:\n  nano-rspow-python [--help]\n\nWith no arguments, read one request per line and write one result per line.\nEmpty lines are ignored. The only accepted argument is --help.\n\nInput:\n  <hash_hex>\n  <hash_hex>:<threshold_hex>\n\nThe optional threshold must use a 0x prefix. Without one, the current\nepoch-2 send/change threshold is used.\n\nOutput:\n  <hash_hex>:0x<threshold_hex>:<work_hex>\n";

fn parse_cli_request(line: &str) -> Result<(String, [u8; 32], u64), String> {
    let parts: Vec<&str> = line.split(':').collect();
    if parts.len() > 2 {
        return Err("request must be <hash_hex> or <hash_hex>:<threshold_hex>".to_owned());
    }

    let hash_text = parts[0].trim().to_owned();
    let hash = parse_hash(&hash_text).map_err(|error| error.to_string())?;
    let threshold = if let Some(threshold_text) = parts.get(1).map(|part| part.trim()) {
        if !threshold_text.starts_with("0x") {
            return Err(format!(
                "threshold {threshold_text:?} must start with 0x"
            ));
        }
        u64::from_str_radix(&threshold_text[2..], 16)
            .map_err(|error| format!("invalid threshold {threshold_text:?}: {error}"))?
    } else {
        thresholds::EPOCH2_SEND
    };

    Ok((hash_text, hash, threshold))
}

/// Run the minimal line-buffered CLI shipped as `nano-rspow-python`.
#[pyfunction]
fn cli_main(py: Python<'_>) -> PyResult<i32> {
    let sys = py.import("sys")?;
    let args: Vec<String> = sys
        .getattr("argv")?
        .extract::<Vec<String>>()?
        .into_iter()
        .skip(1)
        .collect();
    if args == ["--help"] {
        print!("{CLI_HELP}");
        return Ok(0);
    }
    if !args.is_empty() {
        eprintln!("error: only --help is supported");
        eprint!("{CLI_HELP}");
        return Ok(2);
    }

    let generator = get_generator();
    let stdin = std::io::stdin();
    let mut stdout = std::io::BufWriter::new(std::io::stdout());
    for line_result in stdin.lock().lines() {
        let line = line_result.map_err(|error| {
            pyo3::exceptions::PyRuntimeError::new_err(format!("Error reading input: {error}"))
        })?;
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let (hash_text, hash, threshold) = match parse_cli_request(line) {
            Ok(request) => request,
            Err(error) => {
                eprintln!("Error parsing request {line:?}: {error}");
                continue;
            }
        };

        let result = py.detach(move || generator.generate(&hash, threshold));
        let Some(result) = result else {
            eprintln!("Error generating work for {hash_text}: generation failed");
            continue;
        };
        writeln!(
            stdout,
            "{hash_text}:0x{threshold:016x}:{:016x}",
            result.nonce
        )
        .map_err(|error| {
            pyo3::exceptions::PyRuntimeError::new_err(format!("Error writing result: {error}"))
        })?;
        stdout.flush().map_err(|error| {
            pyo3::exceptions::PyRuntimeError::new_err(format!("Error flushing result: {error}"))
        })?;
    }
    Ok(0)
}

// ---------------------------------------------------------------------------
// Threshold constants submodule
// ---------------------------------------------------------------------------

/// Register the ``thresholds`` submodule with Nano PoW threshold constants.
///
/// Constants are sourced from ``nano-rspow/src/thresholds.rs`` and match
/// the values used by rsnano-node and the C++ nano-node.
fn register_thresholds(parent: &Bound<'_, PyModule>) -> PyResult<()> {
    let sub = PyModule::new(parent.py(), "thresholds")?;
    sub.add("EPOCH2_SEND", thresholds::EPOCH2_SEND)?;
    sub.add("EPOCH2_RECEIVE", thresholds::EPOCH2_RECEIVE)?;
    sub.add("LEGACY_EPOCH1", thresholds::LEGACY_EPOCH1)?;
    sub.add("EPOCH1", thresholds::LEGACY_EPOCH1)?;
    sub.add("BETA_LEGACY_EPOCH1", thresholds::BETA_LEGACY_EPOCH1)?;
    sub.add("BETA_EPOCH1", thresholds::BETA_LEGACY_EPOCH1)?;
    sub.add("DEV", thresholds::DEV)?;
    sub.add("BASE", thresholds::BASE)?;
    parent.add_submodule(&sub)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Module definition
// ---------------------------------------------------------------------------

/// Hybrid CPU/GPU Nano (XNO) Proof of Work — Python bindings.
///
/// This module wraps the ``nano-rspow`` Rust library, providing access to
/// the available CPU or GPU work-generation backend.
#[pymodule]
fn nano_rspow(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_class::<WorkType>()?;
    m.add_class::<WorkResult>()?;
    m.add_function(wrap_pyfunction!(generate_work, m)?)?;
    m.add_function(wrap_pyfunction!(generate_work_with_threshold, m)?)?;
    m.add_function(wrap_pyfunction!(validate_work, m)?)?;
    m.add_function(wrap_pyfunction!(compute_difficulty, m)?)?;
    m.add_function(wrap_pyfunction!(backend_name, m)?)?;
    m.add_function(wrap_pyfunction!(cli_main, m)?)?;
    register_thresholds(m)?;
    Ok(())
}
