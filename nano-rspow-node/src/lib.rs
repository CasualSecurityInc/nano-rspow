#![deny(clippy::all)]

use nano_rspow::{WorkGenerator, thresholds};
use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::sync::OnceLock;

static GENERATOR: OnceLock<WorkGenerator> = OnceLock::new();

fn get_generator() -> &'static WorkGenerator {
    GENERATOR.get_or_init(WorkGenerator::auto)
}

#[napi(string_enum)]
pub enum WorkType {
    /// Current mainnet threshold for send and change blocks.
    Send,
    /// Current mainnet threshold for receive, open, and epoch blocks.
    Receive,
}

impl WorkType {
    fn threshold(&self) -> u64 {
        match self {
            WorkType::Send => thresholds::current::SEND,
            WorkType::Receive => thresholds::current::RECEIVE,
        }
    }
}

/// Historical threshold presets. Pass their hexadecimal value to the explicit
/// custom-threshold APIs; they are not current mainnet work types.
#[napi(string_enum)]
pub enum LegacyWorkType {
    /// Epoch 1 mainnet threshold.
    Epoch1,
}

impl LegacyWorkType {
    fn threshold(&self) -> u64 {
        match self {
            LegacyWorkType::Epoch1 => thresholds::legacy::EPOCH1,
        }
    }
}

/// Test-only threshold presets. Do not use them for a published mainnet block.
#[napi(string_enum)]
pub enum TestingWorkType {
    /// Low-difficulty development threshold.
    Dev,
}

impl TestingWorkType {
    fn threshold(&self) -> u64 {
        match self {
            TestingWorkType::Dev => thresholds::testing::DEV,
        }
    }
}

pub struct GenerateTask {
    hash: [u8; 32],
    threshold: u64,
}

#[napi]
impl Task for GenerateTask {
    type Output = String;
    type JsValue = String;

    fn compute(&mut self) -> Result<Self::Output> {
        let generator = get_generator();

        let result = generator
            .generate(&self.hash, self.threshold)
            .ok_or_else(|| {
                Error::new(
                    Status::GenericFailure,
                    "Work generation failed or cancelled".to_string(),
                )
            })?;

        Ok(result.nonce_hex())
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

#[napi]
pub fn generate_work(hash_hex: String, work_type: WorkType) -> Result<AsyncTask<GenerateTask>> {
    let bytes = hex::decode(hash_hex.trim().trim_start_matches("0x"))
        .map_err(|e| Error::new(Status::InvalidArg, format!("Invalid hex: {}", e)))?;

    let hash: [u8; 32] = bytes.try_into().map_err(|_| {
        Error::new(
            Status::InvalidArg,
            "Hash must be exactly 32 bytes (64 hex chars)".to_string(),
        )
    })?;

    let threshold = work_type.threshold();

    Ok(AsyncTask::new(GenerateTask { hash, threshold }))
}

/// Generates work for an arbitrary hexadecimal threshold.
///
/// Use this API when a node or integration requires a threshold stricter than
/// the current mainnet presets, or when handling historical work.
#[napi]
pub fn generate_work_with_threshold(
    hash_hex: String,
    threshold_hex: String,
) -> Result<AsyncTask<GenerateTask>> {
    let bytes = hex::decode(hash_hex.trim().trim_start_matches("0x"))
        .map_err(|e| Error::new(Status::InvalidArg, format!("Invalid hex: {}", e)))?;

    let hash: [u8; 32] = bytes.try_into().map_err(|_| {
        Error::new(
            Status::InvalidArg,
            "Hash must be exactly 32 bytes (64 hex chars)".to_string(),
        )
    })?;

    let threshold = u64::from_str_radix(threshold_hex.trim().trim_start_matches("0x"), 16)
        .map_err(|e| Error::new(Status::InvalidArg, format!("Invalid threshold hex: {}", e)))?;

    Ok(AsyncTask::new(GenerateTask { hash, threshold }))
}

#[napi]
pub fn validate_work(hash_hex: String, work_hex: String, work_type: WorkType) -> Result<bool> {
    let hash_bytes = hex::decode(hash_hex.trim().trim_start_matches("0x"))
        .map_err(|e| Error::new(Status::InvalidArg, format!("Invalid hash hex: {}", e)))?;
    let hash: [u8; 32] = hash_bytes
        .try_into()
        .map_err(|_| Error::new(Status::InvalidArg, "Hash must be 64 hex chars".to_string()))?;

    let work = u64::from_str_radix(work_hex.trim(), 16)
        .map_err(|e| Error::new(Status::InvalidArg, format!("Invalid work hex: {}", e)))?;

    let result = nano_rspow::work_validate(&hash, work, work_type.threshold());
    Ok(result.is_valid())
}

/// Validates work against an arbitrary hexadecimal threshold.
#[napi]
pub fn validate_work_with_threshold(
    hash_hex: String,
    work_hex: String,
    threshold_hex: String,
) -> Result<bool> {
    let hash_bytes = hex::decode(hash_hex.trim().trim_start_matches("0x"))
        .map_err(|e| Error::new(Status::InvalidArg, format!("Invalid hash hex: {}", e)))?;
    let hash: [u8; 32] = hash_bytes
        .try_into()
        .map_err(|_| Error::new(Status::InvalidArg, "Hash must be 64 hex chars".to_string()))?;

    let work = u64::from_str_radix(work_hex.trim().trim_start_matches("0x"), 16)
        .map_err(|e| Error::new(Status::InvalidArg, format!("Invalid work hex: {}", e)))?;
    let threshold = u64::from_str_radix(threshold_hex.trim().trim_start_matches("0x"), 16)
        .map_err(|e| Error::new(Status::InvalidArg, format!("Invalid threshold hex: {}", e)))?;

    let result = nano_rspow::work_validate(&hash, work, threshold);
    Ok(result.is_valid())
}

#[napi]
pub fn get_backend_name() -> String {
    get_generator().backend_name().to_string()
}

#[napi]
pub fn recommend_local_pow() -> bool {
    nano_rspow::recommend_local_pow()
}

#[napi]
pub fn clear_pow_tuning_cache() -> bool {
    nano_rspow::clear_pow_tuning_cache()
}

#[napi]
pub fn work_type_to_hex(work_type: WorkType) -> String {
    format!("{:016x}", work_type.threshold())
}

/// Returns the hexadecimal threshold for a historical preset.
#[napi]
pub fn legacy_work_type_to_hex(work_type: LegacyWorkType) -> String {
    format!("{:016x}", work_type.threshold())
}

/// Returns the hexadecimal threshold for a test-only preset.
#[napi]
pub fn testing_work_type_to_hex(work_type: TestingWorkType) -> String {
    format!("{:016x}", work_type.threshold())
}
