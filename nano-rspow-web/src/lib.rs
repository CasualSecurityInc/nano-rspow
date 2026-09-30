use wasm_bindgen::prelude::*;

mod cpu;
mod webgpu;

macro_rules! console_log {
    ($($t:tt)*) => (
        web_sys::console::log_1(&wasm_bindgen::JsValue::from_str(&format!($($t)*)))
    )
}

/// A cancellation handle that can be passed to `generate_work_gpu` and
/// called from JavaScript to stop the GPU batch loop.
#[wasm_bindgen]
pub struct WasmCancelToken(nano_rspow::CancelToken);

#[wasm_bindgen]
impl WasmCancelToken {
    #[wasm_bindgen(constructor)]
    pub fn new() -> WasmCancelToken {
        WasmCancelToken(nano_rspow::CancelToken::new())
    }

    pub fn cancel(&self) {
        self.0.cancel();
    }
}

impl Default for WasmCancelToken {
    fn default() -> Self {
        Self::new()
    }
}

/// Try up to `max_nonces` nonces at an arbitrary hexadecimal threshold in a
/// single synchronous batch.
/// Returns the nonce as a hex string if found, or `null` if the batch
/// was exhausted. RNG state persists across calls.
#[wasm_bindgen]
pub fn generate_work_cpu_batch(
    hash_hex: &str,
    threshold_hex: &str,
    max_nonces: u32,
) -> Result<JsValue, JsValue> {
    let hash_bytes = hex::decode(hash_hex)
        .map_err(|e| JsValue::from_str(&format!("Invalid hash hex: {}", e)))?;
    let hash: [u8; 32] = hash_bytes
        .try_into()
        .map_err(|_| JsValue::from_str("Hash must be exactly 32 bytes"))?;
    let threshold = u64::from_str_radix(threshold_hex, 16)
        .map_err(|e| JsValue::from_str(&format!("Invalid threshold hex: {}", e)))?;
    match cpu::generate_cpu_batch(&hash, threshold, max_nonces) {
        Some(nonce) => Ok(JsValue::from_str(&format!("{:016x}", nonce))),
        None => Ok(JsValue::NULL),
    }
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

/// Measure whether this browser can reasonably perform local proof-of-work.
///
/// A usable WebGPU pipeline is always recommended. Without WebGPU, the
/// single-threaded WASM CPU fallback must sustain the same 15 MH/s threshold
/// used by the native recommendation before it is recommended.
#[wasm_bindgen]
pub async fn probe_local_pow() -> bool {
    // Warming the shared generator answers the capability question with the
    // same full construction a real work call needs, and leaves the device and
    // pipeline ready for the first `generate_work` instead of throwing them
    // away. The gate is released before the CPU benchmark below, so a
    // concurrent generation is never blocked for its full duration.
    if webgpu::warm_up().await.is_ok() {
        return true;
    }

    let hash = [0u8; 32];
    let started_at = js_sys::Date::now();
    let mut hashes = 0_u64;

    while js_sys::Date::now() - started_at < 10.0 {
        let _ = cpu::generate_cpu_batch(&hash, u64::MAX, 1_000);
        hashes += 1_000;
    }

    let elapsed_seconds = (js_sys::Date::now() - started_at) / 1_000.0;
    elapsed_seconds > 0.0 && (hashes as f64 / elapsed_seconds) >= 15_000_000.0
}

/// Asynchronously generate Proof of Work for a 32-byte block hash and an
/// arbitrary hexadecimal threshold.
///
/// Tries WebGPU first, then falls back to single-threaded CPU WASM.
#[wasm_bindgen]
pub async fn generate_work(hash_hex: &str, threshold_hex: &str) -> Result<GenerateResult, JsValue> {
    console_log!(
        "[WASM] generate_work called. hash: {}, threshold: {}",
        hash_hex,
        threshold_hex
    );
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
    match webgpu::generate_shared(&hash, threshold, &cancel).await {
        Ok(Some(nonce)) => {
            console_log!(
                "[WASM] WebGPU generation succeeded with nonce: {:016x}",
                nonce
            );
            return Ok(GenerateResult {
                nonce,
                is_gpu: true,
            });
        }
        Ok(None) => {
            if cancel.is_cancelled() {
                console_log!("[WASM] WebGPU generation was cancelled.");
                return Err(JsValue::from_str("Work generation cancelled"));
            }
            console_log!("[WASM] WebGPU generation returned None (failed). Falling back to CPU.");
        }
        Err(e) => {
            console_log!(
                "[WASM] WebGPU initialization failed (falling back to CPU): {}",
                e
            );
        }
    }

    // 2. CPU Fallback
    console_log!("[WASM] Falling back to CPU generation...");
    let nonce = cpu::generate_cpu(&hash, threshold);
    console_log!("[WASM] CPU generation succeeded with nonce: {:016x}", nonce);
    Ok(GenerateResult {
        nonce,
        is_gpu: false,
    })
}

/// Asynchronously generate Proof of Work at an arbitrary threshold, forcing
/// WebGPU execution.
///
/// Pass a `WasmCancelToken` created via `new WasmCancelToken()` and call
/// `.cancel()` on it from JavaScript to abort the GPU batch loop (e.g. on timeout).
#[wasm_bindgen]
pub async fn generate_work_gpu(
    hash_hex: &str,
    threshold_hex: &str,
    cancel_token: &WasmCancelToken,
) -> Result<GenerateResult, JsValue> {
    console_log!(
        "[WASM] generate_work_gpu called. hash: {}, threshold: {}",
        hash_hex,
        threshold_hex
    );
    let hash_bytes = hex::decode(hash_hex)
        .map_err(|e| JsValue::from_str(&format!("Invalid hash hex: {}", e)))?;
    let hash: [u8; 32] = hash_bytes
        .try_into()
        .map_err(|_| JsValue::from_str("Hash must be exactly 32 bytes"))?;

    let threshold = u64::from_str_radix(threshold_hex, 16)
        .map_err(|e| JsValue::from_str(&format!("Invalid threshold hex: {}", e)))?;

    console_log!("[WASM] Force WebGPU: Initializing WebGPU and generating...");
    let nonce = webgpu::generate_shared(&hash, threshold, &cancel_token.0)
        .await
        .map_err(|e| {
            console_log!("[WASM] Force WebGPU: Initialization failed: {}", e);
            JsValue::from_str(&format!("WebGPU initialization failed: {}", e))
        })?;

    if let Some(nonce) = nonce {
        console_log!("[WASM] Force WebGPU: Succeeded with nonce: {:016x}", nonce);
        return Ok(GenerateResult {
            nonce,
            is_gpu: true,
        });
    }

    if cancel_token.0.is_cancelled() {
        console_log!("[WASM] Force WebGPU: Generation was cancelled.");
        return Err(JsValue::from_str("Work generation cancelled"));
    }

    console_log!("[WASM] Force WebGPU: Work generation failed.");
    Err(JsValue::from_str("WebGPU work generation failed"))
}

/// Synchronously generate Proof of Work at an arbitrary threshold, forcing
/// single-threaded WASM CPU execution.
#[wasm_bindgen]
pub fn generate_work_cpu(hash_hex: &str, threshold_hex: &str) -> Result<GenerateResult, JsValue> {
    console_log!(
        "[WASM] generate_work_cpu called. hash: {}, threshold: {}",
        hash_hex,
        threshold_hex
    );
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
    Ok(GenerateResult {
        nonce,
        is_gpu: false,
    })
}

/// Synchronously validate a nonce against an arbitrary threshold for a block hash.

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
