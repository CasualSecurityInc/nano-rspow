use wasm_bindgen::prelude::*;

mod cpu;
mod webgpu;

macro_rules! console_log {
    ($($t:tt)*) => (
        web_sys::console::log_1(&wasm_bindgen::JsValue::from_str(&format!($($t)*)))
    )
}

#[wasm_bindgen]
pub struct GenerateResult {
    nonce: u64,
    is_gpu: bool,
}

#[wasm_bindgen]
impl GenerateResult {
    #[wasm_bindgen(getter)]
    pub fn nonce(&self) -> String {
        format!("{:016x}", self.nonce)
    }

    #[wasm_bindgen(getter)]
    pub fn is_gpu(&self) -> bool {
        self.is_gpu
    }
}

/// Asynchronously generate Proof of Work for a 32-byte block hash (hex).
///
/// Tries WebGPU first, then falls back to single-threaded CPU WASM.
#[wasm_bindgen]
pub async fn generate_work(
    hash_hex: &str,
    threshold_hex: &str,
) -> Result<GenerateResult, JsValue> {
    console_log!("[WASM] generate_work called. hash: {}, threshold: {}", hash_hex, threshold_hex);
    let hash_bytes = hex::decode(hash_hex)
        .map_err(|e| JsValue::from_str(&format!("Invalid hash hex: {}", e)))?;
    let hash: [u8; 32] = hash_bytes
        .try_into()
        .map_err(|_| JsValue::from_str("Hash must be exactly 32 bytes"))?;

    let threshold = u64::from_str_radix(threshold_hex, 16)
        .map_err(|e| JsValue::from_str(&format!("Invalid threshold hex: {}", e)))?;

    let cancel = nano_rspow::CancelToken::new();

    // 1. WebGPU Primary
    console_log!("[WASM] Auto Mode: Initializing WebGPU...");
    match webgpu::WgpuWebGenerator::new().await {
        Ok(webgpu_gen) => {
            console_log!("[WASM] WebGPU successfully initialized. Starting generation...");
            match webgpu_gen.generate(&hash, threshold, &cancel).await {
                Some(nonce) => {
                    console_log!("[WASM] WebGPU generation succeeded with nonce: {:016x}", nonce);
                    return Ok(GenerateResult { nonce, is_gpu: true });
                }
                None => {
                    console_log!("[WASM] WebGPU generation returned None (cancelled or failed).");
                }
            }
        }
        Err(e) => {
            console_log!("[WASM] WebGPU initialization failed (falling back to CPU): {}", e);
        }
    }

    // 2. CPU Fallback
    console_log!("[WASM] Falling back to CPU generation...");
    let nonce = cpu::generate_cpu(&hash, threshold);
    console_log!("[WASM] CPU generation succeeded with nonce: {:016x}", nonce);
    Ok(GenerateResult { nonce, is_gpu: false })
}


/// Asynchronously generate Proof of Work forcing WebGPU execution.
#[wasm_bindgen]
pub async fn generate_work_gpu(
    hash_hex: &str,
    threshold_hex: &str,
) -> Result<GenerateResult, JsValue> {
    console_log!("[WASM] generate_work_gpu called. hash: {}, threshold: {}", hash_hex, threshold_hex);
    let hash_bytes = hex::decode(hash_hex)
        .map_err(|e| JsValue::from_str(&format!("Invalid hash hex: {}", e)))?;
    let hash: [u8; 32] = hash_bytes
        .try_into()
        .map_err(|_| JsValue::from_str("Hash must be exactly 32 bytes"))?;

    let threshold = u64::from_str_radix(threshold_hex, 16)
        .map_err(|e| JsValue::from_str(&format!("Invalid threshold hex: {}", e)))?;

    let cancel = nano_rspow::CancelToken::new();

    console_log!("[WASM] Force WebGPU: Initializing WebGPU...");
    let webgpu_gen = webgpu::WgpuWebGenerator::new().await
        .map_err(|e| {
            console_log!("[WASM] Force WebGPU: Initialization failed: {}", e);
            JsValue::from_str(&format!("WebGPU initialization failed: {}", e))
        })?;

    console_log!("[WASM] Force WebGPU: Starting generation...");
    if let Some(nonce) = webgpu_gen.generate(&hash, threshold, &cancel).await {
        console_log!("[WASM] Force WebGPU: Succeeded with nonce: {:016x}", nonce);
        return Ok(GenerateResult { nonce, is_gpu: true });
    }

    console_log!("[WASM] Force WebGPU: Work generation failed.");
    Err(JsValue::from_str("WebGPU work generation failed"))
}

/// Synchronously generate Proof of Work forcing single-threaded WASM CPU execution.
#[wasm_bindgen]
pub fn generate_work_cpu(
    hash_hex: &str,
    threshold_hex: &str,
) -> Result<GenerateResult, JsValue> {
    console_log!("[WASM] generate_work_cpu called. hash: {}, threshold: {}", hash_hex, threshold_hex);
    let hash_bytes = hex::decode(hash_hex)
        .map_err(|e| JsValue::from_str(&format!("Invalid hash hex: {}", e)))?;
    let hash: [u8; 32] = hash_bytes
        .try_into()
        .map_err(|_| JsValue::from_str("Hash must be exactly 32 bytes"))?;

    let threshold = u64::from_str_radix(threshold_hex, 16)
        .map_err(|e| JsValue::from_str(&format!("Invalid threshold hex: {}", e)))?;

    console_log!("[WASM] Force CPU: Starting synchronous generation...");
    let nonce = cpu::generate_cpu(&hash, threshold);
    console_log!("[WASM] Force CPU: Succeeded with nonce: {:016x}", nonce);
    Ok(GenerateResult { nonce, is_gpu: false })
}

/// Synchronously validate if a nonce meets the difficulty threshold for a given block hash.

#[wasm_bindgen]
pub fn validate_work(
    hash_hex: &str,
    nonce_hex: &str,
    threshold_hex: &str,
) -> Result<bool, JsValue> {
    let hash_bytes = hex::decode(hash_hex)
        .map_err(|e| JsValue::from_str(&format!("Invalid hash hex: {}", e)))?;
    let hash: [u8; 32] = hash_bytes
        .try_into()
        .map_err(|_| JsValue::from_str("Hash must be exactly 32 bytes"))?;

    let nonce = u64::from_str_radix(nonce_hex, 16)
        .map_err(|e| JsValue::from_str(&format!("Invalid nonce hex: {}", e)))?;

    let threshold = u64::from_str_radix(threshold_hex, 16)
        .map_err(|e| JsValue::from_str(&format!("Invalid threshold hex: {}", e)))?;

    Ok(nano_rspow::work_validate(&hash, nonce, threshold).is_valid())
}
