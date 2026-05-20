use crate::{Backend, CancelToken, GeneratorDiagnostics, WorkError};
use ocl::{ProQue, Buffer, SpatialDims, flags};
use std::sync::Mutex;

const SHADER: &str = include_str!("pow.cl");

const WORKGROUP_SIZE: usize = 64;
const DISPATCH_X: usize = 1024;
const BATCH_SIZE: usize = WORKGROUP_SIZE * DISPATCH_X;

#[derive(Default, Clone, Debug)]
pub struct OpenClConfig {
    // We can add specific platform/device selection here in the future
}

pub(crate) struct OpenClBackend {
    session: Mutex<OpenClSession>,
}

struct OpenClSession {
    result_nonce: Buffer<u64>,
    result_found: Buffer<u32>,
    kernel: ocl::Kernel,
}

impl OpenClBackend {
    pub fn new(_config: OpenClConfig) -> Result<Self, WorkError> {
        let pro_que = ProQue::builder()
            .src(SHADER)
            .dims(SpatialDims::One(BATCH_SIZE))
            .build()
            .map_err(|e| WorkError::GpuInit(e.to_string()))?;

        let result_nonce = Buffer::<u64>::builder()
            .queue(pro_que.queue().clone())
            .flags(flags::MEM_READ_WRITE)
            .len(1)
            .build()
            .map_err(|e| WorkError::GpuInit(e.to_string()))?;

        let result_found = Buffer::<u32>::builder()
            .queue(pro_que.queue().clone())
            .flags(flags::MEM_READ_WRITE)
            .len(1)
            .build()
            .map_err(|e| WorkError::GpuInit(e.to_string()))?;

        let kernel = pro_que
            .kernel_builder("pow_kernel")
            .arg(0u64)
            .arg(0u64)
            .arg(0u64)
            .arg(0u64)
            .arg(0u64)
            .arg(0u64)
            .arg(&result_nonce)
            .arg(&result_found)
            .build()
            .map_err(|e| WorkError::GpuInit(e.to_string()))?;

        Ok(Self {
            session: Mutex::new(OpenClSession {
                result_nonce,
                result_found,
                kernel,
            }),
        })
    }
}

impl Backend for OpenClBackend {
    fn name(&self) -> &'static str {
        "opencl"
    }

    fn generate(&self, hash: &[u8; 32], threshold: u64, cancel: &CancelToken) -> Option<u64> {
        let session = self.session.lock().ok()?;

        // Convert the 32-byte hash into 4 x u64 (little-endian)
        let mut h = [0u64; 4];
        for (i, chunk) in hash.chunks_exact(8).enumerate() {
            h[i] = u64::from_le_bytes(chunk.try_into().unwrap());
        }

        let mut base_nonce: u64 = rand::random();

        session.kernel.set_arg(0, h[0]).ok()?;
        session.kernel.set_arg(1, h[1]).ok()?;
        session.kernel.set_arg(2, h[2]).ok()?;
        session.kernel.set_arg(3, h[3]).ok()?;
        session.kernel.set_arg(5, threshold).ok()?;

        loop {
            if cancel.is_cancelled() {
                return None;
            }

            session.result_found.write(&[0u32][..]).enq().ok()?;

            session.kernel.set_arg(4, base_nonce).ok()?;

            unsafe {
                session.kernel.enq().ok()?;
            }

            let mut found_arr = [0u32; 1];
            session.result_found.read(&mut found_arr[..]).enq().ok()?;

            if found_arr[0] != 0 {
                let mut nonce_arr = [0u64; 1];
                session.result_nonce.read(&mut nonce_arr[..]).enq().ok()?;
                return Some(nonce_arr[0]);
            }

            base_nonce = base_nonce.wrapping_add(BATCH_SIZE as u64);
        }
    }

    fn diagnostics(&self) -> GeneratorDiagnostics {
        GeneratorDiagnostics {
            backend: "opencl".to_string(),
            gpu: None,
        }
    }
}
