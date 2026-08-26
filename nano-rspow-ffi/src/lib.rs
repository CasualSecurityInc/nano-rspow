//! A deliberately small, panic-safe C ABI for the native nano-rspow engine.
//!
//! The ABI owns all generator state, worker threads, GPU resources, and
//! cancellation tokens. Callers pass copied fixed-size values and never give
//! the engine Go pointers to retain or callbacks to invoke.

use nano_rspow::{GeneratorDiagnostics, TuningSource, WorkGenerator};
use std::ffi::c_char;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::ptr;

const ABI_VERSION: u32 = 1;

pub const BACKEND_AUTO: u32 = 0;
pub const BACKEND_CPU: u32 = 1;
pub const BACKEND_WGPU: u32 = 2;

/// Status values returned by every fallible ABI operation.
#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NanoRspowStatus {
    Ok = 0,
    InvalidArgument = 1,
    NullPointer = 2,
    AllocationFailure = 3,
    GenerationFailed = 4,
    Cancelled = 5,
    BackendUnavailable = 6,
    BufferTooSmall = 7,
    Panic = 8,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct NanoRspowWorkResult {
    pub nonce: u64,
    pub difficulty: u64,
    pub threshold: u64,
    pub is_valid: u8,
}

/// Fixed-size, allocation-free diagnostics suitable for C and Go callers.
/// Strings are UTF-8 bytes terminated with NUL when they fit.
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct NanoRspowDiagnostics {
    pub backend: [u8; 32],
    pub backend_api: [u8; 32],
    pub adapter_name: [u8; 128],
    pub driver_info: [u8; 128],
    pub has_gpu: u8,
    pub vendor_id: u32,
    pub device_id: u32,
    pub max_compute_workgroups_per_dimension: u32,
    pub dispatch_x: u32,
    pub nonces_per_dispatch: u64,
    pub tuning_source: u8,
}

impl Default for NanoRspowDiagnostics {
    fn default() -> Self {
        Self {
            backend: [0; 32],
            backend_api: [0; 32],
            adapter_name: [0; 128],
            driver_info: [0; 128],
            has_gpu: 0,
            vendor_id: 0,
            device_id: 0,
            max_compute_workgroups_per_dimension: 0,
            dispatch_x: 0,
            nonces_per_dispatch: 0,
            tuning_source: 0,
        }
    }
}

pub struct NanoRspowGenerator {
    inner: WorkGenerator,
}

pub struct NanoRspowRequest {
    inner: nano_rspow::CancelToken,
}

fn copy_text(destination: &mut [u8], value: &str) {
    if destination.is_empty() {
        return;
    }
    let bytes = value.as_bytes();
    let count = bytes.len().min(destination.len() - 1);
    destination[..count].copy_from_slice(&bytes[..count]);
    destination[count] = 0;
}

fn diagnostics_from_core(source: GeneratorDiagnostics) -> NanoRspowDiagnostics {
    let mut result = NanoRspowDiagnostics::default();
    copy_text(&mut result.backend, &source.backend);
    if let Some(gpu) = source.gpu {
        result.has_gpu = 1;
        copy_text(&mut result.backend_api, &gpu.backend_api);
        copy_text(&mut result.adapter_name, &gpu.adapter_name);
        copy_text(&mut result.driver_info, &gpu.driver_info);
        result.vendor_id = gpu.vendor_id;
        result.device_id = gpu.device_id;
        result.max_compute_workgroups_per_dimension = gpu.max_compute_workgroups_per_dimension;
        result.dispatch_x = gpu.dispatch_x;
        result.nonces_per_dispatch = gpu.nonces_per_dispatch;
        result.tuning_source = match gpu.tuning_source {
            TuningSource::Cache => 1,
            TuningSource::Probe => 2,
            TuningSource::Heuristic => 3,
            TuningSource::Manual => 4,
        };
    }
    result
}

fn with_panic_guard(operation: impl FnOnce() -> NanoRspowStatus) -> NanoRspowStatus {
    match catch_unwind(AssertUnwindSafe(operation)) {
        Ok(status) => status,
        Err(_) => NanoRspowStatus::Panic,
    }
}

fn copy_hash(source: *const u8) -> Result<[u8; 32], NanoRspowStatus> {
    if source.is_null() {
        return Err(NanoRspowStatus::NullPointer);
    }
    let mut hash = [0u8; 32];
    // SAFETY: the caller contract requires a readable 32-byte hash. The
    // pointer is copied immediately and is never retained by Rust.
    unsafe { ptr::copy_nonoverlapping(source, hash.as_mut_ptr(), hash.len()) };
    Ok(hash)
}

#[unsafe(no_mangle)]
pub extern "C" fn nano_rspow_abi_version() -> u32 {
    ABI_VERSION
}

#[unsafe(no_mangle)]
pub extern "C" fn nano_rspow_status_message(status: NanoRspowStatus) -> *const c_char {
    let message = match status {
        NanoRspowStatus::Ok => b"ok\0" as &[u8],
        NanoRspowStatus::InvalidArgument => b"invalid argument\0",
        NanoRspowStatus::NullPointer => b"null pointer\0",
        NanoRspowStatus::AllocationFailure => b"allocation failure\0",
        NanoRspowStatus::GenerationFailed => b"work generation failed\0",
        NanoRspowStatus::Cancelled => b"work generation cancelled\0",
        NanoRspowStatus::BackendUnavailable => b"backend unavailable\0",
        NanoRspowStatus::BufferTooSmall => b"buffer too small\0",
        NanoRspowStatus::Panic => b"rust panic caught at FFI boundary\0",
    };
    message.as_ptr().cast()
}

#[unsafe(no_mangle)]
/// Creates a work generator for the requested backend.
///
/// # Safety
///
/// If `output` is non-null, it must point to writable storage for one generator
/// handle. The returned handle must be released with [`nano_rspow_generator_free`].
pub unsafe extern "C" fn nano_rspow_generator_new(
    backend: u32,
    output: *mut *mut NanoRspowGenerator,
) -> NanoRspowStatus {
    if output.is_null() {
        return NanoRspowStatus::NullPointer;
    }
    // SAFETY: output was checked above and is written before any allocation.
    unsafe { *output = ptr::null_mut() };

    with_panic_guard(|| {
        let inner = match backend {
            BACKEND_AUTO => WorkGenerator::auto(),
            BACKEND_CPU => WorkGenerator::cpu(),
            BACKEND_WGPU => {
                #[cfg(feature = "wgpu-backend")]
                {
                    match WorkGenerator::gpu() {
                        Ok(generator) => generator,
                        Err(_) => return NanoRspowStatus::BackendUnavailable,
                    }
                }
                #[cfg(not(feature = "wgpu-backend"))]
                {
                    return NanoRspowStatus::BackendUnavailable;
                }
            }
            _ => return NanoRspowStatus::InvalidArgument,
        };

        let generator = Box::new(NanoRspowGenerator { inner });
        // SAFETY: output is non-null and receives ownership of a Box pointer.
        unsafe { *output = Box::into_raw(generator) };
        NanoRspowStatus::Ok
    })
}

#[unsafe(no_mangle)]
/// Releases a generator created by [`nano_rspow_generator_new`].
///
/// # Safety
///
/// `generator` must be null or a live handle returned by
/// [`nano_rspow_generator_new`] that has not already been freed.
pub unsafe extern "C" fn nano_rspow_generator_free(generator: *mut NanoRspowGenerator) {
    if !generator.is_null() {
        // SAFETY: pointer must have been returned by generator_new and is
        // consumed exactly once by the caller.
        unsafe { drop(Box::from_raw(generator)) };
    }
}

#[unsafe(no_mangle)]
/// Creates a cancellation request handle.
///
/// # Safety
///
/// If `output` is non-null, it must point to writable storage for one request
/// handle. The returned handle must be released with [`nano_rspow_request_free`].
pub unsafe extern "C" fn nano_rspow_request_new(
    output: *mut *mut NanoRspowRequest,
) -> NanoRspowStatus {
    if output.is_null() {
        return NanoRspowStatus::NullPointer;
    }
    // SAFETY: output was checked above.
    unsafe { *output = ptr::null_mut() };
    with_panic_guard(|| {
        let request = Box::new(NanoRspowRequest {
            inner: nano_rspow::CancelToken::new(),
        });
        // SAFETY: output is non-null and receives ownership of this Box.
        unsafe { *output = Box::into_raw(request) };
        NanoRspowStatus::Ok
    })
}

#[unsafe(no_mangle)]
/// Requests cancellation for a work operation.
///
/// # Safety
///
/// `request` must be null or a live request handle that is not concurrently
/// freed while this function runs.
pub unsafe extern "C" fn nano_rspow_request_cancel(
    request: *mut NanoRspowRequest,
) -> NanoRspowStatus {
    if request.is_null() {
        return NanoRspowStatus::NullPointer;
    }
    with_panic_guard(|| {
        // SAFETY: request is checked non-null and remains owned by caller.
        unsafe { (*request).inner.cancel() };
        NanoRspowStatus::Ok
    })
}

#[unsafe(no_mangle)]
/// Reports whether a request has been cancelled.
///
/// # Safety
///
/// `request` must be null or a live request handle. If `output` is non-null,
/// it must point to writable storage for one byte.
pub unsafe extern "C" fn nano_rspow_request_is_cancelled(
    request: *const NanoRspowRequest,
    output: *mut u8,
) -> NanoRspowStatus {
    if request.is_null() || output.is_null() {
        return NanoRspowStatus::NullPointer;
    }
    with_panic_guard(|| {
        // SAFETY: both pointers were checked and point to caller-owned data.
        unsafe { *output = u8::from((*request).inner.is_cancelled()) };
        NanoRspowStatus::Ok
    })
}

#[unsafe(no_mangle)]
/// Releases a request created by [`nano_rspow_request_new`].
///
/// # Safety
///
/// `request` must be null or a live handle returned by [`nano_rspow_request_new`]
/// that has not already been freed.
pub unsafe extern "C" fn nano_rspow_request_free(request: *mut NanoRspowRequest) {
    if !request.is_null() {
        // SAFETY: pointer must have been returned by request_new and is
        // consumed exactly once by the caller.
        unsafe { drop(Box::from_raw(request)) };
    }
}

#[unsafe(no_mangle)]
/// Generates work using a generator and cancellation request.
///
/// # Safety
///
/// Non-null `generator` and `request` pointers must be live handles. `hash` must
/// point to 32 readable bytes, and `output` must point to writable result storage.
/// None of these pointers may be concurrently invalidated during the call.
pub unsafe extern "C" fn nano_rspow_generator_generate(
    generator: *const NanoRspowGenerator,
    hash: *const u8,
    threshold: u64,
    request: *const NanoRspowRequest,
    output: *mut NanoRspowWorkResult,
) -> NanoRspowStatus {
    if generator.is_null() || request.is_null() || output.is_null() {
        return NanoRspowStatus::NullPointer;
    }
    with_panic_guard(|| {
        let hash = match copy_hash(hash) {
            Ok(hash) => hash,
            Err(status) => return status,
        };
        // SAFETY: all handles and output were checked non-null. Rust does not
        // retain either handle after this call returns.
        let result = unsafe {
            (*generator)
                .inner
                .generate_with_cancel(&hash, threshold, &(*request).inner)
        };
        match result {
            Some(result) => {
                // SAFETY: output was checked non-null and belongs to caller.
                unsafe {
                    *output = NanoRspowWorkResult {
                        nonce: result.nonce,
                        difficulty: result.difficulty,
                        threshold: result.threshold,
                        is_valid: u8::from(result.is_valid()),
                    };
                }
                NanoRspowStatus::Ok
            }
            None => {
                // SAFETY: request was checked non-null.
                if unsafe { (*request).inner.is_cancelled() } {
                    NanoRspowStatus::Cancelled
                } else {
                    NanoRspowStatus::GenerationFailed
                }
            }
        }
    })
}

#[unsafe(no_mangle)]
/// Validates a work nonce with a generator.
///
/// # Safety
///
/// A non-null `generator` must be a live handle. `hash` must point to 32 readable
/// bytes and `output` to writable result storage for the duration of the call.
pub unsafe extern "C" fn nano_rspow_generator_validate(
    generator: *const NanoRspowGenerator,
    hash: *const u8,
    nonce: u64,
    threshold: u64,
    output: *mut NanoRspowWorkResult,
) -> NanoRspowStatus {
    if generator.is_null() || output.is_null() {
        return NanoRspowStatus::NullPointer;
    }
    with_panic_guard(|| {
        let hash = match copy_hash(hash) {
            Ok(hash) => hash,
            Err(status) => return status,
        };
        // SAFETY: generator and output were checked above.
        let result = unsafe { (*generator).inner.validate(&hash, nonce, threshold) };
        // SAFETY: output was checked non-null and belongs to caller.
        unsafe {
            *output = NanoRspowWorkResult {
                nonce: result.nonce,
                difficulty: result.difficulty,
                threshold: result.threshold,
                is_valid: u8::from(result.is_valid()),
            };
        }
        NanoRspowStatus::Ok
    })
}

#[unsafe(no_mangle)]
/// Retrieves diagnostics for a generator backend.
///
/// # Safety
///
/// A non-null `generator` must be a live handle and `output` must point to
/// writable [`NanoRspowDiagnostics`] storage for the duration of the call.
pub unsafe extern "C" fn nano_rspow_generator_diagnostics(
    generator: *const NanoRspowGenerator,
    output: *mut NanoRspowDiagnostics,
) -> NanoRspowStatus {
    if generator.is_null() || output.is_null() {
        return NanoRspowStatus::NullPointer;
    }
    with_panic_guard(|| {
        // SAFETY: both pointers were checked above.
        let diagnostics = unsafe { (*generator).inner.diagnostics() };
        // SAFETY: output was checked non-null and belongs to caller.
        unsafe { *output = diagnostics_from_core(diagnostics) };
        NanoRspowStatus::Ok
    })
}

#[unsafe(no_mangle)]
/// Writes the generator backend name into a caller-provided buffer.
///
/// # Safety
///
/// A non-null `generator` must be a live handle and `required` must point to
/// writable storage. When `output` is non-null, it must designate a writable
/// buffer of at least `capacity` bytes for the duration of the call.
pub unsafe extern "C" fn nano_rspow_generator_backend_name(
    generator: *const NanoRspowGenerator,
    output: *mut u8,
    capacity: usize,
    required: *mut usize,
) -> NanoRspowStatus {
    if generator.is_null() || required.is_null() {
        return NanoRspowStatus::NullPointer;
    }
    with_panic_guard(|| {
        // SAFETY: generator was checked above.
        let name = unsafe { (*generator).inner.backend_name() }.as_bytes();
        // SAFETY: required was checked above.
        unsafe { *required = name.len() };
        if capacity < name.len() || (!name.is_empty() && output.is_null()) {
            return NanoRspowStatus::BufferTooSmall;
        }
        if !name.is_empty() {
            // SAFETY: capacity was checked and output is non-null.
            unsafe { ptr::copy_nonoverlapping(name.as_ptr(), output, name.len()) };
        }
        NanoRspowStatus::Ok
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn known_hash() -> [u8; 32] {
        [
            0x71, 0x8c, 0xc2, 0x12, 0x1c, 0x3e, 0x64, 0x10, 0x59, 0xbc, 0x1c, 0x2c, 0xfc, 0x45,
            0x66, 0x6c, 0x99, 0xe8, 0xae, 0x92, 0x2f, 0x7a, 0x80, 0x7b, 0x7d, 0x07, 0xb6, 0x2c,
            0x99, 0x5d, 0x79, 0xe2,
        ]
    }

    #[test]
    fn abi_version_is_stable() {
        assert_eq!(nano_rspow_abi_version(), 1);
    }

    #[test]
    fn cpu_validation_matches_known_vector() {
        let mut generator = ptr::null_mut();
        assert_eq!(
            unsafe { nano_rspow_generator_new(BACKEND_CPU, &mut generator) },
            NanoRspowStatus::Ok
        );
        let hash = known_hash();
        let mut result = NanoRspowWorkResult::default();
        assert_eq!(
            unsafe {
                nano_rspow_generator_validate(
                    generator,
                    hash.as_ptr(),
                    0x2bf29ef00786a6bc,
                    nano_rspow::thresholds::legacy::EPOCH1,
                    &mut result,
                )
            },
            NanoRspowStatus::Ok
        );
        assert_eq!(result.difficulty, 0xffffffd21c3933f4);
        assert_eq!(result.is_valid, 1);
        unsafe { nano_rspow_generator_free(generator) };
    }

    #[test]
    fn null_pointers_are_statuses_not_panics() {
        assert_eq!(
            unsafe { nano_rspow_generator_new(BACKEND_CPU, ptr::null_mut()) },
            NanoRspowStatus::NullPointer
        );
        assert_eq!(
            unsafe { nano_rspow_request_cancel(ptr::null_mut()) },
            NanoRspowStatus::NullPointer
        );
    }
}
