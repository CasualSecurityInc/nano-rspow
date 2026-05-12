#![deny(clippy::all)]

use napi::bindgen_prelude::*;
use napi_derive::napi;
use nano_rspow::{WorkGenerator, thresholds};
use std::sync::OnceLock;

static GENERATOR: OnceLock<WorkGenerator> = OnceLock::new();

fn get_generator() -> &'static WorkGenerator {
    GENERATOR.get_or_init(|| WorkGenerator::auto())
}

#[napi(string_enum)]
pub enum WorkType {
    Send,
    Receive,
    Epoch1,
    Dev,
}

impl WorkType {
    fn threshold(&self) -> u64 {
        match self {
            WorkType::Send => thresholds::EPOCH2_SEND,
            WorkType::Receive => thresholds::EPOCH2_RECEIVE,
            WorkType::Epoch1 => thresholds::EPOCH1,
            WorkType::Dev => thresholds::DEV,
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
        
        let result = generator.generate(&self.hash, self.threshold)
            .ok_or_else(|| Error::new(Status::GenericFailure, "Work generation failed or cancelled".to_string()))?;
            
        Ok(result.nonce_hex())
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

#[napi]
pub fn generate_work(hash_hex: String, work_type: WorkType) -> Result<AsyncTask<GenerateTask>> {
    let bytes = hex::decode(hash_hex.trim())
        .map_err(|e| Error::new(Status::InvalidArg, format!("Invalid hex: {}", e)))?;
        
    let hash: [u8; 32] = bytes.try_into()
        .map_err(|_| Error::new(Status::InvalidArg, "Hash must be exactly 32 bytes (64 hex chars)".to_string()))?;

    let threshold = work_type.threshold();

    Ok(AsyncTask::new(GenerateTask { hash, threshold }))
}

#[napi]
pub fn validate_work(hash_hex: String, work_hex: String, work_type: WorkType) -> Result<bool> {
    let hash_bytes = hex::decode(hash_hex.trim())
        .map_err(|e| Error::new(Status::InvalidArg, format!("Invalid hash hex: {}", e)))?;
    let hash: [u8; 32] = hash_bytes.try_into()
        .map_err(|_| Error::new(Status::InvalidArg, "Hash must be 64 hex chars".to_string()))?;

    let work = u64::from_str_radix(work_hex.trim(), 16)
        .map_err(|e| Error::new(Status::InvalidArg, format!("Invalid work hex: {}", e)))?;

    let result = nano_rspow::work_validate(&hash, work, work_type.threshold());
    Ok(result.is_valid())
}
