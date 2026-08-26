use nano_rspow::CancelToken;
use nano_rspow::wgpu_types::{SHADER, Uniforms, WORKGROUP_SIZE};

macro_rules! console_log {
    ($($t:tt)*) => (
        web_sys::console::log_1(&wasm_bindgen::JsValue::from_str(&format!($($t)*)))
    )
}

// Double-buffered WebGPU generator.
// Two slots (ping/pong) let us submit batch N while reading back batch N-1,
// guaranteeing the mapped buffer is always already retired — fixing Safari's
// mapAsync bug where mapping an in-flight buffer returns only zeros.
pub struct WgpuWebGenerator {
    device: wgpu::Device,
    queue: wgpu::Queue,
    pipeline: wgpu::ComputePipeline,
    uniform_bufs: [wgpu::Buffer; 2],
    result_bufs: [wgpu::Buffer; 2],
    readback_bufs: [wgpu::Buffer; 2],
    bind_groups: [wgpu::BindGroup; 2],
}

/// Map a GPU readback buffer asynchronously.
/// The double-buffer ping-pong guarantees the buffer being mapped was submitted
/// one full batch ago, so it is already retired — no explicit sync needed.
async fn map_readback_async(buf: &wgpu::Buffer, cancel: &CancelToken) -> bool {
    use js_sys::Function;
    use wasm_bindgen::JsValue;

    if cancel.is_cancelled() {
        return false;
    }

    // Build a JS Promise whose resolve we hand to map_async.
    let mut resolve_holder: Option<Function> = None;
    let promise = js_sys::Promise::new(&mut |resolve, _reject| {
        resolve_holder = Some(resolve);
    });
    let resolve_fn = resolve_holder.expect("Promise constructor called synchronously");

    buf.slice(..).map_async(wgpu::MapMode::Read, move |_res| {
        let _ = resolve_fn.call0(&JsValue::UNDEFINED);
    });

    // Await the map completion promise.
    wasm_bindgen_futures::JsFuture::from(promise).await.is_ok()
}

impl WgpuWebGenerator {
    pub async fn new() -> Result<Self, String> {
        console_log!("[WebGPU] Instantiating wgpu::Instance...");
        let instance = wgpu::Instance::default();

        console_log!("[WebGPU] Requesting adapter...");
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: None,
                force_fallback_adapter: false,
            })
            .await
            .map_err(|e| format!("Failed to request WebGPU adapter: {:?}", e))?;

        console_log!("[WebGPU] Adapter acquired. Requesting device...");
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor {
                label: Some("nano-rspow-web"),
                required_features: wgpu::Features::empty(),
                required_limits: wgpu::Limits::default(),
                memory_hints: wgpu::MemoryHints::Performance,
                trace: Default::default(),
                experimental_features: Default::default(),
            })
            .await
            .map_err(|e| format!("Failed to request WebGPU device: {}", e))?;

        console_log!("[WebGPU] Device and Queue acquired. Compiling WGSL shader...");
        let shader_src = SHADER.replace("WGS_PLACEHOLDER", &WORKGROUP_SIZE.to_string());
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("nano-rspow-pow"),
            source: wgpu::ShaderSource::Wgsl(shader_src.into()),
        });

        let bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("nano-rspow-bgl"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Storage { read_only: false },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
            ],
        });

        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("nano-rspow-pl"),
            bind_group_layouts: &[Some(&bind_group_layout)],
            immediate_size: 0,
        });

        let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("nano-rspow-pipeline"),
            layout: Some(&pipeline_layout),
            module: &shader,
            entry_point: Some("main"),
            compilation_options: Default::default(),
            cache: None,
        });

        console_log!("[WebGPU] Pipeline compiled. Allocating double-buffered slots...");

        let uniform_bufs = std::array::from_fn(|i| {
            device.create_buffer(&wgpu::BufferDescriptor {
                label: Some(&format!("uniforms-{i}")),
                size: std::mem::size_of::<Uniforms>() as u64,
                usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            })
        });
        let result_bufs = std::array::from_fn(|i| {
            device.create_buffer(&wgpu::BufferDescriptor {
                label: Some(&format!("result-{i}")),
                size: 12,
                usage: wgpu::BufferUsages::STORAGE
                    | wgpu::BufferUsages::COPY_SRC
                    | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            })
        });
        let readback_bufs = std::array::from_fn(|i| {
            device.create_buffer(&wgpu::BufferDescriptor {
                label: Some(&format!("readback-{i}")),
                size: 12,
                usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            })
        });
        let bind_groups = std::array::from_fn(|i| {
            device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some(&format!("nano-rspow-bg-{i}")),
                layout: &bind_group_layout,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: uniform_bufs[i].as_entire_binding(),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: result_bufs[i].as_entire_binding(),
                    },
                ],
            })
        });

        console_log!("[WebGPU] Initialization complete (double-buffered)!");
        Ok(Self {
            device,
            queue,
            pipeline,
            uniform_bufs,
            result_bufs,
            readback_bufs,
            bind_groups,
        })
    }

    pub async fn generate(
        &self,
        hash: &[u8; 32],
        threshold: u64,
        cancel: &CancelToken,
    ) -> Option<u64> {
        console_log!(
            "[WebGPU] Starting generation (double-buffered). threshold: {:016x}",
            threshold
        );
        let mut hash0 = [0u32; 4];
        let mut hash1 = [0u32; 4];
        for (output, chunk) in hash0.iter_mut().zip(hash[..16].as_chunks::<4>().0) {
            *output = u32::from_le_bytes(*chunk);
        }
        for (output, chunk) in hash1.iter_mut().zip(hash[16..].as_chunks::<4>().0) {
            *output = u32::from_le_bytes(*chunk);
        }

        let threshold_lo = threshold as u32;
        let threshold_hi = (threshold >> 32) as u32;
        // 65535 × 64 workgroup threads = ~4.19M nonces per batch.
        const DISPATCH_X: u32 = 65535;
        let nonces_per_batch = (WORKGROUP_SIZE * DISPATCH_X) as u64;

        let mut base_nonce: u64 = rand::random();
        let mut batch_count = 0u64;

        // Submit one compute batch into `slot`.
        let submit = |slot: usize, nonce: u64| {
            let uniforms = Uniforms {
                hash0,
                hash1,
                base_nonce_lo: nonce as u32,
                base_nonce_hi: (nonce >> 32) as u32,
                threshold_lo,
                threshold_hi,
            };
            self.queue
                .write_buffer(&self.uniform_bufs[slot], 0, bytemuck::bytes_of(&uniforms));
            let mut enc = self
                .device
                .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                    label: Some("nano-rspow-enc"),
                });
            enc.clear_buffer(&self.result_bufs[slot], 0, None);
            {
                let mut pass = enc.begin_compute_pass(&wgpu::ComputePassDescriptor {
                    label: Some("pow"),
                    timestamp_writes: None,
                });
                pass.set_pipeline(&self.pipeline);
                pass.set_bind_group(0, &self.bind_groups[slot], &[]);
                pass.dispatch_workgroups(DISPATCH_X, 1, 1);
            }
            enc.copy_buffer_to_buffer(&self.result_bufs[slot], 0, &self.readback_bufs[slot], 0, 12);
            self.queue.submit(std::iter::once(enc.finish()));
        };

        // Warm-up: submit slot 0 so there is always a prior batch to read back.
        submit(0, base_nonce);
        base_nonce = base_nonce.wrapping_add(nonces_per_batch);
        let mut slot: usize = 1;

        loop {
            batch_count += 1;

            if cancel.is_cancelled() {
                console_log!("[WebGPU] Cancelled after {} batch(es).", batch_count - 1);
                return None;
            }

            // Submit current slot.
            submit(slot, base_nonce);
            base_nonce = base_nonce.wrapping_add(nonces_per_batch);

            // Read back the PREVIOUS slot — guaranteed retired by GPU ordering.
            let prev = slot ^ 1;
            let ok = map_readback_async(&self.readback_bufs[prev], cancel).await;
            if !ok {
                if cancel.is_cancelled() {
                    console_log!("[WebGPU] Cancelled after {} batch(es).", batch_count);
                }
                return None;
            }

            let data: Vec<u32> = {
                let mapped = self.readback_bufs[prev].slice(..).get_mapped_range();
                bytemuck::cast_slice(&mapped).to_vec()
            };
            self.readback_bufs[prev].unmap();

            if batch_count <= 3 {
                console_log!(
                    "[WebGPU] batch={} slot={} prev={} data=[{:#010x}, {:#010x}, {}]",
                    batch_count,
                    slot,
                    prev,
                    data[0],
                    data[1],
                    data[2]
                );
            }

            if data[2] != 0 {
                let found_nonce = data[0] as u64 | ((data[1] as u64) << 32);
                console_log!(
                    "[WebGPU] Found nonce after {} batch(es): {:016x}",
                    batch_count,
                    found_nonce
                );
                return Some(found_nonce);
            }

            slot ^= 1;
        }
    }
}
