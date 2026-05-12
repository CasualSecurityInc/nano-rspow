use crate::{Backend, CancelToken, WorkError};
use ocl::{ProQue, Buffer, SpatialDims, flags};

const SHADER: &str = include_str!("pow.cl");

const WORKGROUP_SIZE: usize = 64;
const DISPATCH_X: usize = 1024;
const BATCH_SIZE: usize = WORKGROUP_SIZE * DISPATCH_X;

#[derive(Default, Clone, Debug)]
pub struct OpenClConfig {
    // We can add specific platform/device selection here in the future
}

pub(crate) struct OpenClBackend {
    pro_que: ProQue,
}

impl OpenClBackend {
    pub fn new(_config: OpenClConfig) -> Result<Self, WorkError> {
        let pro_que = ProQue::builder()
            .src(SHADER)
            .dims(SpatialDims::One(BATCH_SIZE))
            .build()
            .map_err(|e| WorkError::GpuInit(e.to_string()))?;
            
        Ok(Self { pro_que })
    }
}

impl Backend for OpenClBackend {
    fn name(&self) -> &'static str {
        "opencl"
    }

    fn generate(&self, hash: &[u8; 32], threshold: u64, cancel: &CancelToken) -> Option<u64> {
        // Convert the 32-byte hash into 4 x u64 (little-endian)
        let mut h = [0u64; 4];
        for (i, chunk) in hash.chunks_exact(8).enumerate() {
            h[i] = u64::from_le_bytes(chunk.try_into().unwrap());
        }

        let mut base_nonce: u64 = rand::random();

        let result_nonce = Buffer::<u64>::builder()
            .queue(self.pro_que.queue().clone())
            .flags(flags::MEM_READ_WRITE)
            .len(1)
            .build().ok()?;

        let result_found = Buffer::<u32>::builder()
            .queue(self.pro_que.queue().clone())
            .flags(flags::MEM_READ_WRITE)
            .len(1)
            .build().ok()?;

        let kernel = self.pro_que.kernel_builder("pow_kernel")
            .arg(h[0])
            .arg(h[1])
            .arg(h[2])
            .arg(h[3])
            .arg(base_nonce)
            .arg(threshold)
            .arg(&result_nonce)
            .arg(&result_found)
            .build().ok()?;

        loop {
            if cancel.is_cancelled() {
                return None;
            }

            result_found.write(&[0u32][..]).enq().ok()?;

            kernel.set_arg(4, base_nonce).ok()?;

            unsafe {
                kernel.enq().ok()?;
            }

            let mut found_arr = [0u32; 1];
            result_found.read(&mut found_arr[..]).enq().ok()?;

            if found_arr[0] != 0 {
                let mut nonce_arr = [0u64; 1];
                result_nonce.read(&mut nonce_arr[..]).enq().ok()?;
                return Some(nonce_arr[0]);
            }

            base_nonce = base_nonce.wrapping_add(BATCH_SIZE as u64);
        }
    }
}
